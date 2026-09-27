import { buildDragExecution } from "../../domain/actions/drag.js";
import type { DragParams } from "../../contracts/drag.js";
import { buildToastExecution } from "../../domain/actions/toast.js";
import { buildNotificationMediaExecution } from "../../domain/notifications/service.js";
import type { NotificationMediaAction } from "../../contracts/notifications.js";
import { runExecution } from "../../domain/executions/runExecution.js";
import { buildClickExecution } from "../../domain/actions/click.js";
import { buildReadExecution } from "../../domain/actions/read.js";
import { buildWaitExecution } from "../../domain/actions/wait.js";
import { buildTypeTextExecution } from "../../domain/actions/typeText.js";
import { buildOpenAppExecution } from "../../domain/actions/openApp.js";
import { buildOpenUriExecution } from "../../domain/actions/openUri.js";
import { buildPressKeyExecution } from "../../domain/actions/pressKey.js";
import { buildScrollExecution } from "../../domain/actions/scroll.js";
import { buildScrollUntilExecution } from "../../domain/actions/scrollUntil.js";
import { buildCloseAppExecution } from "../../domain/actions/closeApp.js";
import { buildSleepExecution } from "../../domain/actions/sleep.js";
import { buildOnScreenLogExecution } from "../../domain/actions/onScreenLog.js";
import type { ActionParams, Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";
import type { OutputOptions } from "../output.js";
import { formatError, formatRunExecutionResultForCli } from "../output.js";
import type { Logger } from "../../adapters/logger.js";
import { tryDaemonExecution } from "../daemonProxy.js";
import { validateExecution, validatePayloadSize } from "../../domain/executions/validateExecution.js";
import { buildSwipeExecution } from "../../domain/actions/swipe.js";
import type { SwipeParams } from "../../contracts/swipe.js";

export async function cmdActionSwipe(options: ActionCommandOptions & SwipeParams): Promise<string> {
  try {
    return await runActionExecution(buildSwipeExecution({ start: options.start, end: options.end, durationMs: options.durationMs }, options.timeoutMs), options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdActionDrag(options: ActionCommandOptions & DragParams): Promise<string> {
  try {
    return await runActionExecution(buildDragExecution({ start: options.start, end: options.end, holdDurationMs: options.holdDurationMs, moveDurationMs: options.moveDurationMs }, options.timeoutMs), options);
  } catch (error) {
    return formatError(error, options);
  }
}

interface ActionCommandOptions {
  format: OutputOptions["format"];
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
  noDaemon?: boolean;
  logger?: Logger;
  tryDaemonExecutionFn?: typeof tryDaemonExecution;
  runExecutionFn?: typeof runExecution;
}

export async function cmdToast(options: ActionCommandOptions & {
  operation: "show" | "cancel";
  params?: Pick<ActionParams, "text" | "duration">;
}): Promise<string> {
  try {
    return await runActionExecution(buildToastExecution(options.operation, options.params, options.timeoutMs), options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdOnScreenLog(options: ActionCommandOptions & {
  operation: "set" | "clear";
  params?: ActionParams;
}): Promise<string> {
  try {
    return await runActionExecution(
      buildOnScreenLogExecution(options.operation, options.params, options.timeoutMs),
      options,
    );
  } catch (error) {
    return formatError(error, options);
  }
}

async function runActionExecution(execution: Execution, options: ActionCommandOptions): Promise<string> {
  const validatedExecution = validateExecution(execution);
  validatePayloadSize(JSON.stringify(validatedExecution));
  const tryDaemonExecutionFn = options.tryDaemonExecutionFn ?? tryDaemonExecution;
  const runExecutionFn = options.runExecutionFn ?? runExecution;
  const proxyResult = options.noDaemon === true
    ? null
    : await tryDaemonExecutionFn(validatedExecution, {
      rawDeviceId: options.deviceId,
      operatorPackage: options.operatorPackage,
      noDaemon: options.noDaemon,
      allowPostDispatchFallback: false,
    });
  const result = proxyResult ?? await runExecutionFn(validatedExecution, {
    deviceId: options.deviceId,
    operatorPackage: options.operatorPackage ?? process.env.CLAWPERATOR_OPERATOR_PACKAGE,
    timeoutMs: options.timeoutMs,
    warn: message => process.stderr.write(message),
    logger: options.logger,
  });
  return formatRunExecutionResultForCli(result, options);
}

export async function cmdActionOpenApp(options: {
  format: OutputOptions["format"];
  applicationId: string;
  skipNavigationWait?: boolean;
  navigationTimeoutMs?: number;
  deviceId?: string;
  operatorPackage?: string;
  noDaemon?: boolean;
  logger?: Logger;
  tryDaemonExecutionFn?: typeof tryDaemonExecution;
  runExecutionFn?: typeof runExecution;
}): Promise<string> {
  try {
    const execution = buildOpenAppExecution(options.applicationId, {
      skipNavigationWait: options.skipNavigationWait,
      navigationTimeoutMs: options.navigationTimeoutMs,
    });
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdSleep(options: {
  format: OutputOptions["format"];
  durationMs: number;
  globalTimeoutMs?: number;
  deviceId?: string;
  operatorPackage?: string;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildSleepExecution(options.durationMs, options.globalTimeoutMs);
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdCloseApp(options: {
  format: OutputOptions["format"];
  applicationId: string;
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildCloseAppExecution(options.applicationId, options.timeoutMs);
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdActionClick(options: {
  format: OutputOptions["format"];
  strict?: boolean;
  container?: NodeMatcher;
  matcher?: NodeMatcher;
  coordinate?: { x: number; y: number };
  clickType?: "default" | "long_click" | "focus";
  deviceId?: string;
  operatorPackage?: string;
  noDaemon?: boolean;
  logger?: Logger;
  tryDaemonExecutionFn?: typeof tryDaemonExecution;
  runExecutionFn?: typeof runExecution;
}): Promise<string> {
  try {
    const execution = buildClickExecution(options.matcher, options.clickType, options.coordinate, options.strict, options.container);
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdActionRead(options: {
  format: OutputOptions["format"];
  strict?: boolean;
  matcher: NodeMatcher;
  readAll?: boolean;
  container?: NodeMatcher;
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
  validateOnly?: boolean;
  dryRun?: boolean;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildReadExecution(options.matcher, options.readAll, options.container, options.strict);
    if (options.validateOnly || options.dryRun) {
      // Reuse exec's contract-only paths so read validation never dispatches to a device.
      return (await import("./execute.js")).cmdExecute({
        format: options.format,
        execution: JSON.stringify(execution),
        deviceId: options.deviceId,
        operatorPackage: options.operatorPackage,
        timeoutMs: options.timeoutMs,
        validateOnly: options.validateOnly,
        dryRun: options.dryRun,
        noDaemon: options.noDaemon,
        logger: options.logger,
      });
    }
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdActionWait(options: {
  format: OutputOptions["format"];
  strict?: boolean;
  container?: NodeMatcher;
  matcher: NodeMatcher;
  waitTimeoutMs?: number;
  deviceId?: string;
  operatorPackage?: string;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildWaitExecution(options.matcher, options.waitTimeoutMs, options.strict, options.container);
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdActionType(options: {
  format: OutputOptions["format"];
  strict?: boolean;
  container?: NodeMatcher;
  matcher: NodeMatcher;
  text: string;
  submit?: boolean;
  clear?: boolean;
  deviceId?: string;
  operatorPackage?: string;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildTypeTextExecution({
      selector: options.matcher,
      strict: options.strict,
      container: options.container,
      text: options.text,
      submit: options.submit ?? false,
      clear: options.clear ?? false,
    });
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdActionOpenUri(options: {
  format: OutputOptions["format"];
  uri: string;
  deviceId?: string;
  operatorPackage?: string;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildOpenUriExecution(options.uri);
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdActionPressKey(options: {
  format: OutputOptions["format"];
  key: string;
  deviceId?: string;
  operatorPackage?: string;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildPressKeyExecution(options.key);
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdScroll(options: {
  format: OutputOptions["format"];
  strict?: boolean;
  direction: string;
  container?: NodeMatcher;
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildScrollExecution(options.direction, options.timeoutMs, options.container, options.strict);
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdScrollUntil(options: {
  format: OutputOptions["format"];
  strict?: boolean;
  direction: string;
  matcher: NodeMatcher;
  container?: NodeMatcher;
  clickAfter: boolean;
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
  noDaemon?: boolean;
  logger?: Logger;
}): Promise<string> {
  try {
    const execution = buildScrollUntilExecution(
      options.direction,
      options.matcher,
      options.container,
      options.clickAfter,
      options.timeoutMs,
      options.strict,
    );
    return await runActionExecution(execution, options);
  } catch (e) {
    return formatError(e, options);
  }
}

export async function cmdQuery(options: ActionCommandOptions & import("../../domain/actions/query.js").QueryOptions): Promise<string> {
  try {
    const { buildQueryExecution } = await import("../../domain/actions/query.js");
    return await runActionExecution(buildQueryExecution({
      matcher: options.matcher, visibility: options.visibility, limit: options.limit,
    }, options.timeoutMs), options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdNotificationMedia(options: ActionCommandOptions & { type: NotificationMediaAction; params: ActionParams }): Promise<string> {
  try {
    return await runActionExecution(buildNotificationMediaExecution(options.type, options.params, options.timeoutMs), options);
  } catch (error) {
    return formatError(error, options);
  }
}
