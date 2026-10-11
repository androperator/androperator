import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PNG } from "pngjs";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import type { Logger, LogEvent } from "../../adapters/logger.js";
import { captureScreenshot } from "../../domain/observe/captureScreenshot.js";
import { verifyScreenshot } from "../../domain/observe/screenshotMetadata.js";

const png = PNG.sync.write(new PNG({ width: 8, height: 4 }));
const diagnostics = Buffer.from("FORTIFY: native shutdown diagnostic containing private-device-text\n");
function fixture(bytes: Buffer, exitCode = 0, silent = false) {
  const events: LogEvent[] = [];
  const logger: Logger = { emit: event => events.push(event), child: () => logger,
    status: () => ({ status: "disabled" }), logPath: () => undefined };
  const runner: ProcessRunner = {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    runShell: async () => { throw Error("No host shell"); },
    spawn: (_command, args) => {
      assert.deepEqual(args, ["-s", "test-device", "shell", "-T", "screencap", "-p"]);
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(),
        kill: () => { queueMicrotask(() => child.emit("close", null)); } });
      queueMicrotask(() => {
        child.stdout.emit("data", bytes);
        child.stderr.emit("data", diagnostics);
        if (!silent) child.emit("close", exitCode);
      });
      return child;
    },
  };
  return { config: getDefaultRuntimeConfig({ deviceId: "test-device", runner, logger }), events };
}

test("stock capture keeps remote diagnostics separate and reports only a redacted warning", async () => {
  const { config, events } = fixture(png);
  const result = await captureScreenshot(config, { timeoutMs: 1000, commandId: "capture", taskId: "task" });
  assert.deepEqual(result, png);
  assert.equal(verifyScreenshot(result).captureWidthPx, 8);
  const warning = events.find(event => event.event === "screenshot.diagnostic");
  assert.equal(warning?.level, "warn");
  assert.equal(warning?.commandId, "capture");
  assert.equal(warning?.taskId, "task");
  assert.match(warning!.message!, new RegExp(`${diagnostics.length} diagnostic bytes`));
  assert.ok(!JSON.stringify(events).includes("private-device-text"));
});

for (const code of [1, 134]) test(`complete PNG does not conceal remote failure ${code}`, async () => {
  const { config } = fixture(png, code);
  await assert.rejects(captureScreenshot(config, { timeoutMs: 1000 }), error => {
    assert.equal((error as any).code, "EVIDENCE_CAPTURE_FAILED");
    assert.deepEqual((error as any).partialBuffer, png);
    return true;
  });
});

test("stock capture timeout remains a failure even after complete image bytes", async () => {
  const { config } = fixture(png, 0, true);
  await assert.rejects(captureScreenshot(config, { timeoutMs: 30 }), error => {
    assert.equal((error as any).code, "COMMAND_TIMEOUT");
    return true;
  });
});

test("remote stdout is never trimmed to conceal invalid PNG data", async () => {
  const bytes = Buffer.concat([png, diagnostics]);
  const { config } = fixture(bytes);
  const result = await captureScreenshot(config, { timeoutMs: 1000 });
  assert.deepEqual(result, bytes);
  assert.throws(() => verifyScreenshot(result));
});
