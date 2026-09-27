import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDragExecution } from "../../domain/actions/drag.js";
import { validateExecution } from "../../domain/executions/validateExecution.js";
import { cmdActionDrag } from "../../cli/commands/action.js";
import { getNamedMcpTools } from "../../mcp/tools/named.js";

const params = { start: { x: 0, y: 200 }, end: { x: 300, y: 200 }, holdDurationMs: 1000, moveDurationMs: 300 };
const cli = fileURLToPath(new URL("../../cli/index.js", import.meta.url));
const baseArgs = ["drag", "--start", "0", "200", "--end", "300", "200", "--hold-duration-ms", "1000", "--move-duration-ms", "300"];

it("drag requires explicit valid endpoints and duration at the execution boundary", () => {
  for (const moveDurationMs of [1, 300, 10000]) {
    assert.deepEqual(validateExecution(buildDragExecution({ ...params, moveDurationMs })).actions[0].params, { ...params, moveDurationMs });
  }
  for (const holdDurationMs of [1, 1000, 10000]) {
    assert.deepEqual(validateExecution(buildDragExecution({ ...params, holdDurationMs })).actions[0].params, { ...params, holdDurationMs });
  }
  const invalid = [
    undefined, {}, { ...params, start: undefined }, { ...params, end: undefined },
    { ...params, start: { x: -1, y: 0 } }, { ...params, start: { x: 0.5, y: 0 } },
    { ...params, end: { x: 2147483648, y: 0 } }, { ...params, end: params.start },
    { ...params, start: { x: "0", y: 0 } }, { ...params, start: { x: 0, y: 0, z: 1 } },
    ...[undefined, null, 0, -1, 10001, 1.5, "300", Infinity, NaN].map(moveDurationMs => ({ ...params, moveDurationMs })),
    ...[undefined, null, 0, -1, 10001, 1.5, "1000"].map(holdDurationMs => ({ ...params, holdDurationMs })),
    { ...params, retry: {} }, { ...params, matcher: { textEquals: "item" } },
  ];
  for (const value of invalid) {
    const execution = buildDragExecution(params);
    (execution.actions[0] as { params?: unknown }).params = value;
    assert.throws(() => validateExecution(execution), JSON.stringify(value));
  }
});

it("drag CLI rejects invalid and missing values with structured errors and exit 1", () => {
  const invalid = [
    [], baseArgs.slice(1, -2), baseArgs.slice(1).filter((_, index) => index !== 6 && index !== 7), ["--start", "0", "200", "--end", "300", "200"],
    ["--start", "0", "--end", "300", "200", "--hold-duration-ms", "1000", "--move-duration-ms", "300"],
    ...["--hold-duration-ms", "--move-duration-ms"].flatMap(flag =>
      ["", "0", "10001", "-1", "1.5", "fast"].map(value => {
        const args = baseArgs.slice(1);
        args[args.indexOf(flag) + 1] = value;
        return args;
      })),
    [...baseArgs.slice(1), "--move-duration-ms", "400"], [...baseArgs.slice(1), "extra"],
    ["--start", "-1", "200", ...baseArgs.slice(4)],
    ["--start", "0", "200", "--end", "0", "200", "--hold-duration-ms", "1000", "--move-duration-ms", "300"],
  ];
  for (const args of invalid) {
    const result = spawnSync(process.execPath, [cli, "drag", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(JSON.parse(result.stdout).code, "EXECUTION_VALIDATION_FAILED", result.stdout);
  }
});

it("drag accepts valid CLI input with global flags before or after the command", () => {
  // A nonexistent explicit device proves parsing/validation succeeded without touching hardware.
  for (const args of [
    ["--device", "missing-drag-test-device", "--output", "json", ...baseArgs, "--no-daemon"],
    [...baseArgs, "--device", "missing-drag-test-device", "--output", "json", "--no-daemon"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.code ?? payload.error?.code, "DEVICE_NOT_FOUND", result.stdout);
  }
});

it("drag preserves the envelope and forbids post-dispatch daemon fallback", async () => {
  let directCalls = 0;
  const output = await cmdActionDrag({
    ...params, format: "json", timeoutMs: 5000,
    tryDaemonExecutionFn: async (input, options) => {
      const execution = validateExecution(input);
      assert.deepEqual(execution.actions[0].params, params);
      assert.equal(execution.timeoutMs, 5000);
      assert.equal(options.allowPostDispatchFallback, false);
      return { ok: true, deviceId: "test-device", terminalSource: "clawperator_result", envelope: {
        commandId: execution.commandId, taskId: execution.taskId, status: "success",
        stepResults: [{ id: "drag", actionType: "drag", success: true, data: { dispatch_accepted: "true" } }], error: null,
      } };
    },
    runExecutionFn: async () => { directCalls++; throw new Error("Unexpected replay"); },
  });
  assert.equal(directCalls, 0);
  assert.equal(JSON.parse(output).envelope.stepResults[0].actionType, "drag");
});

it("MCP drag advertises required duration and rejects omitted duration before dispatch", async () => {
  const tool = getNamedMcpTools().find(tool => tool.name === "drag")!;
  assert.ok(tool);
  assert.ok((tool.inputSchema.required as string[]).includes("moveDurationMs"));
  await assert.rejects(async () => tool.handler({ start: params.start, end: params.end }));
  await assert.rejects(async () => tool.handler({ ...params, end: params.start }));
  await assert.rejects(async () => tool.handler({ ...params, holdDurationMs: undefined }));
  assert.ok((tool.inputSchema.required as string[]).includes("holdDurationMs"));
});
