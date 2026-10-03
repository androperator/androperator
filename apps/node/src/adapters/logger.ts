import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ANDROPERATOR_SKILL_RUN_ID_ENV_VAR,
  type LogEvent,
  type LoggingStatus,
  type LogLevel,
  type AndroperatorLogger,
  LEVEL_ORDER,
  resolveRoutingRule,
  DEFAULT_ROUTING_RULES,
  expandHomePath,
  formatLogPath,
  normalizeSkillRunId,
} from "../contracts/logging.js";

// Re-export contract types for consumers
export type { LogEvent, LogLevel, AndroperatorLogger };

/**
 * Logger is a type alias for AndroperatorLogger. Kept as a convenience export
 * so existing call sites do not need a mass rename. New code should prefer
 * importing AndroperatorLogger from contracts/logging.ts.
 */
export type Logger = AndroperatorLogger;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeLogLevel(level?: string): LogLevel {
  const lowered = level?.toLowerCase();
  return lowered === "debug" || lowered === "warn" || lowered === "error" ? lowered : "info";
}

function warnOnce(state: { warned: boolean }, message: string): void {
  if (state.warned) {
    return;
  }
  state.warned = true;
  process.stderr.write(message);
}

function mergeDefinedContext(
  base: Partial<LogEvent> | undefined,
  overlay: Partial<LogEvent>
): Partial<LogEvent> {
  const merged: Partial<LogEvent> = base ? { ...base } : {};
  const target = merged as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlay) as Array<[keyof LogEvent, LogEvent[keyof LogEvent]]>) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Unified logger factory
// ---------------------------------------------------------------------------

export interface CreateAndroperatorLoggerOptions {
  logDir?: string;
  logLevel?: string;
  outputFormat?: "json" | "pretty";
  inheritSkillRunId?: boolean;
  fileLogging?: boolean;
}

const loggerDirectories = new WeakMap<AndroperatorLogger, string>();

export function resolveLogDestination(logDir?: string, date = new Date()): { logDir: string; logPath: string } {
  const configuredDir = logDir?.trim() || process.env.ANDROPERATOR_LOG_DIR?.trim() || "~/.androperator/logs";
  const resolvedDir = resolve(expandHomePath(configuredDir));
  return { logDir: resolvedDir, logPath: formatLogPath(resolvedDir, date) };
}

/** Retain the attempted destination even after the logger disables its file sink. */
export function getLoggerDestination(logger?: AndroperatorLogger): { logDir: string; logPath: string } {
  const directory = logger === undefined ? undefined : loggerDirectories.get(logger);
  if (directory !== undefined) return resolveLogDestination(directory);
  const logPath = logger?.logPath();
  return logPath === undefined ? resolveLogDestination() : { logDir: dirname(logPath), logPath };
}

/**
 * Create a unified Androperator logger with file and terminal routing.
 *
 * File destination: NDJSON lines at `~/.androperator/logs/androperator-YYYY-MM-DD.log`.
 * Terminal destination: selected events written to stderr in pretty mode, suppressed in JSON mode.
 * Fail-open: if the log directory is unavailable, one stderr warning then file logging disabled.
 */
export function createAndroperatorLogger(options?: CreateAndroperatorLoggerOptions): AndroperatorLogger {
  const { logDir } = resolveLogDestination(options?.logDir);
  const threshold = normalizeLogLevel(options?.logLevel ?? process.env.ANDROPERATOR_LOG_LEVEL);
  const outputFormat = options?.outputFormat ?? "json";
  const state = { warned: false, fileDisabled: false, persistedPath: undefined as string | undefined };

  function shouldLogToFile(level: LogLevel): boolean {
    return (LEVEL_ORDER.get(level) ?? 1) >= (LEVEL_ORDER.get(threshold) ?? 1);
  }

  function writeToFile(event: LogEvent): void {
    if (state.fileDisabled || options?.fileLogging === false) {
      return;
    }
    const path = formatLogPath(logDir);
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
      state.persistedPath = path;
    } catch (error) {
      const message =
        error instanceof Error
          ? `[androperator] WARN: logging disabled after write failure for ${path}: ${error.message}\n`
          : `[androperator] WARN: logging disabled after write failure for ${path}\n`;
      warnOnce(state, message);
      state.fileDisabled = true;
    }
  }

  function writeToTerminal(event: LogEvent): void {
    process.stderr.write(`${event.message}\n`);
  }

  function buildLogger(defaultContext?: Partial<LogEvent>): AndroperatorLogger {
    function emitEvent(event: LogEvent): void {
      // Merge child context into event. Explicit event fields take precedence.
      const merged = mergeDefinedContext(defaultContext, event) as LogEvent;

      const rule = resolveRoutingRule(merged.event, DEFAULT_ROUTING_RULES);
      const alwaysWriteToFile = merged.event === "skills.run.output";

      // File destination
      if (rule.file && (alwaysWriteToFile || shouldLogToFile(merged.level))) {
        writeToFile(merged);
      }

      // Terminal destination
      if (rule.terminal) {
        const isJsonMode = outputFormat === "json";
        if (!isJsonMode || rule.terminalInJsonMode) {
          writeToTerminal(merged);
        }
      }
    }

    const logger: AndroperatorLogger = {
      emit: emitEvent,

      child(childContext: Partial<LogEvent>): AndroperatorLogger {
        const mergedContext = mergeDefinedContext(defaultContext, childContext);
        return buildLogger(mergedContext);
      },

      status(): LoggingStatus {
        if (options?.fileLogging === false) return { status: "disabled" };
        if (state.fileDisabled) return { status: "write_failed", code: "LOGGING_WRITE_FAILED" };
        return { status: "available", ...(state.persistedPath !== undefined ? { logPath: state.persistedPath } : {}) };
      },

      logPath(): string | undefined {
        if (state.fileDisabled || options?.fileLogging === false) {
          return undefined;
        }
        return state.persistedPath;
      },
    };
    loggerDirectories.set(logger, logDir);
    return logger;
  }

  const inheritedSkillRunId = options?.inheritSkillRunId === false
    ? undefined
    : normalizeSkillRunId(process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR]);
  return buildLogger(inheritedSkillRunId !== undefined ? { skillRunId: inheritedSkillRunId } : undefined);
}

export function getLoggingStatus(logger?: AndroperatorLogger): LoggingStatus {
  return logger === undefined ? { status: "disabled" } : logger.status();
}
