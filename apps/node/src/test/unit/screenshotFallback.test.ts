import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResultEnvelope } from "../../contracts/result.js";
import { runExecution } from "../../domain/executions/runExecution.js";
import { executionRunner } from "./fakes/executionResultRunner.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

const ready = async () => ({ ok: true as const, state: { screenOn: true, deviceLocked: false, userUnlocked: true } });

describe("verified screenshot fallback", () => {
  for (const scenario of ["success", "invalid_png", "empty", "transport_failure", "missing_parent"] as const) {
    it(`reports truthful result for ${scenario}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "screenshot-reliability-"));
      try {
        const path = join(directory, scenario === "missing_parent" ? "absent/image.png" : "image.png");
        const png = new PNG({ width: 6, height: 3 });
        const bytes = scenario === "empty" ? undefined : scenario === "invalid_png" ? Buffer.from("not a PNG") : PNG.sync.write(png);
        const envelope: ResultEnvelope = { commandId: "screenshot-request", taskId: "screenshot-task", status: "failed", error: "Runtime screenshot unsupported", stepResults: [{ id: "shot", actionType: "take_screenshot", success: false, data: { error: "UNSUPPORTED_RUNTIME_SCREENSHOT", errorCode: "UNSUPPORTED_RUNTIME_SCREENSHOT", message: "unsupported", provenance: "keep" } }] };
        const result = await runExecution({ commandId: envelope.commandId, taskId: envelope.taskId, source: "test", expectedFormat: "android-ui-automator", timeoutMs: 1000, actions: [{ id: "shot", type: "take_screenshot", params: { path } }] }, {
          deviceId: "test-device", operatorPackage: "com.test.operator", runner: executionRunner(envelope, undefined, bytes, scenario === "transport_failure" ? 1 : 0), ensureInteractiveAutomationReadyFn: ready, logcatBroadcastDelayMs: 0,
        });
        assert.equal(result.ok, true, JSON.stringify(result));
        if (!result.ok) return;
        const step = result.envelope.stepResults[0];
        assert.equal(step.success, scenario === "success");
        assert.equal(result.envelope.status, scenario === "success" ? "success" : "failed");
        assert.equal(step.data.provenance, "keep");
        if (scenario === "success") {
          assert.equal(step.data.errorCode, undefined);
          assert.equal(step.data.error, undefined);
          assert.equal(step.data.message, undefined);
          assert.equal(step.data.captureSource, "host");
          assert.equal(step.data.capturedAt, undefined);
          assert.ok(!Number.isNaN(Date.parse(step.data.persistedAt!)));
          assert.equal(step.data.captureWidthPx, "6");
          assert.equal(step.data.captureHeightPx, "3");
          assert.equal(step.data.coordinateSpace, "screenshot_pixels");
          assert.equal(step.data.origin, "top_left");
          assert.deepEqual(await readFile(path), bytes);
        } else {
          assert.equal(step.data.errorCode, "EVIDENCE_CAPTURE_FAILED");
          assert.equal(step.data.path, undefined);
          assert.equal(step.data.captureWidthPx, undefined);
          assert.equal(step.data.captureHeightPx, undefined);
        }
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }
});
