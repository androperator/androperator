import type { RunExecutionResult } from "../domain/executions/runExecution.js";

/**
 * Agent-facing output: machine-readable JSON by default.
 */
export type OutputFormat = "json" | "pretty";

export interface OutputOptions {
  format: OutputFormat;
  verbose?: boolean;
}

export function formatSuccess<T>(data: T, options: OutputOptions): string {
  return options.format === "pretty" ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

export function formatError(error: unknown, options: OutputOptions): string {
  const obj =
    typeof error === "object" && error !== null && "code" in error
      ? error
      : { code: "UNKNOWN", message: String(error) };
  if (options.format === "pretty") {
    return JSON.stringify(obj, null, 2);
  }
  return JSON.stringify(obj);
}

export function formatRunExecutionResultForCli(
  result: RunExecutionResult,
  options: OutputOptions
): string {
  if (result.ok) {
    return formatSuccess(
      {
        envelope: result.envelope,
        deviceId: result.deviceId,
        terminalSource: result.terminalSource,
        isCanonicalTerminal: result.terminalSource === "androperator_result",
      },
      options
    );
  }
  return formatError(result.error, options);
}
