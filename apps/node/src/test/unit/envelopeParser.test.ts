import { describe, it } from "node:test";
import assert from "node:assert";
import {
  parseResultEnvelope,
  parseTerminalEnvelope,
} from "../../adapters/android-bridge/envelopeParser.js";
import { RESULT_ENVELOPE_PREFIX } from "../../contracts/result.js";

const CMD_ID = "cmd-123";

describe("parseResultEnvelope", () => {
  /** Canonical regression: CI gate — logcat-formatted [Androperator-Result] must parse. Do not remove. */
  it("canonical regression: logcat-formatted [Androperator-Result] line parses to envelope (CI gate)", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[{"id":"s1","actionType":"snapshot_ui","success":true,"data":{}}],"error":null}`;
    const logcatLine = `02-19 12:00:00.000  1234  5678 I AgentCommandExecutorDefault: ${RESULT_ENVELOPE_PREFIX} ${json}`;
    const env = parseResultEnvelope(logcatLine, CMD_ID);
    assert.ok(env && typeof env === "object", "Canonical logcat line must parse to object");
    if (typeof env === "object") {
      assert.strictEqual(env.commandId, CMD_ID);
      assert.strictEqual(env.status, "success");
      assert.strictEqual(env.stepResults.length, 1);
    }
  });

  it("parses [Androperator-Result] JSON", () => {
    const line = `${RESULT_ENVELOPE_PREFIX} {"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[],"error":null}`;
    const env = parseResultEnvelope(line, CMD_ID);
    assert.ok(env && typeof env === "object");
    if (typeof env === "object") {
      assert.strictEqual(env.commandId, CMD_ID);
      assert.strictEqual(env.status, "success");
    }
  });

  it("returns null for wrong commandId", () => {
    const line = `${RESULT_ENVELOPE_PREFIX} {"commandId":"other","taskId":"t1","status":"success","stepResults":[],"error":null}`;
    assert.strictEqual(parseResultEnvelope(line, CMD_ID), null);
  });

  it("returns 'malformed' for invalid JSON after prefix", () => {
    const line = `${RESULT_ENVELOPE_PREFIX} { not json }`;
    assert.strictEqual(parseResultEnvelope(line, CMD_ID), "malformed");
  });

  it("returns 'malformed' for an envelope with invalid status", () => {
    const line = `${RESULT_ENVELOPE_PREFIX} {"commandId":"${CMD_ID}","taskId":"t1","status":"queued","stepResults":[],"error":null}`;
    assert.strictEqual(parseResultEnvelope(line, CMD_ID), "malformed");
  });

  it("parses canonical line in logcat format (tag prefix before [Androperator-Result])", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[],"error":null}`;
    const line = `02-19 12:00:00.000  1234  5678 I AndroperatorResult: ${RESULT_ENVELOPE_PREFIX} ${json}`;
    const env = parseResultEnvelope(line, CMD_ID);
    assert.ok(env && typeof env === "object");
    if (typeof env === "object") {
      assert.strictEqual(env.commandId, CMD_ID);
      assert.strictEqual(env.status, "success");
    }
  });
});

describe("parseTerminalEnvelope", () => {
  it("returns [Androperator-Result] with terminalSource androperator_result", () => {
    const line = `${RESULT_ENVELOPE_PREFIX} {"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[],"error":null}`;
    const parsed = parseTerminalEnvelope(line, CMD_ID);
    assert.ok(parsed && typeof parsed === "object");
    if (typeof parsed === "object") {
      assert.strictEqual(parsed.terminalSource, "androperator_result");
      assert.strictEqual(parsed.envelope.commandId, CMD_ID);
    }
  });

  it("returns null for line without [Androperator-Result]", () => {
    const line = `02-19 12:00:00.000 I SomeTag: [Some-Other-Event] status=ok commandId=${CMD_ID}`;
    assert.strictEqual(parseTerminalEnvelope(line, CMD_ID), null);
  });

  it("returns 'malformed' for invalid JSON after prefix", () => {
    const line = `${RESULT_ENVELOPE_PREFIX} { bad json }`;
    assert.strictEqual(parseTerminalEnvelope(line, CMD_ID), "malformed");
  });

  it("accepts canonical line in logcat format", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[{"id":"s1","actionType":"snapshot_ui","success":true}],"error":null}`;
    const line = `02-19 12:00:00.000  1234  5678 I AndroperatorResult: ${RESULT_ENVELOPE_PREFIX} ${json}`;
    const parsed = parseTerminalEnvelope(line, CMD_ID);
    assert.ok(parsed && typeof parsed === "object");
    if (typeof parsed === "object") {
      assert.strictEqual(parsed.terminalSource, "androperator_result");
      assert.strictEqual(parsed.envelope.commandId, CMD_ID);
      assert.strictEqual(parsed.envelope.stepResults.length, 1);
      assert.strictEqual(parsed.envelope.stepResults[0].id, "s1");
    }
  });

  it("parses step results with success: false and error data", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[{"id":"s1","actionType":"close_app","success":false,"data":{"error":"UNSUPPORTED"}}],"error":null}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    const parsed = parseTerminalEnvelope(line, CMD_ID);
    assert.ok(parsed && typeof parsed === "object");
    if (typeof parsed === "object") {
      const step = parsed.envelope.stepResults[0];
      assert.strictEqual(step.success, false);
      assert.strictEqual(step.data?.error, "UNSUPPORTED");
    }
  });

  it("normalizes missing step data to an empty object", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[{"id":"s1","actionType":"snapshot_ui","success":true}],"error":null}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    const parsed = parseTerminalEnvelope(line, CMD_ID);
    assert.ok(parsed && typeof parsed === "object");
    if (typeof parsed === "object") {
      assert.deepStrictEqual(parsed.envelope.stepResults[0].data, {});
    }
  });

  it("normalizes non-string step data values to strings", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[{"id":"s1","actionType":"sleep","success":true,"data":{"duration_ms":1000,"ok":true}}],"error":null}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    const parsed = parseTerminalEnvelope(line, CMD_ID);
    assert.ok(parsed && typeof parsed === "object");
    if (typeof parsed === "object") {
      assert.deepStrictEqual(parsed.envelope.stepResults[0].data, {
        duration_ms: "1000",
        ok: "true",
      });
    }
  });

  it("returns malformed when step success is missing", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[{"id":"s1","actionType":"snapshot_ui","data":{}}],"error":null}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    assert.strictEqual(parseTerminalEnvelope(line, CMD_ID), "malformed");
  });

  it("returns malformed when step success is not boolean", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"success","stepResults":[{"id":"s1","actionType":"snapshot_ui","success":"false","data":{}}],"error":null}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    assert.strictEqual(parseTerminalEnvelope(line, CMD_ID), "malformed");
  });

  it("returns malformed when envelope identifiers are not strings", () => {
    const json = `{"commandId":123,"taskId":"t1","status":"success","stepResults":[],"error":null}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    assert.strictEqual(parseTerminalEnvelope(line, CMD_ID), "malformed");
  });

  it("passes errorCode through when present in failed envelope", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"failed","stepResults":[],"error":"Accessibility service is not available","errorCode":"SERVICE_UNAVAILABLE"}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    const parsed = parseTerminalEnvelope(line, CMD_ID);
    assert.ok(parsed && typeof parsed === "object");
    if (typeof parsed === "object") {
      assert.strictEqual(parsed.envelope.status, "failed");
      assert.strictEqual(parsed.envelope.errorCode, "SERVICE_UNAVAILABLE");
      assert.strictEqual(parsed.envelope.error, "Accessibility service is not available");
    }
  });

  it("omits errorCode when not present (older APK backward compat)", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"failed","stepResults":[],"error":"Something went wrong"}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    const parsed = parseTerminalEnvelope(line, CMD_ID);
    assert.ok(parsed && typeof parsed === "object");
    if (typeof parsed === "object") {
      assert.strictEqual("errorCode" in parsed.envelope, false);
    }
  });

  it("returns malformed when errorCode is not a string or null", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"failed","stepResults":[],"error":"oops","errorCode":42}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    assert.strictEqual(parseTerminalEnvelope(line, CMD_ID), "malformed");
  });

  it("accepts errorCode: null (no enumerated code for this failure)", () => {
    const json = `{"commandId":"${CMD_ID}","taskId":"t1","status":"failed","stepResults":[],"error":"Unknown failure","errorCode":null}`;
    const line = `${RESULT_ENVELOPE_PREFIX} ${json}`;
    const parsed = parseTerminalEnvelope(line, CMD_ID);
    assert.ok(parsed && typeof parsed === "object");
    if (typeof parsed === "object") {
      assert.strictEqual(parsed.envelope.errorCode, null);
    }
  });
});

for (const errorCode of ["WAIT_TIMEOUT", "ACTION_FAILED", "UI_TREE_UNAVAILABLE", "COMMAND_TIMEOUT"]) {
  it(`preserves ${errorCode} action evidence and string-valued receipts through parser and CLI output`, async () => {
    const { formatRunExecutionResultForCli } = await import("../../cli/output.js");
    const { shouldCliStdoutForceExitCode1 } = await import("../../cli/stdoutExitCode.js");
    const envelope: import("../../contracts/result.js").ResultEnvelope = {
      commandId: "command", taskId: "task", status: "failed" as const, errorCode, error: "Original failure",
      stepResults: [
        { id: "before", actionType: "click", success: true, data: { target: '{"resourceId":"wrapper"}',
          matched_target: '{"resourceId":"label"}', candidate_count: "1", dispatch_method: "accessibility_action",
          dispatch_accepted: "true", elapsed_ms: "12" } },
        { id: "failed", actionType: "wait_for_node", success: false, data: { errorCode, error: "Original failure" } },
      ],
    };
    const parsed = parseResultEnvelope(`${RESULT_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}`, "command");
    assert.deepStrictEqual(parsed, envelope);
    const output = formatRunExecutionResultForCli({ ok: true, envelope, deviceId: "test-device", terminalSource: "androperator_result" }, { format: "json" });
    assert.deepStrictEqual(JSON.parse(output).envelope, envelope);
    assert.strictEqual(shouldCliStdoutForceExitCode1(output, false), true);
  });
}
