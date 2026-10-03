import type { ActionParams, Execution } from "../../contracts/execution.js";

export function buildToastExecution(
  operation: "show" | "cancel",
  params?: Pick<ActionParams, "text" | "duration">,
  timeoutMs = 30000,
): Execution {
  return {
    commandId: `toast-${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    taskId: `cli-toast-${operation}`,
    source: "androperator-cli",
    timeoutMs,
    expectedFormat: "android-ui-automator",
    actions: [{ id: "a1", type: operation === "show" ? "show_toast" : "cancel_toast",
      ...(params !== undefined ? { params } : {}),
    }],
  };
}
