import type { Execution } from "../../contracts/execution.js";
import type { SwipeParams } from "../../contracts/swipe.js";

export function buildSwipeExecution(params: SwipeParams, timeoutMs = 30000): Execution {
  const commandId = `swipe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    commandId,
    taskId: commandId,
    source: "androperator-action",
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions: [{ id: "swipe", type: "swipe", params }],
    mode: "direct",
  };
}
