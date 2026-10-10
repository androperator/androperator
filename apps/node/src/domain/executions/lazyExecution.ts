import { persistentCliContext } from "./persistentCliContext.js";
import type { RunExecutionOptions, RunExecutionResult } from "./runExecution.js";

export type { RunExecutionOptions } from "./runExecution.js";

/** Keep direct device transport and capture dependencies out of daemon clients. */
export async function runExecution(
  executionInput: unknown,
  options?: RunExecutionOptions,
): Promise<RunExecutionResult> {
  const execution = await import("./runExecution.js");
  const context = persistentCliContext.getStore();
  return execution.runExecution(executionInput, context ? { ...options, warn: context.warn } : options);
}
