/**
 * Type definitions for recording events and evidence exports.
 * Aligns with the NDJSON schema and export format from the Record feature PRD.
 */

// Header - first line of the NDJSON file
export interface RecordingHeader {
  type: "recording_header";
  schemaVersion: number;
  sessionId: string;
  startedAt: number; // epoch ms
  operatorPackage: string; // package that produced this recording
}

// Raw event types from Android NDJSON
export interface WindowChangeEvent {
  ts: number;
  seq: number;
  type: "window_change";
  packageName: string;
  className: string | null;
  title: string | null;
  snapshot?: string | null;
}

export interface ClickEvent {
  ts: number;
  seq: number;
  type: "click";
  packageName: string;
  resourceId: string | null;
  text: string | null;
  contentDesc: string | null;
  bounds: { left: number; top: number; right: number; bottom: number };
  snapshot?: string | null;
}

export interface ScrollEvent {
  ts: number;
  seq: number;
  type: "scroll";
  packageName: string;
  resourceId: string | null;
  scrollX: number;
  scrollY: number;
  maxScrollX: number;
  maxScrollY: number;
  snapshot?: string | null;
}

export interface PressKeyEvent {
  ts: number;
  seq: number;
  type: "press_key";
  key: "back";
  snapshot?: string | null;
}

export interface TextChangeEvent {
  ts: number;
  seq: number;
  type: "text_change";
  packageName: string;
  resourceId: string | null;
  text: string;
  snapshot?: string | null;
}

export type RawRecordingEvent =
  | WindowChangeEvent
  | ClickEvent
  | ScrollEvent
  | PressKeyEvent
  | TextChangeEvent;

export const RECORDING_EXPORT_VERSION = 1;

export type RecordingExportSnapshotMode = "omit" | "include";

export interface RecordingExportSnapshot {
  present: boolean;
  xml: string | null;
}

export interface RecordingExportWindowChangeEvent {
  seq: number;
  ts: number;
  deltaMsSincePrevious: number | null;
  type: "window_change";
  packageName: string;
  className: string | null;
  title: string | null;
  snapshot: RecordingExportSnapshot;
}

export interface RecordingExportClickEvent {
  seq: number;
  ts: number;
  deltaMsSincePrevious: number | null;
  type: "click";
  packageName: string;
  resourceId: string | null;
  text: string | null;
  contentDesc: string | null;
  bounds: { left: number; top: number; right: number; bottom: number };
  snapshot: RecordingExportSnapshot;
}

export interface RecordingExportScrollEvent {
  seq: number;
  ts: number;
  deltaMsSincePrevious: number | null;
  type: "scroll";
  packageName: string;
  resourceId: string | null;
  scrollX: number;
  scrollY: number;
  maxScrollX: number;
  maxScrollY: number;
  snapshot: RecordingExportSnapshot;
}

export interface RecordingExportPressKeyEvent {
  seq: number;
  ts: number;
  deltaMsSincePrevious: number | null;
  type: "press_key";
  key: "back";
  snapshot: RecordingExportSnapshot;
}

export interface RecordingExportTextChangeEvent {
  seq: number;
  ts: number;
  deltaMsSincePrevious: number | null;
  type: "text_change";
  packageName: string;
  resourceId: string | null;
  text: string;
  snapshot: RecordingExportSnapshot;
}

export type RecordingExportEvent =
  | RecordingExportWindowChangeEvent
  | RecordingExportClickEvent
  | RecordingExportScrollEvent
  | RecordingExportPressKeyEvent
  | RecordingExportTextChangeEvent;

export interface RecordingExportCounts {
  totalEvents: number;
  byType: Record<string, number>;
}

export interface RecordingExportPackageTransition {
  seq: number;
  ts: number;
  fromPackageName: string;
  toPackageName: string;
}

export interface RecordingExportTimeline {
  firstEventTs: number | null;
  lastEventTs: number | null;
  durationMs: number | null;
}

export interface RecordingExportSession {
  sessionId: string;
  schemaVersion: number;
  startedAt: number;
  operatorPackage: string;
}

export interface RecordingExportArtifact {
  exportVersion: number;
  session: RecordingExportSession;
  snapshotMode: RecordingExportSnapshotMode;
  events: RecordingExportEvent[];
  counts: RecordingExportCounts;
  packageTransitions: RecordingExportPackageTransition[];
  timeline: RecordingExportTimeline;
}

/**
 * Shared NDJSON validation contract for recordingValidation.ts.
 *
 * Rules pinned here for evidence export:
 * - returns `{ header, events }`
 * - `events` are sorted by `seq` before return
 * - throws plain `{ code, message }` objects, not `Error` instances
 * - preserves current line-numbered validation messages
 * - never writes to stderr
 */
export interface ValidatedRecording {
  header: RecordingHeader;
  events: RawRecordingEvent[];
}
