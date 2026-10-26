import assert from "node:assert/strict";
import { it } from "node:test";
import { parseDaemonRunExecutionResult } from "../../cli/daemonProxy.js";
import { formatRunExecutionResultForCli } from "../../cli/output.js";
import { mapServeErrorCodeToStatus } from "../../cli/commands/serve.js";
import { buildMcpErrorResult } from "../../mcp/errors.js";

for (const code of ["RESULT_READER_NOT_READY", "RESULT_ENVELOPE_INCOMPLETE", "RESULT_TRANSPORT_EXITED", "RESULT_TRANSPORT_SPAWN_FAILED", "RESULT_TRANSPORT_CANCELLED", "RESULT_ENVELOPE_MALFORMED", "RESULT_ENVELOPE_TIMEOUT"]) {
  it(`preserves ${code} across daemon, CLI, Serve and MCP adapters`, () => {
    const error = { code, message: "transport failed", details: { commandId: "command", taskId: "task",
      deviceId: "device", operatorPackage: "com.test.operator", dispatchAttempted: code !== "RESULT_READER_NOT_READY",
      executionPosition: "unknown", exitCode: 255, signal: null, stderr: "private raw stderr" } };
    const result = parseDaemonRunExecutionResult(JSON.stringify({ ok: false, error, deviceId: "device" }));
    assert.ok(!result.ok);
    assert.deepEqual(result.error, error);
    assert.deepEqual(JSON.parse(formatRunExecutionResultForCli(result, { format: "json" })), error);
    assert.ok(mapServeErrorCodeToStatus(code) >= 400);
    const mcp = buildMcpErrorResult(result.error);
    assert.equal(mcp.isError, true);
    const payload = mcp.structuredContent!;
    assert.equal(payload.code, code);
    const { stderr: _stderr, ...safeDetails } = error.details;
    const details = payload.details as Record<string, unknown>;
    for (const [key, value] of Object.entries(safeDetails)) assert.deepEqual(details[key], value);
    assert.notEqual(details.stderr, error.details.stderr);
  });
}
