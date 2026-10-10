import { readFile } from "node:fs/promises";
import { runExecution } from "../../domain/executions/lazyExecution.js";
import { validateExecution, validatePayloadSize } from "../../domain/executions/validateExecution.js";
import { LIMITS } from "../../contracts/limits.js";
import type { OutputOptions } from "../output.js";
import { formatSuccess, formatError, formatRunExecutionResultForCli } from "../output.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import type { Logger } from "../../adapters/logger.js";
import { tryDaemonExecution } from "../daemonProxy.js";

function normalizeExecutionForRun(payload: unknown, timeoutMs: number | undefined): unknown {
  const execution = validateExecution(payload);
  if (timeoutMs === undefined) {
    validatePayloadSize(JSON.stringify(execution));
    return execution;
  }
  if (!Number.isFinite(timeoutMs)) {
    throw {
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
      message: "timeoutMs must be a finite number",
    };
  }
  if (timeoutMs < LIMITS.MIN_EXECUTION_TIMEOUT_MS || timeoutMs > LIMITS.MAX_EXECUTION_TIMEOUT_MS) {
    throw {
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
      message: `timeoutMs must be between ${LIMITS.MIN_EXECUTION_TIMEOUT_MS} and ${LIMITS.MAX_EXECUTION_TIMEOUT_MS}`,
    };
  }
  const executionWithTimeout = { ...execution, timeoutMs };
  validatePayloadSize(JSON.stringify(executionWithTimeout));
  return executionWithTimeout;
}

export async function cmdExecute(options: {
  format: OutputOptions["format"];
  execution: string; // JSON string or file path
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
  validateOnly?: boolean;
  dryRun?: boolean;
  noDaemon?: boolean;
  logger?: Logger;
  tryDaemonExecutionFn?: typeof tryDaemonExecution;
  runExecutionFn?: typeof runExecution;
}): Promise<string> {
  let payload: unknown;
  const raw = options.execution.trim();
  // Inline object JSON vs file path: '{' is unambiguous for objects.
  if (raw.startsWith("{")) {
    try {
      payload = JSON.parse(raw);
    } catch {
      return formatError({ code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: "Invalid JSON content" }, options);
    }
  } else if (raw.startsWith("[")) {
    // Paths can start with '['; prefer file read when the path exists, else treat as inline JSON array.
    try {
      const content = await readFile(raw, "utf-8");
      try {
        payload = JSON.parse(content);
      } catch (e) {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: `Invalid JSON content in execution file: ${(e as Error).message}`,
          },
          options
        );
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        try {
          payload = JSON.parse(raw);
        } catch {
          return formatError({ code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: "Invalid JSON content" }, options);
        }
      } else {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: `Failed to read execution file: ${err.message}`,
          },
          options
        );
      }
    }
  } else {
    // Treat as file path: error precedence is unreadable file -> invalid JSON content
    let content: string;
    try {
      content = await readFile(raw, "utf-8");
    } catch (e) {
      return formatError(
        { code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: `Failed to read execution file: ${(e as Error).message}` },
        options
      );
    }
    try {
      payload = JSON.parse(content);
    } catch (e) {
      return formatError(
        { code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: `Invalid JSON content in execution file: ${(e as Error).message}` },
        options
      );
    }
  }

  try {
    if (options.dryRun) {
      let execution = validateExecution(payload);
      if (options.timeoutMs !== undefined) {
        if (!Number.isFinite(options.timeoutMs)) {
          return formatError(
            {
              code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
              message: "timeoutMs must be a finite number",
            },
            options
          );
        }
        if (options.timeoutMs < LIMITS.MIN_EXECUTION_TIMEOUT_MS || options.timeoutMs > LIMITS.MAX_EXECUTION_TIMEOUT_MS) {
          return formatError(
            {
              code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
              message: `timeoutMs must be between ${LIMITS.MIN_EXECUTION_TIMEOUT_MS} and ${LIMITS.MAX_EXECUTION_TIMEOUT_MS}`,
            },
            options
          );
        }
        execution = { ...execution, timeoutMs: options.timeoutMs };
      }
      validatePayloadSize(JSON.stringify(execution));
      const plan = {
        commandId: execution.commandId,
        timeoutMs: execution.timeoutMs,
        actionCount: execution.actions.length,
        actions: execution.actions.map(action => ({
          id: action.id,
          type: action.type,
          params: action.params,
        })),
      };
      return formatSuccess({ ok: true, dryRun: true, plan }, options);
    }

    if (options.validateOnly) {
      let execution = validateExecution(payload);
      if (options.timeoutMs !== undefined) {
        if (!Number.isFinite(options.timeoutMs)) {
          return formatError(
            {
              code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
              message: "timeoutMs must be a finite number",
            },
            options
          );
        }
        if (options.timeoutMs < LIMITS.MIN_EXECUTION_TIMEOUT_MS || options.timeoutMs > LIMITS.MAX_EXECUTION_TIMEOUT_MS) {
          return formatError(
            {
              code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
              message: `timeoutMs must be between ${LIMITS.MIN_EXECUTION_TIMEOUT_MS} and ${LIMITS.MAX_EXECUTION_TIMEOUT_MS}`,
            },
            options
          );
        }
        execution = { ...execution, timeoutMs: options.timeoutMs };
      }
      validatePayloadSize(JSON.stringify(execution));
      return formatSuccess({ ok: true, validated: true, execution }, options);
    }

    const executionForRun = normalizeExecutionForRun(payload, options.timeoutMs);
    const tryDaemonExecutionFn = options.tryDaemonExecutionFn ?? tryDaemonExecution;
    const runExecutionFn = options.runExecutionFn ?? runExecution;
    const proxyResult = await tryDaemonExecutionFn(executionForRun, {
      rawDeviceId: options.deviceId,
      operatorPackage: options.operatorPackage,
      noDaemon: options.noDaemon,
      allowPostDispatchFallback: false,
    });
    const result = proxyResult ?? await runExecutionFn(executionForRun, {
      deviceId: options.deviceId,
      operatorPackage: options.operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE,
      timeoutMs: options.timeoutMs,
      warn: message => process.stderr.write(message),
      logger: options.logger,
    });
    return formatRunExecutionResultForCli(result, options);
  } catch (e) {
    return formatError(e, options);
  }
}
