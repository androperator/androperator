import type { Execution } from "../../contracts/execution.js";
import type { DragParams } from "../../contracts/drag.js";

export function buildDragExecution(params: DragParams, timeoutMs = 30000): Execution {
  const commandId = `drag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    commandId,
    taskId: commandId,
    source: "clawperator-action",
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions: [{ id: "drag", type: "drag", params }],
    mode: "direct",
  };
}
