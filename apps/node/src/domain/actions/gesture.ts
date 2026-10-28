import type { DragParams } from "../../contracts/drag.js";

export interface GesturePoint { x: number; y: number }

/** Start plus at most eight waypoints plus the end; a final hold uses one waypoint slot for the last point. */
export const MAX_GESTURE_POINTS = 10;
const MAX_LEG_MS = 10000;

/** Parse "x,y x,y ..." into at least two non-negative integer points. */
export function parseGesturePath(text: string): GesturePoint[] {
  const tokens = text.trim().split(/\s+/).filter(token => token.length > 0);
  const points = tokens.map(token => {
    const match = /^(\d+),(\d+)$/.exec(token);
    if (match === null) throw new Error(`gesture point "${token}" must be x,y with non-negative integers`);
    return { x: Number(match[1]), y: Number(match[2]) };
  });
  if (points.length < 2) throw new Error("gesture --path needs at least two points, for example \"3,1500 400,1500\"");
  if (points.length > MAX_GESTURE_POINTS) throw new Error(`gesture --path accepts at most ${MAX_GESTURE_POINTS} points`);
  return points;
}

/**
 * Map one finger moving through `points` to a drag: a 1 ms initial hold, one leg per segment sharing
 * `durationMs` evenly, and an optional hold at the last point before release.
 */
export function buildPathGestureParams(points: GesturePoint[], durationMs: number, finalHoldMs?: number): DragParams {
  const legs = points.length - 1;
  if (legs < 1) throw new Error("gesture needs at least two points");
  if (points.every(point => point.x === points[0].x && point.y === points[0].y)) throw new Error("gesture path must move: its points are all the same");
  if (!Number.isInteger(durationMs) || durationMs < legs || durationMs > MAX_LEG_MS * legs) {
    throw new Error(`gesture --duration-ms must be an integer from ${legs} to ${MAX_LEG_MS * legs} for ${legs} segment(s)`);
  }
  if (finalHoldMs !== undefined && (!Number.isInteger(finalHoldMs) || finalHoldMs < 1 || finalHoldMs > MAX_LEG_MS)) {
    throw new Error(`gesture --hold-ms must be an integer from 1 to ${MAX_LEG_MS}`);
  }
  const base = Math.floor(durationMs / legs);
  const extra = durationMs - base * legs;
  const legMs = Array.from({ length: legs }, (_, index) => base + (index < extra ? 1 : 0));
  if (legMs.some(ms => ms > MAX_LEG_MS)) throw new Error(`each gesture segment must take at most ${MAX_LEG_MS} ms`);
  const last = points[legs];
  const middle = points.slice(1, legs).map((point, index) => ({ ...point, durationMs: legMs[index] }));
  const waypoints = finalHoldMs === undefined ? middle : [...middle, { ...last, durationMs: legMs[legs - 1] }];
  if (waypoints.length > 8) throw new Error(`gesture path is too long: at most 8 intermediate points (the last point counts when --hold-ms is set)`);
  return {
    start: points[0], end: last, holdDurationMs: 1,
    moveDurationMs: finalHoldMs ?? legMs[legs - 1],
    ...(waypoints.length > 0 ? { waypoints } : {}),
  };
}
