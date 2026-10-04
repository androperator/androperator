import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
