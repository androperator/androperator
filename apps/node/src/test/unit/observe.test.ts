import { once } from "node:events";
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSnapshotExecution } from "../../domain/observe/snapshot.js";
import { buildScreenshotExecution } from "../../domain/observe/screenshot.js";
import { cmdObserveScreenshot, cmdObserveSnapshot } from "../../cli/commands/observe.js";
import { buildWaitExecution } from "../../domain/actions/wait.js";
import { attachSnapshotsToStepResults, runExecution, type RunExecutionResult } from "../../domain/executions/runExecution.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { androperatorEvents, ANDROPERATOR_EVENT_TYPES } from "../../domain/observe/events.js";
import { applyMcpExecutionMetadata } from "../../mcp/tools/common.js";
import type { DaemonProxyOptions } from "../../cli/daemonProxy.js";

describe("observe executions", () => {
  it("maps snapshots only onto successful snapshot steps", () => {
    const stepResults = [
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
      { id: "tap-1", actionType: "tap", success: true, data: {} },
      { id: "snap-2", actionType: "snapshot", success: true, data: {} },
      { id: "snap-3", actionType: "snapshot", success: false, data: {} },
    ];

    attachSnapshotsToStepResults(stepResults, ["first snapshot", "second snapshot"]);

    assert.deepStrictEqual(stepResults, [
      { id: "snap-1", actionType: "snapshot", success: true, data: { text: "first snapshot" } },
      { id: "tap-1", actionType: "tap", success: true, data: {} },
      { id: "snap-2", actionType: "snapshot", success: true, data: { text: "second snapshot" } },
      { id: "snap-3", actionType: "snapshot", success: false, data: {} },
    ]);
  });

  it("applies timeout override to snapshot execution", () => {
    const execution = buildSnapshotExecution({ timeoutMs: 5000 });
    assert.strictEqual(execution.timeoutMs, 5000);
  });

  it("applies timeout override to screenshot execution", () => {
    const execution = buildScreenshotExecution({ timeoutMs: 7000 });
    assert.strictEqual(execution.timeoutMs, 7000);
  });

  it("preserves wait execution timeout padding when MCP metadata is applied", () => {
    const execution = buildWaitExecution({ textEquals: "Settings" }, 12_000);
    const stamped = applyMcpExecutionMetadata(execution, "wait", execution.timeoutMs);

    assert.strictEqual(execution.timeoutMs, 30_000);
    assert.strictEqual(stamped.timeoutMs, 30_000);
  });

  it("passes through explicit screenshot output path", () => {
    const execution = buildScreenshotExecution({ path: "/tmp/example.png" });
    assert.deepStrictEqual(execution.actions[0]?.params, { path: "/tmp/example.png" });
  });

  it("does not silently drop empty screenshot path so validateExecution can reject it", () => {
    const execution = buildScreenshotExecution({ path: "" });
    assert.deepStrictEqual(execution.actions[0]?.params, { path: "" });
  });

  it("uses the centralized execution validation code for invalid timeout overrides", async () => {
    const result = await runExecution(buildSnapshotExecution(), { timeoutMs: Number.NaN });
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
  });

  it("validates invalid snapshot timeout before daemon proxy startup", async () => {
    const output = await cmdObserveSnapshot({ format: "json", timeoutMs: Number.NaN });
    const payload = JSON.parse(output) as { code?: string };

    assert.strictEqual(payload.code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
  });

  it("does not run direct screenshot fallback after daemon proxy response loss", async () => {
    const proxyError: RunExecutionResult = {
      ok: false,
      error: {
        code: ERROR_CODES.DAEMON_PROXY_ERROR,
        message: "Daemon response lost; action may have executed",
      },
    };
    let proxyOptions: DaemonProxyOptions | undefined;
    let directCalls = 0;

    const output = await cmdObserveScreenshot({
      format: "json",
      tryDaemonExecutionFn: async (_execution, options) => {
        proxyOptions = options;
        return proxyError;
      },
      runExecutionFn: async () => {
        directCalls += 1;
        return proxyError;
      },
    });
    const payload = JSON.parse(output) as { code?: string; message?: string };

    assert.strictEqual(payload.code, ERROR_CODES.DAEMON_PROXY_ERROR);
    assert.strictEqual(payload.message, "Daemon response lost; action may have executed");
    assert.strictEqual(proxyOptions?.allowPostDispatchFallback, false);
    assert.strictEqual(directCalls, 0);
  });

  it("emits the resolved execution metadata when timeout overrides are applied", async () => {
    const largeExecution = buildSnapshotExecution();
    largeExecution.actions = Array.from({ length: 50 }, (_, index) => ({
      id: `enter-${index}`,
      type: "enter_text",
      params: {
        matcher: {
          resourceId: "r".repeat(512),
          role: "o".repeat(512),
          textEquals: "e".repeat(512),
          textContains: "x".repeat(512),
          contentDescEquals: "d".repeat(512),
          contentDescContains: "c".repeat(512),
        },
        text: "y".repeat(512),
      },
    }));

    const executionEvent = once(androperatorEvents, ANDROPERATOR_EVENT_TYPES.EXECUTION);
    const result = await runExecution(largeExecution, { deviceId: "test-device", timeoutMs: 12_345 });
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, ERROR_CODES.PAYLOAD_TOO_LARGE);

    const [event] = await executionEvent;
    assert.strictEqual(event.deviceId, "test-device");
    assert.strictEqual(event.input.timeoutMs, 12_345);
  });
});
