import assert from "node:assert/strict";
import { it } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { waitForResultEnvelope } from "../../adapters/android-bridge/logcatResultReader.js";
import { runDoctorPingCommand } from "../../domain/doctor/checks/deviceInteractivity.js";

for (const legacyDelay of [undefined, 0, 1]) {
  it(`genuine doctor waits for delayed reader startup with legacy delay ${legacyDelay}`, async () => {
    const stdout = new PassThrough();
    const proc = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), kill: () => true });
    let attached = false;
    let broadcasts = 0;
    const config = getDefaultRuntimeConfig({ deviceId: "test-device", operatorPackage: "com.test.operator" });
    config.runner = {
      ...config.runner,
      spawn: () => {
        setTimeout(() => { attached = true; stdout.write("I/Boot: attached\n"); }, 150);
        return proc;
      },
      run: async (_command, args) => {
        broadcasts++;
        assert.equal(attached, true, "probe must not precede logcat attachment");
        const shell = args.at(-1)!;
        const payload = JSON.parse(shell.slice(shell.indexOf("{"), shell.lastIndexOf("}") + 1));
        assert.equal(payload.actions[0].type, "doctor_ping");
        stdout.write(`[Androperator-Result] ${JSON.stringify({ commandId: payload.commandId, taskId: payload.taskId,
          status: "success", error: null, stepResults: [{ id: "h1", actionType: "doctor_ping", success: true, data: {} }] })}\n`);
        return { code: 0, stdout: "Broadcast completed: result=0", stderr: "" };
      },
    };
    const result = await runDoctorPingCommand(config, (runtime, options, broadcast) =>
      waitForResultEnvelope(runtime, { ...options, broadcastDelayMs: legacyDelay }, broadcast));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(broadcasts, 1);
    assert.equal(result.probeEvidence.probeDispatchState, "dispatched");
  });
}

it("silent genuine readiness retains not-dispatched evidence and the reader-start error", async () => {
  const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
  let broadcasts = 0;
  const config = getDefaultRuntimeConfig();
  config.runner = { ...config.runner, spawn: () => proc, run: async () => { broadcasts++; throw new Error("must not dispatch"); } };
  const result = await runDoctorPingCommand(config, (runtime, options, broadcast) =>
    waitForResultEnvelope(runtime, { ...options, readerStartupTimeoutMs: 20 }, broadcast));
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_READER_NOT_READY");
  assert.equal(result.probeEvidence.probeDispatchState, "not_dispatched");
  assert.equal(result.diagnostics?.dispatchAttempted, false);
  assert.equal(broadcasts, 0);
});

it("a silent readiness reader prevents the requested main action and retains both dispatch states", async () => {
  const { runExecution } = await import("../../domain/executions/runExecution.js");
  const { probeInteractiveState, clearReadinessCacheForTesting } = await import("../../domain/doctor/checks/deviceInteractivity.js");
  clearReadinessCacheForTesting();
  let readers = 0;
  let broadcasts = 0;
  const runner = {
    ...getDefaultRuntimeConfig().runner,
    spawn: () => {
      const stdout = new PassThrough();
      const proc = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), kill: () => true });
      if (++readers === 1) queueMicrotask(() => stdout.write("I/Boot: main reader ready\n"));
      return proc;
    },
    run: async (_command: string, args: string[]) => {
      if (args.includes("devices")) return { code: 0, stdout: "List of devices attached\ntest-device\tdevice\n", stderr: "" };
      if (args.includes("packages")) return { code: 0, stdout: "package:com.test.operator\n", stderr: "" };
      broadcasts++;
      throw new Error("No doctor or main broadcast is allowed before probe reader readiness");
    },
  };
  const result = await runExecution({ commandId: "blocked-main", taskId: "blocked-task", source: "test",
    expectedFormat: "android-ui-automator", timeoutMs: 1000,
    actions: [{ id: "back", type: "press_key", params: { key: "back" } }] }, {
    runner, deviceId: "test-device", operatorPackage: "com.test.operator",
    probeInteractiveStateFn: config => probeInteractiveState(config, (runtime, options, broadcast) =>
      waitForResultEnvelope(runtime, { ...options, readerStartupTimeoutMs: 20 }, broadcast)),
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "RESULT_READER_NOT_READY");
  const details = result.error.details as Record<string, unknown>;
  assert.equal(details.phase, "readiness");
  assert.equal(details.dispatchState, "not_dispatched");
  assert.equal(details.probeDispatchState, "not_dispatched");
  assert.equal(readers, 2);
  assert.equal(broadcasts, 0);
});
