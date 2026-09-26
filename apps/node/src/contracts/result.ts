import type { LoggingStatus } from "./logging.js";
import type { ExecutionFailureEvidence } from "./errors.js";

/**
 * How the terminal result was obtained. Canonical-only: Node accepts only [Clawperator-Result].
 */
export type TerminalSource = "clawperator_result";

/**
 * Result envelope contract: [Clawperator-Result] terminal envelope.
 */
/** Receipt JSON fields (target/matched_target/coordinate/progress) remain serialized strings.
 * Dispatch acceptance never asserts an application postcondition.
 */
export type DispatchMethod = "accessibility_action" | "coordinate_gesture" | "none";

/** Safe facts only: never copy parser messages, tag names or source excerpts here. */
export interface SnapshotExtractionDiagnostics {
  receivedBytes: number;
  sourceValidationCategory: string;
  line?: number;
  column?: number;
  position?: number;
  closingHierarchySeen?: boolean;
  terminationReason?: "next_snapshot" | "same_tag_event" | "closing_hierarchy" | "end_of_capture";
}

export interface StepResultData {
  [key: string]: string | SnapshotExtractionDiagnostics | undefined;
  extractionDiagnostics?: SnapshotExtractionDiagnostics;
  text?: string;
  error?: string;
  errorCode?: string;
  message?: string;
  extractionReason?: string;
  path?: string;
  payload?: string;
  sessionId?: string;
  selection_warning?: string;
  warn?: string;
  persistedAt?: string;
  value?: string;
}

export interface StepResult {
  id: string;
  actionType: string;
  success: boolean;
  data: StepResultData;
}

export interface ResultEnvelope {
  commandId: string;
  taskId: string;
  status: "success" | "failed";
  stepResults: StepResult[];
  error?: string | null;
  /**
   * Stable enumerated error code for top-level failures. Present when the Android APK emits
   * a known error code (e.g. "SERVICE_UNAVAILABLE"). May be absent for older APK versions or
   * unclassified failures. Agents should branch on this field rather than string-matching `error`.
   */
  errorCode?: string | null;
  hint?: string;
  /** Host evidence added only when processing a received envelope fails. */
  failureEvidence?: ExecutionFailureEvidence;
  diagnostics?: { logging: LoggingStatus };
}

export const RESULT_ENVELOPE_PREFIX = "[Clawperator-Result]";
export const EVENT_ENVELOPE_PREFIX = "[Clawperator-Event]";
