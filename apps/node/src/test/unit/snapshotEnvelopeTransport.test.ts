import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { runExecution } from "../../domain/executions/runExecution.js";
import { projectCompactSnapshot } from "../../domain/observe/compactSnapshot.js";
import type { ResultEnvelope } from "../../contracts/result.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

const commandId = "snapshot-chunks";
const taskId = "snapshot-task";
const ready = async () => ({ ok: true as const, state: { screenOn: true, deviceLocked: false, userUnlocked: true } });
const xml = `<hierarchy>${Array.from({ length: 4500 }, (_, i) => `<node text="${i} 界😀 &amp; ${"content ".repeat(60)}"/>`).join("")}</hierarchy>`;

function frames(envelope: ResultEnvelope): string[] {
  const bytes = Buffer.from(`[Clawperator-Result] ${JSON.stringify(envelope)}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return Array.from({ length: Math.ceil(bytes.length / 1024) }, (_, index) =>
    `D/Result: [Clawperator-Result-Chunk] ${JSON.stringify({ commandId, taskId, index,
      count: Math.ceil(bytes.length / 1024), byteLength: bytes.length, sha256,
      data: bytes.subarray(index * 1024, (index + 1) * 1024).toString("base64") })}\n`);
}

async function execute(sources: string[], transform: (lines: string[]) => string[] = lines => lines) {
  const runner = new FakeProcessRunner();
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
  runner.spawn = () => child;
  runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device\tdevice\n", stderr: "" });
  runner.queueResult({ code: 0, stdout: "package:com.test.operator\n", stderr: "" });
  const envelope: ResultEnvelope = { commandId, taskId, status: "success", error: null,
    stepResults: sources.map((text, i) => ({ id: `snap-${i}`, actionType: "snapshot_ui", success: true, data: { text } })) };
  runner.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" }, () => {
    setTimeout(() => {
      for (const line of transform(frames(envelope))) {
        const bytes = Buffer.from(line);
        child.stdout.emit("data", bytes.subarray(0, 137));
        child.stdout.emit("data", bytes.subarray(137));
      }
    }, 1);
  });
  return runExecution({ commandId, taskId, source: "test", expectedFormat: "android-ui-automator", timeoutMs: 1000,
    actions: sources.map((_, i) => ({ id: `snap-${i}`, type: "snapshot" })) },
  { runner, deviceId: "test-device", operatorPackage: "com.test.operator", ensureInteractiveAutomationReadyFn: ready,
    logcatBroadcastDelayMs: 0, resultEnvelopeTimeoutMs: 1000 });
}

describe("snapshot XML inside verified result transport", () => {
  it("preserves a multi-megabyte Unicode source and multiple snapshot identities before compact projection", async () => {
    assert.ok(Buffer.byteLength(xml) > 2 * 1024 * 1024);
    const second = '<hierarchy><node text="second"/></hierarchy>';
    const result = await execute([xml, second]);
    assert.ok(result.ok);
    assert.equal(result.envelope.status, "success");
    assert.deepEqual(result.envelope.stepResults.map(step => step.data.text), [xml, second]);
    const compact = projectCompactSnapshot(result.envelope.stepResults[0].data.text!, { commandId, taskId }, { maxNodes: 200 });
    assert.equal(compact.totalNodes, 4500);
    assert.equal(compact.returnedNodes, 200);
    assert.equal(compact.truncated, true);
  });

  for (const fault of ["missing-middle", "missing-tail", "checksum"] as const) {
    it(`never accepts a snapshot with ${fault} damage`, async () => {
      const result = await execute([xml], lines => {
        if (fault === "missing-middle") return lines.filter((_, i) => i !== 2);
        if (fault === "missing-tail") return lines.slice(0, -1);
        return lines.map(line => line.replace(/"sha256":"[a-f0-9]+"/, `"sha256":"${"0".repeat(64)}"`));
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, fault === "missing-tail" ? "RESULT_ENVELOPE_TIMEOUT" : "RESULT_ENVELOPE_MALFORMED");
      assert.equal((result.error.details as Record<string, unknown>).dispatchState, "dispatched");
    });
  }

  it("still validates XML after successful integrity verification", async () => {
    const result = await execute(["<hierarchy><node>"]);
    assert.ok(result.ok);
    assert.equal(result.envelope.status, "failed");
    assert.equal(result.envelope.stepResults[0].data.error, "SNAPSHOT_EXTRACTION_FAILED");
  });
});
