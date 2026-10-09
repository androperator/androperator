import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runHostInputSequence } from "../../domain/actions/hostInput.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { WEAR_KEYS } from "../../contracts/keys.js";
import type { Execution } from "../../contracts/execution.js";
import type { RunExecutionResult } from "../../domain/executions/runExecution.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

const accepted = { code: 0, stdout: "", stderr: "" };
const watch = { ...accepted, stdout: "true\n" };
const usage = { ...accepted, stdout: "rotaryencoder\n  scroll [axis_value]\n--axis SCROLL,1" };
const noRuntime = async (): Promise<RunExecutionResult> => { throw new Error("unexpected runtime dispatch"); };
function execution(keys: readonly string[]): Execution {
  return { commandId: "wear-command", taskId: "wear-task", source: "test", expectedFormat: "android-ui-automator", timeoutMs: 10000,
    actions: keys.map((key, index) => ({ id: `input-${index}`, type: "press_key", params: { key } })) };
}

describe("Wear inputs", () => {
  it("preflights once and dispatches every mapping on the explicit watch, preserving IDs and evidence", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult(watch);
    runner.queueResult(usage);
    for (let index = 0; index < WEAR_KEYS.length; index++) runner.queueResult(accepted);
    const result = await runHostInputSequence(execution(WEAR_KEYS.map(key => key.toUpperCase())), getDefaultRuntimeConfig({ deviceId: "watch", runner }), noRuntime);
    assert.equal(result.ok && result.envelope.status, "success");
    assert.deepEqual(runner.calls.map(call => call.args), [
      ["pm", "has-feature", "android.hardware.type.watch"], ["input"],
      ["input", "rotaryencoder", "scroll", "--axis", "SCROLL,-1"],
      ["input", "rotaryencoder", "scroll", "--axis", "SCROLL,1"],
      ...["PRIMARY", "1", "2", "3"].map(stem => ["input", "keyevent", `KEYCODE_STEM_${stem}`]),
    ].map(args => ["-s", "watch", "shell", ...args]));
    if (!result.ok) return;
    assert.equal(result.envelope.commandId, "wear-command");
    assert.equal(result.envelope.taskId, "wear-task");
    assert.deepEqual(result.envelope.stepResults.map(step => step.data.key), WEAR_KEYS);
    assert.deepEqual(result.envelope.stepResults[0].data, { key: "wear_rotary_clockwise", dispatchSource: "host", inputCommand: "rotaryencoder scroll --axis SCROLL,-1" });
  });

  for (const feature of ["false", "", "true\nError: unavailable"]) it(`rejects incompatible target before leading runtime actions: ${feature}`, async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({ ...accepted, stdout: feature });
    const result = await runHostInputSequence(execution(["home", "wear_stem_1"]), getDefaultRuntimeConfig({ deviceId: "watch", runner }), noRuntime);
    assert.equal(!result.ok && result.error.code, "WEAR_DEVICE_REQUIRED");
    assert.equal(runner.calls.length, 1);
  });

  it("rejects older shell rotary capability before any mutation", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult(watch);
    runner.queueResult({ ...accepted, stdout: "Usage: input\n  keyevent" });
    const result = await runHostInputSequence(execution(["home", "wear_rotary_clockwise"]), getDefaultRuntimeConfig({ deviceId: "watch", runner }), noRuntime);
    assert.equal(!result.ok && result.error.code, "WEAR_ROTARY_UNSUPPORTED");
    assert.equal(runner.calls.length, 2);
  });

  for (const failure of [
    { ...accepted, stdout: "Unknown command: scroll" },
    { ...accepted, stderr: "Permission denied" },
    { ...accepted, code: 1 },
  ]) it(`stops ordered mixed execution on rejected dispatch: ${JSON.stringify(failure)}`, async () => {
    const runner = new FakeProcessRunner();
    const order: string[] = [];
    runner.queueResult(watch);
    runner.queueResult(accepted, () => { order.push("stem"); });
    runner.queueResult(failure, () => { order.push("failure"); });
    const result = await runHostInputSequence(execution(["wear_stem_1", "back", "wear_stem_2", "home"]), getDefaultRuntimeConfig({ deviceId: "watch", runner }), async segment => {
      order.push("back");
      assert.notEqual(segment.commandId, "wear-command");
      assert.equal(segment.taskId, "wear-task");
      return { ok: true, deviceId: "watch", terminalSource: "androperator_result", envelope: { commandId: segment.commandId, taskId: segment.taskId, status: "success", stepResults: [{ id: "input-1", actionType: "press_key", success: true, data: {} }] } };
    });
    assert.deepEqual(order, ["stem", "back", "failure"]);
    assert.equal(result.ok && result.envelope.error, "WEAR_INPUT_FAILED");
    assert.deepEqual(result.ok && result.envelope.stepResults.map(step => step.success), [true, true, false]);
  });

  it("cancels during preflight without injecting or running leading runtime actions", async () => {
    const runner = new FakeProcessRunner();
    const controller = new AbortController();
    runner.queueResult(watch, () => controller.abort());
    const result = await runHostInputSequence(execution(["home", "wear_rotary_clockwise"]), getDefaultRuntimeConfig({ deviceId: "watch", runner }), noRuntime, controller.signal);
    assert.equal(!result.ok && result.error.code, "RESULT_TRANSPORT_CANCELLED");
    assert.equal(runner.calls.length, 1);
  });

  it("enforces the execution deadline during capability checks", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult(watch, () => new Promise(resolve => setTimeout(resolve, 20)));
    const payload = { ...execution(["back", "wear_stem_primary"]), timeoutMs: 5 };
    const result = await runHostInputSequence(payload, getDefaultRuntimeConfig({ deviceId: "watch", runner }), noRuntime);
    assert.equal(!result.ok && result.error.code, "COMMAND_TIMEOUT");
    assert.equal(runner.calls.length, 1);
  });

});
