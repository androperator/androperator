import { isAndroperatorError } from "../contracts/errors.js";

export interface McpErrorPayload {
  code?: string;
  message: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: [{ type: "text"; text: string }, ...Array<{ type: "text"; text: string }>];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function buildMcpSuccessResult(payload: unknown): McpToolResult {
  const sanitized = sanitizeMcpTransportValue(payload);
  return {
    content: [{ type: "text", text: JSON.stringify(sanitized) }],
    ...(isRecord(sanitized) ? { structuredContent: sanitized } : {}),
  };
}

export function buildMcpErrorResult(error: unknown): McpToolResult {
  const payload = normalizeMcpError(error);
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

export function normalizeMcpError(error: unknown): McpErrorPayload {
  if (isAndroperatorError(error)) {
    return sanitizeMcpErrorPayload(error as unknown as Record<string, unknown>);
  }

  if (typeof error === "object" && error !== null) {
    return sanitizeMcpErrorPayload(error as Record<string, unknown>);
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "path" || normalized.endsWith("path") || normalized === "command" || normalized === "stdout" || normalized === "stderr" || normalized === "stack";
}

function sanitizeMcpErrorPayload(error: Record<string, unknown>): McpErrorPayload {
  const payload: McpErrorPayload = {
    message: typeof error.message === "string" && error.message.length > 0 ? error.message : "Unknown MCP error",
  };

  if (typeof error.code === "string" && error.code.length > 0) {
    payload.code = error.code;
  }
  // Evidence storage preflight deliberately exposes its destination and recovery action.
  if (error.code === "EVIDENCE_STORAGE_UNWRITABLE") {
    for (const field of ["path", "recovery", "causeCode"] as const) {
      if (typeof error[field] === "string" || error[field] === null) payload[field] = error[field];
    }
  }
  if (typeof error.hint === "string" && error.hint.length > 0) {
    payload.hint = error.hint;
  }
  if ("details" in error) {
    payload.details = sanitizeMcpTransportValue(error.details);
  }
  if ("diagnostics" in error) {
    payload.diagnostics = sanitizeMcpTransportValue(error.diagnostics);
  }
  if ("envelope" in error) {
    payload.envelope = sanitizeMcpTransportValue(error.envelope);
  }
  if (typeof error.deviceId === "string" && error.deviceId.length > 0) {
    payload.deviceId = error.deviceId;
  }
  if (typeof error.terminalSource === "string" && error.terminalSource.length > 0) {
    payload.terminalSource = error.terminalSource;
  }

  return payload;
}

function sanitizeMcpTransportValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMcpTransportValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    sanitized[key] = sanitizeMcpTransportValue(entry);
  }
  return sanitized;
}
