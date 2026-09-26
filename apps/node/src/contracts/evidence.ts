import { z } from "zod";
import { screenshotMetadataSchema } from "./screenshot.js";

export const evidenceErrorSchema = z.object({
  code: z.string(), stage: z.string(), message: z.string(), component: z.string().nullable(),
}).strict();
export type EvidenceError = z.infer<typeof evidenceErrorSchema>;
const nullableString = z.string().nullable();
const nullableNumber = z.number().finite().nullable();
const relativePath = z.string().refine(value => value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..") && !value.includes(":"));
export const evidenceArtifactSchema = z.object({
  kind: z.enum(["screenshot", "hierarchy", "capture_envelopes", "video", "encoder_stderr"]),
  path: relativePath.nullable(), mimeType: z.string(), status: z.enum(["complete", "partial", "failed"]),
  bytes: z.number().int().nonnegative().nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(), durationMs: z.number().nonnegative(),
  image: screenshotMetadataSchema.optional(),
  commandId: z.string().optional(), taskId: z.string().optional(), error: evidenceErrorSchema.optional(),
}).strict().superRefine((artifact, context) => {
  if (artifact.image !== undefined && (artifact.kind !== "screenshot" || artifact.status !== "complete")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Image geometry requires a complete screenshot" });
  }
  const hasFile = artifact.path !== null && artifact.bytes !== null && (artifact.bytes > 0 || artifact.kind === "encoder_stderr") && artifact.sha256 !== null;
  if (artifact.status === "failed") {
    if (artifact.path !== null || artifact.bytes !== null || artifact.sha256 !== null || artifact.error === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Failed artifacts require null file fields and an error" });
    }
  } else if (!hasFile || (artifact.status === "partial" && artifact.error === undefined) || (artifact.status === "complete" && artifact.error !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Complete/partial artifacts require verified file fields and matching error state" });
  }
});
export type EvidenceArtifact = z.infer<typeof evidenceArtifactSchema>;
export const evidenceDeviceSchema = z.object({
  serial: z.string(), operatorPackage: z.string(), cliVersion: nullableString, operatorVersion: nullableString,
  apiLevel: nullableNumber, androidVersion: nullableString, manufacturer: nullableString, model: nullableString,
  deviceType: z.enum(["emulator", "physical", "unknown"]),
  deviceTypeProperties: z.object({ "ro.kernel.qemu": nullableString, "ro.boot.qemu": nullableString }).strict(),
  display: z.object({ width: nullableNumber, height: nullableNumber, density: nullableNumber, rotation: nullableNumber }).strict(),
}).strict();
export type EvidenceDevice = z.infer<typeof evidenceDeviceSchema>;
export const evidenceManifestSchema = z.object({
  schemaVersion: z.literal(1), evidenceId: z.string(), label: nullableString,
  context: z.record(z.unknown()), device: evidenceDeviceSchema,
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  video: z.object({ requestedDurationSeconds: z.number().int().min(1).max(180), hostDurationMs: z.number().nonnegative(),
    mediaDurationMs: nullableNumber, requestedSize: z.string(), actualSize: nullableString, codec: nullableString, stopReason: nullableString }).strict().optional(),
  status: z.enum(["starting", "recording", "finalizing", "complete", "partial", "failed"]),
  artifacts: z.array(evidenceArtifactSchema), errors: z.array(evidenceErrorSchema),
}).strict().superRefine((manifest, context) => {
  const terminal = ["complete", "partial", "failed"].includes(manifest.status);
  if (terminal !== (manifest.finishedAt !== null) || (!terminal && manifest.video === undefined))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Only active video manifests have a null finishedAt" });
});
export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>;
export interface EvidenceCaptureResult {
  ok: boolean;
  status: "complete" | "partial" | "failed";
  manifestPath: string;
  evidenceId: string;
  code?: "EVIDENCE_CAPTURE_FAILED";
}
