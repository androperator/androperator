import assert from "node:assert";
import { describe, it } from "node:test";
import { getDefaultRuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import {
  ensureDeviceAwake,
  ensureInteractiveAutomationReadyCached,
  buildReadinessCacheKey,
  clearReadinessCacheForTesting,
  ensureInteractiveAutomationReady,
  invalidateReadinessCache,
  invalidateReadinessCacheForErrorCode,
  isInteractiveAutomationReady,
  parseDoctorPingInteractiveState,
  probeInteractiveState,
  type InternalInteractiveState,
  type InteractiveStateProbeResult,
} from "../../../domain/doctor/checks/deviceInteractivity.js";
import { FakeProcessRunner } from "../fakes/FakeProcessRunner.js";

describe("parseDoctorPingInteractiveState", () => {
  it("parses strict booleans from the doctor ping step payload", () => {
    const state = parseDoctorPingInteractiveState({
      id: "h1",
      actionType: "doctor_ping",
      success: true,
      data: {
        screen_on: "false",
        device_locked: "true",
        user_unlocked: "false",
      },
    });

    assert.deepStrictEqual(state, {
      screenOn: false,
      deviceLocked: true,
      userUnlocked: false,
    });
  });

  it("throws when a required boolean is missing or malformed", () => {
    assert.throws(
      () =>
        parseDoctorPingInteractiveState({
          id: "h1",
          actionType: "doctor_ping",
          success: true,
          data: {
            screen_on: "maybe",
            device_locked: "true",
            user_unlocked: "false",
          },
        }),
      /invalid boolean for screen_on/
    );
  });
});

describe("readiness cache", () => {
  const readyState: InternalInteractiveState = {
    screenOn: true,
    deviceLocked: false,
    userUnlocked: true,
  };

  function makeConfig(deviceId = "test-device", operatorPackage = "com.test.operator") {
    return getDefaultRuntimeConfig({
      runner: new FakeProcessRunner(),
      deviceId,
      operatorPackage,
    });
  }

  it("builds cache keys from resolved device id and operator package", () => {
    assert.strictEqual(
      buildReadinessCacheKey("192.168.1.1:5555", "com.test.operator"),
      "192.168.1.1:5555:com.test.operator",
    );
  });

  it("uses the cache on a second call within the TTL", async () => {
    clearReadinessCacheForTesting();
    let calls = 0;
    const config = makeConfig();

    await ensureInteractiveAutomationReadyCached(config, {
      ensureDeviceAwakeFn: async () => {
        calls += 1;
        return { status: "already_awake", attempts: [], state: readyState };
      },
    });
    await ensureInteractiveAutomationReadyCached(config, {
      ensureDeviceAwakeFn: async () => {
        calls += 1;
        return { status: "already_awake", attempts: [], state: readyState };
      },
    });

    assert.strictEqual(calls, 1);
  });

  it("misses the cache on the first call", async () => {
    clearReadinessCacheForTesting();
    let calls = 0;
    const result = await ensureInteractiveAutomationReadyCached(makeConfig(), {
      ensureDeviceAwakeFn: async () => {
        calls += 1;
        return { status: "already_awake", attempts: [], state: readyState };
      },
    });

    assert.strictEqual(calls, 1);
    assert.strictEqual(result.ok, true);
  });

  it("expires cache entries after the TTL", async () => {
    clearReadinessCacheForTesting();
    let calls = 0;
    const config = makeConfig();
    const options = {
      ensureDeviceAwakeFn: async () => {
        calls += 1;
        return { status: "already_awake" as const, attempts: [], state: readyState };
      },
    };

    await ensureInteractiveAutomationReadyCached(config, options);
    await new Promise((resolve) => setTimeout(resolve, 8050));
    await ensureInteractiveAutomationReadyCached(config, options);

    assert.strictEqual(calls, 2);
  });

  it("invalidates one specific key", async () => {
    clearReadinessCacheForTesting();
    let firstCalls = 0;
    let secondCalls = 0;
    await ensureInteractiveAutomationReadyCached(makeConfig("one"), {
      ensureDeviceAwakeFn: async () => {
        firstCalls += 1;
        return { status: "already_awake", attempts: [], state: readyState };
      },
    });
    await ensureInteractiveAutomationReadyCached(makeConfig("two"), {
      ensureDeviceAwakeFn: async () => {
        secondCalls += 1;
        return { status: "already_awake", attempts: [], state: readyState };
      },
    });

    invalidateReadinessCache("one", "com.test.operator");
    await ensureInteractiveAutomationReadyCached(makeConfig("one"), {
      ensureDeviceAwakeFn: async () => {
        firstCalls += 1;
        return { status: "already_awake", attempts: [], state: readyState };
      },
    });
    await ensureInteractiveAutomationReadyCached(makeConfig("two"), {
      ensureDeviceAwakeFn: async () => {
        secondCalls += 1;
        return { status: "already_awake", attempts: [], state: readyState };
      },
    });

    assert.strictEqual(firstCalls, 2);
    assert.strictEqual(secondCalls, 1);
  });

  it("invalidates only locked error codes including SERVICE_UNAVAILABLE", async () => {
    for (const code of [
      ERROR_CODES.DEVICE_NOT_INTERACTIVE,
      ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING,
      ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
      ERROR_CODES.BROADCAST_FAILED,
      ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
      "SERVICE_UNAVAILABLE",
    ]) {
      clearReadinessCacheForTesting();
      let calls = 0;
      const config = makeConfig();
      const options = {
        ensureDeviceAwakeFn: async () => {
          calls += 1;
          return { status: "already_awake" as const, attempts: [], state: readyState };
        },
      };
      await ensureInteractiveAutomationReadyCached(config, options);
      invalidateReadinessCacheForErrorCode("test-device", "com.test.operator", code);
      await ensureInteractiveAutomationReadyCached(config, options);
      assert.strictEqual(calls, 2, code);
    }

    clearReadinessCacheForTesting();
    let calls = 0;
    const config = makeConfig();
    const options = {
      ensureDeviceAwakeFn: async () => {
        calls += 1;
        return { status: "already_awake" as const, attempts: [], state: readyState };
      },
    };
    await ensureInteractiveAutomationReadyCached(config, options);
    invalidateReadinessCacheForErrorCode("test-device", "com.test.operator", "NOT_INVALIDATING");
    await ensureInteractiveAutomationReadyCached(config, options);
    assert.strictEqual(calls, 1);
  });

  it("clearReadinessCacheForTesting clears all entries", async () => {
    clearReadinessCacheForTesting();
    let calls = 0;
    const config = makeConfig();
    const options = {
      ensureDeviceAwakeFn: async () => {
        calls += 1;
        return { status: "already_awake" as const, attempts: [], state: readyState };
      },
    };
    await ensureInteractiveAutomationReadyCached(config, options);
    clearReadinessCacheForTesting();
    await ensureInteractiveAutomationReadyCached(config, options);

    assert.strictEqual(calls, 2);
  });
});

describe("probeInteractiveState", () => {
  function createConfig(runner = new FakeProcessRunner()) {
    return {
      config: getDefaultRuntimeConfig({
        runner,
        deviceId: "test-device",
        operatorPackage: "com.test.operator",
      }),
      runner,
    };
  }

  it("returns the parsed internal interactive state when doctor ping succeeds", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const mockWait = async () => ({
      ok: true as const,
      envelope: {
        status: "success" as const,
        commandId: "test-cmd",
        taskId: "test-task",
        stepResults: [
          {
            id: "h1",
            actionType: "doctor_ping",
            success: true,
            data: {
              screen_on: "false",
              device_locked: "true",
              user_unlocked: "false",
            },
          },
        ],
      },
      terminalSource: "androperator_result" as const,
    });

    const result = await probeInteractiveState(config, mockWait as any);
    assert.ok(result.ok);
    assert.match(String(result.probeEvidence?.probeCommandId), /^doctor-handshake-/);
    assert.deepStrictEqual(result, {
      probeEvidence: result.probeEvidence,
      ok: true,
      state: {
        screenOn: false,
        deviceLocked: true,
        userUnlocked: false,
      },
    });
  });

  it("fails closed when a required doctor ping boolean is missing", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const mockWait = async () => ({
      ok: true as const,
      envelope: {
        status: "success" as const,
        commandId: "test-cmd",
        taskId: "test-task",
        stepResults: [
          {
            id: "h1",
            actionType: "doctor_ping",
            success: true,
            data: {
              device_locked: "true",
              user_unlocked: "false",
            },
          },
        ],
      },
      terminalSource: "androperator_result" as const,
    });

    const result = await probeInteractiveState(config, mockWait as any);
    assert.deepStrictEqual(result, {
      details: !result.ok ? result.details : undefined,
      ok: false,
      code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
      message: "doctor_ping returned an invalid boolean for screen_on: missing",
    });
  });

  it("fails closed when doctor ping returns an unsuccessful step result", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const mockWait = async () => ({
      ok: true as const,
      envelope: {
        status: "success" as const,
        commandId: "test-cmd",
        taskId: "test-task",
        stepResults: [
          {
            id: "h1",
            actionType: "doctor_ping",
            success: false,
            data: {
              screen_on: "true",
              device_locked: "false",
              user_unlocked: "true",
            },
          },
        ],
      },
      terminalSource: "androperator_result" as const,
    });

    const result = await probeInteractiveState(config, mockWait as any);
    assert.deepStrictEqual(result, {
      details: !result.ok ? result.details : undefined,
      ok: false,
      code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
      message: "doctor_ping step result was unsuccessful.",
    });
  });
});

describe("ensureDeviceAwake", () => {
  function createConfig(runner = new FakeProcessRunner()) {
    return {
      config: getDefaultRuntimeConfig({
        runner,
        deviceId: "test-device",
        operatorPackage: "com.test.operator",
      }),
      runner,
    };
  }

  function state(overrides?: Partial<InternalInteractiveState>): InternalInteractiveState {
    return {
      screenOn: false,
      deviceLocked: false,
      userUnlocked: true,
      ...overrides,
    };
  }

  function probeSequence(sequence: InteractiveStateProbeResult[]) {
    let index = 0;
    return async () => {
      const next = sequence[index];
      index += 1;
      if (!next) {
        throw new Error("Unexpected probe invocation");
      }
      return next;
    };
  }

  it("skips adb wake commands when the device is already interactive", async () => {
    const { config, runner } = createConfig();

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([{ ok: true, state: state({ screenOn: true }) }]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "already_awake");
    assert.deepStrictEqual(result.state, state({ screenOn: true }));
    assert.deepStrictEqual(runner.calls, []);
  });

  it("reports awake but locked when the initial probe is already interactive", async () => {
    const { config, runner } = createConfig();

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state({ screenOn: true, deviceLocked: true, userUnlocked: false }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "awake_but_locked");
    assert.deepStrictEqual(result.state, state({ screenOn: true, deviceLocked: true, userUnlocked: false }));
    assert.deepStrictEqual(runner.calls, []);
  });

  it("treats post-boot locked state as awake but not ready", async () => {
    const { config, runner } = createConfig();

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state({ screenOn: true, deviceLocked: false, userUnlocked: false }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "awake_but_locked");
    assert.deepStrictEqual(result.state, state({ screenOn: true, deviceLocked: false, userUnlocked: false }));
    assert.deepStrictEqual(runner.calls, []);
  });

  it("uses the host wake retry order until the device becomes interactive", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        { ok: true, state: state() },
        { ok: true, state: state() },
        { ok: true, state: state({ screenOn: true }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "awake");
    assert.deepStrictEqual(
      runner.calls.map(call => call.args),
      [
        ["-s", "test-device", "shell", "cmd", "power", "wakeup"],
        ["-s", "test-device", "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
        ["-s", "test-device", "shell", "input", "keyevent", "KEYCODE_HOME"],
      ]
    );
  });

  it("stops after the first successful wake postcondition", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        { ok: true, state: state({ screenOn: true }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "awake");
    assert.strictEqual(runner.calls.length, 1);
    assert.deepStrictEqual(runner.calls[0]?.args, ["-s", "test-device", "shell", "cmd", "power", "wakeup"]);
  });

  it("reports awake but locked without attempting unlock behavior", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        { ok: true, state: state({ screenOn: true, deviceLocked: true, userUnlocked: false }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "awake_but_locked");
    assert.deepStrictEqual(result.state, state({ screenOn: true, deviceLocked: true, userUnlocked: false }));
  });

  it("fails closed when probe data is unavailable", async () => {
    const { config, runner } = createConfig();

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        {
          ok: false,
          code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
          message: "doctor_ping returned an invalid boolean for screen_on: missing",
        },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "probe_failed");
    assert.deepStrictEqual(result.error, {
      code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
      message: "doctor_ping returned an invalid boolean for screen_on: missing",
    });
    assert.deepStrictEqual(runner.calls, []);
  });

  it("returns still_asleep after exhausting all wake attempts", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        { ok: true, state: state() },
        { ok: true, state: state() },
        { ok: true, state: state({ deviceLocked: true, userUnlocked: false }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "still_asleep");
    assert.deepStrictEqual(result.state, state({ deviceLocked: true, userUnlocked: false }));
    assert.deepStrictEqual(
      runner.calls.map(call => call.args),
      [
        ["-s", "test-device", "shell", "cmd", "power", "wakeup"],
        ["-s", "test-device", "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
        ["-s", "test-device", "shell", "input", "keyevent", "KEYCODE_HOME"],
      ]
    );
  });

  it("returns transport_failed when an adb wake command fails and the device stays asleep", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 1, stdout: "", stderr: "device offline" });
    runner.queueResult({ code: 1, stdout: "", stderr: "device offline" });
    runner.queueResult({ code: 1, stdout: "", stderr: "device offline" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        { ok: true, state: state({ deviceLocked: true, userUnlocked: false }) },
        { ok: true, state: state({ deviceLocked: true, userUnlocked: false }) },
        { ok: true, state: state({ deviceLocked: true, userUnlocked: false }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "transport_failed");
    assert.deepStrictEqual(result.state, state({ deviceLocked: true, userUnlocked: false }));
    assert.deepStrictEqual(result.error, {
      code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
      message: "Wake attempt keycode_home failed before the device screen turned on: device offline",
    });
    assert.strictEqual(runner.calls.length, 3);
    assert.deepStrictEqual(
      runner.calls.map(call => call.args),
      [
        ["-s", "test-device", "shell", "cmd", "power", "wakeup"],
        ["-s", "test-device", "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
        ["-s", "test-device", "shell", "input", "keyevent", "KEYCODE_HOME"],
      ]
    );
  });

  it("continues to later wake methods when an earlier adb wake command fails", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 1, stdout: "", stderr: "cmd power unsupported" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        { ok: true, state: state() },
        { ok: true, state: state({ screenOn: true }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "awake");
    assert.deepStrictEqual(result.state, state({ screenOn: true }));
    assert.deepStrictEqual(
      runner.calls.map(call => call.args),
      [
        ["-s", "test-device", "shell", "cmd", "power", "wakeup"],
        ["-s", "test-device", "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
      ]
    );
  });

  it("returns still_asleep after a later wake transport succeeds but the device never wakes", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 1, stdout: "", stderr: "cmd power unsupported" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        { ok: true, state: state() },
        { ok: true, state: state() },
        { ok: true, state: state({ deviceLocked: true, userUnlocked: false }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "still_asleep");
    assert.deepStrictEqual(result.state, state({ deviceLocked: true, userUnlocked: false }));
  });

  it("still returns awake when adb reports failure but the postcondition is interactive", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 1, stdout: "", stderr: "transient shell failure" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        { ok: true, state: state({ screenOn: true }) },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "awake");
    assert.deepStrictEqual(result.state, state({ screenOn: true }));
    assert.strictEqual(runner.calls.length, 1);
    assert.deepStrictEqual(runner.calls[0]?.args, ["-s", "test-device", "shell", "cmd", "power", "wakeup"]);
  });

  it("returns probe_failed when a post-attempt probe fails", async () => {
    const { config, runner } = createConfig();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await ensureDeviceAwake(config, {
      probeInteractiveStateFn: probeSequence([
        { ok: true, state: state() },
        {
          ok: false,
          code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
          message: "doctor_ping step result was unsuccessful.",
        },
      ]),
      settleDelayMs: 0,
    });

    assert.strictEqual(result.status, "probe_failed");
    assert.deepStrictEqual(result.error, {
      code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
      message: "doctor_ping step result was unsuccessful.",
    });
    assert.strictEqual(runner.calls.length, 1);
    assert.deepStrictEqual(runner.calls[0]?.args, ["-s", "test-device", "shell", "cmd", "power", "wakeup"]);
  });
});

describe("isInteractiveAutomationReady", () => {
  it("requires screen-on, unlocked, and user-unlocked state", () => {
    assert.strictEqual(isInteractiveAutomationReady({ screenOn: true, deviceLocked: false, userUnlocked: true }), true);
    assert.strictEqual(isInteractiveAutomationReady({ screenOn: false, deviceLocked: false, userUnlocked: true }), false);
    assert.strictEqual(isInteractiveAutomationReady({ screenOn: true, deviceLocked: true, userUnlocked: true }), false);
    assert.strictEqual(isInteractiveAutomationReady({ screenOn: true, deviceLocked: false, userUnlocked: false }), false);
  });
});

describe("ensureInteractiveAutomationReady", () => {
  const readyState: InternalInteractiveState = {
    screenOn: true,
    deviceLocked: false,
    userUnlocked: true,
  };

  it("returns success when the shared wake helper makes the device ready", async () => {
    const config = getDefaultRuntimeConfig({
      runner: new FakeProcessRunner(),
      deviceId: "test-device",
      operatorPackage: "com.test.operator",
    });

    const result = await ensureInteractiveAutomationReady(config, {
      ensureDeviceAwakeFn: async () => ({
        status: "awake",
        attempts: [],
        state: readyState,
      }),
    });

    assert.deepStrictEqual(result, {
      ok: true,
      state: readyState,
    });
  });

  it("returns DEVICE_NOT_INTERACTIVE when the device remains asleep after wake attempts", async () => {
    const config = getDefaultRuntimeConfig({
      runner: new FakeProcessRunner(),
      deviceId: "test-device",
      operatorPackage: "com.test.operator",
    });

    const result = await ensureInteractiveAutomationReady(config, {
      ensureDeviceAwakeFn: async () => ({
        status: "still_asleep",
        attempts: [],
        state: {
          screenOn: false,
          deviceLocked: false,
          userUnlocked: true,
        },
      }),
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
        message: "Device is not interactive. Interactive automation requires an awake, usable device state. screenOn=false deviceLocked=false userUnlocked=true",
        details: {
          phase: "readiness",
          dispatchState: "not_dispatched",
          wakeAttempts: [],
          screenOn: false,
          deviceLocked: false,
          userUnlocked: true,
        },
      },
    });
  });

  it("passes through bounded wake failures", async () => {
    const config = getDefaultRuntimeConfig({
      runner: new FakeProcessRunner(),
      deviceId: "test-device",
      operatorPackage: "com.test.operator",
    });

    const result = await ensureInteractiveAutomationReady(config, {
      ensureDeviceAwakeFn: async () => ({
        status: "transport_failed",
        attempts: [],
        state: {
          screenOn: false,
          deviceLocked: false,
          userUnlocked: true,
        },
        error: {
          code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
          message: "Wake attempt cmd_power_wakeup failed before the device screen turned on: transport error",
        },
      }),
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
        message: "Wake attempt cmd_power_wakeup failed before the device screen turned on: transport error",
        details: {
          phase: "readiness",
          dispatchState: "not_dispatched",
          wakeAttempts: [],
          screenOn: false,
          deviceLocked: false,
          userUnlocked: true,
        },
      },
    });
  });

  it("treats inconsistent awake-success states as DEVICE_NOT_INTERACTIVE", async () => {
    const config = getDefaultRuntimeConfig({
      runner: new FakeProcessRunner(),
      deviceId: "test-device",
      operatorPackage: "com.test.operator",
    });

    const result = await ensureInteractiveAutomationReady(config, {
      ensureDeviceAwakeFn: async () => ({
        status: "already_awake",
        attempts: [],
        state: {
          screenOn: true,
          deviceLocked: true,
          userUnlocked: true,
        },
      }),
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
        message: "Device is not interactive. Interactive automation requires an awake, usable device state. screenOn=true deviceLocked=true userUnlocked=true",
        details: {
          phase: "readiness",
          dispatchState: "not_dispatched",
          wakeAttempts: [],
          screenOn: true,
          deviceLocked: true,
          userUnlocked: true,
        },
      },
    });
  });
});
