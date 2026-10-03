import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { buildNotificationMediaExecution } from "../../domain/notifications/service.js";
import { isBackgroundObservation, isBackgroundServiceExecution } from "../../contracts/notifications.js";
import { cmdDoctor } from "../../cli/commands/doctor.js";

afterEach(() => { process.exitCode = undefined; });
describe("notification/media contract", () => {
  it("exempts only nonempty validated observation-only lists", () => {
    const actions = ["list_notifications", "list_media_sessions", "get_media_status", "observe_media"].map(type => ({ id: type, type }));
    assert.equal(isBackgroundObservation(actions), true);
    for (const type of ["media_pause", "media_play", "media_seek", "dismiss_notification", "invoke_notification_action", "snapshot", "doctor_ping", "unknown", "LIST_NOTIFICATIONS"]) {
      assert.equal(isBackgroundObservation([...actions, { id: "x", type }]), false);
      assert.equal(isBackgroundObservation([{ id: "x", type }, ...actions]), false);
    }
    assert.equal(isBackgroundObservation([]), false);
  });
  it("rejects invalid/missing targets and inappropriate parameters", () => {
    for (const params of [{}, { applicationId: "" }, { applicationId: " " }, { mediaSessionId: "" }, { applicationId: "p", mediaSessionId: "s" }, { applicationId: "p", limit: 1 }]) {
      assert.throws(() => buildNotificationMediaExecution("get_media_status", params));
    }
    for (const params of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { maxTextChars: 0 }, { applicationId: "" }, { mediaSessionId: "s" }]) {
      assert.throws(() => buildNotificationMediaExecution("list_notifications", params));
    }
    assert.throws(() => buildNotificationMediaExecution("media_play", { applicationId: "p", waitTimeoutMs: -1 }));
    assert.throws(() => buildNotificationMediaExecution("media_pause", { applicationId: "p", waitTimeoutMs: 30001 }));
    assert.equal(buildNotificationMediaExecution("media_pause", { mediaSessionId: "s", waitTimeoutMs: 1000 }).actions[0].type, "media_pause");
    assert.equal(buildNotificationMediaExecution("list_notifications", { limit: 100 }).actions[0].params?.limit, 100);
  });
  it("rejects background doctor mutations before executing any diagnostics", async () => {
    for (const options of [{ capability: "invalid" }, { capability: "background-observation", full: true }, { capability: "background-observation", fix: true }]) {
      const result = JSON.parse(await cmdDoctor({ format: "json", ...options }, { doctorService: { run: async () => { throw new Error("must not run"); } } }));
      assert.equal(result.code, "INVALID_ARGUMENT");
      assert.equal(process.exitCode, 1);
    }
  });
});

import { EventEmitter } from "node:events";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";
import { runExecution } from "../../domain/executions/runExecution.js";
import { clearReadinessCacheForTesting, ensureInteractiveAutomationReadyCached } from "../../domain/doctor/checks/deviceInteractivity.js";

it("dispatches each service read/control and mixed lists without interactive readiness", async () => {
  const cases = [
    buildNotificationMediaExecution("list_notifications"),
    buildNotificationMediaExecution("list_media_sessions"),
    buildNotificationMediaExecution("get_media_status", { mediaSessionId: "s" }),
    buildNotificationMediaExecution("observe_media", { mediaSessionId: "s", durationMs: 1 }),
    buildNotificationMediaExecution("media_pause", { mediaSessionId: "s" }),
    buildNotificationMediaExecution("media_play", { mediaSessionId: "s" }),
    buildNotificationMediaExecution("media_seek", { mediaSessionId: "s", positionMs: 0 }),
  ];
  cases.push({ ...cases[0], actions: cases.flatMap((execution, index) => execution.actions.map(action => ({ ...action, id: `a${index}` }))) });
  for (const cache of ["cold", "warm", "expired"]) {
    for (const execution of cases) {
      clearReadinessCacheForTesting();
      const runner = new FakeProcessRunner();
      const envelope = { commandId: execution.commandId, taskId: execution.taskId, status: "success", error: null, stepResults: execution.actions.map(action => ({ id: action.id, actionType: action.type, success: true, data: { payload: '{}' } })) };
      let stream: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
      runner.spawn = (() => {
        stream = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
        return stream;
      }) as FakeProcessRunner["spawn"];
      runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device\tdevice\n", stderr: "" });
      runner.queueResult({ code: 0, stdout: "package:com.test.operator\n", stderr: "" });
      runner.queueResult({ code: 0, stdout: "0", stderr: "" });
      runner.queueResult({ code: 0, stdout: "RUNNING_UNLOCKED", stderr: "" });
      runner.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" }, () => {
        setTimeout(() => { stream.stdout.emit("data", Buffer.from(`[Androperator-Result] ${JSON.stringify(envelope)}\n`)); }, 5);
      });
      if (cache !== "cold") {
        const now = Date.now();
        const clock = mock.method(Date, "now", () => now - (cache === "expired" ? 9000 : 0));
        try {
          await ensureInteractiveAutomationReadyCached(getDefaultRuntimeConfig({ deviceId: "test-device", operatorPackage: "com.test.operator", runner }), {
            probeInteractiveStateFn: async () => ({ ok: true, state: { screenOn: true, deviceLocked: false, userUnlocked: true } }),
          });
        } finally { clock.mock.restore(); }
      }
      const result = await runExecution(execution, { deviceId: "test-device", operatorPackage: "com.test.operator", runner, logcatBroadcastDelayMs: 0, resultEnvelopeTimeoutMs: 1000,
        ensureInteractiveAutomationReadyFn: async () => { throw new Error("must not wake or probe interactive readiness"); } });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(runner.calls.some(call => /WAKEUP|KEYCODE_HOME|logcat -c|doctor_ping/.test(call.args.join(" "))), false);
    }
  }
  clearReadinessCacheForTesting();
});

import { grantNotificationListenerPermission } from "../../domain/device/grantPermissions.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
it("reconciles an existing settings grant through NotificationManager", async () => {
  const runner = new FakeProcessRunner();
  const service = "com.test.operator/action.notification.NotificationListenerService";
  runner.queueResult({ code: 0, stdout: service, stderr: "" });
  runner.queueResult({ code: 0, stdout: "", stderr: "" });
  const result = await grantNotificationListenerPermission(getDefaultRuntimeConfig({ runner }), "com.test.operator");
  assert.deepEqual(result, { ok: true, alreadyEnabled: true });
  assert.deepEqual(runner.calls[1].args, ["shell", "cmd", "notification", "allow_listener", service]);
});
it("does not normalize denied notification grant to success", async () => {
  const runner = new FakeProcessRunner();
  runner.queueResult({ code: 0, stdout: "null", stderr: "" });
  runner.queueResult({ code: 0, stdout: "SecurityException: denied", stderr: "" });
  assert.equal((await grantNotificationListenerPermission(getDefaultRuntimeConfig({ runner }), "com.test.operator")).ok, false);
});

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
it("CLI rejects missing, blank, conflicting and invalid service values with JSON and nonzero exits", () => {
  const cli = fileURLToPath(new URL("../../cli/index.js", import.meta.url));
  for (const args of [
    ["notifications", "dismiss"], ["notifications", "dismiss", " "],
    ["notifications", "action", "key"], ["notifications", "action", "key", "--action"],
    ["notifications", "action", "key", "--action", " "], ["notifications", "dismiss", "key", "--action", "a"],
    ["media", "seek", "--session", "s"], ["media", "seek", "--session", "s", "--position-ms"],
    ...["-1", "1.5", "NaN", "Infinity", "9007199254740992", " "].map(value => ["media", "seek", "--session", "s", "--position-ms", value]),
    ["media", "seek", "--session", "s", "--position-ms", "0", "--position-tolerance-ms", "60001"],
    ["media", "observe", "--session", "s"],
    ["media", "observe", "--session", "s", "--duration-ms"],
    ...["0", "-1", "30001", "1.5", "NaN", "Infinity", " "].map(value => ["media", "observe", "--session", "s", "--duration-ms", value]),
    ["media", "status"], ["media", "status", "--session"],
    ["media", "status", "--session", " "], ["media", "status", "--app", "p", "--session", "s"],
    ["media", "play", "--app", "p", "--wait-timeout-ms", "-1"],
    ["notifications", "list", "--limit", "0"], ["notifications", "list", "--max-text-chars", "1025"],
    ["doctor", "--capability"], ["doctor", "--capability", "bogus"],
    ["doctor", "--capability", "background-observation", "--full"],
  ]) {
    for (const optionsFirst of [true, false]) {
      const global = ["--device", "non-existent-test-device", "--output", "json"];
      const result = spawnSync(process.execPath, [cli, ...(optionsFirst ? [...global, ...args] : [...args, ...global])], { encoding: "utf8" });
      assert.notEqual(result.status, 0, JSON.stringify(args));
      const error = JSON.parse(result.stdout);
      assert.match(error.code, /USAGE|INVALID|VALIDATION/);
    }
  }
});

it("returns an explicit pre-unlock error without dispatch, wake or remediation", async () => {
  for (const execution of [
    buildNotificationMediaExecution("list_notifications"),
    buildNotificationMediaExecution("media_pause", { mediaSessionId: "s" }),
    buildNotificationMediaExecution("media_play", { mediaSessionId: "s" }),
    buildNotificationMediaExecution("media_seek", { mediaSessionId: "s", positionMs: 0 }),
  ]) {
    const runner = new FakeProcessRunner();
    runner.spawn = (() => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} })) as FakeProcessRunner["spawn"];
    for (const stdout of ["List of devices attached\ntest-device\tdevice\n", "package:com.test.operator", "0", "RUNNING_LOCKED"]) {
      runner.queueResult({ code: 0, stdout, stderr: "" });
    }
    const result = await runExecution(execution, { deviceId: "test-device", operatorPackage: "com.test.operator", runner, logcatBroadcastDelayMs: 0 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DEVICE_USER_NOT_UNLOCKED");
    assert.equal(runner.calls.some(call => /broadcast|WAKEUP|HOME|doctor_ping|settings put/.test(call.args.join(" "))), false);
  }
});

import { probeUserUnlockState } from "../../domain/device/userUnlockState.js";
it("leaves unavailable or unsupported unlock probes to the runtime", async () => {
  for (const state of ["Unknown command: get-started-user-state", "", "STOPPING"]) {
    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "0", stderr: "" });
    runner.queueResult({ code: 0, stdout: state, stderr: "" });
    assert.equal(await probeUserUnlockState(getDefaultRuntimeConfig({ runner })), undefined);
    assert.equal(runner.calls.length, 2);
  }
});

it("does not report a missing notification shell service as a granted permission", async () => {
  for (const output of ["cmd: Can't find service: notification", "notification: not found", "Unknown command: allow_listener", "No shell command implementation."]) {
    const runner = new FakeProcessRunner();
    for (const stdout of ["null", output, "36"]) runner.queueResult({ code: 0, stdout, stderr: "" });
    const result = await grantNotificationListenerPermission(getDefaultRuntimeConfig({ runner }), "com.test.operator");
    assert.equal(result.ok, false, output);
    assert.equal(runner.calls.some(call => call.args.includes("put")), false);
  }
});
it("uses the legacy grant on Android versions before the notification shell implementation", async () => {
  for (const [api, output] of [[21, "Unknown command: allow_listener"], [24, "No shell command implementation."], [25, "No shell command implementation."], [26, "No shell command implementation."]]) {
    const runner = new FakeProcessRunner();
    for (const stdout of ["null", String(output), String(api), ""]) runner.queueResult({ code: 0, stdout, stderr: "" });
    assert.deepEqual(await grantNotificationListenerPermission(getDefaultRuntimeConfig({ runner }), "com.test.operator"), { ok: true, alreadyEnabled: false });
    assert.deepEqual(runner.calls.at(-1)?.args.slice(0, 5), ["shell", "settings", "put", "secure", "enabled_notification_listeners"]);
  }
});


it("validates all N2 mutations strictly and preserves their canonical payloads", () => {
  for (const [type, params] of [
    ["dismiss_notification", { notificationKey: "key", waitTimeoutMs: 100 }],
    ["invoke_notification_action", { notificationKey: "key", actionId: "revision:0" }],
    ["media_seek", { mediaSessionId: "s", positionMs: 0, positionToleranceMs: 0, waitTimeoutMs: 30000 }],
    ["media_seek", { applicationId: "p", positionMs: Number.MAX_SAFE_INTEGER }],
  ] as const) {
    assert.deepEqual(buildNotificationMediaExecution(type, params).actions[0].params, params);
  }
  for (const positionMs of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.throws(() => buildNotificationMediaExecution("media_seek", { mediaSessionId: "s", positionMs } as never));
  }
  for (const [type, params] of [
    ["dismiss_notification", {}], ["dismiss_notification", { notificationKey: " " }],
    ["dismiss_notification", { notificationKey: "k", applicationId: "p" }],
    ["invoke_notification_action", { notificationKey: "k", actionId: "a", waitTimeoutMs: 1 }],
    ["invoke_notification_action", { notificationKey: "k", actionId: "" }],
    ["media_seek", { positionMs: 1 }], ["media_seek", { mediaSessionId: "s", applicationId: "p", positionMs: 1 }],
    ["media_seek", { mediaSessionId: "s", positionMs: 1, positionToleranceMs: -1 }],
  ] as const) assert.throws(() => buildNotificationMediaExecution(type, params));
});

it("valid N2 CLI values reach device selection with either global flag placement", () => {
  const cli = fileURLToPath(new URL("../../cli/index.js", import.meta.url));
  for (const args of [
    ["media", "observe", "--session", "s", "--duration-ms", "30000"],
    ["notifications", "dismiss", "key", "--wait-timeout-ms", "0"],
    ["notifications", "action", "key", "--action", "revision:0"],
    ["media", "seek", "--session", "s", "--position-ms", "1000", "--position-tolerance-ms", "50"],
  ]) for (const first of [true, false]) {
    const global = ["--device", "non-existent-test-device", "--output", "json", "--no-daemon"];
    const result = spawnSync(process.execPath, [cli, ...(first ? [...global, ...args] : [...args, ...global])], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(JSON.parse(result.stdout).code, /DEVICE/);
  }
});

it("never replays N2 mutations when the transport loses their receipt", async () => {
  for (const [type, params] of [
    ["media_seek", { mediaSessionId: "s", positionMs: 1000 }],
    ["dismiss_notification", { notificationKey: "k" }],
    ["invoke_notification_action", { notificationKey: "k", actionId: "a" }],
  ] as const) {
    const runner = new FakeProcessRunner();
    runner.spawn = (() => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} })) as FakeProcessRunner["spawn"];
    for (const stdout of ["List of devices attached\ntest-device\tdevice\n", "package:com.test.operator\n", "0", "Broadcast completed: result=0"]) {
      runner.queueResult({ code: 0, stdout, stderr: "" });
    }
    const result = await runExecution(buildNotificationMediaExecution(type, params), {
      deviceId: "test-device", operatorPackage: "com.test.operator", runner, logcatBroadcastDelayMs: 0, resultEnvelopeTimeoutMs: 30,
      ensureInteractiveAutomationReadyFn: async () => ({ ok: true } as never),
    });
    assert.equal(result.ok, false);
    assert.equal(runner.calls.filter(call => call.args.some(arg => arg.includes("am broadcast"))).length, 1);
  }
});

it("allows only complete read/media-control executions on the background service path", () => {
  const eligible = ["list_notifications", "list_media_sessions", "get_media_status", "observe_media", "media_pause", "media_play", "media_seek"].map(type => ({ id: type, type }));
  for (const action of eligible) assert.equal(isBackgroundServiceExecution([action]), true);
  assert.equal(isBackgroundServiceExecution(eligible), true);
  assert.equal(isBackgroundServiceExecution([]), false);
  for (const type of ["dismiss_notification", "invoke_notification_action", "snapshot", "doctor_ping", "unknown", "MEDIA_PLAY"]) {
    const action = { id: "other", type };
    for (const actions of [[action], [action, ...eligible], [...eligible, action]]) assert.equal(isBackgroundServiceExecution(actions), false);
  }
});

it("bounds observation and preserves explicit execution timeouts", () => {
  for (const durationMs of [1, 30000]) {
    const execution = buildNotificationMediaExecution("observe_media", { applicationId: "p", durationMs });
    assert.equal(execution.timeoutMs, durationMs + 10000);
    assert.equal(isBackgroundObservation(execution.actions), true);
  }
  assert.equal(buildNotificationMediaExecution("observe_media", { mediaSessionId: "s", durationMs: 30000 }, 1000).timeoutMs, 1000);
  for (const params of [{ mediaSessionId: "s" }, { durationMs: 1 }, { applicationId: " ", durationMs: 1 },
    { applicationId: "p", mediaSessionId: "s", durationMs: 1 }, { mediaSessionId: "s", durationMs: 1, waitTimeoutMs: 0 },
    ...[null, "1", NaN, Infinity, 0, -1, 1.5, 30001].map(durationMs => ({ mediaSessionId: "s", durationMs }))]) {
    assert.throws(() => buildNotificationMediaExecution("observe_media", params as never));
  }
});

import { decodeNotificationMediaPayload } from "../../domain/notifications/service.js";
it("decodes observation evidence without dropping samples and still accepts older status", () => {
  const session = { mediaSessionId: "s", applicationId: "p", state: "playing", title: null, artist: null,
    durationMs: null, reportedPositionMs: null, estimatedPositionMs: 10, positionUpdatedElapsedMs: null,
    positionUpdateAgeMs: null, positionUnknownReason: "original_player_report_unavailable", observedElapsedMs: 10,
    playbackSpeed: 1, clock: "android_elapsed_realtime", evidence: "platform_query", supportedControls: [], textTruncated: false };
  const base = { schemaVersion: 1, observedElapsedMs: 20, deviceState: { screenOn: false, deviceLocked: true, userUnlocked: true } };
  assert.deepEqual(decodeNotificationMediaPayload(JSON.stringify({ ...base, session })), { ...base, session });
  const updated = { ...session, playerReportSequence: 1, playerReportReceivedElapsedMs: 15, bufferedPositionMs: 100, playbackType: "remote" };
  const observation = { ...base, initialSession: session, session: updated, durationMs: 10, startedElapsedMs: 10,
    endedElapsedMs: 20, newPlayerReportCount: 1, truncated: false, reportedPositionDeltaMs: null,
    samples: [{ playerReportSequence: 1, playerReportReceivedElapsedMs: 15, state: "playing", reportedPositionMs: 10,
      positionUpdatedElapsedMs: 14, playbackSpeed: 1 }] };
  assert.deepEqual(decodeNotificationMediaPayload(JSON.stringify(observation)), observation);
  assert.throws(() => decodeNotificationMediaPayload(JSON.stringify({ ...observation, samples: [{}] })));
});
