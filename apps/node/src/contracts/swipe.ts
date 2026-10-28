import { z } from "zod";

export const swipePointSchema = z.object({
  x: z.number().int().min(0).max(2147483647),
  y: z.number().int().min(0).max(2147483647),
}).strict();

/** Appended to zero-length gesture errors so a first attempt at a long press at one point finds the supported command. */
export const LONG_PRESS_AT_POINT_HINT = "To press and hold at one point, use: androperator click --coordinate <x> <y> --long";
export const SWIPE_ENDPOINTS_MESSAGE = `swipe start and end must differ. ${LONG_PRESS_AT_POINT_HINT}`;

export const swipeParamsSchema = z.object({
  start: swipePointSchema,
  end: swipePointSchema,
  durationMs: z.number().int().min(1).max(10000),
}).strict().refine(value => value.start.x !== value.end.x || value.start.y !== value.end.y, {
  message: SWIPE_ENDPOINTS_MESSAGE,
  path: ["end"],
});

export type SwipeParams = z.infer<typeof swipeParamsSchema>;
