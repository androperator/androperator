import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExecution } from "../../domain/executions/runExecution.js";
import { closeCaptureHelpers } from "../../domain/observe/captureHelper.js";
import { scaledCaptureRunner } from "./fakes/scaledCaptureRunner.js";
import { verifyScreenshot } from "../../domain/observe/screenshotMetadata.js";

for (const fallback of [false, true]) {
  for (const scale of [undefined, 25, 50, 100] as const) {
    test(`${fallback ? "fallback" : "direct"} scale ${scale ?? "omitted"} publishes scale-aware hints with the PNG`, async () => {
      const directory = await fs.mkdtemp(join(tmpdir(), "screenshot-guidance-"));
      const path = join(directory, "screen.png");
      const { runner, captures } = await scaledCaptureRunner(fallback);
      try {
        const result = await runExecution({ commandId: "guidance-request", taskId: "guidance-task", source: "test",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "shot", type: "take_screenshot", params: { path, ...(scale !== undefined ? { scale } : {}) } }] }, {
          deviceId: "test-device", operatorPackage: "com.test.operator", runner,
          ensureInteractiveAutomationReadyFn: async () => ({ ok: true, state: { screenOn: true, deviceLocked: false, userUnlocked: true } }),
          logcatBroadcastDelayMs: 0,
        });
        assert.equal(result.ok, true, JSON.stringify(result));
        if (!result.ok) return;
        assert.equal(result.envelope.status, "success");
        const { data, success } = result.envelope.stepResults[0];
        assert.equal(success, true);
        assert.equal(data.path, path);
        assert.equal(data.appliedScale, String(scale ?? 25));
        assert.equal(data.captureMethod, fallback ? "adb_screencap_resize" : "shell_hardware_buffer");
        assert.equal(verifyScreenshot(await fs.readFile(path)).captureWidthPx, 8 * (scale ?? 25) / 100);
        assert.ok(typeof data.hint === "string");
        assert.equal(data.guidance, undefined);
        assert.match(data.hint, /Open the PNG at data.path on the capture host/);
        assert.match(data.hint, /image bytes are not embedded/);
        assert.match(data.hint, /Verify the intended screen has rendered/);
        assert.match(data.hint, /Retry observation, not the preceding action/);
        assert.match(data.hint, /map to nativeWidthPx\/nativeHeightPx/);
        if (scale === undefined || scale === 25) assert.match(data.hint, /default 25% scale per dimension/);
        const suggestedScales = (scale ?? 25) === 25 ? [50, 100] : scale === 50 ? [25, 100] : [25, 50];
        for (const suggestion of suggestedScales) {
          assert.ok(data.hint.includes(`--scale ${suggestion}`));
          assert.ok(data.hint.includes(`observeScreenshot({ scale: ${suggestion} })`));
        }
        if (scale === 100) assert.match(data.hint, /already at full resolution/);
        assert.equal(captures(), 1);
      } finally {
        closeCaptureHelpers();
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }
}

for (const fallback of [false, true]) {
  for (const failure of ["cancelled", "timeout", "publication"] as const) {
    test(`${fallback ? "fallback" : "direct"} ${failure} preserves metadata, prior outcomes and the destination`, async () => {
      const directory = await fs.mkdtemp(join(tmpdir(), "scaled-publication-"));
      const path = join(directory, "screen.png");
      const previous = Buffer.from("previous observation");
      await fs.writeFile(path, previous);
      const controller = new AbortController();
      const { runner, captures } = await scaledCaptureRunner(fallback);
      const writeFile = fs.writeFile;
      const now = Date.now;
      const mockedWrite = mock.method(fs, "writeFile", async (...args: Parameters<typeof writeFile>) => {
        if (failure === "publication") throw Object.assign(new Error("No space left"), { code: "ENOSPC" });
        await writeFile(...args);
        if (failure === "cancelled") controller.abort();
        else mock.method(Date, "now", () => now() + 10000);
      });
      syncBuiltinESMExports();
      try {
        const result = await runExecution({ commandId: "scaled-request", taskId: "scaled-task", source: "test",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "before", type: "press_key", params: { key: "home" } },
            { id: "shot", type: "take_screenshot", params: { path, scale: 25 } }] }, {
          deviceId: "test-device", operatorPackage: "com.test.operator", runner, signal: controller.signal,
          ensureInteractiveAutomationReadyFn: async () => ({ ok: true, state: { screenOn: true, deviceLocked: false, userUnlocked: true } }),
          logcatBroadcastDelayMs: 0,
        });
        assert.equal(result.ok, true, JSON.stringify(result));
        if (!result.ok) return;
        assert.equal(result.envelope.commandId, "scaled-request");
        assert.equal(result.envelope.taskId, "scaled-task");
        assert.equal(result.envelope.status, "failed");
        assert.deepEqual(result.envelope.stepResults[0], { id: "before", actionType: "press_key", success: true, data: { preserved: "yes" } });
        const step = result.envelope.stepResults[1];
        assert.equal(step.success, false);
        assert.equal(step.data.errorCode, "EVIDENCE_CAPTURE_FAILED");
        assert.equal(step.data.captureFailureReason, failure);
        assert.equal(step.data.requestedScale, "25");
        assert.equal(step.data.fallbackAttempted, String(fallback));
        assert.equal(step.data.protectedContent, fallback ? "unknown" : "absent");
        assert.equal(step.data.captureMethod, fallback ? "adb_screencap_resize" : "shell_hardware_buffer");
        assert.equal(step.data.fallbackReason, fallback ? "unavailable" : undefined);
        assert.equal(step.data.path, undefined);
        assert.equal(step.data.hint, undefined);
        assert.equal(step.data.persistedAt, undefined);
        assert.equal(step.data.captureWidthPx, undefined);
        assert.equal(captures(), 1);
        assert.deepEqual(await fs.readFile(path), previous);
        assert.deepEqual(await fs.readdir(directory), ["screen.png"]);
        assert.equal(mockedWrite.mock.callCount(), 1);
      } finally {
        mock.restoreAll(); syncBuiltinESMExports(); closeCaptureHelpers();
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }
}

for (const phase of ["handshake", "frame"] as const) {
  test(`helper closes during ${phase}: preserve failure receipt and retry only screenshot in a fresh session`, async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "capture-lifecycle-"));
    const path = join(directory, "screen.png");
    const previous = Buffer.from("previous screenshot");
    await fs.writeFile(path, previous);
    const f = await scaledCaptureRunner();
    const spawn = f.runner.spawn.bind(f.runner);
    let helpers = 0;
    f.runner.spawn = (command, args, options) => {
      const child = spawn(command, args, options);
      if (args.at(-1)?.includes("app_process") && ++helpers === 1) {
        const close = () => { child.stderr.write("PRIVATE_STDERR"); child.emit("close", 23, null); };
        if (phase === "handshake") queueMicrotask(close);
        else child.stdin.write = () => { queueMicrotask(close); return true; };
      }
      return child;
    };
    const options = { runner: f.runner, deviceId: "test-device", operatorPackage: "com.test.operator", logcatBroadcastDelayMs: 0,
      ensureInteractiveAutomationReadyFn: async () => ({ ok: true as const, state: { screenOn: true, deviceLocked: false, userUnlocked: true } }) };
    try {
      const execution = { commandId: "capture-failed", taskId: "capture-task", source: "test", expectedFormat: "android-ui-automator" as const, timeoutMs: 5000,
        actions: [{ id: "navigate", type: "press_key" as const, params: { key: "home" as const } },
          { id: "shot", type: "take_screenshot" as const, params: { path, scale: 50 as const } }] };
      const result = await runExecution(execution, options);
      assert.ok(result.ok);
      assert.equal(result.envelope.status, "failed");
      assert.equal(result.envelope.stepResults[0].success, true);
      const step = result.envelope.stepResults[1];
      assert.equal(step.success, false);
      assert.equal(step.data.errorCode, "EVIDENCE_CAPTURE_FAILED");
      assert.equal(step.data.captureFailureReason, "transport");
      assert.equal(step.data.fallbackAttempted, "false");
      assert.equal(step.data.path, undefined);
      assert.deepEqual(JSON.parse(String(step.data.captureDiagnostics)), { phase, event: "child_close", requestAttempted: phase === "frame", exitCode: 23, exitSignal: null });
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
      assert.deepEqual(await fs.readFile(path), previous);
      const retry = await runExecution({ ...execution, commandId: "screenshot-only-retry", actions: [execution.actions[1]] }, options);
      assert.ok(retry.ok);
      assert.equal(retry.envelope.status, "success");
      assert.equal(helpers, 2);
      const broadcasts = f.calls.filter(args => args.some(arg => arg.startsWith("am broadcast ")))
        .map(args => JSON.parse(args.join(" ").match(/\{.*\}/)![0]));
      assert.deepEqual(broadcasts.map(payload => payload.actions.map((action: { type: string }) => action.type)), [["press_key", "take_screenshot"], ["take_screenshot"]]);
      assert.equal(f.calls.some(args => args.includes("screencap")), false);
    } finally { closeCaptureHelpers(); await fs.rm(directory, { recursive: true, force: true }); }
  });
}
