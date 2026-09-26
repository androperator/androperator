import { z } from "zod";
import type { Logger } from "../../adapters/logger.js";
import { captureEvidence, validateEvidenceCaptureOptions, type EvidenceCaptureDependencies } from "../../domain/evidence/capture.js";
import { buildMcpErrorResult } from "../errors.js";
import { createSessionDefaults, type SessionDefaults } from "../session.js";
import { buildCommonExecutionSchema, buildValidationResult, executionToolOptionsSchema, mergeWithSessionDefaults, parseToolArguments } from "./common.js";
import type { McpToolDefinition } from "./index.js";
import { startVideo, stopVideo, videoStatus, managedVideoSession, type VideoDependencies } from "../../domain/evidence/video.js";
const captureSchema = executionToolOptionsSchema.extend({
  label: z.string().max(2048).optional(), context: z.record(z.unknown()).optional(),
}).strict();
export function getEvidenceMcpTools(logger?: Logger, session: SessionDefaults = createSessionDefaults(), dependencies?: EvidenceCaptureDependencies): McpToolDefinition[] {
  return [{
    name: "evidence_capture",
    description: "Capture a local screenshot and raw hierarchy bundle with correlated metadata and explicit partial failures. Complete screenshot artifacts include original PNG pixel dimensions and a top-left coordinate origin; resized preview coordinates must be mapped back before use.",
    inputSchema: buildCommonExecutionSchema({ label: { type: "string", maxLength: 2048 }, context: { type: "object" } }),
    handler: async args => {
      const options = mergeWithSessionDefaults(parseToolArguments(captureSchema, args), session);
      try { validateEvidenceCaptureOptions(options); }
      catch (error) { return buildValidationResult((error as { message: string }).message); }
      try {
        const result = await captureEvidence({ ...options, logger }, dependencies);
        // Only this domain-created manifest path is exposed, never caller paths or capture contents.
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result }, ...(result.ok ? {} : { isError: true }) };
      } catch (error) { return buildMcpErrorResult(error); }
    },
  }];
}



export function getVideoMcpTools(session: SessionDefaults = createSessionDefaults(), dependencies: VideoDependencies = {}): McpToolDefinition[] {
  const startSchema = z.object({ deviceId: z.string().trim().min(1).optional(), operatorPackage: z.string().trim().min(1).optional(),
    durationSeconds: z.number().int().min(1).max(180), size: z.string().optional(), label: z.string().max(2048).optional(), context: z.record(z.unknown()).optional() }).strict();
  const sessionSchema = z.object({ sessionId: z.string().uuid() }).strict();
  const result = (value: Awaited<ReturnType<typeof videoStatus>>) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { ...value }, ...(value.ok ? {} : { isError: true }) });
  return [{ name: "evidence_video_start", description: "Start a bounded screen recording in a managed bundle; recording is startup confirmation, not verified media. Requires separately installed scrcpy 3.0+, ffprobe, and ffmpeg 6.1+ with libx264 and passthrough/demux timing support on the server PATH. Unmet dependencies return HOST_DEPENDENCY_MISSING with dependency details and recovery instructions.",
    inputSchema: { type: "object", additionalProperties: false, required: ["durationSeconds"], properties: {
      deviceId: { type: "string" }, operatorPackage: { type: "string" }, durationSeconds: { type: "integer", minimum: 1, maximum: 180 },
      size: { type: "string" }, label: { type: "string", maxLength: 2048 }, context: { type: "object" } } },
    handler: async args => {
      const options = parseToolArguments(startSchema, args);
      try { return result(await startVideo({ ...options, deviceId: options.deviceId ?? session.deviceId, operatorPackage: options.operatorPackage ?? session.operatorPackage }, dependencies)); }
      catch (error) { return buildMcpErrorResult(error); }
    },
  }, ...(["status", "stop"] as const).map(operation => ({ name: `evidence_video_${operation}`,
    description: operation === "status" ? "Read a managed video session and detect unavailable ownership." : "Request owned video finalization and wait up to 15 seconds; pending is not success.",
    inputSchema: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string" } } },
    handler: async (args: Record<string, unknown>) => {
      const options = parseToolArguments(sessionSchema, args);
      try { return result(await (operation === "status" ? videoStatus : stopVideo)({ session: await managedVideoSession(options.sessionId, dependencies) })); }
      catch (error) { return buildMcpErrorResult(error); }
    },
  }))];
}
