import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cmdActionClick } from "../../../cli/commands/action.js";
import type { RunExecutionResult } from "../../../domain/executions/runExecution.js";

const successResult: RunExecutionResult = {
  ok: true,
  deviceId: "device-1",
  terminalSource: "androperator_result",
  envelope: {
    commandId: "click-test",
    taskId: "click-test",
    status: "success",
    stepResults: [],
    error: null,
  },
};

describe("action command daemon proxy wiring", () => {
  it("uses a daemon result when the proxy is available", async () => {
    let proxyCalls = 0;
    let directCalls = 0;

    const raw = await cmdActionClick({
      format: "json",
      coordinate: { x: 1, y: 2 },
      tryDaemonExecutionFn: async () => {
        proxyCalls += 1;
        return successResult;
      },
      runExecutionFn: async () => {
        directCalls += 1;
        return successResult;
      },
    });
    const parsed = JSON.parse(raw) as { deviceId?: string };

    assert.equal(proxyCalls, 1);
    assert.equal(directCalls, 0);
    assert.equal(parsed.deviceId, "device-1");
  });

  it("falls back to direct execution when the proxy is unavailable before dispatch", async () => {
    let directCalls = 0;

    await cmdActionClick({
      format: "json",
      coordinate: { x: 1, y: 2 },
      tryDaemonExecutionFn: async () => null,
      runExecutionFn: async () => {
        directCalls += 1;
        return successResult;
      },
    });

    assert.equal(directCalls, 1);
  });

  it("skips proxy when noDaemon is true", async () => {
    let proxyCalls = 0;
    let directCalls = 0;

    await cmdActionClick({
      format: "json",
      coordinate: { x: 1, y: 2 },
      noDaemon: true,
      tryDaemonExecutionFn: async () => {
        proxyCalls += 1;
        return successResult;
      },
      runExecutionFn: async () => {
        directCalls += 1;
        return successResult;
      },
    });

    assert.equal(proxyCalls, 0);
    assert.equal(directCalls, 1);
  });

  it("forwards timeoutMs to direct execution options", async () => {
    let observedTimeoutMs: number | undefined;

    await cmdActionClick({
      format: "json",
      coordinate: { x: 1, y: 2 },
      timeoutMs: 4321,
      tryDaemonExecutionFn: async () => null,
      runExecutionFn: async (...args) => {
        observedTimeoutMs = (args[1] as { timeoutMs?: number }).timeoutMs;
        return successResult;
      },
    } as Parameters<typeof cmdActionClick>[0] & { timeoutMs: number });

    assert.equal(observedTimeoutMs, 4321);
  });
});
