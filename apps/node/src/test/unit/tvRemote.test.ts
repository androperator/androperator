import { runExecution } from "../../domain/executions/runExecution.js";
import { tryAcquire, release } from "../../domain/executions/executionStore.js";
import { androperatorEvents, ANDROPERATOR_EVENT_TYPES } from "../../domain/observe/events.js";
import type { ResultEnvelope } from "../../contracts/result.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runTvRemoteSequence } from "../../domain/actions/tvRemote.js";
import { validateExecution } from "../../domain/executions/validateExecution.js";
import { SYSTEM_KEYS } from "../../contracts/keys.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { Execution } from "../../contracts/execution.js";
import type { RunExecutionResult } from "../../domain/executions/runExecution.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

function execution(keys: string[]): Execution {
  return { commandId: "tv-command", taskId: "tv-task", source: "test", expectedFormat: "android-ui-automator", timeoutMs: 10000,
    actions: keys.map((key, index) => ({ id: `key-${index}`, type: "press_key", params: { key } })) };
}
const noRuntime = async (): Promise<RunExecutionResult> => { throw new Error("unexpected runtime dispatch"); };
const accepted = { code: 0, stdout: "", stderr: "" };

describe("TV remote", () => {
  it("accepts all public keys case-insensitively and rejects invented icon key names", () => {
    for (const key of SYSTEM_KEYS) {
      validateExecution(execution([key.toUpperCase()]));
    }
    for (const key of ["", " ", "select_profile", "KEYCODE_TV", "volume_up"]) assert.throws(() => validateExecution(execution([key])));
  });

  it("dispatches all key events to the selected device with the verified profile mapping", async () => {
    const runner = new FakeProcessRunner();
    const keys = ["dpad_up", "dpad_down", "dpad_left", "dpad_right", "dpad_center", "bookmark", "profile"];
    keys.forEach(() => runner.queueResult(accepted));
    const result = await runTvRemoteSequence(execution(keys), getDefaultRuntimeConfig({ deviceId: "test-device", runner }), noRuntime);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.envelope.commandId, "tv-command");
    assert.equal(result.envelope.taskId, "tv-task");
    assert.equal(result.envelope.stepResults.length, 7);
    assert.deepEqual(runner.calls.map(call => call.args), ["DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_CENTER", "BOOKMARK", "NOTIFICATION"].map(key => ["-s", "test-device", "shell", "input", "keyevent", `KEYCODE_${key}`]));
  });

  for (const version of [33, 34, 36]) it(`launches TV activities using the emulator mapping on API ${version}`, async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult(accepted);
    runner.queueResult({ ...accepted, stdout: String(version) });
    runner.queueResult({ ...accepted, stdout: "Status: ok" });
    const result = await runTvRemoteSequence(execution(["settings", "tv"]), getDefaultRuntimeConfig({ deviceId: "test-device", runner }), noRuntime);
    assert.equal(result.ok && result.envelope.status, "success");
    assert.deepEqual(runner.calls[0].args.slice(2), ["shell", "am", "start", "-W", "-n", "com.android.tv.settings/com.android.tv.settings.MainSettings"]);
    assert.equal(runner.calls[2].args.at(-1), version < 34 ? "com.google.android.tv/com.android.tv.MainActivity" : "com.android.tv/com.android.tv.MainActivity");
  });

  it("preserves mixed runtime and button order, with distinct segment transport IDs", async () => {
    const runner = new FakeProcessRunner();
    const order: string[] = [];
    runner.queueResult(accepted, () => { order.push("bookmark"); });
    const ids: string[] = [];
    const result = await runTvRemoteSequence(execution(["back", "bookmark", "home"]), getDefaultRuntimeConfig({ deviceId: "test-device", runner }), async segment => {
      ids.push(segment.commandId);
      order.push(segment.actions[0].params!.key!);
      return { ok: true, deviceId: "test-device", terminalSource: "androperator_result", envelope: { commandId: segment.commandId, taskId: segment.taskId, status: "success", stepResults: segment.actions.map(action => ({ id: action.id, actionType: action.type, success: true, data: {} })) } };
    });
    assert.deepEqual(order, ["back", "bookmark", "home"]);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(result.ok && result.envelope.commandId, "tv-command");
    assert.deepEqual(result.ok && result.envelope.stepResults.map(step => step.id), ["key-0", "key-1", "key-2"]);
  });

  for (const response of [{ code: 1, stdout: "", stderr: "denied" }, { code: 0, stdout: "Error type 3\nError: Activity class does not exist", stderr: "" }]) it("keeps rejected dispatch failed and stops subsequent buttons", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult(response);
    const result = await runTvRemoteSequence(execution(["settings", "bookmark"]), getDefaultRuntimeConfig({ deviceId: "test-device", runner }), noRuntime);
    assert.equal(result.ok && result.envelope.status, "failed");
    assert.equal(result.ok && result.envelope.stepResults[0].success, false);
    assert.equal(runner.calls.length, 1);
  });

  it("stops after a runtime failure and preserves earlier button results", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult(accepted);
    const result = await runTvRemoteSequence(execution(["bookmark", "back", "profile"]), getDefaultRuntimeConfig({ deviceId: "test-device", runner }), async segment => ({
      ok: true, deviceId: "test-device", terminalSource: "androperator_result", envelope: {
        commandId: segment.commandId, taskId: segment.taskId, status: "failed", error: "GLOBAL_ACTION_FAILED",
        stepResults: [{ id: "key-1", actionType: "press_key", success: false, data: { error: "GLOBAL_ACTION_FAILED" } }],
      },
    }));
    assert.equal(result.ok && result.envelope.status, "failed");
    assert.equal(result.ok && result.envelope.stepResults.length, 2);
    assert.equal(runner.calls.length, 1);
  });

  it("preserves confirmed preceding effects if a later host transport throws", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult(accepted);
    const result = await runTvRemoteSequence(execution(["bookmark", "profile"]), getDefaultRuntimeConfig({ deviceId: "test-device", runner }), noRuntime);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal((result.error.details as { stepResults: unknown[] }).stepResults.length, 1);
  });

  it("does not inject a canceled command", async () => {
    const runner = new FakeProcessRunner();
    const controller = new AbortController();
    controller.abort();
    const result = await runTvRemoteSequence(execution(["bookmark"]), getDefaultRuntimeConfig({ deviceId: "test-device", runner }), noRuntime, controller.signal);
    assert.equal(result.ok, false);
    assert.equal(runner.calls.length, 0);
  });
});


describe("TV remote execution integration", () => {
  it("holds the device lock across runtime segments and emits only the caller envelope", async () => {
    const runner = new FakeProcessRunner();
    const deviceId = "tv-lock-device";
    const resolve = { ...accepted, stdout: `List of devices attached\n${deviceId}\tdevice\n` };
    const apk = { ...accepted, stdout: "package:com.test.operator.dev\n" };
    runner.queueResult(resolve);
    runner.queueResult(apk);
    runner.queueResult(accepted);
    runner.queueResult(resolve);
    runner.queueResult(apk);
    runner.queueResult(accepted, () => { assert.equal(tryAcquire(deviceId, "competitor"), false); });
    runner.queueResult(accepted, () => { assert.equal(tryAcquire(deviceId, "competitor"), false); });
    const input = execution(["bookmark", "home", "profile"]);
    input.actions[1] = { id: "key-1", type: "close_app", params: { applicationId: "com.example.app" } };
    const events: ResultEnvelope[] = [];
    const listener = (event: { deviceId: string; envelope: ResultEnvelope }) => {
      if (event.deviceId === deviceId) events.push(event.envelope);
    };
    androperatorEvents.on(ANDROPERATOR_EVENT_TYPES.RESULT, listener);
    try {
      const result = await runExecution(input, { deviceId, operatorPackage: "com.test.operator.dev", runner,
        ensureInteractiveAutomationReadyFn: async () => ({ ok: true, state: { screenOn: true, deviceLocked: false, userUnlocked: true } }) });
      assert.equal(result.ok && result.envelope.status, "success");
      assert.deepEqual(result.ok && result.envelope.stepResults.map(step => step.id), ["key-0", "key-1", "key-2"]);
      assert.equal(events.length, 1);
      assert.equal(events[0].commandId, input.commandId);
      assert.equal(tryAcquire(deviceId, "competitor"), true);
    } finally {
      release(deviceId, "competitor");
      androperatorEvents.off(ANDROPERATOR_EVENT_TYPES.RESULT, listener);
    }
  });

  it("requires interactive readiness before injecting any TV button", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({ ...accepted, stdout: "List of devices attached\ntv-readiness-device\tdevice\n" });
    runner.queueResult({ ...accepted, stdout: "package:com.test.operator.dev\n" });
    const result = await runExecution(execution(["bookmark"]), { deviceId: "tv-readiness-device", operatorPackage: "com.test.operator.dev", runner,
      ensureInteractiveAutomationReadyFn: async () => ({ ok: false, error: { code: "DEVICE_NOT_INTERACTIVE", message: "not ready" } }) });
    assert.equal(result.ok, false);
    assert.equal(runner.calls.some(call => call.args.includes("keyevent")), false);
  });
});
