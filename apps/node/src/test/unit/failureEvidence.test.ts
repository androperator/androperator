import assert from "node:assert/strict";
import { it } from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runExecution } from "../../domain/executions/runExecution.js";
import { ensureInteractiveAutomationReady, probeInteractiveState, clearReadinessCacheForTesting } from "../../domain/doctor/checks/deviceInteractivity.js";
import { formatRunExecutionResultForCli } from "../../cli/output.js";
import { parseDaemonRunExecutionResult } from "../../cli/daemonProxy.js";
import { buildExecutionToolFailureResult, buildExecutionSuccessPayload } from "../../mcp/tools/common.js";
import { buildMcpSuccessResult } from "../../mcp/errors.js";
import { androperatorEvents, ANDROPERATOR_EVENT_TYPES } from "../../domain/observe/events.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";
import { executionRunner } from "./fakes/executionResultRunner.js";
import type { Execution } from "../../contracts/execution.js";
import { emittedSkillResultSchema } from "../../contracts/skillResult.js";
import type { ResultEnvelope } from "../../contracts/result.js";

const execution: Execution = { commandId: "requested", taskId: "requested-task", source: "test", expectedFormat: "android-ui-automator", timeoutMs: 1000, actions: [{ id: "snap", type: "snapshot" }] };
const options = { deviceId: "test-device", operatorPackage: "com.test.operator", logcatBroadcastDelayMs: 0, resultEnvelopeTimeoutMs: 20 };
const retained = JSON.parse(readFileSync(new URL("../../../src/test/fixtures/readiness-timeout.json", import.meta.url), "utf8"));
function runner() {
  const result = new FakeProcessRunner();
  result.queueResult({ code: 0, stdout: "List of devices attached\ntest-device\tdevice\n", stderr: "" });
  result.queueResult({ code: 0, stdout: "package:com.test.operator\n", stderr: "" });
  result.spawn = (() => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} })) as FakeProcessRunner["spawn"];
  return result;
}
const ready = async () => ({ ok: true as const, state: { screenOn: true, deviceLocked: false, userUnlocked: true } });

it("retains requested identity without inventing probe identity before readiness starts", async () => {
  const process = runner();
  process.run = async () => { throw { code: "ADB_NOT_FOUND", message: "missing adb", details: { diagnosticReference: "fixture:missing-adb" } }; };
  const result = await runExecution(execution, { ...options, runner: process });
  assert.ok(!result.ok);
  const details = result.error.details as Record<string, unknown>;
  assert.equal(details.phase, "readiness");
  assert.equal(details.dispatchState, "not_dispatched");
  assert.equal(details.commandId, execution.commandId);
  assert.equal(details.probeCommandId, undefined);
  assert.equal(details.diagnosticReference, "fixture:missing-adb");
  assert.equal("envelope" in result, false);
});

it("retained readiness timeout survives cached readiness, CLI, daemon, MCP and execution events", async () => {
  clearReadinessCacheForTesting();
  const process = runner();
  process.queueResult({ code: 0, stdout: "", stderr: "" }); // force stop
  process.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" });
  let event: unknown;
  const listener = (value: { result: unknown }) => { event = value.result; };
  androperatorEvents.once(ANDROPERATOR_EVENT_TYPES.EXECUTION, listener);
  const result = await runExecution({ ...execution, actions: [{ id: "close", type: "close_app", params: { applicationId: "com.example.app" } }, ...execution.actions] }, {
    ...options, runner: process,
    probeInteractiveStateFn: config => probeInteractiveState(config, async (_config, probe, broadcast) => {
      assert.notEqual(probe.commandId, execution.commandId);
      await broadcast!(() => {});
      return { ok: false, timeout: true, diagnostics: { code: "RESULT_ENVELOPE_TIMEOUT", message: retained.message, details: { diagnosticReference: retained.diagnosticReference, reader: { events: ["deadline_reached"] } } } };
    }),
  });
  assert.ok(!result.ok);
  assert.deepEqual(event, result);
  const details = result.error.details as Record<string, unknown>;
  assert.equal(details.phase, "readiness");
  assert.equal(details.dispatchState, "not_dispatched");
  assert.equal(details.probeDispatchState, "dispatched");
  assert.equal(details.probeTaskId, "doctor-handshake");
  assert.notEqual(details.probeCommandId, execution.commandId);
  assert.deepEqual(details.earlierEffects, [{ actionId: "close", effect: "force_stop" }]);
  assert.ok(details.probeStartedAt && details.probeCompletedAt && details.completedAt);
  assert.deepEqual(parseDaemonRunExecutionResult(JSON.stringify(result)), JSON.parse(JSON.stringify(result)));
  assert.deepEqual(JSON.parse(formatRunExecutionResultForCli(result, { format: "json" })).details, JSON.parse(JSON.stringify(details)));
  assert.deepEqual(buildExecutionToolFailureResult(result.error).structuredContent?.details, JSON.parse(JSON.stringify(details)));
});

for (const acknowledged of [true, false]) it(`retains successful readiness probe through dispatch failure acknowledged=${acknowledged}`, async () => {
  const process = runner();
  process.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" });
  process.queueResult({ code: acknowledged ? 0 : 1, stdout: "", stderr: "" });
  const result = await runExecution(execution, { ...options, runner: process,
    ensureInteractiveAutomationReadyFn: config => ensureInteractiveAutomationReady(config, {
      probeInteractiveStateFn: cfg => probeInteractiveState(cfg, async (_config, probe, broadcast) => {
        await broadcast!(() => {});
        return { ok: true, terminalSource: "androperator_result", envelope: { commandId: probe.commandId, taskId: "doctor-handshake", status: "success", error: null, stepResults: [{ id: "h1", actionType: "doctor_ping", success: true, data: { screen_on: "true", device_locked: "false", user_unlocked: "true" } }] } };
      }),
    }),
  });
  assert.ok(!result.ok);
  const details = result.error.details as Record<string, unknown>;
  assert.equal(details.phase, acknowledged ? "result_wait" : "dispatch");
  assert.equal(details.dispatchState, acknowledged ? "dispatched" : "unknown");
  assert.equal(details.commandId, execution.commandId);
  assert.match(String(details.probeCommandId), /^doctor-handshake-/);
  assert.equal(details.probeTaskId, "doctor-handshake");
  assert.equal(details.probeDispatchState, "dispatched");
  assert.equal("envelope" in result, false);
});

it("preserves confirmed earlier force-stops when a later preflight throws", async () => {
  const process = runner();
  process.queueResult({ code: 0, stdout: "", stderr: "" });
  process.queueResult({ code: 0, stdout: "", stderr: "" }, () => { throw { code: "DEVICE_SHELL_UNAVAILABLE", message: "connection lost", details: { diagnosticReference: "fixture:preflight" } }; });
  const result = await runExecution({ ...execution, actions: ["first", "second"].map(id => ({ id, type: "close_app" as const, params: { applicationId: `com.example.${id}` } })) }, { ...options, runner: process });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "DEVICE_SHELL_UNAVAILABLE");
  const details = result.error.details as Record<string, unknown>;
  assert.equal(details.phase, "readiness");
  assert.equal(details.dispatchState, "not_dispatched");
  assert.deepEqual(details.earlierEffects, [{ actionId: "first", effect: "force_stop" }]);
  assert.equal(details.diagnosticReference, "fixture:preflight");
});

it("retains structured errors thrown during readiness", async () => {
  const result = await runExecution(execution, { ...options, runner: runner(), ensureInteractiveAutomationReadyFn: async () => {
    throw { code: "RESULT_TRANSPORT_FAILED", message: "probe disconnected", details: { probeCommandId: "probe-thrown", probeTaskId: "doctor-handshake", probeDispatchState: "unknown", diagnosticReference: "fixture:throw" } };
  } });
  assert.ok(!result.ok);
  assert.equal(result.error.message, "probe disconnected");
  assert.equal((result.error.details as Record<string, unknown>).probeCommandId, "probe-thrown");
});

it("attaches complete host evidence to a real envelope on post-processing failure and preserves success", async () => {
  for (const valid of [false, true]) {
    const envelope: ResultEnvelope = { commandId: execution.commandId, taskId: execution.taskId, status: "success", error: null, stepResults: [{ id: "snap", actionType: "snapshot_ui", success: true, data: {} }] };
    const result = await runExecution(execution, { ...options, runner: executionRunner(envelope, valid ? "<hierarchy/>" : "<hierarchy>"), ensureInteractiveAutomationReadyFn: ready });
    assert.ok(result.ok);
    const evidence = result.envelope.failureEvidence;
    if (valid) { assert.equal(evidence, undefined); assert.equal(result.envelope.status, "success"); continue; }
    assert.equal(result.envelope.status, "failed");
    const retainedEnvelope = emittedSkillResultSchema.shape.execEnvelopes.parse([result.envelope])?.[0];
    assert.deepEqual(retainedEnvelope?.failureEvidence, evidence);
    assert.deepEqual(retainedEnvelope?.stepResults[0].data.extractionDiagnostics, result.envelope.stepResults[0].data.extractionDiagnostics);
    assert.deepEqual(retainedEnvelope?.diagnostics, result.envelope.diagnostics);
    assert.equal(evidence?.phase, "post_processing");
    assert.equal(evidence?.dispatchState, "dispatched");
    assert.equal(evidence?.commandId, execution.commandId);
    assert.ok(evidence?.startedAt && evidence?.completedAt);
    assert.deepEqual(JSON.parse(formatRunExecutionResultForCli(result, { format: "json" })).envelope.failureEvidence, evidence);
    const mcp = buildMcpSuccessResult(buildExecutionSuccessPayload(result));
    assert.deepEqual((mcp.structuredContent?.envelope as Record<string, unknown>).failureEvidence, evidence);
    assert.deepEqual(parseDaemonRunExecutionResult(JSON.stringify(result)), JSON.parse(JSON.stringify(result)));
  }
});


it("snapshot presentation errors preserve correlation through the CLI", async () => {
  const { cmdObserveSnapshot } = await import("../../cli/commands/observe.js");
  const output = JSON.parse(await cmdObserveSnapshot({ format: "json", compact: true,
    tryDaemonExecutionFn: async () => null,
    runExecutionFn: async () => ({ ok: true, deviceId: "test-device", terminalSource: "androperator_result", envelope: {
      commandId: "presentation-command", taskId: "presentation-task", status: "success", stepResults: [
        { id: "snap", actionType: "snapshot", success: true, data: { text: "<hierarchy><invalid/></hierarchy>" } },
      ],
    } }),
  }));
  assert.equal(output.code, "SNAPSHOT_EXTRACTION_FAILED");
  assert.equal(output.details.phase, "post_processing");
  assert.equal(output.details.dispatchState, "dispatched");
  assert.equal(output.details.commandId, "presentation-command");
  assert.equal(output.details.taskId, "presentation-task");
  assert.ok(output.envelope);
});


it("a correlated terminal result proves dispatch even before broadcast acknowledgement", async () => {
  const process = runner();
  const logcat = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
  process.spawn = (() => logcat) as FakeProcessRunner["spawn"];
  const envelope: ResultEnvelope = { commandId: execution.commandId, taskId: execution.taskId, status: "success", error: null, stepResults: [{ id: "snap", actionType: "snapshot_ui", success: true, data: {} }] };
  process.queueResult({ code: 0, stdout: "", stderr: "" }, async () => {
    logcat.stdout.emit("data", Buffer.from(`D/Result: [Androperator-Result] ${JSON.stringify(envelope)}\n`));
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  const result = await runExecution(execution, { ...options, runner: process, ensureInteractiveAutomationReadyFn: ready });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.envelope.failureEvidence?.dispatchState, "dispatched");
});

it("late broadcast acknowledgement cannot rewind screenshot post-processing evidence", async () => {
  const process = runner();
  const logcat = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
  const capture = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
  let startCapture!: () => void;
  const captureStarted = new Promise<void>(resolve => { startCapture = resolve; });
  process.spawn = ((_command, args) => {
    if (args.includes("logcat")) return logcat;
    assert.ok(args.includes("screencap"));
    startCapture();
    return capture;
  }) as FakeProcessRunner["spawn"];
  const envelope: ResultEnvelope = {
    commandId: execution.commandId, taskId: execution.taskId, status: "success", error: null,
    stepResults: [{ id: "screen", actionType: "take_screenshot", success: true, data: {} }],
  };
  process.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" }, async () => {
    logcat.stdout.emit("data", Buffer.from(`D/Result: [Androperator-Result] ${JSON.stringify(envelope)}\n`));
    await captureStarted;
  });
  const logger: import("../../adapters/logger.js").Logger = {
    emit(event) {
      // Fail capture only after the delayed acknowledgement updates execution evidence.
      if (event.event === "broadcast.dispatched") capture.emit("close", 1);
    },
    status() { return { status: "disabled" }; },
    child() { return logger; },
    logPath() { return undefined; },
  };
  const result = await runExecution({ ...execution, actions: [{ id: "screen", type: "take_screenshot" }] }, {
    ...options, runner: process, logger, ensureInteractiveAutomationReadyFn: ready,
  });
  assert.ok(result.ok);
  assert.equal(result.envelope.status, "failed");
  assert.equal(result.envelope.stepResults[0].data.failurePhase, "post_processing");
  assert.equal(result.envelope.failureEvidence?.phase, "post_processing");
  assert.equal(result.envelope.failureEvidence?.dispatchState, "dispatched");
});
