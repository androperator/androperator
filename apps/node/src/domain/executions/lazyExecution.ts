import type { RunExecutionOptions, RunExecutionResult } from "./runExecution.js";

export type { RunExecutionOptions } from "./runExecution.js";

/** Keep direct device transport and capture dependencies out of daemon clients. */
export async function runExecution(
  executionInput: unknown,
  options?: RunExecutionOptions,
): Promise<RunExecutionResult> {
  const execution = await import("./runExecution.js");
  return execution.runExecution(executionInput, options);
}
