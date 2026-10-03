import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumeQuery, QueryConsumptionError, type QueryProcessOutput } from "../../examples/query-consumer.js";

const node = {
  nodePath: "0", parentPath: null, resourceId: null, className: "android.view.View", role: "view",
  label: "", contentDescription: null, bounds: { left: 0, top: 0, right: 100, bottom: 100 },
  visibleToUser: null, onScreen: true, enabled: true, clickable: false, checkable: false,
  checked: null, selected: null, scrollable: false,
};
function payload(nodes: unknown[] = []) {
  return { schemaVersion: 1, snapshotId: "capture", capturedAt: "2026-09-13T00:00:00Z",
    totalMatches: nodes.length, returnedCount: nodes.length, truncated: false, nodes };
}
function response(query: unknown = payload()) {
  return { terminalSource: "androperator_result", isCanonicalTerminal: true,
    envelope: { commandId: " command ", taskId: " task ", status: "success", error: null,
      stepResults: [{ id: "query", actionType: "query_ui", success: true, data: { query: JSON.stringify(query) } }] } };
}
function processOutput(value: unknown = response()): QueryProcessOutput {
  return { status: 0, signal: null, stdout: JSON.stringify(value), stderr: "original stderr" };
}
function reject(output: QueryProcessOutput) {
  assert.throws(() => consumeQuery(output), error => {
    assert.ok(error instanceof QueryConsumptionError);
    assert.equal(error.diagnostics, output);
    return true;
  });
}

describe("safe query consumer example", () => {
  it("accepts empty and populated captures and preserves IDs, raw diagnostics and unknown states", () => {
    for (const nodes of [[], [node], [true, false, null].map(value => ({ ...node, accessibilityDataSensitive: value }))]) {
      const output = processOutput(response(payload(nodes)));
      const result = consumeQuery(output);
      assert.deepEqual(result.query.nodes, nodes);
      assert.equal(result.commandId, " command ");
      assert.equal(result.taskId, " task ");
      assert.equal(result.diagnostics, output);
    }
  });
  it("rejects process, signal, spawn, transport and outer JSON failures", () => {
    for (const change of [{ status: 1 }, { status: null }, { signal: "SIGTERM" },
      { error: new Error("spawn failed") }, { stdout: "{" }, { stdout: "null" },
      { stdout: JSON.stringify({ code: "RESULT_TIMEOUT", message: "No terminal" }) }]) {
      reject({ ...processOutput(), ...change });
    }
    for (const change of [{ terminalSource: "logcat" }, { isCanonicalTerminal: false }, { envelope: null }]) {
      reject(processOutput({ ...response(), ...change }));
    }
  });
  it("rejects failed envelopes, failed steps, missing, duplicate or wrong query steps", () => {
    for (const edit of [
      (r: ReturnType<typeof response>) => { r.envelope.status = "failed"; },
      (r: ReturnType<typeof response>) => { r.envelope.commandId = " "; },
      (r: ReturnType<typeof response>) => { r.envelope.stepResults[0].success = false; },
      (r: ReturnType<typeof response>) => { r.envelope.stepResults = []; },
      (r: ReturnType<typeof response>) => { r.envelope.stepResults[0].id = "other"; },
      (r: ReturnType<typeof response>) => { r.envelope.stepResults[0].actionType = "click"; },
      (r: ReturnType<typeof response>) => { r.envelope.stepResults.push(r.envelope.stepResults[0]); },
      (r: ReturnType<typeof response>) => { r.envelope.stepResults.push({ id: "other", actionType: "click", success: false, data: { query: "" } }); },
      (r: ReturnType<typeof response>) => { r.envelope.stepResults[0].data.query = "{"; },
    ]) { const value = response(); edit(value); reject(processOutput(value)); }
    const value = response();
    value.envelope.stepResults[0].id = "custom";
    assert.equal(consumeQuery(processOutput(value), "custom").query.totalMatches, 0);
  });
  it("rejects missing/non-string query data and malformed node/schema/count shapes", () => {
    for (const data of [{}, { query: null }, { query: payload() }]) {
      const value = response();
      Object.assign(value.envelope.stepResults[0], { data });
      reject(processOutput(value));
    }
    for (const query of [null, [], {}, { ...payload(), schemaVersion: 2 },
      { ...payload(), capturedAt: "yesterday" }, { ...payload(), nodes: [null] },
      payload([{ ...node, checked: "false" }]), payload([{ ...node, bounds: {} }]),
      { ...payload(), returnedCount: 1 }, { ...payload(), totalMatches: -1 },
      { ...payload(), totalMatches: 0.5 }, { ...payload(), truncated: true },
      { ...payload(), totalMatches: 2 }, { ...payload([node]), totalMatches: 0 },
      { ...payload([node]), totalMatches: 2, truncated: true }]) {
      reject(processOutput(response(query)));
    }
  });
});
