import type { Execution } from "../../contracts/execution.js";
import { runExecution } from "../executions/lazyExecution.js";
import type { RunExecutionOptions } from "../executions/runExecution.js";

/**
 * Build execution that runs a single take_screenshot and run it.
 */
export function buildScreenshotExecution(options?: { timeoutMs?: number; path?: string; scale?: 100 | 50 | 25 }): Execution {
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
        params: { ...(options?.path !== undefined ? { path: options.path } : {}), ...(options?.scale !== undefined ? { scale: options.scale } : {}) },
      },
    ],
  };
}

export async function observeScreenshot(
  options?: RunExecutionOptions & { path?: string; scale?: 100 | 50 | 25 }
) {
  const execution = buildScreenshotExecution({
    timeoutMs: options?.timeoutMs,
    path: options?.path,
    scale: options?.scale,
  });
  return runExecution(execution, options);
}
