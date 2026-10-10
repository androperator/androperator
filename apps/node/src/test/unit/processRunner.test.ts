import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { NodeProcessRunner } from "../../adapters/android-bridge/processRunner.js";

const runner = new NodeProcessRunner();

test("process runner preserves input, output, exit codes and missing-executable errors", async () => {
  const result = await runner.run(process.execPath, ["-e", `
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', data => process.stdout.write(data));
    process.stdin.on('end', () => { process.stderr.write('diagnostic'); process.exitCode = 7; });
  `], { input: "input text" });
  assert.deepEqual(result, { stdout: "input text", stderr: "diagnostic", code: 7 });
  const missing = await runner.run("androperator-test-missing-executable", []);
  assert.equal(missing.code, 127);
  assert.equal((missing.error as NodeJS.ErrnoException).code, "ENOENT");
});

test("timeout is bounded even when the child ignores SIGTERM and would later exit successfully", async () => {
  const started = Date.now();
  const result = await runner.run(process.execPath, ["-e", `
    process.on('SIGTERM', () => {});
    console.log('ready');
    console.error('before timeout');
    setTimeout(() => process.exit(0), 5000);
  `], { timeoutMs: 1000 });
  assert.equal(result.stdout, "ready\n");
  assert.equal(result.code, null);
  assert.match(result.stderr, /before timeout\n\nProcess timed out after 1000ms/);
  assert.ok(Date.now() - started < 4000, "must settle before the child's successful exit");
});

test("shell timeout kills descendants holding inherited output pipes", { skip: process.platform === "win32" }, async () => {
  const started = Date.now();
  const result = await runner.runShell("sleep 30 & echo $!; wait", { timeoutMs: 1000 });
  const pid = Number(result.stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 0, "shell must report its child PID");
  try {
    assert.equal(result.code, null);
    assert.match(result.stderr, /Process timed out after 1000ms/);
    assert.ok(Date.now() - started < 4000, "inherited pipes must not keep runShell pending");
    await delay(100);
    const state = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
    assert.equal(state.error, undefined);
    assert.ok(state.stdout.trim() === "" || state.stdout.trim().startsWith("Z"), "descendant must be terminated");
  } finally {
    try { process.kill(pid, "SIGKILL"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
});

test("early child exit tolerates unconsumed stdin", async () => {
  const result = await runner.run(process.execPath, ["-e", "process.exit(0)"], { input: "x".repeat(2_000_000) });
  assert.equal(result.code, 0);
});

for (const customHandler of [false, true]) {
  test(`parent interruption terminates its owned command (${customHandler ? "custom" : "default"} handler)`, { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "runner-interruption-"));
    const pidFile = join(root, "child-pid");
    const runnerUrl = new URL("../../adapters/android-bridge/processRunner.js", import.meta.url).href;
    const childScript = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const parent = spawn(process.execPath, ["--input-type=module", "-e", `
      import { NodeProcessRunner } from ${JSON.stringify(runnerUrl)};
      ${customHandler ? "process.once('SIGINT', () => process.exit(42));" : ""}
      await new NodeProcessRunner().run(process.execPath, ['-e', ${JSON.stringify(childScript)}]);
    `], { detached: true, stdio: "ignore" });
    const closed = once(parent, "close");
    let childPid: number | undefined;
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { childPid = Number(await readFile(pidFile, "utf8")); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await delay(20);
      }
      assert.ok(childPid && parent.pid, "fixture must start before interruption");
      process.kill(-parent.pid, "SIGINT");
      const [code, signal] = await closed;
      if (customHandler) assert.equal(code, 42);
      else assert.equal(signal, "SIGINT");
      await delay(100);
      const state = spawnSync("ps", ["-p", String(childPid), "-o", "stat="], { encoding: "utf8" });
      assert.equal(state.error, undefined);
      assert.ok(state.stdout.trim() === "" || state.stdout.trim().startsWith("Z"), "owned child must not survive interruption");
    } finally {
      for (const pid of [parent.pid === undefined ? undefined : -parent.pid, childPid]) {
        if (pid !== undefined) {
          try { process.kill(pid, "SIGKILL"); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
      }
      await closed;
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("cancellation terminates an owned process and releases its pipes before its timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "runner-cancellation-"));
  const pidFile = join(root, "pid");
  const controller = new AbortController();
  const pending = runner.run(process.execPath, ["-e", `
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `], { timeoutMs: 10000, signal: controller.signal });
  try {
    const deadline = Date.now() + 5000;
    let pid: number | undefined;
    while (Date.now() < deadline) {
      try { pid = Number(await readFile(pidFile, "utf8")); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await delay(20);
    }
    assert.ok(pid, "fixture must start before cancellation");
    const started = Date.now();
    controller.abort();
    const result = await pending;
    assert.equal(result.code, null);
    assert.match(result.stderr, /cancelled/);
    assert.ok(Date.now() - started < 1000, "cancellation must not await the command timeout");
    await delay(100);
    assert.throws(() => process.kill(pid!, 0), (error: any) => error.code === "ESRCH");
  } finally {
    controller.abort();
    await pending;
    await rm(root, { recursive: true, force: true });
  }
});

test("an already-cancelled process does not spawn", async () => {
  const result = await runner.run("androperator-test-missing-executable", [], { signal: AbortSignal.abort() });
  assert.equal(result.code, null);
  assert.equal(result.error, undefined);
  assert.match(result.stderr, /cancelled/);
});
