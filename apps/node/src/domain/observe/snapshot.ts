import type { Execution } from "../../contracts/execution.js";
import { runExecution } from "../executions/runExecution.js";
import type { RunExecutionOptions } from "../executions/runExecution.js";

/**
 * Build execution that runs a single snapshot and run it.
 */
export function buildSnapshotExecution(options?: { timeoutMs?: number }): Execution {
  const commandId = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    commandId,
    taskId: commandId,
    source: "androperator-observe",
    expectedFormat: "android-ui-automator",
    timeoutMs: options?.timeoutMs ?? 30_000,
    actions: [
      {
        id: "snap",
        type: "snapshot",
      },
    ],
    mode: "direct",
  };
}

export async function observeSnapshot(runOptions?: RunExecutionOptions) {
  const execution = buildSnapshotExecution();
  return runExecution(execution, runOptions);
}
