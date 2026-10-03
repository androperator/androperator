import type { ResultEnvelope, StepResult, StepResultData, TerminalSource } from "../../contracts/result.js";
import { RESULT_ENVELOPE_PREFIX } from "../../contracts/result.js";

export interface ParsedTerminal {
  envelope: ResultEnvelope;
  terminalSource: TerminalSource;
}

/**
 * Parse result envelope: [Androperator-Result] only (canonical envelope).
 * Returns envelope, null if not an envelope, or 'malformed' if prefix exists but JSON is invalid.
 */
export function parseResultEnvelope(line: string, commandId: string): ResultEnvelope | 'malformed' | null {
  const trimmed = line.trim();
  const prefixIndex = trimmed.indexOf(RESULT_ENVELOPE_PREFIX);
  if (prefixIndex === -1) return null;
  const json = trimmed.slice(prefixIndex + RESULT_ENVELOPE_PREFIX.length).trim();
  try {
    const data = normalizeResultEnvelope(JSON.parse(json));
    if (data.commandId === commandId) return data;
    return null; // different commandId
  } catch {
    return 'malformed';
  }
}

/**
 * Parse terminal result: [Androperator-Result] only (canonical envelope).
 * Returns envelope plus terminalSource for observability.
 */
export function parseTerminalEnvelope(line: string, commandId: string): ParsedTerminal | 'malformed' | null {
  const envelope = parseResultEnvelope(line, commandId);
  if (typeof envelope === 'object' && envelope !== null) {
    return { envelope, terminalSource: "androperator_result" };
  }
  return envelope;
}

function normalizeResultEnvelope(raw: unknown): ResultEnvelope {
  const envelope = raw as Partial<ResultEnvelope> & { stepResults?: unknown[] };
  if (typeof envelope.commandId !== "string" || typeof envelope.taskId !== "string") {
    throw new Error("Invalid envelope identifiers");
  }
  if (envelope.status !== "success" && envelope.status !== "failed") {
    throw new Error("Invalid envelope status");
  }
  if (!Array.isArray(envelope.stepResults)) {
    throw new Error("Invalid envelope stepResults");
  }
  if (!(typeof envelope.error === "string" || envelope.error === null)) {
    throw new Error("Invalid envelope error");
  }
  // errorCode is optional - older APK versions may not emit it
  const errorCode = envelope.errorCode;
  if (errorCode !== undefined && !(typeof errorCode === "string" || errorCode === null)) {
    throw new Error("Invalid envelope errorCode");
  }

  return {
    commandId: envelope.commandId,
    taskId: envelope.taskId,
    status: envelope.status,
    stepResults: envelope.stepResults.map(normalizeStepResult),
    error: envelope.error,
    ...(errorCode !== undefined ? { errorCode } : {}),
  };
}

function normalizeStepResult(raw: unknown): StepResult {
  const step = raw as Partial<StepResult> & { data?: unknown };
  if (typeof step.id !== "string" || typeof step.actionType !== "string") {
    throw new Error("Invalid step result identifiers");
  }
  if (typeof step.success !== "boolean") {
    throw new Error("Invalid step result success");
  }

  return {
    id: step.id,
    actionType: step.actionType,
    success: step.success,
    data: normalizeStepResultData(step.data),
  };
}

function normalizeStepResultData(raw: unknown): StepResultData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const normalized: StepResultData = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key] = typeof value === "string" ? value : String(value);
  }
  return normalized;
}
