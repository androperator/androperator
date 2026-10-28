import { z } from "zod";
import { LONG_PRESS_AT_POINT_HINT, swipePointSchema } from "./swipe.js";

const dragFieldsSchema = z.object({
  start: swipePointSchema,
  end: swipePointSchema,
  holdDurationMs: z.number().int().min(1).max(10000),
  moveDurationMs: z.number().int().min(1).max(10000),
  waypoints: z.array(swipePointSchema.extend({
    durationMs: z.number().int().min(1).max(10000),
    holdDurationMs: z.number().int().min(0).max(10000).optional(),
  }).strict()).max(8).optional(),
}).strict();

export function isValidDragPath(value: z.infer<typeof dragFieldsSchema>): boolean {
  const waypointDuration = (value.waypoints ?? []).reduce(
    (total, point) => total + point.durationMs + (point.holdDurationMs ?? 0), 0);
  const points = [value.start, ...(value.waypoints ?? []), value.end];
  // A path may end where it started (out and back), but it must go somewhere.
  return points.some(point => point.x !== value.start.x || point.y !== value.start.y) &&
    value.holdDurationMs + value.moveDurationMs + waypointDuration <= 60000;
}

export const DRAG_PATH_MESSAGE = `drag path must move (start, waypoints and end are not all the same point) and total duration must not exceed 60000ms. ${LONG_PRESS_AT_POINT_HINT}`;

export const dragParamsSchema = dragFieldsSchema.refine(isValidDragPath, {
  message: DRAG_PATH_MESSAGE,
});

export type DragParams = z.infer<typeof dragParamsSchema>;
