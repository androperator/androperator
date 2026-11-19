import { z } from "zod";
import type { ExecutionAction } from "./execution.js";

export const notificationMediaActions = [
  "list_notifications", "list_media_sessions", "get_media_status", "observe_media", "media_pause", "media_play", "dismiss_notification", "invoke_notification_action", "media_seek",
] as const;
export type NotificationMediaAction = typeof notificationMediaActions[number];
const observationActions = new Set<string>(notificationMediaActions.slice(0, 4));
export function isBackgroundObservation(actions: readonly ExecutionAction[]): boolean {
  return actions.length > 0 && actions.every(action => observationActions.has(action.type));
}
// Call only after validating the whole execution; notification mutations still require UI readiness.
const backgroundServiceActions = new Set([...observationActions, "set_wallpaper", "media_pause", "media_play", "media_seek"]);
export function isBackgroundServiceExecution(actions: readonly ExecutionAction[]): boolean {
  return actions.length > 0 && actions.every(action => backgroundServiceActions.has(action.type));
}
const observeUsage = "Use media observe --session <id> --duration-ms 10000 (1-30000 ms), or replace --session with --app <package>.";
const target = {
  applicationId: z.string().min(1).max(512).refine(value => value.trim().length > 0).optional(),
  mediaSessionId: z.string().min(1).max(128).refine(value => value.trim().length > 0).optional(),
};
const listing = z.object({
  applicationId: target.applicationId,
  limit: z.number().int().min(1).max(100).optional(),
  maxTextChars: z.number().int().min(1).max(1024).optional(),
}).strict();
const selected = z.object(target).strict().refine(
  value => (value.applicationId !== undefined) !== (value.mediaSessionId !== undefined),
  "Provide exactly one of applicationId or mediaSessionId; discover sessions with media list.",
);
const control = z.object({ ...target, waitTimeoutMs: z.number().int().min(0).max(30000).optional() }).strict().refine(
  value => (value.applicationId !== undefined) !== (value.mediaSessionId !== undefined),
  "Provide exactly one of applicationId or mediaSessionId; discover sessions with media list.",
);
const notificationKey = z.string().min(1).max(4096).refine(value => value.trim().length > 0);
const dismissal = z.object({ notificationKey, waitTimeoutMs: z.number().int().min(0).max(30000).optional() }).strict();
const notificationAction = z.object({ notificationKey, actionId: z.string().min(1).max(128).refine(value => value.trim().length > 0) }).strict();
const seek = z.object({
  ...target,
  positionMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  waitTimeoutMs: z.number().int().min(0).max(30000).optional(),
  positionToleranceMs: z.number().int().min(0).max(60000).optional(),
}).strict().refine(value => (value.applicationId !== undefined) !== (value.mediaSessionId !== undefined),
  "Provide exactly one of applicationId or mediaSessionId.");
const observation = z.object({
  ...target,
  durationMs: z.number({ required_error: observeUsage, invalid_type_error: observeUsage })
    .int(observeUsage).min(1, observeUsage).max(30000, observeUsage),
}).strict().refine(
  value => (value.applicationId !== undefined) !== (value.mediaSessionId !== undefined),
  `Provide exactly one of applicationId or mediaSessionId. ${observeUsage}`,
);
export function notificationMediaParamsSchema(type: string): z.ZodTypeAny | undefined {
  if (type === "list_notifications" || type === "list_media_sessions") return listing.optional();
  if (type === "dismiss_notification") return dismissal;
  if (type === "invoke_notification_action") return notificationAction;
  if (type === "media_seek") return seek;
  if (type === "observe_media") return observation;
  if (type === "get_media_status") return selected;
  if (type === "media_pause" || type === "media_play") return control;
  return undefined;
}
