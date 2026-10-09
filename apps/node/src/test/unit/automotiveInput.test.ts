import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runHostInputSequence } from "../../domain/actions/hostInput.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { AUTOMOTIVE_KEYS } from "../../contracts/keys.js";
import type { Execution } from "../../contracts/execution.js";
import type { RunExecutionResult } from "../../domain/executions/runExecution.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

const accepted = { code: 0, stdout: "Succeeded\n", stderr: "" };
const rotated = { ...accepted, stdout: "Succeeded in injecting: RotaryEvent { inputType = 10, clockwise = true, uptimeMillisForClicks = [100] }\n" };
const noRuntime = async (): Promise<RunExecutionResult> => { throw new Error("unexpected runtime dispatch"); };
function execution(keys: readonly string[]): Execution {
  return { commandId: "car-command", taskId: "car-task", source: "test", expectedFormat: "android-ui-automator", timeoutMs: 10000,
    actions: keys.map((key, index) => ({ id: `input-${index}`, type: "press_key", params: { key } })) };
}

describe("Automotive inputs", () => {
  it("injects single-detent rotation and car controller buttons on the selected device", async () => {
    const runner = new FakeProcessRunner();
    for (let i = 0; i < AUTOMOTIVE_KEYS.length; i++) runner.queueResult(i < 2 ? rotated : accepted);
    const result = await runHostInputSequence(execution(AUTOMOTIVE_KEYS.map(key => key.toUpperCase())), getDefaultRuntimeConfig({ deviceId: "car-device", runner }), noRuntime);
    assert.equal(result.ok && result.envelope.status, "success");
    assert.deepEqual(runner.calls.map(call => call.args), [
      ["inject-rotary", "-c", "true"], ["inject-rotary"],
      ["inject-key", "280"], ["inject-key", "281"], ["inject-key", "282"], ["inject-key", "283"], ["inject-key", "23"],
    ].map(command => ["-s", "car-device", "shell", "cmd", "car_service", ...command]));
    if (!result.ok) return;
    assert.equal(result.envelope.commandId, "car-command");
    assert.equal(result.envelope.taskId, "car-task");
    assert.deepEqual(result.envelope.stepResults.map(step => step.data.key), AUTOMOTIVE_KEYS);
    assert.deepEqual(result.envelope.stepResults[0].data, { key: "rotary_clockwise", dispatchSource: "host", carCommand: "inject-rotary -c true" });
  });

  for (const response of [
    { ...accepted, stdout: "" },
    { ...accepted, stdout: "Unknown command: inject-rotary" },
    { ...accepted, stdout: "Invalid option at index 1: -c" },
    { ...accepted, stdout: "", stderr: "cmd: Can't find service: car_service" },
    { ...rotated, stderr: "java.lang.SecurityException: denied" },
    { ...accepted, code: 1 },
  ]) it(`rejects unacknowledged or failed dispatch: ${JSON.stringify(response)}`, async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult(response);
    const result = await runHostInputSequence(execution(["rotary_clockwise", "rotary_center"]), getDefaultRuntimeConfig({ deviceId: "car-device", runner }), noRuntime);
    assert.equal(result.ok && result.envelope.status, "failed");
    assert.equal(result.ok && result.envelope.error, "AUTOMOTIVE_INPUT_FAILED");
    assert.equal(runner.calls.length, 1);
  });

  it("keeps car, runtime, and TV inputs in order and preserves effects before car failure", async () => {
    const runner = new FakeProcessRunner();
    const order: string[] = [];
    runner.queueResult(rotated, () => { order.push("rotate"); });
    runner.queueResult({ ...accepted, stdout: "" }, () => { order.push("tv"); });
    runner.queueResult({ ...accepted, stdout: "Permission denied" }, () => { order.push("car-failure"); });
    const result = await runHostInputSequence(execution(["rotary_clockwise", "back", "dpad_up", "rotary_center", "home"]), getDefaultRuntimeConfig({ deviceId: "car-device", runner }), async segment => {
      order.push("back");
      return { ok: true, deviceId: "car-device", terminalSource: "androperator_result", envelope: {
        commandId: segment.commandId, taskId: segment.taskId, status: "success",
        stepResults: [{ id: "input-1", actionType: "press_key", success: true, data: { key: "back" } }],
      } };
    });
    assert.deepEqual(order, ["rotate", "back", "tv", "car-failure"]);
    assert.equal(result.ok && result.envelope.status, "failed");
    assert.deepEqual(result.ok && result.envelope.stepResults.map(step => step.success), [true, true, true, false]);
  });
});
