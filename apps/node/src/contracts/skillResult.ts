import { z } from "zod";
import type { ResultEnvelope, StepResult, StepResultData } from "./result.js";

export const SKILL_RESULT_FRAME_PREFIX = "[Androperator-Skill-Result]";
export const SKILL_RESULT_CONTRACT_VERSION = "1.0.0";
export const SKILL_RESULT_CONTRACT_MAJOR_VERSION = 1;
export const SKILL_RESULT_CONTRACT_MINOR_VERSION = 0;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(version: string): ParsedSemver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
  };
}

export type SkillResultContractVersionValidation =
  | { ok: true; minorAhead: boolean }
  | { ok: false; message: string };

export function validateSupportedSkillResultContractVersion(
  contractVersion: string
): SkillResultContractVersionValidation {
  const semver = parseSemver(contractVersion);
  if (semver === null) {
    return {
      ok: false,
      message: `SkillResult contractVersion must be semver-shaped, got ${contractVersion}`,
    };
  }

  if (semver.major !== SKILL_RESULT_CONTRACT_MAJOR_VERSION) {
    return {
      ok: false,
      message: `Unsupported SkillResult contract major version ${semver.major}; expected ${SKILL_RESULT_CONTRACT_MAJOR_VERSION}`,
    };
  }

  return {
    ok: true,
    minorAhead: semver.minor > SKILL_RESULT_CONTRACT_MINOR_VERSION,
  };
}

export type SkillResultSource =
  | { kind: "script" }
  | { kind: "agent"; agentCli: string };

export type SkillResultStatus = "success" | "failed" | "indeterminate";
export type SkillCheckpointStatus = "ok" | "failed" | "skipped";
export type SkillRuntimeState = "healthy" | "poisoned" | "unavailable" | "unknown";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type SkillCheckpointEvidence =
  | { kind: "text"; text: string }
  | { kind: "json"; value: JsonValue }
  | { kind: "result_envelope_ref"; execEnvelopeIndex: number; stepResultId?: string };

export interface SkillCheckpoint {
  id: string;
  status: SkillCheckpointStatus;
  observedAt?: string;
  evidence?: SkillCheckpointEvidence;
  note?: string;
}

export interface SkillTerminalVerification {
  status: "verified" | "failed" | "not_run";
  expected?: SkillCheckpointEvidence | null;
  observed?: SkillCheckpointEvidence | null;
  note?: string | null;
}

export interface SkillDiagnostics {
  runtimeState?: SkillRuntimeState;
  warnings?: string[];
  hints?: string[];
  [key: string]: JsonValue | string[] | undefined;
}

export interface SkillResult {
  contractVersion: string;
  skillId: string;
  source: SkillResultSource;
  goal?: JsonObject;
  inputs?: JsonObject;
  /** Domain answer. Use `null` when the skill cannot report a truthful value. */
  result: SkillCheckpointEvidence | null;
  status: SkillResultStatus;
  checkpoints: SkillCheckpoint[];
  terminalVerification?: SkillTerminalVerification | null;
  execEnvelopes?: ResultEnvelope[];
  diagnostics?: SkillDiagnostics;
}

export const skillResultSourceSchema: z.ZodType<SkillResultSource> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("script"),
  }),
  z.object({
    kind: z.literal("agent"),
    agentCli: z.string().min(1),
  }),
]);

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)])
);

const extractionDiagnosticsSchema = z.object({
  receivedBytes: z.number().int().nonnegative().safe(),
  sourceValidationCategory: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  line: z.number().int().nonnegative().safe().optional(),
  column: z.number().int().nonnegative().safe().optional(),
  position: z.number().int().nonnegative().safe().optional(),
  closingHierarchySeen: z.boolean().optional(),
  terminationReason: z.enum(["next_snapshot", "same_tag_event", "closing_hierarchy", "end_of_capture"]).optional(),
});

function normalizeEnvelopeStepResultData(raw: unknown): StepResultData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const normalized: StepResultData = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "extractionDiagnostics") {
      const diagnostic = extractionDiagnosticsSchema.safeParse(value);
      if (diagnostic.success) normalized.extractionDiagnostics = diagnostic.data;
      continue;
    }
    normalized[key] = typeof value === "string" ? value : String(value);
  }
  return normalized;
}

const resultEnvelopeStepSchema: z.ZodType<StepResult, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  actionType: z.string(),
  success: z.boolean(),
  data: z.unknown().transform((raw) => normalizeEnvelopeStepResultData(raw)),
});

const resultEnvelopeSchema: z.ZodType<ResultEnvelope, z.ZodTypeDef, unknown> = z.object({
  commandId: z.string(),
  taskId: z.string(),
  status: z.enum(["success", "failed"]),
  stepResults: z.array(resultEnvelopeStepSchema),
  error: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  hint: z.string().optional(),
  diagnostics: z.object({
    logging: z.object({
      status: z.enum(["available", "disabled", "write_failed"]),
      code: z.literal("LOGGING_WRITE_FAILED").optional(),
      logPath: z.string().optional(),
    }),
  }).optional(),
  failureEvidence: z.object({
    phase: z.enum(["readiness", "dispatch", "result_wait", "post_processing"]),
    dispatchState: z.enum(["not_dispatched", "dispatched", "unknown"]),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    commandId: z.string().optional(),
    taskId: z.string().optional(),
    earlierEffects: z.array(z.object({ actionId: z.string(), effect: z.literal("force_stop") })).optional(),
    probeCommandId: z.string().optional(),
    probeTaskId: z.string().optional(),
    probeDispatchState: z.enum(["not_dispatched", "dispatched", "unknown"]).optional(),
    probeStartedAt: z.string().optional(),
    probeCompletedAt: z.string().optional(),
    dispatchStartedAt: z.string().optional(),
    logPath: z.string().optional(),
  }).passthrough().optional(),
});

const skillCheckpointEvidenceSchema: z.ZodType<SkillCheckpointEvidence> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("json"),
    value: jsonValueSchema,
  }),
  z.object({
    kind: z.literal("result_envelope_ref"),
    execEnvelopeIndex: z.number().int().nonnegative(),
    stepResultId: z.string().optional(),
  }),
]);

const skillCheckpointSchema: z.ZodType<SkillCheckpoint> = z.object({
  id: z.string().min(1),
  status: z.enum(["ok", "failed", "skipped"]),
  observedAt: z.string().optional(),
  evidence: skillCheckpointEvidenceSchema.optional(),
  note: z.string().optional(),
});

const skillTerminalVerificationSchema: z.ZodType<SkillTerminalVerification> = z.object({
  status: z.enum(["verified", "failed", "not_run"]),
  expected: skillCheckpointEvidenceSchema.nullable().optional(),
  observed: skillCheckpointEvidenceSchema.nullable().optional(),
  note: z.string().nullable().optional(),
});

export const skillDiagnosticsSchema: z.ZodType<SkillDiagnostics> = z.object({
  runtimeState: z.enum(["healthy", "poisoned", "unavailable", "unknown"]).optional(),
  warnings: z.array(z.string()).optional(),
  hints: z.array(z.string()).optional(),
}).catchall(jsonValueSchema);

export const emittedSkillResultSchema = z.object({
  contractVersion: z.string(),
  skillId: z.string().min(1),
  goal: z.record(jsonValueSchema).optional(),
  inputs: z.record(jsonValueSchema).optional(),
  result: skillCheckpointEvidenceSchema.nullable(),
  status: z.enum(["success", "failed", "indeterminate"]),
  checkpoints: z.array(skillCheckpointSchema),
  terminalVerification: skillTerminalVerificationSchema.nullable().optional(),
  execEnvelopes: z.array(resultEnvelopeSchema).optional(),
  diagnostics: skillDiagnosticsSchema.optional(),
});

export type EmittedSkillResult = z.infer<typeof emittedSkillResultSchema>;

export const skillResultSchema = emittedSkillResultSchema.extend({
  source: skillResultSourceSchema,
});
