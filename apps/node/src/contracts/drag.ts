import { z } from "zod";
import { swipePointSchema } from "./swipe.js";

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
  return (value.start.x !== value.end.x || value.start.y !== value.end.y) &&
    value.holdDurationMs + value.moveDurationMs + waypointDuration <= 60000;
}

export const dragParamsSchema = dragFieldsSchema.refine(isValidDragPath, {
  message: "drag start and end must differ and total duration must not exceed 60000ms",
});

export type DragParams = z.infer<typeof dragParamsSchema>;
