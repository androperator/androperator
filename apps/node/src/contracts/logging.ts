/**
 * Unified logging contract for Androperator.
 *
 * All event routing, level thresholds, and schema definitions live here.
 * The routing table and naming table are authoritative - do not re-derive.
 */

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LEVEL_ORDER: ReadonlyMap<LogLevel, number> = new Map([
  ["debug", 0],
  ["info", 1],
  ["warn", 2],
  ["error", 3],
]);

// ---------------------------------------------------------------------------
// LogEvent schema
// ---------------------------------------------------------------------------

export interface LogEvent {
  ts: string;
  level: LogLevel;
  event: string;
  message: string;
  commandId?: string;
  taskId?: string;
  deviceId?: string;
  runId?: string;
  logPath?: string;
  status?: string;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// AndroperatorLogger interface
// ---------------------------------------------------------------------------

export interface LoggingStatus {
  status: "available" | "disabled" | "write_failed";
  code?: "LOGGING_WRITE_FAILED";
  logPath?: string;
}

export interface AndroperatorLogger {
  status(): LoggingStatus;
  emit(event: LogEvent): void;
  child(defaultContext: Partial<LogEvent>): AndroperatorLogger;
  /** Last successfully persisted file while the sink is enabled, not a configured destination. */
  logPath(): string | undefined;
}

export { ANDROPERATOR_RUN_ID_ENV_VAR } from "./loggingEnv.cjs";
export const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
export const RUN_ID_MAX_LENGTH = 240;

export function normalizeRunId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > RUN_ID_MAX_LENGTH) {
    return undefined;
  }
  return RUN_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Routing rules
// ---------------------------------------------------------------------------

/**
 * Terminal routing intentionally ignores the log-level threshold.
 * Only the file sink applies the level gate. A debug-level cli.banner
 * appears on stderr in pretty mode regardless of --log-level because
 * terminal output respects output format, not log level.
 */
export interface RoutingRule {
  /** Event name prefix to match (first-match-wins). Use "*" for default. */
  prefix: string;
  /** Whether to write to the NDJSON log file. */
  file: boolean;
  /** Whether to write to the terminal (stderr in pretty mode). */
  terminal: boolean;
  /** If true, terminal output is suppressed in JSON output mode even when terminal is true. */
  terminalInJsonMode: boolean;
}

/**
 * Default routing rules implementing the event routing table from plan.md.
 * First-match-wins prefix lookup. Do not re-derive - use verbatim.
 *
 * | Event category                | File | Terminal | In JSON mode |
 * |-------------------------------|------|----------|--------------|
 * | cli.                          | Yes  | Yes      | No           |
 * | doctor.                       | Yes  | No       | No           |
 * | serve.                        | Yes  | No       | No           |
 * | * (default)                   | Yes  | No       | No           |
 */
export const DEFAULT_ROUTING_RULES: readonly RoutingRule[] = [
  { prefix: "cli.", file: true, terminal: true, terminalInJsonMode: false },
  { prefix: "doctor.", file: true, terminal: false, terminalInJsonMode: false },
  { prefix: "serve.", file: true, terminal: false, terminalInJsonMode: false },
  { prefix: "*", file: true, terminal: false, terminalInJsonMode: false },
];

/**
 * Resolve the routing rule for a given event name using first-match-wins prefix lookup.
 */
export function resolveRoutingRule(eventName: string, rules: readonly RoutingRule[] = DEFAULT_ROUTING_RULES): RoutingRule {
  for (const rule of rules) {
    if (rule.prefix === "*" || eventName.startsWith(rule.prefix)) {
      return rule;
    }
  }
  // Should never happen with a "*" default, but fail safe
  return { prefix: "*", file: true, terminal: false, terminalInJsonMode: false };
}

// ---------------------------------------------------------------------------
// Log path utilities (shared between logger and logs command)
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expand ~ to home directory.
 */
export function expandHomePath(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }
  if (pathValue.startsWith("~/")) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

/**
 * Format a date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format the daily log file path.
 */
export function formatLogPath(logDir: string, date = new Date()): string {
  return join(logDir, `androperator-${formatDate(date)}.log`);
}
