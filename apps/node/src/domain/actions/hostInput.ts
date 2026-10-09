import { AndroidAutoClient, androidAutoSocketPath } from "../android-auto/broker.js";
import { ANDROID_AUTO_COMMANDS, isAndroidAutoKey } from "../android-auto/commands.js";
import { randomUUID } from "node:crypto";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { Execution, ExecutionAction } from "../../contracts/execution.js";
import { ERROR_CODES, isAndroperatorError } from "../../contracts/errors.js";
import { isAutomotiveKey, isTvRemoteKey } from "../../contracts/keys.js";
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

const AUTOMOTIVE_COMMANDS: Record<string, string[]> = {
  rotary_clockwise: ["inject-rotary", "-c", "true"],
  rotary_counterclockwise: ["inject-rotary"],
  rotary_nudge_up: ["inject-key", "280"],
  rotary_nudge_down: ["inject-key", "281"],
  rotary_nudge_left: ["inject-key", "282"],
  rotary_nudge_right: ["inject-key", "283"],
  rotary_center: ["inject-key", "23"],
};

export function isHostInputAction(action: ExecutionAction): boolean {
  return action.type === "press_key" && (isTvRemoteKey(action.params?.key) || isAutomotiveKey(action.params?.key) || isAndroidAutoKey(action.params?.key?.trim().toLowerCase()));
}

/** Execute bridge-only buttons in order with runtime segments, under the caller's device lock. */
export async function runHostInputSequence(
  execution: Execution,
  config: RuntimeConfig,
  runRuntime: (segment: Execution, signal: AbortSignal) => Promise<RunExecutionResult>,
  signal?: AbortSignal,
  connectAndroidAuto: (deviceId: string) => AndroidAutoClient = deviceId => AndroidAutoClient.connect(androidAutoSocketPath(deviceId)),
): Promise<RunExecutionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort({
    code: ERROR_CODES.COMMAND_TIMEOUT,
    message: "Host input execution timed out",
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
    message: "Host input execution canceled or timed out",
    details: { stepResults: envelope.stepResults },
  } });
  let androidAuto: AndroidAutoClient | undefined;
  try {
    for (let index = 0; index < execution.actions.length;) {
      if (sequenceSignal.aborted) return canceled();
      const action = execution.actions[index];
      if (!isHostInputAction(action)) {
        const segmentStart = index;
        index += 1;
        while (index < execution.actions.length && !isHostInputAction(execution.actions[index])) {
          index += 1;
        }
        const result = await runRuntime({
          ...execution,
          // Distinct transport IDs prevent a preceding segment's logcat result from being reused.
          commandId: `host_input_segment_${randomUUID()}`,
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
      if (isAndroidAutoKey(key)) {
        if (androidAuto === undefined) {
          androidAuto = connectAndroidAuto(config.deviceId!);
          await androidAuto.request(config.deviceId!, "acquire", Math.max(1, deadline - Date.now()), undefined, sequenceSignal);
        }
        const response = await androidAuto.request(config.deviceId!, "press", Math.max(1, deadline - Date.now()), key, sequenceSignal);
        if (response.dhuCommand !== ANDROID_AUTO_COMMANDS[key]) throw { code: "ANDROID_AUTO_PROTOCOL_ERROR", message: "DHU acknowledged a different command" };
        envelope.stepResults.push({ id: action.id, actionType: "press_key", success: true, data: {
          key, dispatchSource: "dhu", dhuCommand: ANDROID_AUTO_COMMANDS[key],
        } });
        continue;
      }
      const keyCode = KEY_EVENTS[key];
      const carCommand = AUTOMOTIVE_COMMANDS[key];
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
      let args: string[];
      let dispatchData: Record<string, string>;
      let error: string;
      if (carCommand !== undefined) {
        args = ["shell", "cmd", "car_service", ...carCommand];
        dispatchData = { carCommand: carCommand.join(" ") };
        error = "AUTOMOTIVE_INPUT_FAILED";
      } else if (keyCode !== undefined) {
        args = ["shell", "input", "keyevent", keyCode];
        dispatchData = { keyCode };
        error = "TV_REMOTE_KEY_FAILED";
      } else {
        args = ["shell", "am", "start", "-W", "-n", activity!];
        dispatchData = { activity: activity! };
        error = "TV_REMOTE_ACTIVITY_FAILED";
      }
      const result = await runAdb(config, args, { timeoutMs: Math.max(1, deadline - Date.now()) });
      if (sequenceSignal.aborted) return canceled();
      // am can print an unresolved activity error while exiting with code zero.
      const dispatchAccepted = result.code === 0 && !/Error:|Error type|Exception|Status:\s*(?!ok\b)\S+/i.test(result.stdout + result.stderr);
      // car_service can return exit zero for rejected arguments or unavailable commands.
      // Require its explicit acknowledgement, rather than treating silence as success.
      const accepted = dispatchAccepted && (carCommand === undefined || (
        carCommand[0] === "inject-key"
          ? result.stdout.trim() === "Succeeded"
          : /^Succeeded in injecting: RotaryEvent\b[^\r\n]*$/.test(result.stdout.trim())
      ));
      envelope.stepResults.push({ id: action.id, actionType: "press_key", success: accepted, data: {
        key, dispatchSource: "host",
        ...dispatchData,
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
    if (sequenceSignal.aborted) return canceled();
    return { ok: false, deviceId: config.deviceId, error: {
      ...(isAndroperatorError(error) ? { ...error } : {
        code: ERROR_CODES.RESULT_TRANSPORT_FAILED,
        message: error instanceof Error ? error.message : String(error),
      }),
      details: { stepResults: envelope.stepResults },
    } };
  } finally {
    androidAuto?.close();
    clearTimeout(timer);
  }
}
