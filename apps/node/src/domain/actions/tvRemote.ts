import { randomUUID } from "node:crypto";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { Execution, ExecutionAction } from "../../contracts/execution.js";
import { ERROR_CODES, isAndroperatorError } from "../../contracts/errors.js";
import { isTvRemoteKey } from "../../contracts/keys.js";
import type { ResultEnvelope } from "../../contracts/result.js";
import type { RunExecutionResult } from "../executions/runExecution.js";

const KEY_EVENTS: Record<string, string> = {
  dpad_up: "KEYCODE_DPAD_UP",
  dpad_down: "KEYCODE_DPAD_DOWN",
  dpad_left: "KEYCODE_DPAD_LEFT",
  dpad_right: "KEYCODE_DPAD_RIGHT",
  dpad_center: "KEYCODE_DPAD_CENTER",
  bookmark: "KEYCODE_BOOKMARK",
  // The emulator's person icon opens its dashboard, not PROFILE_SWITCH.
  profile: "KEYCODE_NOTIFICATION",
};

export function isTvRemoteAction(action: ExecutionAction): boolean {
  return action.type === "press_key" && isTvRemoteKey(action.params?.key);
}

/** Execute bridge-only buttons in order with runtime segments, under the caller's device lock. */
export async function runTvRemoteSequence(
  execution: Execution,
  config: RuntimeConfig,
  runRuntime: (segment: Execution, signal: AbortSignal) => Promise<RunExecutionResult>,
  signal?: AbortSignal,
): Promise<RunExecutionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort({
    code: ERROR_CODES.COMMAND_TIMEOUT,
    message: "TV remote execution timed out",
  }), execution.timeoutMs);
  const sequenceSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
  const deadline = Date.now() + execution.timeoutMs;
  const envelope: ResultEnvelope = {
    commandId: execution.commandId, taskId: execution.taskId,
    status: "success", stepResults: [], error: null,
  };
  const resultWithEnvelope = (): RunExecutionResult => ({ ok: true, envelope, deviceId: config.deviceId!, terminalSource: "androperator_result" });
  const canceled = (): RunExecutionResult => ({ ok: false, deviceId: config.deviceId, error: {
    code: signal?.aborted
      ? (isAndroperatorError(signal.reason) ? signal.reason.code : ERROR_CODES.RESULT_TRANSPORT_CANCELLED)
      : ERROR_CODES.COMMAND_TIMEOUT,
    message: "TV remote execution canceled or timed out",
    details: { stepResults: envelope.stepResults },
  } });
  try {
    for (let index = 0; index < execution.actions.length;) {
      if (sequenceSignal.aborted) return canceled();
      const action = execution.actions[index];
      if (!isTvRemoteAction(action)) {
        const segmentStart = index;
        index += 1;
        while (index < execution.actions.length && !isTvRemoteAction(execution.actions[index])) {
          index += 1;
        }
        const result = await runRuntime({
          ...execution,
          // Distinct transport IDs prevent a preceding segment's logcat result from being reused.
          commandId: `tv_segment_${randomUUID()}`,
          actions: execution.actions.slice(segmentStart, index),
        }, sequenceSignal);
        if (!result.ok) return { ...result, error: { ...result.error, details: { ...result.error.details as object, precedingStepResults: envelope.stepResults } } };
        envelope.stepResults.push(...result.envelope.stepResults);
        if (result.envelope.status === "failed") {
          envelope.status = "failed";
          envelope.error = result.envelope.error;
          envelope.errorCode = result.envelope.errorCode;
          return resultWithEnvelope();
        }
        continue;
      }
      index++;
      const key = action.params!.key!.trim().toLowerCase();
      const keyCode = KEY_EVENTS[key];
      let activity: string | undefined;
      if (key === "settings") activity = "com.android.tv.settings/com.android.tv.settings.MainSettings";
      if (key === "tv") {
        const version = await runAdb(config, ["shell", "getprop", "ro.build.version.sdk"], { timeoutMs: Math.max(1, deadline - Date.now()) });
        if (sequenceSignal.aborted) return canceled();
        if (version.code !== 0 || !/^\d+$/.test(version.stdout.trim())) {
          return { ok: false, deviceId: config.deviceId, error: { code: "DEVICE_SHELL_UNAVAILABLE", message: "Cannot resolve Android API level for Live Channels", details: { stepResults: envelope.stepResults } } };
        }
        activity = Number(version.stdout.trim()) < 34
          ? "com.google.android.tv/com.android.tv.MainActivity"
          : "com.android.tv/com.android.tv.MainActivity";
      }
      const args = keyCode !== undefined
        ? ["shell", "input", "keyevent", keyCode]
        : ["shell", "am", "start", "-W", "-n", activity!];
      const result = await runAdb(config, args, { timeoutMs: Math.max(1, deadline - Date.now()) });
      if (sequenceSignal.aborted) return canceled();
      // am can print an unresolved activity error while exiting with code zero.
      const accepted = result.code === 0 && !/Error:|Error type|Exception|Status:\s*(?!ok\b)\S+/i.test(result.stdout + result.stderr);
      const error = keyCode !== undefined ? "TV_REMOTE_KEY_FAILED" : "TV_REMOTE_ACTIVITY_FAILED";
      envelope.stepResults.push({ id: action.id, actionType: "press_key", success: accepted, data: {
        key, dispatchSource: "host",
        ...(keyCode !== undefined ? { keyCode } : { activity }),
        ...(accepted ? {} : { error, message: (result.stderr || result.stdout).trim(), adbExitCode: String(result.code) }),
      } });
      if (!accepted) {
        envelope.status = "failed";
        envelope.error = error;
        return resultWithEnvelope();
      }
    }
    return resultWithEnvelope();
  } catch (error) {
    return { ok: false, deviceId: config.deviceId, error: {
      ...(isAndroperatorError(error) ? { ...error } : {
        code: ERROR_CODES.RESULT_TRANSPORT_FAILED,
        message: error instanceof Error ? error.message : String(error),
      }),
      details: { stepResults: envelope.stepResults },
    } };
  } finally {
    clearTimeout(timer);
  }
}
