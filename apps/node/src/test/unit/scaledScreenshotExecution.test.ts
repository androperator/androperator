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
    test(`${fallback ? "fallback" : "direct"} scale ${scale ?? "omitted"} publishes scale-aware guidance with the PNG`, async () => {
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
        assert.equal(data.appliedScale, String(scale ?? 100));
        assert.equal(data.captureMethod, scale === undefined ? "adb_screencap" : fallback ? "adb_screencap_resize" : "shell_hardware_buffer");
        assert.equal(verifyScreenshot(await fs.readFile(path)).captureWidthPx, 8 * (scale ?? 100) / 100);
        assert.ok(typeof data.guidance === "string");
        assert.match(data.guidance, /Open the PNG at data.path on the capture host/);
        assert.match(data.guidance, /image bytes are not embedded/);
        const suggestedScales = scale === 25 ? [50, 100] : scale === 50 ? [25, 100] : [25, 50];
        for (const suggestion of suggestedScales) {
          assert.ok(data.guidance.includes(`--scale ${suggestion}`));
          assert.ok(data.guidance.includes(`observeScreenshot({ scale: ${suggestion} })`));
        }
        if (scale === undefined || scale === 100) assert.match(data.guidance, /already at full resolution/);
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
        assert.equal(step.data.guidance, undefined);
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
