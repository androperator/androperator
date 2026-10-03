import type { Execution } from "../../contracts/execution.js";

export function buildCloseAppExecution(applicationId: string, timeoutMs = 30000): Execution {
  const commandId = `close-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    commandId,
    taskId: commandId,
    source: "androperator-cli",
    timeoutMs,
    expectedFormat: "android-ui-automator",
    actions: [
      {
        id: "close",
        type: "close_app",
        params: { applicationId },
      },
    ],
  };
}
