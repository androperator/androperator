import { presentSnapshot, validateSnapshotPresentationOptions } from "../../domain/observe/compactSnapshot.js";
import { z } from "zod";
import type { Logger } from "../../adapters/logger.js";
import type { ExecutionAction } from "../../contracts/execution.js";
import { normalizeExecutionInput } from "../../contracts/inputAliases.js";
import { LIMITS } from "../../contracts/limits.js";
import type { ResultEnvelope, StepResult } from "../../contracts/result.js";
import { listDevices } from "../../domain/devices/listDevices.js";
import { buildSnapshotExecution } from "../../domain/observe/snapshot.js";
import { buildMcpErrorResult, type McpToolResult } from "../errors.js";
import { extractStepDataValue } from "../results.js";
import { createSessionDefaults, type SessionDefaults } from "../session.js";
import type { McpToolDefinition } from "./index.js";
import {
  applyMcpExecutionMetadata,
  buildCommonExecutionSchema,
  buildValidationResult,
  buildExecutionSuccessPayload,
  buildSuccessResult,
  createRuntimeConfig,
  executionToolOptionsSchema,
  mergeWithSessionDefaults,
  parseToolArguments,
  runExecutionTool,
} from "./common.js";

const emptyArgsSchema = z.object({}).strict();

const snapshotArgsSchema = executionToolOptionsSchema.extend({
  compact: z.boolean().optional(),
  maxNodes: z.number().int().min(1).max(1000).optional(),
  maxTextChars: z.number().int().min(1).max(4096).optional(),
  saveRaw: z.boolean().optional(),
  maxChars: z.number().int().positive().optional(),
}).strict();

const executionActionSchema = z.object({
  id: z.string().trim().min(1),
  // Keep the raw type for the canonical execution validator. In particular,
  // the on-screen-log actions must reject whitespace and case variants rather
  // than having this transport normalize them first.
  type: z.string().min(1).refine((value) => value.trim().length > 0),
  // Action-specific parameter validation belongs to the canonical execution
  // validator. Keeping this raw also makes MCP return the normal structured
  // execution validation error for nulls, arrays, and scalars.
  params: z.unknown().optional(),
}).strict();

const executeArgsSchema = executionToolOptionsSchema.extend({
  actions: z.array(executionActionSchema).min(1, { message: "actions is required" }),
}).strict();

const configureArgsSchema = z.object({
  deviceId: z.string().trim().min(1).optional(),
  operatorPackage: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().min(LIMITS.MIN_EXECUTION_TIMEOUT_MS).max(LIMITS.MAX_EXECUTION_TIMEOUT_MS).optional(),
}).strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCallerControlledScreenshotPath(action: z.infer<typeof executionActionSchema>): boolean {
  const normalized = normalizeExecutionInput({ actions: [action] }) as { actions?: unknown };
  const normalizedAction = Array.isArray(normalized.actions) ? normalized.actions[0] : undefined;
  if (!isRecord(normalizedAction)) {
    return false;
  }
  if (normalizedAction.type !== "take_screenshot") {
    return false;
  }
  return isRecord(normalizedAction.params) && Object.prototype.hasOwnProperty.call(normalizedAction.params, "path");
}

export interface SnapshotMaxCharsResult {
  snapshot: string;
  truncated?: true;
}

export function applySnapshotMaxChars(
  snapshot: string,
  maxChars: number | undefined,
): SnapshotMaxCharsResult {
  if (maxChars === undefined || snapshot.length <= maxChars) {
    return { snapshot };
  }

  return { snapshot: snapshot.slice(0, maxChars), truncated: true };
}

export interface SnapshotEnvelopeResult extends SnapshotMaxCharsResult {
  envelope: ResultEnvelope;
}

export function applySnapshotMaxCharsToEnvelope(
  envelope: ResultEnvelope,
  snapshotStep: StepResult,
  snapshot: string,
  maxChars: number | undefined,
): SnapshotEnvelopeResult {
  const truncatedSnapshot = applySnapshotMaxChars(snapshot, maxChars);
  if (!truncatedSnapshot.truncated) {
    return {
      ...truncatedSnapshot,
      envelope,
    };
  }

  return {
    ...truncatedSnapshot,
    envelope: {
      ...envelope,
      stepResults: envelope.stepResults.map((step) => {
        if (step !== snapshotStep) {
          return step;
        }
        return {
          ...step,
          data: {
            ...step.data,
            text: truncatedSnapshot.snapshot,
          },
        };
      }),
    },
  };
}

/** Only shared snapshot presentation may supply these runtime-owned output fields. */
export function buildSnapshotSuccessResult(payload: Record<string, unknown>, presentation: Awaited<ReturnType<typeof presentSnapshot>>): McpToolResult {
  const sanitized = buildSuccessResult(payload).structuredContent ?? {};
  const output = { ...sanitized,
    ...(presentation.compact !== undefined ? { compact: presentation.compact } : {}),
    ...("rawArtifactPath" in presentation && presentation.rawArtifactPath !== undefined
      ? { rawArtifactPath: presentation.rawArtifactPath } : {}),
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
}

function buildSnapshotPresentationError(error: unknown, result: { deviceId: string; terminalSource: string }): McpToolResult {
  const failure = buildMcpErrorResult({ ...(error as object), ...result });
  // This path is produced only by presentSnapshot after an exclusive write.
  const rawArtifactPath = (error as { rawArtifactPath?: string }).rawArtifactPath;
  if (rawArtifactPath === undefined) return failure;
  const payload = { ...failure.structuredContent, rawArtifactPath };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
}

function buildSessionStatePayload(session: SessionDefaults): { session: SessionDefaults } {
  const current: SessionDefaults = {};
  if (session.deviceId !== undefined) {
    current.deviceId = session.deviceId;
  }
  if (session.operatorPackage !== undefined) {
    current.operatorPackage = session.operatorPackage;
  }
  if (session.timeoutMs !== undefined) {
    current.timeoutMs = session.timeoutMs;
  }

  return { session: current };
}

export function getCoreMcpTools(
  logger?: Logger,
  session: SessionDefaults = createSessionDefaults(),
): McpToolDefinition[] {
  return [
    {
      name: "devices",
      description: "List connected Android devices visible to adb.",
      inputSchema: { type: "object", additionalProperties: false },
      handler: async (args) => {
        parseToolArguments(emptyArgsSchema, args);

        try {
          const devices = await listDevices(createRuntimeConfig());
          return buildSuccessResult({ devices });
        } catch (error) {
          return buildMcpErrorResult(error);
        }
      },
    },
    {
      name: "snapshot",
      description: 'Capture the current Android UI hierarchy as XML, or bounded JSON with compact: true. maxNodes and maxTextChars require compact: true. Example: {"compact":true,"maxNodes":100}. Limits affect returned output, not capture or transfer cost.',
      inputSchema: {
        ...buildCommonExecutionSchema({
          compact: { type: "boolean", default: false, description: "Return bounded structural JSON instead of XML. Required to use maxNodes or maxTextChars; cannot be combined with maxChars." },
          maxNodes: { type: "integer", minimum: 1, maximum: 1000, description: "Requires compact: true. Maximum returned nodes; defaults to 100 in compact mode. Does not limit source capture." },
          maxTextChars: { type: "integer", minimum: 1, maximum: 4096, description: "Requires compact: true. Maximum Unicode code points per text or content-description field; defaults to 256 in compact mode." },
          saveRaw: { type: "boolean", default: false, description: "Save complete XML to a runtime-owned temporary file in either mode and return rawArtifactPath. Caller-provided paths are not accepted." },
          maxChars: { type: "integer", minimum: 1, description: "Raw XML mode only. Truncate returned XML to this many characters; omit with compact: true. Defaults to no truncation." },
        }),
        examples: [{ compact: true, maxNodes: 100 }],
        allOf: [
          {
            if: { anyOf: [{ required: ["maxNodes"] }, { required: ["maxTextChars"] }] },
            then: { required: ["compact"], properties: { compact: { const: true } } },
          },
          {
            if: { required: ["compact"], properties: { compact: { const: true } } },
            then: { not: { required: ["maxChars"] } },
          },
        ],
      },
      handler: async (args) => {
        const parsed = parseToolArguments(snapshotArgsSchema, args);
        try { validateSnapshotPresentationOptions(parsed); }
        catch (error) { return buildValidationResult((error as { message: string }).message); }
        const opts = mergeWithSessionDefaults(parsed, session);

        const execution = applyMcpExecutionMetadata(
          buildSnapshotExecution({ timeoutMs: opts.timeoutMs }),
          "snapshot",
          opts.timeoutMs,
        );

        return await runExecutionTool(execution, opts, logger, async (result) => {
          const extracted = extractStepDataValue(result.envelope, {
            actionType: "snapshot",
            dataKey: "text",
            errorKey: "error",
          });

          if (!extracted.ok) {
            return buildMcpErrorResult({
              code: extracted.error,
              message: extracted.message,
              envelope: result.envelope,
              deviceId: result.deviceId,
              terminalSource: result.terminalSource,
            });
          }

          let presentation;
          try {
            presentation = await presentSnapshot(result.envelope, parsed);
          } catch (error) {
            return buildSnapshotPresentationError(error, { deviceId: result.deviceId, terminalSource: result.terminalSource });
          }
          if (parsed.compact) {
            return buildSnapshotSuccessResult({ ...buildExecutionSuccessPayload(result), ...presentation }, presentation);
          }
          const { snapshot, truncated, envelope } = applySnapshotMaxCharsToEnvelope(
            result.envelope,
            extracted.step,
            extracted.value,
            parsed.maxChars,
          );
          return buildSnapshotSuccessResult({
            ...buildExecutionSuccessPayload({
              ...result,
              envelope,
            }),
            snapshot,
            ...(truncated ? { truncated } : {}),
          }, presentation);
        });
      },
    },
    {
      name: "execute",
      description: "Run a validated Clawperator execution payload over the canonical execution engine.",
      inputSchema: buildCommonExecutionSchema({
        actions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, pattern: "\\S" },
              type: { type: "string", minLength: 1, pattern: "\\S" },
              params: {},
            },
            required: ["id", "type"],
          },
        },
      }, ["actions"]),
      handler: async (args) => {
        const parsed = parseToolArguments(executeArgsSchema, args);
        const opts = mergeWithSessionDefaults(parsed, session);

        if (parsed.actions.some((action) => hasCallerControlledScreenshotPath(action))) {
          return buildValidationResult("execute does not allow caller-controlled take_screenshot paths over MCP", "actions");
        }

        const execution = {
          source: "mcp",
          expectedFormat: "android-ui-automator" as const,
          timeoutMs: opts.timeoutMs ?? 30_000,
          actions: parsed.actions as ExecutionAction[],
        };
        const stampedExecution = applyMcpExecutionMetadata(execution, "execute", opts.timeoutMs ?? 30_000);

        return await runExecutionTool(stampedExecution, opts, logger, (result) => {
          return buildSuccessResult(buildExecutionSuccessPayload(result));
        });
      },
    },
    {
      name: "configure",
      description: "Store per-session defaults for deviceId, operatorPackage, and timeoutMs.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          deviceId: { type: "string", minLength: 1, pattern: "\\S" },
          operatorPackage: { type: "string", minLength: 1, pattern: "\\S" },
          timeoutMs: {
            type: "integer",
            minimum: LIMITS.MIN_EXECUTION_TIMEOUT_MS,
            maximum: LIMITS.MAX_EXECUTION_TIMEOUT_MS,
          },
        },
      },
      handler: (args) => {
        const parsed = parseToolArguments(configureArgsSchema, args);

        if (parsed.deviceId !== undefined) {
          session.deviceId = parsed.deviceId;
        }
        if (parsed.operatorPackage !== undefined) {
          session.operatorPackage = parsed.operatorPackage;
        }
        if (parsed.timeoutMs !== undefined) {
          session.timeoutMs = parsed.timeoutMs;
        }

        return buildSuccessResult(buildSessionStatePayload(session));
      },
    },
  ];
}
