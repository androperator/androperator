import { EventEmitter } from "node:events";
import type { ResultEnvelope } from "../../contracts/result.js";
import type { RunExecutionResult } from "../executions/runExecution.js";

/**
 * EventEmitter-based SSE transport. Intentionally separate from AndroperatorLogger.
 * The logger handles file and terminal routing; this emitter carries rich in-memory
 * objects (ResultEnvelope, RunExecutionResult) to SSE clients. See
 * docs/internal/design/ for rationale.
 */

/**
 * Global event emitter for Androperator envelopes.
 * Used by the 'serve' command to stream SSE events.
 */
export const androperatorEvents = new EventEmitter();
androperatorEvents.setMaxListeners(100); // support many SSE clients, but keep a limit to detect leaks

export const ANDROPERATOR_EVENT_TYPES = {
  RESULT: "androperator:result", // specific canonical terminal envelope (legacy/v0.1)
  EXECUTION: "androperator:execution", // full outcome of any runExecution call (success or failure)
  EVENT: "androperator:event", // placeholder for future real-time events
} as const;

export function emitResult(deviceId: string, envelope: ResultEnvelope): void {
  androperatorEvents.emit(ANDROPERATOR_EVENT_TYPES.RESULT, { deviceId, envelope });
}

export function emitExecution(deviceId: string, input: unknown, result: RunExecutionResult): void {
  androperatorEvents.emit(ANDROPERATOR_EVENT_TYPES.EXECUTION, { deviceId, input, result });
}
