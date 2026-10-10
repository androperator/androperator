import type { Execution } from "../../contracts/execution.js";
import { runExecution } from "../executions/lazyExecution.js";
import type { RunExecutionOptions } from "../executions/runExecution.js";

/**
 * Build execution that runs a single take_screenshot and run it.
 */
export function buildScreenshotExecution(options?: { timeoutMs?: number; path?: string }): Execution {
  const commandId = `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    commandId,
    taskId: commandId,
    source: "androperator-observe",
    expectedFormat: "android-ui-automator",
    timeoutMs: options?.timeoutMs ?? 30_000,
    actions: [
      {
        id: "snap",
        type: "take_screenshot",
        params: options?.path !== undefined ? { path: options.path } : {},
      },
    ],
  };
}

export async function observeScreenshot(
  options?: RunExecutionOptions & { path?: string }
) {
  const execution = buildScreenshotExecution({
    timeoutMs: options?.timeoutMs,
    path: options?.path,
  });
  return runExecution(execution, options);
}
