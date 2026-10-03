import { describe, it } from "node:test";
import assert from "node:assert";
import { formatSuccess } from "../../cli/output.js";

describe("formatSuccess", () => {
  it("formats androperator_result with terminalSource (pretty)", () => {
    const data = {
      envelope: { commandId: "c1", taskId: "t1", status: "success" as const, stepResults: [], error: null },
      deviceId: "device1",
      terminalSource: "androperator_result" as const,
    };
    const out = formatSuccess(data, { format: "pretty" });
    assert.ok(out.includes('"terminalSource": "androperator_result"'));
  });

  it("formats androperator_result (json compact)", () => {
    const data = {
      envelope: { commandId: "c1", taskId: "t1", status: "success" as const, stepResults: [], error: null },
      deviceId: "device1",
      terminalSource: "androperator_result" as const,
    };
    const out = formatSuccess(data, { format: "json" });
    assert.ok(out.includes('"terminalSource":"androperator_result"'));
  });

  it("includes isCanonicalTerminal true when terminalSource is androperator_result", () => {
    const data = {
      envelope: { commandId: "c1", taskId: "t1", status: "success" as const, stepResults: [], error: null },
      deviceId: "device1",
      terminalSource: "androperator_result" as const,
      isCanonicalTerminal: true,
    };
    const out = formatSuccess(data, { format: "json" });
    assert.ok(out.includes('"isCanonicalTerminal":true'));
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.terminalSource, "androperator_result");
    assert.strictEqual(parsed.isCanonicalTerminal, true);
  });
});
