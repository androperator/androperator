import type { Execution } from "../../contracts/execution.js";

export function buildSleepExecution(durationMs: number, globalTimeoutMs?: number): Execution {
  // Execution timeout = max(durationMs + 5000, globalTimeout) to prevent envelope killing sleep early
  const executionTimeoutMs = Math.max(durationMs + 5000, globalTimeoutMs ?? 0, 30000);
  const commandId = `sleep-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    commandId,
    taskId: commandId,
    source: "androperator-cli",
    timeoutMs: executionTimeoutMs,
    expectedFormat: "android-ui-automator",
    actions: [
      {
        id: "sleep",
        type: "sleep",
        params: { durationMs },
      },
    ],
  };
}
