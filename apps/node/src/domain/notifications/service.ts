import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ActionParams, Execution } from "../../contracts/execution.js";
import type { NotificationMediaAction } from "../../contracts/notifications.js";
import { runExecution, type RunExecutionOptions } from "../executions/runExecution.js";
import { validateExecution } from "../executions/validateExecution.js";

export function buildNotificationMediaExecution(type: NotificationMediaAction, params: ActionParams = {}, timeoutMs = type === "observe_media" ? (params.durationMs ?? 0) + 10000 : 30000): Execution {
  return validateExecution({ commandId: `service-${randomUUID()}`, taskId: `service-${type}`, source: "androperator", expectedFormat: "android-ui-automator", timeoutMs, actions: [{ id: "a1", type, params }] });
}
const sessionSchema = z.object({
  mediaSessionId: z.string(), applicationId: z.string(), state: z.string(),
  title: z.string().nullable(), artist: z.string().nullable(), durationMs: z.number().nullable(),
  playerReportSequence: z.number().int().nonnegative().optional(),
  playerReportReceivedElapsedMs: z.number().nullable().optional(),
  bufferedPositionMs: z.number().nullable().optional(),
  playbackType: z.enum(["local", "remote", "unknown"]).optional(),
  reportedPositionMs: z.number().nullable(), estimatedPositionMs: z.number().nullable(),
  positionUpdatedElapsedMs: z.number().nullable(), positionUpdateAgeMs: z.number().nullable(),
  positionUnknownReason: z.string().nullable(), observedElapsedMs: z.number(),
  playbackSpeed: z.number().nullable(), clock: z.literal("android_elapsed_realtime"),
  evidence: z.enum(["player_report", "platform_query"]), supportedControls: z.array(z.string()), textTruncated: z.boolean(),
});
const notificationSchema = z.object({
  key: z.string(), applicationId: z.string(), title: z.string().nullable(), text: z.string().nullable(),
  postTime: z.number(), ongoing: z.boolean(), clearable: z.boolean(), groupKey: z.string().nullable(),
  groupSummary: z.boolean(), actions: z.array(z.object({ actionId: z.string(), title: z.string().nullable(), requiresInput: z.boolean(), requiresAuthentication: z.boolean() })),
  actionsTruncated: z.boolean(), textTruncated: z.boolean(),
  progress: z.object({ value: z.number(), max: z.number(), indeterminate: z.boolean() }).nullable(),
});
const base = { schemaVersion: z.literal(1), observedElapsedMs: z.number(), deviceState: z.object({ screenOn: z.boolean(), deviceLocked: z.boolean(), userUnlocked: z.boolean() }) };
export const notificationMediaPayloadSchema = z.union([
  z.object({ ...base, initialSession: sessionSchema, session: sessionSchema,
    durationMs: z.number().int(), startedElapsedMs: z.number(), endedElapsedMs: z.number(),
    reportedPositionDeltaMs: z.number().nullable(),
    newPlayerReportCount: z.number().int().nonnegative(), truncated: z.boolean(),
    samples: z.array(z.object({ playerReportSequence: z.number().int(),
      playerReportReceivedElapsedMs: z.number().nullable(), state: z.string(),
      reportedPositionMs: z.number().nullable(), positionUpdatedElapsedMs: z.number().nullable(),
      playbackSpeed: z.number().nullable(),
    })).max(64),
  }),
  z.object({ ...base, notificationKey: z.string(), dispatched: z.boolean(), actionId: z.string().optional(), removalObserved: z.boolean().optional(), waitTimeoutMs: z.number().optional() }),
  z.object({ ...base, notifications: z.array(notificationSchema), truncated: z.boolean(), total: z.number() }),
  z.object({ ...base, sessions: z.array(sessionSchema), truncated: z.boolean(), total: z.number() }),
  z.object({ ...base, initialSession: z.never().optional(), session: sessionSchema, dispatched: z.boolean().optional(), waitTimeoutMs: z.number().optional(), targetStateObserved: z.boolean().optional(), requestedPositionMs: z.number().optional(), positionToleranceMs: z.number().optional(), targetPositionObserved: z.boolean().optional() }),
]);
export type MediaStatus = z.infer<typeof sessionSchema>;
export type NotificationSnapshot = z.infer<typeof notificationSchema>;
export function decodeNotificationMediaPayload(payload: string) {
  return notificationMediaPayloadSchema.parse(JSON.parse(payload));
}
export async function runNotificationMedia(type: NotificationMediaAction, params: ActionParams, options: RunExecutionOptions = {}) {
  const response = await runExecution(buildNotificationMediaExecution(type, params, options.timeoutMs), options);
  const step = response.ok ? response.envelope.stepResults.find(step => step.id === "a1") : undefined;
  return { result: response, payload: step?.success && step.data.payload !== undefined ? decodeNotificationMediaPayload(step.data.payload) : undefined };
}
