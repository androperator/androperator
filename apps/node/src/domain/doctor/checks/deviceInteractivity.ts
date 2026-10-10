import { randomUUID } from "node:crypto";
import { runAdb, type AdbResult } from "../../../adapters/android-bridge/adbClient.js";
import { broadcastAgentCommand } from "../../../adapters/android-bridge/broadcastAgentCommand.js";
import { waitForResultEnvelope, type LogcatResult } from "../../../adapters/android-bridge/logcatResultReader.js";
import { type RuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { ERROR_CODES, type ErrorCode, type DispatchState, isAndroperatorError } from "../../../contracts/errors.js";
import { type StepResult } from "../../../contracts/result.js";

export type WaitForResultEnvelopeFn = typeof waitForResultEnvelope;

export interface InternalInteractiveState {
  screenOn: boolean;
  deviceLocked: boolean;
  userUnlocked: boolean;
}

export interface InteractiveStateEvidence extends Record<string, unknown> {
  deviceLocked: boolean;
  screenOn: boolean;
  userUnlocked: boolean;
}

export interface InteractiveStateProbeFailure {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface InteractiveAutomationReadyError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type InteractiveStateProbeResult =
  | { ok: true; state: InternalInteractiveState; probeEvidence?: Record<string, unknown> }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

export type InteractiveAutomationReadyResult =
  | { ok: true; state: InternalInteractiveState; probeEvidence?: Record<string, unknown> }
  | { ok: false; error: InteractiveAutomationReadyError };

export type WakeAttemptMethod =
  | "cmd_power_wakeup"
  | "keycode_wakeup"
  | "keycode_home";

export interface WakeAttempt {
  method: WakeAttemptMethod;
  adbResult: AdbResult;
}

export interface EnsureDeviceAwakeResult {
  status:
    | "already_awake"
    | "awake"
    | "awake_but_locked"
    | "still_asleep"
    | "transport_failed"
    | "probe_failed";
  attempts: WakeAttempt[];
  state?: InternalInteractiveState;
  error?: InteractiveStateProbeFailure;
  probeEvidence?: Record<string, unknown>;
}

interface WakeCommand {
  method: WakeAttemptMethod;
  args: string[];
}

const DEFAULT_WAKE_SETTLE_DELAY_MS = 750;
const DOCTOR_PING_ACTION_ID = "h1";
const READINESS_CACHE_TTL_MS = 8000;
const readinessCache = new Map<string, number>();
const READINESS_CACHE_INVALIDATION_CODES = new Set<string>([
  ERROR_CODES.DEVICE_NOT_INTERACTIVE,
  ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING,
  ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
  ERROR_CODES.BROADCAST_FAILED,
  ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
  "SERVICE_UNAVAILABLE",
]);

const WAKE_COMMANDS: WakeCommand[] = [
  {
    method: "cmd_power_wakeup",
    args: ["shell", "cmd", "power", "wakeup"],
  },
  {
    method: "keycode_wakeup",
    args: ["shell", "input", "keyevent", "KEYCODE_WAKEUP"],
  },
  {
    method: "keycode_home",
    args: ["shell", "input", "keyevent", "KEYCODE_HOME"],
  },
];

export async function runDoctorPingCommand(
  config: RuntimeConfig,
  waitForEnvelope: WaitForResultEnvelopeFn = waitForResultEnvelope,
  signal?: AbortSignal
): Promise<LogcatResult & { probeEvidence: Record<string, unknown> }> {
  const commandId = `doctor-handshake-${Date.now()}-${randomUUID()}`;
  const payload = JSON.stringify({
    commandId,
    taskId: "doctor-handshake",
    source: "androperator-doctor",
    expectedFormat: "android-ui-automator",
    actions: [{ id: DOCTOR_PING_ACTION_ID, type: "doctor_ping" }],
    timeoutMs: 5000,
  });

  const startedAt = new Date().toISOString();
  let dispatchState: DispatchState = "not_dispatched";
  let result: LogcatResult;
  try {
    result = await waitForEnvelope(
      config,
      { commandId, taskId: "doctor-handshake", timeoutMs: 7000, cancelSignal: signal },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        dispatchState = "unknown";
        const broadcast = await broadcastAgentCommand(config, payload, signal);
        if (broadcast.success) dispatchState = "dispatched";
        return broadcast;
      }
    );
  } catch (error) {
    result = {
      ok: false,
      code: ERROR_CODES.RESULT_TRANSPORT_FAILED,
      error: error instanceof Error || isAndroperatorError(error) ? error.message : String(error),
      ...(isAndroperatorError(error) && error.details !== undefined ? { diagnostics: error.details } : {}),
    };
  }
  return {
    ...result,
    probeEvidence: {
      probeCommandId: commandId,
      probeTaskId: "doctor-handshake",
      probeDispatchState: result.ok ? "dispatched" : dispatchState,
      phase: "readiness",
      dispatchState: "not_dispatched",
      probeStartedAt: startedAt,
      probeCompletedAt: new Date().toISOString(),
      logPath: config.logger?.logPath(),
      ...("diagnostics" in result ? { transport: result.diagnostics } : {}),
    },
  };
}

export function parseDoctorPingInteractiveState(stepResult: StepResult): InternalInteractiveState {
  return {
    screenOn: parseStrictBoolean(stepResult, "screen_on"),
    deviceLocked: parseStrictBoolean(stepResult, "device_locked"),
    userUnlocked: parseStrictBoolean(stepResult, "user_unlocked"),
  };
}

export function isInteractiveAutomationReady(
  state: Pick<InternalInteractiveState, "screenOn" | "deviceLocked" | "userUnlocked">
): boolean {
  return state.screenOn && !state.deviceLocked && state.userUnlocked;
}

export async function probeInteractiveState(
  config: RuntimeConfig,
  waitForEnvelope: WaitForResultEnvelopeFn = waitForResultEnvelope,
  signal?: AbortSignal
): Promise<InteractiveStateProbeResult> {
  const result = await runDoctorPingCommand(config, waitForEnvelope, signal);

  if (!result.ok) {
    if (("timeout" in result && result.timeout) || ("broadcastFailed" in result && result.broadcastFailed)) {
      return {
        ok: false,
        details: result.probeEvidence,
        code: result.diagnostics.code,
        message: result.diagnostics.message,
      };
    }

    if ("error" in result) {
      return {
        ok: false,
        details: result.probeEvidence,
        code: (result.code as ErrorCode | undefined) ?? ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
        message: result.error,
      };
    }

    return {
      ok: false,
      details: result.probeEvidence,
      code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
      message: "doctor_ping failed before a usable result envelope was available.",
    };
  }

  if (result.envelope.status !== "success") {
    return {
      ok: false,
      details: result.probeEvidence,
      code: ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING,
      message: `Operator returned an error: ${result.envelope.error ?? "Unknown error"}`,
    };
  }

  const doctorPingStep = result.envelope.stepResults.find(step => step.actionType === "doctor_ping");
  if (!doctorPingStep) {
    return {
      ok: false,
      details: result.probeEvidence,
      code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
      message: "doctor_ping step result was missing from the result envelope.",
    };
  }

  if (!doctorPingStep.success) {
    return {
      ok: false,
      details: result.probeEvidence,
      code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
      message: "doctor_ping step result was unsuccessful.",
    };
  }

  try {
    return {
      ok: true,
      state: parseDoctorPingInteractiveState(doctorPingStep),
      probeEvidence: result.probeEvidence,
    };
  } catch (error) {
    return {
      ok: false,
      details: result.probeEvidence,
      code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureDeviceAwake(
  config: RuntimeConfig,
  options?: {
    probeInteractiveStateFn?: typeof probeInteractiveState;
    settleDelayMs?: number;
  }
): Promise<EnsureDeviceAwakeResult> {
  const probeInteractiveStateFn = options?.probeInteractiveStateFn ?? probeInteractiveState;
  const settleDelayMs = options?.settleDelayMs ?? DEFAULT_WAKE_SETTLE_DELAY_MS;

  const initialProbe = await probeInteractiveStateFn(config);
  if (!initialProbe.ok) {
    return {
      status: "probe_failed",
      attempts: [],
      error: {
        code: initialProbe.code,
        message: initialProbe.message,
        ...(initialProbe.details !== undefined ? { details: initialProbe.details } : {}),
      },
    };
  }

  let probeEvidence = initialProbe.probeEvidence;
  if (initialProbe.state.screenOn) {
    return {
      status: isInteractiveAutomationReady(initialProbe.state) ? "already_awake" : "awake_but_locked",
      attempts: [],
      state: initialProbe.state,
      ...(probeEvidence !== undefined ? { probeEvidence } : {}),
    };
  }

  const attempts: WakeAttempt[] = [];
  let lastObservedState = initialProbe.state;
  let lastTransportFailure: InteractiveStateProbeFailure | undefined;
  let observedSuccessfulWakeTransport = false;

  for (const command of WAKE_COMMANDS) {
    const adbResult = await runAdb(config, command.args);
    attempts.push({
      method: command.method,
      adbResult,
    });

    await sleep(settleDelayMs);

    const postAttemptProbe = await probeInteractiveStateFn(config);
    if (!postAttemptProbe.ok) {
      return {
        status: "probe_failed",
        attempts,
        error: {
          code: postAttemptProbe.code,
          message: postAttemptProbe.message,
          ...(postAttemptProbe.details !== undefined ? { details: postAttemptProbe.details } : {}),
        },
      };
    }

    probeEvidence = postAttemptProbe.probeEvidence;
    lastObservedState = postAttemptProbe.state;
    if (didWakeCommandFail(adbResult)) {
      if (postAttemptProbe.state.screenOn) {
        return {
          status: isInteractiveAutomationReady(postAttemptProbe.state) ? "awake" : "awake_but_locked",
          attempts,
          state: postAttemptProbe.state,
          ...(probeEvidence !== undefined ? { probeEvidence } : {}),
        };
      }

      lastTransportFailure = buildWakeTransportFailure(adbResult, command.method);
      continue;
    }

    observedSuccessfulWakeTransport = true;

    if (!postAttemptProbe.state.screenOn) {
      continue;
    }

    return {
      status: isInteractiveAutomationReady(postAttemptProbe.state) ? "awake" : "awake_but_locked",
      attempts,
      state: postAttemptProbe.state,
      ...(probeEvidence !== undefined ? { probeEvidence } : {}),
    };
  }

  if (lastTransportFailure && !observedSuccessfulWakeTransport) {
    return {
      status: "transport_failed",
      attempts,
      state: lastObservedState,
      ...(probeEvidence !== undefined ? { probeEvidence } : {}),
      error: lastTransportFailure,
    };
  }

  return {
    status: "still_asleep",
    attempts,
    state: lastObservedState,
    ...(probeEvidence !== undefined ? { probeEvidence } : {}),
  };
}

export async function ensureInteractiveAutomationReady(
  config: RuntimeConfig,
  options?: {
    ensureDeviceAwakeFn?: typeof ensureDeviceAwake;
    probeInteractiveStateFn?: typeof probeInteractiveState;
    settleDelayMs?: number;
  }
): Promise<InteractiveAutomationReadyResult> {
  const ensureDeviceAwakeFn = options?.ensureDeviceAwakeFn ?? ensureDeviceAwake;
  const wakeResult = await ensureDeviceAwakeFn(config, {
    probeInteractiveStateFn: options?.probeInteractiveStateFn,
    settleDelayMs: options?.settleDelayMs,
  });

  if ((wakeResult.status === "already_awake" || wakeResult.status === "awake") &&
      wakeResult.state && isInteractiveAutomationReady(wakeResult.state)) {
    return {
      ok: true,
      state: wakeResult.state,
      ...(wakeResult.probeEvidence !== undefined || wakeResult.attempts.length > 0 ? {
        probeEvidence: {
          ...wakeResult.probeEvidence,
          wakeAttempts: wakeResult.attempts.map(attempt => ({ method: attempt.method, exitCode: attempt.adbResult.code })),
        },
      } : {}),
    };
  }

  const error: InteractiveAutomationReadyError =
    wakeResult.status === "probe_failed" || wakeResult.status === "transport_failed"
      ? {
          code: wakeResult.error?.code ?? ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
          message: wakeResult.error?.message ?? "Could not prepare the device for interactive automation.",
        }
      : wakeResult.state
        ? buildDeviceNotInteractiveError(wakeResult.state)
        : {
            code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
            message: "Device is not interactive and no interactive-state evidence was available.",
          };
  return {
    ok: false,
    error: {
      ...error,
      details: {
        phase: "readiness",
        dispatchState: "not_dispatched",
        ...wakeResult.probeEvidence,
        ...wakeResult.error?.details,
        ...(wakeResult.state ? toInteractiveStateEvidence(wakeResult.state) : {}),
        wakeAttempts: wakeResult.attempts.map(attempt => ({ method: attempt.method, exitCode: attempt.adbResult.code })),
      },
    },
  };
}

export function buildReadinessCacheKey(resolvedDeviceId: string, operatorPackage: string): string {
  return `${resolvedDeviceId}:${operatorPackage}`;
}

export function invalidateReadinessCache(resolvedDeviceId: string, operatorPackage: string): void {
  readinessCache.delete(buildReadinessCacheKey(resolvedDeviceId, operatorPackage));
}

export function invalidateReadinessCacheForErrorCode(
  resolvedDeviceId: string,
  operatorPackage: string,
  code: string | undefined | null
): void {
  if (code !== undefined && code !== null && READINESS_CACHE_INVALIDATION_CODES.has(code)) {
    invalidateReadinessCache(resolvedDeviceId, operatorPackage);
  }
}

export function clearReadinessCacheForTesting(): void {
  readinessCache.clear();
}

export async function ensureInteractiveAutomationReadyCached(
  config: RuntimeConfig,
  options?: Parameters<typeof ensureInteractiveAutomationReady>[1]
): Promise<InteractiveAutomationReadyResult> {
  if (!config.deviceId) {
    return ensureInteractiveAutomationReady(config, options);
  }

  const key = buildReadinessCacheKey(config.deviceId, config.operatorPackage);
  const cachedAt = readinessCache.get(key);
  const now = Date.now();
  if (cachedAt !== undefined && now - cachedAt < READINESS_CACHE_TTL_MS) {
    return {
      ok: true,
      state: {
        screenOn: true,
        deviceLocked: false,
        userUnlocked: true,
      },
    };
  }

  const result = await ensureInteractiveAutomationReady(config, options);
  if (result.ok) {
    readinessCache.set(key, now);
  } else {
    invalidateReadinessCacheForErrorCode(config.deviceId, config.operatorPackage, result.error.code);
  }
  return result;
}

export function toInteractiveStateEvidence(
  state: Pick<InternalInteractiveState, "deviceLocked" | "screenOn" | "userUnlocked">
): InteractiveStateEvidence {
  return {
    deviceLocked: state.deviceLocked,
    screenOn: state.screenOn,
    userUnlocked: state.userUnlocked,
  };
}

export function buildDeviceNotInteractiveError(
  state: Pick<InternalInteractiveState, "deviceLocked" | "screenOn" | "userUnlocked">
): { code: ErrorCode; message: string; details: InteractiveStateEvidence } {
  return {
    code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
    message: `Device is not interactive. Interactive automation requires an awake, usable device state. screenOn=${state.screenOn} deviceLocked=${state.deviceLocked} userUnlocked=${state.userUnlocked}`,
    details: toInteractiveStateEvidence(state),
  };
}

export function toPublicInteractiveAutomationError<T extends { code: string; message: string; details?: Record<string, unknown> }>(
  error: T
): Omit<T, "details" | "message"> & { message: string; details?: Record<string, unknown> } {
  if (error.code === ERROR_CODES.DEVICE_NOT_INTERACTIVE) {
    const { details, message: _message, ...rest } = error;
    // Keep recovery evidence while preserving the public omission of internal state.
    const { screenOn: _screenOn, deviceLocked: _deviceLocked, userUnlocked: _userUnlocked, ...diagnostics } =
      typeof details === "object" && details !== null ? details as Record<string, unknown> : {};
    return {
      ...rest,
      ...(Object.keys(diagnostics).length > 0 ? { details: diagnostics } : {}),
      message: "Device is not interactive. Interactive automation requires an awake, usable device state.",
    };
  }

  return error;
}

function didWakeCommandFail(adbResult: AdbResult): boolean {
  return adbResult.code === null || adbResult.code !== 0;
}

function buildWakeTransportFailure(
  adbResult: AdbResult,
  method: WakeAttemptMethod
): InteractiveStateProbeFailure {
  const detail = adbResult.stderr.trim() || adbResult.stdout.trim() || "Unknown adb transport failure.";
  return {
    code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
    message: `Wake attempt ${method} failed before the device screen turned on: ${detail}`,
  };
}

function parseStrictBoolean(stepResult: StepResult, key: string): boolean {
  const value = stepResult.data[key];
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  throw new Error(
    `doctor_ping returned an invalid boolean for ${key}: ${value === undefined ? "missing" : JSON.stringify(value)}`
  );
}

async function sleep(durationMs: number): Promise<void> {
  if (durationMs <= 0) {
    return;
  }

  await new Promise(resolve => setTimeout(resolve, durationMs));
}
