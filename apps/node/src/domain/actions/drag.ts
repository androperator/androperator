import type { Execution } from "../../contracts/execution.js";
import type { DragParams } from "../../contracts/drag.js";

const DEFAULT_DRAG_TIMEOUT_MS = 30000;
const DRAG_OVERHEAD_MS = 15000;

/** Time the gesture itself needs: the initial hold, every waypoint movement and hover, and the final leg. */
export function plannedDragDurationMs(params: DragParams): number {
  return params.holdDurationMs + params.moveDurationMs +
    (params.waypoints ?? []).reduce((total, point) => total + point.durationMs + (point.holdDurationMs ?? 0), 0);
}

/** The execution must outlive the gesture plus dispatch and result overhead, and never be shorter than the usual default. */
export function defaultDragTimeoutMs(params: DragParams): number {
  return Math.max(DEFAULT_DRAG_TIMEOUT_MS, plannedDragDurationMs(params) + DRAG_OVERHEAD_MS);
}

export function buildDragExecution(params: DragParams, timeoutMs = defaultDragTimeoutMs(params)): Execution {
  const commandId = `drag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    commandId,
    taskId: commandId,
    source: "androperator-action",
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions: [{ id: "drag", type: "drag", params }],
    mode: "direct",
  };
}
