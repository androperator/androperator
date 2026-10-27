import { z } from "zod";
import { swipePointSchema } from "./swipe.js";

export const dragParamsSchema = z.object({
  start: swipePointSchema,
  end: swipePointSchema,
  holdDurationMs: z.number().int().min(1).max(10000),
  moveDurationMs: z.number().int().min(1).max(10000),
  waypoints: z.array(z.object({ x: z.number().int().min(0).max(2147483647), y: z.number().int().min(0).max(2147483647), durationMs: z.number().int().min(1).max(10000), holdDurationMs: z.number().int().min(0).max(10000).optional() }).strict()).max(8).optional(),
}).strict().refine(value => (value.start.x !== value.end.x || value.start.y !== value.end.y) && value.holdDurationMs + value.moveDurationMs + (value.waypoints ?? []).reduce((n, p) => n + p.durationMs + (p.holdDurationMs ?? 0), 0) <= 60000, {
  message: "drag start and end must differ and total duration must not exceed 60000ms",
  path: ["end"],
});

export type DragParams = z.infer<typeof dragParamsSchema>;
