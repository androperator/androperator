import type { ActionParams, Execution } from "../../contracts/execution.js";

export function buildOnScreenLogExecution(
  operation: "set" | "clear",
  params?: ActionParams,
  timeoutMs = 30000,
): Execution {
  return {
    commandId: `on-screen-log-${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    taskId: `cli-on-screen-log-${operation}`,
    source: "androperator-cli",
    timeoutMs,
    expectedFormat: "android-ui-automator",
    actions: [{
      id: "a1",
      type: operation === "set" ? "set_on_screen_log" : "clear_on_screen_log",
      ...(params !== undefined ? { params } : {}),
    }],
  };
}
