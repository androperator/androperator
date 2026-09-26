import { z } from "zod";

/** Geometry of the decoded original PNG, not a viewer's resized preview. */
export const screenshotMetadataSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  coordinateSpace: z.literal("screenshot_pixels"),
  origin: z.literal("top_left"),
}).strict();
export type ScreenshotMetadata = z.infer<typeof screenshotMetadataSchema>;
