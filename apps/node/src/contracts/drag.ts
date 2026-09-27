import { z } from "zod";
import { swipePointSchema } from "./swipe.js";

export const dragParamsSchema = z.object({
  start: swipePointSchema,
  end: swipePointSchema,
  holdDurationMs: z.number().int().min(1).max(10000),
  moveDurationMs: z.number().int().min(1).max(10000),
}).strict().refine(value => value.start.x !== value.end.x || value.start.y !== value.end.y, {
  message: "drag start and end must differ",
  path: ["end"],
});

export type DragParams = z.infer<typeof dragParamsSchema>;
