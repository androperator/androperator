import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExecution } from "../../domain/executions/runExecution.js";
import { closeCaptureHelpers } from "../../domain/observe/captureHelper.js";
import { scaledCaptureRunner } from "./fakes/scaledCaptureRunner.js";

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
