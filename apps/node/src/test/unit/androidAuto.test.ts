import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { DhuSession } from "../../domain/android-auto/session.js";
import { AndroidAutoClient, startAndroidAutoBroker } from "../../domain/android-auto/broker.js";
import { ANDROID_AUTO_COMMANDS } from "../../domain/android-auto/commands.js";
import { ANDROID_AUTO_KEYS } from "../../contracts/keys.js";
import { runHostInputSequence } from "../../domain/actions/hostInput.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";
import { validateExecution } from "../../domain/executions/validateExecution.js";

async function withFakeDhu(mode: "normal" | "exit" | "no-frame" | "reject-input", run: (binary: string, log: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dhu-test-"));
  const binary = join(directory, "dhu");
  const log = join(directory, "commands.jsonl");
  const png = PNG.sync.write(new PNG({ width: 1, height: 1 })).toString("base64");
  await writeFile(binary, `#!${process.execPath}\n` + `
const fs = require('node:fs');
if (${JSON.stringify(mode)} === 'exit') process.exit(0);
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(line) + '\\n');
  if (${JSON.stringify(mode)} === 'reject-input' && line.startsWith('dpad ')) process.stderr.write('[E]: rejected input\\n');
  if (line.startsWith('screenshot ') && ${JSON.stringify(mode)} !== 'no-frame') {
    fs.writeFileSync(line.slice(11), Buffer.from(${JSON.stringify(png)}, 'base64'));
  }
});
`, { mode: 0o700 });
  try { await run(binary, log); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("Android Auto DHU session", () => {
  it("accepts all public keys and sends the documented commands with frame barriers", async () => {
    for (const key of ANDROID_AUTO_KEYS) validateExecution({ commandId: "auto", taskId: "auto", source: "test", expectedFormat: "android-ui-automator", timeoutMs: 10000,
      actions: [{ id: key, type: "press_key", params: { key } }] });
    await withFakeDhu("normal", async (binary, log) => {
      const session = await DhuSession.start(binary, 5277, 2000);
      try {
        for (const key of ANDROID_AUTO_KEYS) await session.press(key, 1000);
        const commands = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line) as string);
        assert.deepEqual(commands.filter(command => !command.startsWith("screenshot ")), Object.values(ANDROID_AUTO_COMMANDS));
        assert.equal(commands.filter(command => command.startsWith("screenshot ")).length, ANDROID_AUTO_KEYS.length + 1);
      } finally { await session.close(); }
    });
  });
  it("does not treat DHU exit zero as a ready connection", async () => {
    await withFakeDhu("exit", async binary => {
      await assert.rejects(DhuSession.start(binary, 5277, 1000), { code: "ANDROID_AUTO_SESSION_CLOSED" });
    });
  });
  it("bounds startup when no projection frame arrives", async () => {
    await withFakeDhu("no-frame", async binary => {
      await assert.rejects(DhuSession.start(binary, 5277, 150), { code: "ANDROID_AUTO_NOT_READY" });
    });
  });
  it("rejects DHU errors even if the following screenshot succeeds", async () => {
    await withFakeDhu("reject-input", async binary => {
      const session = await DhuSession.start(binary, 5277, 2000);
      await assert.rejects(session.press("android_auto_rotary_center", 1000), { code: "ANDROID_AUTO_INPUT_UNCONFIRMED" });
      await assert.rejects(session.press("android_auto_back", 1000), { code: "ANDROID_AUTO_SESSION_CLOSED" });
    });
  });
});

describe("Android Auto execution lease", () => {
  it("excludes another caller until the full execution releases its lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auto-socket-"));
    const path = join(directory, "control.sock");
    const keys: string[] = [];
    const broker = await startAndroidAutoBroker("phone", { press: async key => { keys.push(key); }, close: async () => {} }, path);
    const first = AndroidAutoClient.connect(path);
    const second = AndroidAutoClient.connect(path);
    try {
      await first.request("phone", "acquire", 1000);
      await assert.rejects(second.request("phone", "acquire", 1000), { code: "EXECUTION_CONFLICT_IN_FLIGHT" });
      const result = await first.request("phone", "press", 1000, "android_auto_rotary_center");
      assert.equal(result.dhuCommand, "dpad click");
      await assert.rejects(second.request("wrong-phone", "press", 1000, "android_auto_home"), { code: "EXECUTION_VALIDATION_FAILED" });
      assert.deepEqual(keys, ["android_auto_rotary_center"]);
    } finally { first.close(); second.close(); await broker.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it("cancels an uncertain in-flight input and closes the session when its caller disappears", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auto-cancel-"));
    const path = join(directory, "control.sock");
    let closed = false;
    let aborted = false;
    const broker = await startAndroidAutoBroker("phone", {
      press: async (_key, _timeout, signal) => new Promise<void>((_resolve, reject) => {
        signal!.addEventListener("abort", () => { aborted = true; reject(new Error("canceled")); }, { once: true });
      }),
      close: async () => { closed = true; },
    }, path);
    const client = AndroidAutoClient.connect(path);
    try {
      await client.request("phone", "acquire", 1000);
      await assert.rejects(client.request("phone", "press", 100, "android_auto_home"));
      await broker.closed;
      assert.equal(aborted, true);
      assert.equal(closed, true);
    } finally { client.close(); await broker.close(); await rm(directory, { recursive: true, force: true }); }
  });
});


it("preserves mixed DHU/runtime ordering, caller IDs, and evidence before a later failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-mixed-"));
  const path = join(directory, "control.sock");
  const order: string[] = [];
  const broker = await startAndroidAutoBroker("phone", {
    press: async key => {
      order.push(key);
      if (key === "android_auto_home") throw { code: "ANDROID_AUTO_INPUT_UNCONFIRMED", message: "lost video" };
    },
    close: async () => {},
  }, path);
  const input = validateExecution({ commandId: "caller-command", taskId: "caller-task", source: "test", expectedFormat: "android-ui-automator", timeoutMs: 5000,
    actions: [
      { id: "first", type: "press_key", params: { key: "android_auto_rotary_center" } },
      { id: "phone", type: "press_key", params: { key: "back" } },
      { id: "failed", type: "press_key", params: { key: "android_auto_home" } },
      { id: "skipped", type: "press_key", params: { key: "android_auto_back" } },
    ] });
  try {
    const result = await runHostInputSequence(input, getDefaultRuntimeConfig({ deviceId: "phone", runner: new FakeProcessRunner() }), async segment => {
      order.push("phone-back");
      assert.equal(segment.taskId, "caller-task");
      assert.notEqual(segment.commandId, "caller-command");
      return { ok: true, deviceId: "phone", terminalSource: "androperator_result", envelope: {
        commandId: segment.commandId, taskId: segment.taskId, status: "success",
        stepResults: [{ id: "phone", actionType: "press_key", success: true, data: { key: "back" } }],
      } };
    }, undefined, () => AndroidAutoClient.connect(path));
    assert.deepEqual(order, ["android_auto_rotary_center", "phone-back", "android_auto_home"]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "ANDROID_AUTO_INPUT_UNCONFIRMED");
      const details = result.error.details as { stepResults: { id: string }[] };
      assert.deepEqual(details.stepResults.map(step => step.id), ["first", "phone"]);
    }
  } finally { await broker.close(); await rm(directory, { recursive: true, force: true }); }
});
