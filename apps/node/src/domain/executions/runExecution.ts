import { waitForDirectResult } from "../../adapters/android-bridge/directResultReader.js";
import { getLoggingStatus } from "../../adapters/logger.js";
import { verifyScreenshot } from "../observe/screenshotMetadata.js";
import type { ScreenshotMetadata } from "../../contracts/screenshot.js";
import { probeUserUnlockState } from "../device/userUnlockState.js";
import { isBackgroundServiceExecution } from "../../contracts/notifications.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureScreenshot } from "../observe/captureScreenshot.js";
import type { Execution } from "../../contracts/execution.js";
import { validateExecution, validatePayloadSize } from "./validateExecution.js";
import { resolveDevice } from "../devices/resolveDevice.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { broadcastAgentCommand } from "../../adapters/android-bridge/broadcastAgentCommand.js";
import { waitForResultEnvelope } from "../../adapters/android-bridge/logcatResultReader.js";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import { checkApkPresence } from "../doctor/checks/readinessChecks.js";
import { ensureInteractiveAutomationReady, ensureInteractiveAutomationReadyCached, invalidateReadinessCacheForErrorCode, probeInteractiveState, toPublicInteractiveAutomationError } from "../doctor/checks/deviceInteractivity.js";
import { getOperatorPackageApkPath } from "../version/compatibility.js";
import { tryAcquire, release, getConflictError } from "./executionStore.js";
import type { ResultEnvelope, TerminalSource } from "../../contracts/result.js";
import type { TimeoutDiagnostics, ExecutionFailureEvidence } from "../../contracts/errors.js";
import { extractSnapshotRecordsFromLogs, inspectSnapshotXml, validateSnapshotXml, hasLegacyUntaggedSnapshotMarker } from "./snapshotHelper.js";
import { emitResult, emitExecution } from "../observe/events.js";
import { LIMITS } from "../../contracts/limits.js";
import { ERROR_CODES, isClawperatorError } from "../../contracts/errors.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { Logger } from "../../adapters/logger.js";
import { buildResultEnvelopeTimeoutHint } from "./timeoutGuidance.js";

export interface RunExecutionOptions {
  /** Experimental per-command ADB-forwarded result transport; defaults to logcat. */
  resultTransport?: "logcat" | "direct";
  deviceId?: string;
  operatorPackage?: string;
  adbPath?: string;
  runner?: RuntimeConfig["runner"];
  resultEnvelopeTimeoutMs?: number;
  logcatBroadcastDelayMs?: number;
  ensureInteractiveAutomationReadyFn?: typeof ensureInteractiveAutomationReady;
  probeInteractiveStateFn?: typeof probeInteractiveState;
  timeoutMs?: number;
  signal?: AbortSignal;
  warn?: (message: string) => void;
  logger?: Logger;
}

export type RunExecutionResult =
  | { ok: true; envelope: ResultEnvelope; deviceId: string; terminalSource: TerminalSource }
  | { ok: false; error: { code: string; message: string; [k: string]: unknown }; deviceId?: string };

interface PerformExecutionResult {
  execution?: Execution;
  result: RunExecutionResult;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

type BroadcastResult = { success: boolean; stdout?: string; stderr?: string };
type BroadcastFn = (beginDispatchCapture: () => void) => Promise<BroadcastResult>;

const SNAPSHOT_ACTION_TYPE = "snapshot";
const LEGACY_ANDROID_SNAPSHOT_ACTION_TYPE = "snapshot_ui";
const ON_SCREEN_LOG_RUNTIME_ERROR_CODES = new Set<string>([
  ERROR_CODES.ON_SCREEN_LOG_SERVICE_UNAVAILABLE,
  ERROR_CODES.ON_SCREEN_LOG_LAYOUT_INVALID,
  ERROR_CODES.ON_SCREEN_LOG_RENDER_FAILED,
  ERROR_CODES.ON_SCREEN_LOG_RENDER_TIMEOUT,
]);

function isSnapshotActionType(actionType: string): boolean {
  return actionType === SNAPSHOT_ACTION_TYPE || actionType === LEGACY_ANDROID_SNAPSHOT_ACTION_TYPE;
}

function buildAndroidExecutionPayload(execution: Execution): Execution {
  return {
    ...execution,
    actions: execution.actions.map(action =>
      action.type === SNAPSHOT_ACTION_TYPE
        ? { ...action, type: LEGACY_ANDROID_SNAPSHOT_ACTION_TYPE }
        : action
    ),
  };
}

function normalizePublicStepActionTypes(stepResults: ResultEnvelope["stepResults"]): void {
  for (const step of stepResults) {
    if (step.actionType === LEGACY_ANDROID_SNAPSHOT_ACTION_TYPE) {
      step.actionType = SNAPSHOT_ACTION_TYPE;
    }
  }
}

/**
 * Lets explicit-device executions attach logcat before preflight completes,
 * while holding the actual broadcast until the device, APK, and readiness
 * checks pass. If logcat's no-output fallback fires before the gate opens,
 * the waiter simply parks here; releasing the gate later still sends exactly
 * one broadcast and starts timeout accounting at dispatch capture.
 */
function createDeferredBroadcast(): {
  wait: BroadcastFn;
  release: (fn: BroadcastFn) => void;
  cancel: () => void;
} {
  let released = false;
  let resolveGate!: (fn: BroadcastFn) => void;
  const gate = new Promise<BroadcastFn>(resolve => {
    resolveGate = resolve;
  });

  return {
    wait: async (beginDispatchCapture) => {
      const fn = await gate;
      return fn(beginDispatchCapture);
    },
    release: (fn) => {
      if (released) {
        return;
      }
      released = true;
      resolveGate(fn);
    },
    cancel: () => {
      if (released) {
        return;
      }
      released = true;
      resolveGate(async () => ({
        success: false,
        stderr: "preflight canceled before broadcast",
      }));
    },
  };
}

function validateNonNegativeFiniteNumber(
  value: unknown,
  fieldName: string
): { code: string; message: string; [k: string]: unknown } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
      message: `${fieldName} must be a finite number`,
    };
  }
  if (value < 0) {
    return {
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
      message: `${fieldName} must be a non-negative number`,
    };
  }
  if (value > MAX_TIMER_DELAY_MS) {
    return {
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
      message: `${fieldName} must not exceed ${MAX_TIMER_DELAY_MS}`,
    };
  }
  return undefined;
}

export function attachSnapshotsToStepResults(stepResults: ResultEnvelope["stepResults"], snapshots: string[]): void {
  const snapshotSteps = stepResults.filter(step => isSnapshotActionType(step.actionType) && step.success);
  if (snapshotSteps.length === 0 || snapshots.length === 0) {
    return;
  }

  let snapshotIndex = snapshots.length - 1;
  for (let stepIndex = snapshotSteps.length - 1; stepIndex >= 0 && snapshotIndex >= 0; stepIndex -= 1) {
    const snapshotText = snapshots[snapshotIndex];
    const targetStep = snapshotSteps[stepIndex];
    if (snapshotText && targetStep && targetStep.data.text === undefined) {
      targetStep.data = { ...targetStep.data, text: snapshotText };
    }
    snapshotIndex -= 1;
  }
}

/**
 * After snapshot attachment, mark any snapshot step that is still success:true but has
 * no data.text as SNAPSHOT_EXTRACTION_FAILED, and emit a warning to stderr for each
 * affected step so users running CLI commands interactively can diagnose the problem
 * without parsing JSON.
 */
export function markExtractionFailedSnapshotSteps(
  stepResults: ResultEnvelope["stepResults"],
  warn?: (message: string) => void,
  options: { sawLegacyUntaggedSnapshotMarker?: boolean; logPath?: string } = {}
): void {
  for (const step of stepResults) {
    if (!isSnapshotActionType(step.actionType) || !step.success) continue;
    const extractionReason = step.data.extractionReason ??
      (step.data.text === undefined ? "missing_payload" : validateSnapshotXml(step.data.text));
    if (extractionReason !== undefined) {
      step.success = false;
      const { text: _text, ...remainingData } = step.data;
      const error = options.sawLegacyUntaggedSnapshotMarker
        ? ERROR_CODES.VERSION_INCOMPATIBLE
        : ERROR_CODES.SNAPSHOT_EXTRACTION_FAILED;
      const message = options.sawLegacyUntaggedSnapshotMarker
        ? "Snapshot hierarchy logs used the legacy untagged marker. Install a matching Operator APK that emits commandId-tagged snapshot logs, or use a compatible CLI."
        : "UI hierarchy source validation failed. Inspect earlier action effects, invalidate stale candidates, and use bounded orchestrator observation recovery. See https://docs.clawperator.com/api/snapshot/.";
      step.data = {
        ...remainingData,
        error,
        extractionReason,
        extractionDiagnostics: step.data.extractionDiagnostics ?? inspectSnapshotXml(step.data.text ?? "").diagnostics,
        ...(options.logPath !== undefined ? { diagnosticLogPath: options.logPath } : {}),
        ...(error === ERROR_CODES.SNAPSHOT_EXTRACTION_FAILED ? {
          failurePhase: "post_processing", dispatchState: "dispatched",
        } : {}),
        message,
      };
      warn?.(
        options.sawLegacyUntaggedSnapshotMarker
          ? `[clawperator] WARN: snapshot step "${step.id}" saw legacy untagged snapshot logs. ` +
            `Install a matching Operator APK or run 'clawperator version --check-compat' to diagnose.\n`
          : `[clawperator] WARN: snapshot step "${step.id}" UI hierarchy extraction produced missing or invalid XML. ` +
            `Source category: ${extractionReason}. Inspect earlier effects before bounded observation recovery; see https://docs.clawperator.com/api/snapshot/.\n`
      );
    }
  }
}

export function addSettleWarnings(stepResults: ResultEnvelope["stepResults"], execution: Execution): void {
  const actionIndexes = new Map(execution.actions.map((action, index) => [action.id, index]));

  for (const step of stepResults) {
    if (!isSnapshotActionType(step.actionType) || !step.success) {
      continue;
    }

    const snapshotIndex = actionIndexes.get(step.id);
    if (snapshotIndex === undefined) {
      continue;
    }

    // Only warn when a click-like action is the immediately preceding action.
    // Any intervening step (sleep, read_text, wait_for_node, etc.) may itself
    // introduce settling time, so we don't warn in those cases.
    const preceding = execution.actions[snapshotIndex - 1];
    if (preceding?.type === "click" || preceding?.type === "scroll_and_click") {
      step.data = {
        ...step.data,
        warn: "snapshot captured without a preceding sleep step; UI may not have settled - consider adding a sleep step between click and snapshot",
      };
    }
  }
}
export function injectServiceUnavailableHint(envelope: ResultEnvelope, deviceId: string): void {
  if (envelope.status !== "failed" || envelope.errorCode !== "SERVICE_UNAVAILABLE") {
    return;
  }

  envelope.hint = `Accessibility service not running. Run 'clawperator doctor --fix --device ${deviceId}' to diagnose and repair, or 'clawperator operator setup --apk <path-to-apk> --device ${deviceId}' to reinstall.`;
}

/**
 * Align top-level envelope `status` / `error` with the final `stepResults` after Node-side
 * post-processing (close_app preflight normalization, snapshot attachment, etc.).
 * Does not alter Android-only failure envelopes that have no steps (e.g. service unavailable).
 */
export function reconcileEnvelopeStatusAfterPostProcessing(envelope: ResultEnvelope): void {
  // A typed runtime terminal failure is authoritative even if cancellation occurred
  // between steps. Host post-processing must not erase its code, message, or verdict.
  if (envelope.stepResults.length === 0 ||
      (envelope.status === "failed" && typeof envelope.errorCode === "string" && envelope.errorCode.length > 0)) {
    return;
  }
  const firstFailed = envelope.stepResults.find(s => !s.success);
  if (firstFailed !== undefined) {
    envelope.status = "failed";
    const errKey = firstFailed.data?.error;
    const detail = errKey !== undefined && errKey !== "" ? `: ${errKey}` : "";
    envelope.error = `Step ${firstFailed.id} (${firstFailed.actionType}) failed${detail}`;
    const stepCode = firstFailed.data?.errorCode;
    if (typeof stepCode === "string" && stepCode.length > 0) {
      envelope.errorCode = stepCode;
    } else if (typeof errKey === "string" && ON_SCREEN_LOG_RUNTIME_ERROR_CODES.has(errKey)) {
      envelope.errorCode = errKey;
    }
    delete envelope.hint;
  } else {
    envelope.status = "success";
    envelope.error = null;
    delete envelope.errorCode;
    delete envelope.hint;
  }
}

export function getReadinessInvalidationErrorCodes(envelope: ResultEnvelope): string[] {
  const codes = envelope.stepResults
    .filter(step => !step.success)
    .map(step => step.data?.error)
    .filter((code): code is string => code !== undefined && code.length > 0);
  if (typeof envelope.errorCode === "string" && envelope.errorCode.length > 0) {
    codes.unshift(envelope.errorCode);
  }
  return codes;
}

export interface TimeoutErrorDetails {
  [key: string]: unknown;
  commandId?: string;
  taskId?: string;
  lastActionId?: string;
  lastActionType?: string;
  lastActionCaveat: string;
  elapsedMs: number;
  timeoutMs: number;
  logPath?: string;
}

export interface TimeoutErrorWithDetails extends TimeoutDiagnostics {
  details: TimeoutErrorDetails;
  hint?: string;
  [k: string]: unknown;
}

export function buildTimeoutError(
  execution: Pick<Execution, "actions" | "timeoutMs"> & Partial<Pick<Execution, "commandId" | "taskId">>,
  diagnostics: TimeoutDiagnostics,
  elapsedMs: number,
  logPath?: string
): TimeoutErrorWithDetails {
  // Node only knows the last action in the payload, not the action Android was
  // actually executing when the timeout elapsed.
  const lastAction = execution.actions.at(-1);
  const hint = buildResultEnvelopeTimeoutHint(diagnostics, {
    deviceId: diagnostics.deviceId,
    operatorPackage: diagnostics.operatorPackage,
  });
  const timeoutError: TimeoutErrorWithDetails = {
    ...diagnostics,
    ...(hint !== undefined ? { hint } : {}),
    details: {
      ...diagnostics.details,
      ...(execution.commandId !== undefined ? { commandId: execution.commandId } : {}),
      ...(execution.taskId !== undefined ? { taskId: execution.taskId } : {}),
      ...(lastAction?.id !== undefined ? { lastActionId: lastAction.id } : {}),
      ...(lastAction?.type !== undefined ? { lastActionType: lastAction.type } : {}),
      lastActionCaveat: "payload-last only; Android execution position is unknown",
      elapsedMs,
      timeoutMs: execution.timeoutMs,
      ...(logPath !== undefined ? { logPath } : {}),
    },
  };

  return timeoutError;
}

export function finalizeSuccessfulScreenshotCapture(
  screenStep: ResultEnvelope["stepResults"][number] | undefined,
  screenshotPath: string,
  image: ScreenshotMetadata,
): void {
  if (!screenStep) {
    return;
  }

  if (screenStep.data.error === "UNSUPPORTED_RUNTIME_SCREENSHOT") {
    screenStep.success = true;
    const { error: _error, errorCode: _errorCode, message: _message, ...remainingData } = screenStep.data;
    screenStep.data = remainingData;
  }

  const { capturedAt: _capturedAt, ...captureData } = screenStep.data;
  screenStep.data = { ...captureData, path: screenshotPath, captureSource: "host", persistedAt: new Date().toISOString(),
    captureWidthPx: String(image.captureWidthPx), captureHeightPx: String(image.captureHeightPx), coordinateSpace: image.coordinateSpace, origin: image.origin };
}

/**
 * close_app is executed pre-flight via adb force-stop in the Node layer.
 * When that succeeds, normalize the Android runtime's expected
 * UNSUPPORTED_RUNTIME_CLOSE step into a successful close_app result so the
 * envelope matches the real outcome observed by callers.
 */
export function finalizeSuccessfulCloseAppSteps(
  stepResults: ResultEnvelope["stepResults"],
  execution: Execution,
  successfulCloseActionIds?: ReadonlySet<string>
): void {
  const closeActions = new Map(
    execution.actions
      .filter(action => action.type === "close_app" && action.params?.applicationId)
      .map(action => [action.id, action.params?.applicationId as string])
  );

  if (closeActions.size === 0) {
    return;
  }

  for (const step of stepResults) {
    if (step.actionType !== "close_app") {
      continue;
    }
    const applicationId = closeActions.get(step.id);
    if (!applicationId) {
      continue;
    }
    if (successfulCloseActionIds && !successfulCloseActionIds.has(step.id)) {
      continue;
    }
    if (step.success === false && step.data.error === "UNSUPPORTED_RUNTIME_CLOSE") {
      step.success = true;
      step.data = { application_id: applicationId };
    }
  }
}

export async function runCloseAppPreflight(
  execution: Execution,
  config: RuntimeConfig,
  successfulCloseActionIds = new Set<string>()
): Promise<{ ok: true; successfulCloseActionIds: Set<string> } | { ok: false; error: { code: string; message: string; [k: string]: unknown } }> {
  for (const action of execution.actions) {
    if (action.type !== "close_app" || !action.params?.applicationId) {
      continue;
    }

    const applicationId = action.params.applicationId;
    const adbResult = await runAdb(config, ["shell", "am", "force-stop", applicationId]);
    if (adbResult.code !== 0) {
      return {
        ok: false,
        error: {
          code: adbResult.code === 127 ? ERROR_CODES.ADB_NOT_FOUND : ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
          message: `close_app pre-flight force-stop failed for ${applicationId}`,
          details: {
            earlierEffects: [...successfulCloseActionIds].map(actionId => ({ actionId, effect: "force_stop" })),
            applicationId,
            adbExitCode: adbResult.code,
            stdout: adbResult.stdout,
            stderr: adbResult.stderr,
          },
        },
      };
    }

    successfulCloseActionIds.add(action.id);
  }

  return { ok: true, successfulCloseActionIds };
}

function executionCancellationError(signal?: AbortSignal): { code: string; message: string; [k: string]: unknown } | undefined {
  if (!signal?.aborted) return undefined;
  if (isClawperatorError(signal.reason) && signal.reason.code === ERROR_CODES.COMMAND_TIMEOUT) return { ...signal.reason };
  return { code: ERROR_CODES.RESULT_TRANSPORT_CANCELLED, message: "Execution canceled before dispatch" };
}

function isCloseAppOnlyExecution(execution: Execution): boolean {
  return execution.actions.length > 0
    && execution.actions.every(action => action.type === "close_app" && !!action.params?.applicationId);
}

function buildCloseAppOnlySuccessEnvelope(execution: Execution): ResultEnvelope {
  return {
    commandId: execution.commandId,
    taskId: execution.taskId,
    status: "success",
    stepResults: execution.actions.map(action => ({
      id: action.id,
      actionType: "close_app",
      success: true,
      data: {
        application_id: action.params?.applicationId ?? "",
      },
    })),
    error: null,
  };
}

/**
 * Internal helper to validate, resolve device, and perform actual execution.
 */
async function performExecution(
  executionInput: unknown,
  options: RunExecutionOptions,
  evidence: ExecutionFailureEvidence
): Promise<PerformExecutionResult> {
  const config = getDefaultRuntimeConfig({
    deviceId: options.deviceId,
    operatorPackage: options.operatorPackage ?? process.env.CLAWPERATOR_OPERATOR_PACKAGE,
    adbPath: options.adbPath ?? process.env.ADB_PATH,
    runner: options.runner,
    logger: options.logger,
  });

  let execution: Execution;
  try {
    execution = validateExecution(executionInput);
  } catch (e) {
    return { result: { ok: false, error: e as { code: string; message: string; [k: string]: unknown } } };
  }

  Object.assign(evidence, { commandId: execution.commandId, taskId: execution.taskId });

  const resultEnvelopeTimeoutError = validateNonNegativeFiniteNumber(
    options.resultEnvelopeTimeoutMs,
    "resultEnvelopeTimeoutMs"
  );
  if (resultEnvelopeTimeoutError !== undefined) {
    return { execution, result: { ok: false, error: resultEnvelopeTimeoutError } };
  }

  const logcatBroadcastDelayError = validateNonNegativeFiniteNumber(
    options.logcatBroadcastDelayMs,
    "logcatBroadcastDelayMs"
  );
  if (logcatBroadcastDelayError !== undefined) {
    return { execution, result: { ok: false, error: logcatBroadcastDelayError } };
  }

  if (options.timeoutMs !== undefined) {
    if (!Number.isFinite(options.timeoutMs)) {
      return {
        execution,
        result: {
          ok: false,
          error: {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: "timeoutMs must be a finite number",
          },
        },
      };
    }
    if (options.timeoutMs < LIMITS.MIN_EXECUTION_TIMEOUT_MS || options.timeoutMs > LIMITS.MAX_EXECUTION_TIMEOUT_MS) {
      return {
        execution,
        result: {
          ok: false,
          error: {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: `timeoutMs must be between ${LIMITS.MIN_EXECUTION_TIMEOUT_MS} and ${LIMITS.MAX_EXECUTION_TIMEOUT_MS}`,
          },
        },
      };
    }
    execution = { ...execution, timeoutMs: options.timeoutMs };
  }

  const cancellation = executionCancellationError(options.signal);
  if (cancellation !== undefined) return { execution, result: { ok: false, error: cancellation } };

  const androidExecution = buildAndroidExecutionPayload(execution);
  const payload = JSON.stringify(androidExecution);
  try {
    validatePayloadSize(payload);
  } catch (e) {
    return { execution, result: { ok: false, error: e as { code: string; message: string; [k: string]: unknown } } };
  }

  if (options.resultTransport !== undefined && options.resultTransport !== "logcat" && options.resultTransport !== "direct") {
    return { execution, result: { ok: false, error: { code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: "resultTransport must be logcat or direct" } } };
  }
  const hasExplicitDevice = typeof config.deviceId === "string" && config.deviceId.trim().length > 0;
  // Explicit-device logcat can start early because resolveDevice validates the
  // provided serial exactly. Auto-resolve must stay sequential so the logcat
  // reader is attached to the final resolved device.
  const deferredBroadcast = hasExplicitDevice && options.resultTransport !== "direct" ? createDeferredBroadcast() : undefined;
  const earlyResultAbortController = deferredBroadcast !== undefined ? new AbortController() : undefined;
  const earlyResultWaiter = deferredBroadcast !== undefined
    ? waitForResultEnvelope(
        config,
        {
          commandId: execution.commandId,
          taskId: execution.taskId,
          timeoutMs: options.resultEnvelopeTimeoutMs ?? (execution.timeoutMs + 5000),
          broadcastDelayMs: options.logcatBroadcastDelayMs,
          lastCorrelatedLines: 30,
          cancelSignal: options.signal !== undefined
            ? AbortSignal.any([earlyResultAbortController!.signal, options.signal])
            : earlyResultAbortController?.signal,
        },
        deferredBroadcast.wait
      )
    : undefined;
  earlyResultWaiter?.catch(() => undefined);

  const cancelEarlyResultWaiter = () => {
    earlyResultAbortController?.abort();
    deferredBroadcast?.cancel();
  };

  let deviceId: string;
  let apkCheck: Awaited<ReturnType<typeof checkApkPresence>>;
  let broadcastReleased = false;
  try {
    if (hasExplicitDevice) {
      const [resolved, explicitApkCheck] = await Promise.all([
        resolveDevice(config),
        checkApkPresence(config),
      ]);
      deviceId = resolved.deviceId;
      config.deviceId = deviceId;
      apkCheck = explicitApkCheck;
    } else {
      const resolved = await resolveDevice(config);
      deviceId = resolved.deviceId;
      config.deviceId = deviceId;
      apkCheck = await checkApkPresence(config);
    }
  } catch (e) {
    cancelEarlyResultWaiter();
    return { execution, result: { ok: false, error: e as { code: string; message: string; [k: string]: unknown } } };
  }

  const preflightCancellation = executionCancellationError(options.signal);
  if (preflightCancellation !== undefined) {
    cancelEarlyResultWaiter();
    return { execution, result: { ok: false, error: preflightCancellation, deviceId } };
  }

  if (apkCheck.status === "fail") {
    cancelEarlyResultWaiter();
    const isMissing = apkCheck.code === ERROR_CODES.OPERATOR_NOT_INSTALLED;
    const installCommand = isMissing
      ? `clawperator operator setup --apk ${getOperatorPackageApkPath(config.operatorPackage)} --device ${deviceId}${config.operatorPackage !== "com.clawperator.operator" ? ` --operator-package ${config.operatorPackage}` : ""}`
      : undefined;
    const message = isMissing
      ? `Operator APK (${config.operatorPackage}) is not installed on ${deviceId}. Install it with: ${installCommand}`
      : `${apkCheck.summary}${apkCheck.detail !== undefined ? ` ${apkCheck.detail}` : ""}`;
    options.logger?.emit({
      ts: new Date().toISOString(),
      level: "error",
      event: isMissing ? "preflight.apk.missing" : "preflight.apk.failed",
      commandId: execution.commandId,
      taskId: execution.taskId,
      deviceId,
      message: `${apkCheck.code}: ${message}`,
    });
    return {
      execution,
      result: {
        ok: false,
        error: {
          code: apkCheck.code!,
          message,
          details: {
            checkId: apkCheck.id,
            summary: apkCheck.summary,
            detail: apkCheck.detail,
            evidence: apkCheck.evidence,
            fix: apkCheck.fix,
            ...(installCommand !== undefined ? { installCommand } : {}),
          },
        },
        deviceId,
      },
    };
  }

  if (apkCheck.status === "warn") {
    options.warn?.(
      `[clawperator] WARN: ${apkCheck.id} ${apkCheck.summary}${apkCheck.detail ? ` - ${apkCheck.detail}` : ""}\n`
    );
  }

  if (apkCheck.status === "pass") {
    options.logger?.emit({
      ts: new Date().toISOString(),
      level: "info",
      event: "preflight.apk.pass",
      commandId: execution.commandId,
      taskId: execution.taskId,
      deviceId,
      message: `Operator APK (${config.operatorPackage}) is installed on ${deviceId}`,
    });
  }

  if (!tryAcquire(deviceId, execution.commandId)) {
    cancelEarlyResultWaiter();
    return { execution, result: { ok: false, error: getConflictError(deviceId, execution.commandId), deviceId } };
  }

  try {
    // Host-side close_app preflight is safe even when the device is not yet interactive.
    const successfulCloseActionIds = new Set<string>();
    let closeAppPreflight: Awaited<ReturnType<typeof runCloseAppPreflight>>;
    try {
      closeAppPreflight = await runCloseAppPreflight(execution, config, successfulCloseActionIds);
    } finally {
      // Keep confirmed effects even if a later force-stop throws.
      evidence.earlierEffects = [...successfulCloseActionIds].map(actionId => ({ actionId, effect: "force_stop" }));
    }
    const closeCancellation = executionCancellationError(options.signal);
    if (closeCancellation !== undefined) throw closeCancellation;
    if (!closeAppPreflight.ok) {
      cancelEarlyResultWaiter();
      invalidateReadinessCacheForErrorCode(deviceId, config.operatorPackage, closeAppPreflight.error.code);
      return { execution, result: { ok: false, error: closeAppPreflight.error, deviceId } };
    }

    if (isCloseAppOnlyExecution(execution)) {
      cancelEarlyResultWaiter();
      const envelope = buildCloseAppOnlySuccessEnvelope(execution);
      emitResult(deviceId, envelope);
      return {
        execution,
        result: {
          ok: true,
          envelope,
          deviceId,
          terminalSource: "clawperator_result",
        },
      };
    }

    if (isBackgroundServiceExecution(execution.actions)) {
      const userState = await probeUserUnlockState(config);
      if (userState?.userUnlocked === false) {
        cancelEarlyResultWaiter();
        return { execution, result: { ok: false, deviceId, error: {
          code: ERROR_CODES.DEVICE_USER_NOT_UNLOCKED,
          message: "Android user storage is not unlocked after boot. Unlock the selected user once before notification/media operations; no unlock was attempted.",
          details: userState,
        } } };
      }
    } else {
      const ensureInteractiveAutomationReadyFn = options.ensureInteractiveAutomationReadyFn ?? ensureInteractiveAutomationReadyCached;
      const interactiveState = await ensureInteractiveAutomationReadyFn(config, {
        probeInteractiveStateFn: options.probeInteractiveStateFn,
      });
      if (interactiveState.ok) {
        const { phase: _phase, dispatchState: _dispatchState, ...probeEvidence } = interactiveState.probeEvidence ?? {};
        Object.assign(evidence, probeEvidence);
      }
      const readinessCancellation = executionCancellationError(options.signal);
      if (readinessCancellation !== undefined) throw readinessCancellation;
      if (!interactiveState.ok) {
        cancelEarlyResultWaiter();
        const publicError = interactiveState.error.code === ERROR_CODES.DEVICE_NOT_INTERACTIVE
          ? toPublicInteractiveAutomationError(interactiveState.error)
          : interactiveState.error;
        return {
          execution,
          result: {
            ok: false,
            error: { ...publicError },
            deviceId,
          },
        };
      }
    }

    evidence.phase = "dispatch";
    let dispatchStart = Date.now();
    const runBroadcast = async (beginDispatchCapture: () => void, resultSessionId?: string) => {
      const cancellation = executionCancellationError(options.signal);
      if (cancellation !== undefined) throw cancellation;
      evidence.phase = "dispatch";
      beginDispatchCapture();
      evidence.dispatchState = "unknown";
      evidence.dispatchStartedAt = new Date().toISOString();
      const broadcast = await broadcastAgentCommand(config, payload, { resultSessionId, timeoutMs: resultSessionId === undefined ? undefined : execution.timeoutMs });
      if (broadcast.success) {
        evidence.dispatchState = "dispatched";
        // A terminal result may already have started asynchronous post-processing.
        if (evidence.phase === "dispatch") evidence.phase = "result_wait";
        options.logger?.emit({
          ts: new Date().toISOString(),
          level: "info",
          event: "broadcast.dispatched",
          commandId: execution.commandId,
          taskId: execution.taskId,
          deviceId,
          message: `Broadcast dispatched to ${deviceId} for ${config.operatorPackage}`,
        });
      }
      return { success: broadcast.success, stdout: broadcast.stdout, stderr: broadcast.stderr };
    };
    let result: Awaited<ReturnType<typeof waitForResultEnvelope>>;
    if (options.resultTransport === "direct") {
      result = await waitForDirectResult(config, {
        commandId: execution.commandId,
        taskId: execution.taskId,
        timeoutMs: options.resultEnvelopeTimeoutMs ?? (execution.timeoutMs + 5000),
        cancelSignal: options.signal,
      }, runBroadcast);
    } else if (earlyResultWaiter !== undefined && deferredBroadcast !== undefined) {
      dispatchStart = Date.now();
      broadcastReleased = true;
      deferredBroadcast.release(runBroadcast);
      result = await earlyResultWaiter;
    } else {
      result = await waitForResultEnvelope(config, {
        commandId: execution.commandId,
        taskId: execution.taskId,
        timeoutMs: options.resultEnvelopeTimeoutMs ?? (execution.timeoutMs + 5000),
        broadcastDelayMs: options.logcatBroadcastDelayMs,
        lastCorrelatedLines: 30,
        cancelSignal: options.signal,
      }, runBroadcast);
    }

    if (result.ok) {
      // A correlated terminal result proves delivery even if the ADB acknowledgement is still pending.
      evidence.dispatchState = "dispatched";
      evidence.phase = "post_processing";
      options.logger?.emit({
        ts: new Date().toISOString(),
        level: "info",
        event: "envelope.received",
        commandId: execution.commandId,
        taskId: execution.taskId,
        deviceId,
        message: `Result envelope received from ${deviceId}`,
      });
      finalizeSuccessfulCloseAppSteps(result.envelope.stepResults, execution, closeAppPreflight.successfulCloseActionIds);

      // Reconstruct snapshot XML from the live result logcat stream.
      const hasSnapshot = result.envelope.stepResults.some(s => isSnapshotActionType(s.actionType));
      if (hasSnapshot) {
        const snapshotLogLines = result.snapshotLogLines ?? [];
        const records = extractSnapshotRecordsFromLogs(snapshotLogLines).filter(record => record.commandId === execution.commandId);
        const snapshots = records.map(record => record.snapshot);
        for (const [occurrence, record] of records.entries()) {
          if (record.validationError !== undefined) options.logger?.emit({
            ts: new Date().toISOString(), level: "error", event: "snapshot.extraction.failed",
            commandId: execution.commandId, taskId: execution.taskId, deviceId,
            message: JSON.stringify({ occurrence, reason: record.validationError, diagnostics: record.extractionDiagnostics, preview: record.diagnosticPreview }),
          });
        }
        const snapshotSteps = result.envelope.stepResults.filter(step => isSnapshotActionType(step.actionType) && step.success);
        for (let offset = 1; offset <= Math.min(records.length, snapshotSteps.length); offset++) {
          const record = records[records.length - offset];
          if (record.validationError !== undefined && snapshotSteps[snapshotSteps.length - offset].data.text === undefined) {
            snapshotSteps[snapshotSteps.length - offset].data.extractionReason = record.validationError;
            snapshotSteps[snapshotSteps.length - offset].data.extractionDiagnostics = record.extractionDiagnostics;
          }
        }
        attachSnapshotsToStepResults(result.envelope.stepResults, snapshots);
        markExtractionFailedSnapshotSteps(result.envelope.stepResults, options.warn, {
          sawLegacyUntaggedSnapshotMarker: hasLegacyUntaggedSnapshotMarker(snapshotLogLines),
          logPath: getLoggingStatus(options.logger).logPath,
        });
        // Attach data.warn to any snapshot immediately following a click with no sleep.
        addSettleWarnings(result.envelope.stepResults, execution);
      }
      normalizePublicStepActionTypes(result.envelope.stepResults);

      const hasScreenshot = result.envelope.stepResults.some(s => s.actionType === "take_screenshot");
      const screenAction = execution.actions.find(a => a.type === "take_screenshot");
      if (hasScreenshot) {
        try {
          const screenshotPath = screenAction?.params?.path ?? join(tmpdir(), `clawperator-screenshot-${execution.commandId}-${Date.now()}.png`);
          const screenStep = result.envelope.stepResults.find(s => s.actionType === "take_screenshot");

          const buffer = await captureScreenshot(config, {
            timeoutMs: execution.timeoutMs,
            commandId: execution.commandId,
            taskId: execution.taskId,
          });

          const image = verifyScreenshot(buffer);
          await writeFile(screenshotPath, buffer);
          finalizeSuccessfulScreenshotCapture(screenStep, screenshotPath, image);
        } catch (e) {
          const screenStep = result.envelope.stepResults.find(step => step.actionType === "take_screenshot");
          if (screenStep !== undefined) {
            screenStep.success = false;
            const { path: _path, capturedAt: _capturedAt, persistedAt: _persistedAt, captureWidthPx: _width, captureHeightPx: _height, coordinateSpace: _space, origin: _origin, ...previousData } = screenStep.data;
            screenStep.data = { ...previousData,
              runtimeError: previousData.error ?? "",
              error: ERROR_CODES.EVIDENCE_CAPTURE_FAILED,
              errorCode: ERROR_CODES.EVIDENCE_CAPTURE_FAILED,
              message: (typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e)).slice(0, 1024), failurePhase: "post_processing", dispatchState: "dispatched",
            };
          }
        }
      }

      reconcileEnvelopeStatusAfterPostProcessing(result.envelope);
      if (result.envelope.stepResults.some(step => !step.success && step.data.failurePhase === "post_processing")) {
        result.envelope.failureEvidence = { ...evidence, completedAt: new Date().toISOString() };
      }
      injectServiceUnavailableHint(result.envelope, deviceId);
      if (result.envelope.status === "failed") {
        for (const errorCode of getReadinessInvalidationErrorCodes(result.envelope)) {
          invalidateReadinessCacheForErrorCode(deviceId, config.operatorPackage, errorCode);
        }
      }

      result.envelope.diagnostics = { logging: getLoggingStatus(options.logger) };
      emitResult(deviceId, result.envelope);
      return {
        execution,
        result: { ok: true, envelope: result.envelope, deviceId, terminalSource: result.terminalSource },
      };
    }

    if ("broadcastFailed" in result && result.broadcastFailed && "diagnostics" in result) {
      invalidateReadinessCacheForErrorCode(deviceId, config.operatorPackage, result.diagnostics.code);
      return { execution, result: { ok: false, error: { ...result.diagnostics }, deviceId } };
    }
    if ("timeout" in result && result.timeout && "diagnostics" in result) {
      const elapsedMs = Date.now() - dispatchStart;
      options.logger?.emit({
        ts: new Date().toISOString(),
        level: "error",
        event: "timeout.fired",
        commandId: execution.commandId,
        taskId: execution.taskId,
        deviceId,
        message: `Timeout waiting for result envelope after ${elapsedMs}ms`,
      });
      invalidateReadinessCacheForErrorCode(deviceId, config.operatorPackage, result.diagnostics.code);
      return {
        execution,
        result: {
          ok: false,
          error: buildTimeoutError(execution, result.diagnostics, elapsedMs, options.logger?.logPath()),
          deviceId,
        },
      };
    }
    
    const errCode = ("code" in result && result.code) ? result.code : ERROR_CODES.RESULT_TRANSPORT_FAILED;
    return {
      execution,
      result: {
        ok: false,
        error: { code: errCode, message: ("error" in result && typeof result.error === "string") ? result.error : "Unknown transport error",
          details: { ...("diagnostics" in result ? result.diagnostics : {}),
            commandId: execution.commandId, taskId: execution.taskId, deviceId,
            operatorPackage: config.operatorPackage, executionPosition: "unknown" } },
        deviceId,
      },
    };
  } catch (error) {
    return { execution, result: { ok: false, deviceId, error: isClawperatorError(error) ? { ...error } : {
      code: ERROR_CODES.RESULT_TRANSPORT_FAILED,
      message: error instanceof Error ? error.message : String(error),
    } } };
  } finally {
    if (!broadcastReleased) {
      cancelEarlyResultWaiter();
    }
    release(deviceId, execution.commandId);
  }
}

/**
 * Validate, resolve device, enforce single-flight, dispatch broadcast, wait for terminal envelope.
 * Always emits outcome to SSE subscribers via emitExecution.
 */
export async function runExecution(
  executionInput: unknown,
  options: RunExecutionOptions = {}
): Promise<RunExecutionResult> {
  const evidence: ExecutionFailureEvidence = {
    phase: "readiness", dispatchState: "not_dispatched", startedAt: new Date().toISOString(),
  };
  const { execution, result } = await performExecution(executionInput, options, evidence);
  const logging = getLoggingStatus(options.logger);
  if (logging.logPath !== undefined) evidence.logPath = logging.logPath;
  if (result.ok) result.envelope.diagnostics = { logging };
  if (!result.ok) {
    result.error.diagnostics = { logging };
    const details = result.error.details as Record<string, unknown> | undefined;
    result.error.details = { ...details, ...evidence,
      ...(details?.earlierEffects !== undefined ? { earlierEffects: details.earlierEffects } : {}),
      completedAt: new Date().toISOString() };
  }
  
  // We emit the execution outcome even if resolution failed, as long as we have SOME deviceId 
  // (either from options or resolved during the process).
  const resolvedDeviceId: string | null = result.deviceId || options.deviceId || null;
  if (resolvedDeviceId !== null) {
    emitExecution(resolvedDeviceId, execution ?? executionInput, result);
  }
  return result;
}
