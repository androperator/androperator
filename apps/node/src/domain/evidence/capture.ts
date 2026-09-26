import { writeEvidenceManifest } from "./manifest.js";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { evidenceRoot, storageError } from "./storage.js";
import { isAbsolute, join, parse, resolve } from "node:path";
import { verifyScreenshot } from "../observe/screenshotMetadata.js";
import type { ScreenshotMetadata } from "../../contracts/screenshot.js";
import { type EvidenceArtifact, type EvidenceCaptureResult, type EvidenceError } from "../../contracts/evidence.js";
import { getDefaultRuntimeConfig, type RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { resolveOperatorPackageForRequest } from "../config/resolveOperatorPackage.js";
import { resolveDevice } from "../devices/resolveDevice.js";
import { captureScreenshot } from "../observe/captureScreenshot.js";
import { buildSnapshotExecution } from "../observe/snapshot.js";
import { projectCompactSnapshot } from "../observe/compactSnapshot.js";
import type { Execution } from "../../contracts/execution.js";
import type { RunExecutionOptions, RunExecutionResult } from "../executions/runExecution.js";
import { runExecution } from "../executions/runExecution.js";
import { probeInteractiveState, isInteractiveAutomationReady, buildDeviceNotInteractiveError } from "../doctor/checks/deviceInteractivity.js";
import { EvidenceBudgetRunner } from "./budget.js";
import { collectEvidenceMetadata } from "./metadata.js";
import type { Logger } from "../../adapters/logger.js";

export interface EvidenceCaptureOptions {
  outputDir?: string;
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
  label?: string;
  context?: Record<string, unknown>;
  logger?: Logger;
}
export interface EvidenceCaptureDependencies {
  baseDir?: string;
  config?: RuntimeConfig;
  screenshot?: typeof captureScreenshot;
  snapshot?: (execution: Execution, options?: RunExecutionOptions) => Promise<RunExecutionResult>;
  metadata?: typeof collectEvidenceMetadata;
  files?: Pick<typeof fs, "mkdir" | "writeFile" | "readFile" | "rename">;
  now?: () => number;
}
function isJson(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(item => isJson(item, ancestors));
  ancestors.delete(value);
  return valid;
}
export function validateEvidenceCaptureOptions(options: EvidenceCaptureOptions): void {
  const invalid = (message: string): never => { throw { code: "EXECUTION_VALIDATION_FAILED", message }; };
  if (options.outputDir !== undefined && (typeof options.outputDir !== "string" || options.outputDir.trim().length === 0 || !isAbsolute(options.outputDir) || options.outputDir.includes("\0") || resolve(options.outputDir) === parse(resolve(options.outputDir)).root || options.outputDir.split(/[\\/]/).includes(".."))) {
    invalid("outputDir must be a nonblank absolute new directory without parent traversal");
  }
  for (const field of ["deviceId", "operatorPackage"] as const) {
    if (options[field] !== undefined && (typeof options[field] !== "string" || options[field]!.trim().length === 0)) invalid(`${field} must be nonblank`);
  }
  if (options.operatorPackage !== undefined && !/^[A-Za-z0-9_.]+$/.test(options.operatorPackage)) invalid("operatorPackage must contain only package identifier characters");
  if (options.label !== undefined && (typeof options.label !== "string" || options.label.length > 2048)) invalid("label must contain at most 2048 UTF-16 code units");
  if (options.context !== undefined && (options.context === null || Array.isArray(options.context) || typeof options.context !== "object" || !isJson(options.context))) invalid("context must be a JSON object");
  if (Buffer.byteLength(JSON.stringify(options.context ?? {}), "utf8") > 16 * 1024) invalid("context exceeds 16 KiB UTF-8");
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120_000)) invalid("timeoutMs must be an integer from 1000 to 120000");
}
function captureError(error: unknown, stage: string, component: string | null): EvidenceError {
  const value = error as { code?: unknown; message?: unknown } | null;
  return { code: typeof value?.code === "string" ? value.code : "EVIDENCE_CAPTURE_FAILED", stage, component,
    message: typeof value?.message === "string" ? value.message : String(error) };
}

export async function captureEvidence(options: EvidenceCaptureOptions, dependencies: EvidenceCaptureDependencies = {}): Promise<EvidenceCaptureResult> {
  validateEvidenceCaptureOptions(options);
  const root = evidenceRoot();
  const managedRoot = dependencies.baseDir === undefined ? join(root, "bundles") : resolve(dependencies.baseDir);
  // Snapshot caller data before asynchronous work; its verdict remains opaque.
  const context = JSON.parse(JSON.stringify(options.context ?? {})) as Record<string, unknown>;
  const files = dependencies.files ?? fs;
  const now = dependencies.now ?? (() => performance.now());
  const startedAt = new Date().toISOString();
  const deadline = now() + (options.timeoutMs ?? 30_000);
  const remaining = () => Math.max(0, Math.floor(deadline - now()));
  const config = dependencies.config ?? getDefaultRuntimeConfig({ deviceId: options.deviceId, operatorPackage: resolveOperatorPackageForRequest(options.operatorPackage), adbPath: process.env.ADB_PATH, logger: options.logger });
  validateEvidenceCaptureOptions({ operatorPackage: config.operatorPackage, deviceId: config.deviceId });
  const runner = new EvidenceBudgetRunner(config.runner, performance.now() + remaining());
  const runtime = { ...config, runner };
  const evidenceId = randomUUID();
  let outputDir: string;
  try {
    const target = await resolveDevice(runtime);
    runtime.deviceId = target.deviceId;
    if (options.outputDir === undefined) {
      try { await files.mkdir(managedRoot, { recursive: true, mode: 0o700 }); }
      catch (error) { storageError(error, managedRoot); }
      outputDir = join(managedRoot, evidenceId);
    } else outputDir = options.outputDir;
    try { await files.mkdir(outputDir, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw { code: "EVIDENCE_OUTPUT_EXISTS", message: "Evidence output directory already exists" };
      storageError(error, outputDir);
    }
    const artifacts: EvidenceArtifact[] = [];
    const errors: EvidenceError[] = [];
    const captures: Array<Record<string, unknown>> = [];
    const store = async (kind: EvidenceArtifact["kind"], filename: string, mimeType: string, work: () => Promise<Buffer>, verify: (data: Buffer) => ScreenshotMetadata | void, correlation: { commandId?: string; taskId?: string } = {}) => {
      const artifactStart = new Date().toISOString(), monotonicStart = now();
      const partialPath = filename.replace(/(\.[^.]+)$/, ".partial$1");
      let path: string | null = null, bytes: number | null = null, sha256: string | null = null;
      let status: EvidenceArtifact["status"] = "failed";
      let error: EvidenceError | undefined;
      let image: ScreenshotMetadata | void = undefined;
      try {
        const data = await work();
        if (data.length === 0) throw new Error("Captured output is empty");
        await files.writeFile(join(outputDir, partialPath), data, { flag: "wx", mode: 0o600 });
        const saved = await files.readFile(join(outputDir, partialPath));
        image = verify(saved);
        await files.rename(join(outputDir, partialPath), join(outputDir, filename));
        path = filename; bytes = saved.length; sha256 = createHash("sha256").update(saved).digest("hex"); status = "complete";
      } catch (caught) {
        error = captureError(caught, "capture", kind);
        errors.push(error);
        const partialBuffer = (caught as { partialBuffer?: Buffer })?.partialBuffer;
        if (partialBuffer?.length) {
          try { await files.writeFile(join(outputDir, partialPath), partialBuffer, { flag: "wx", mode: 0o600 }); } catch { /* Preserve any file already written. */ }
        }
        try {
          const saved = await files.readFile(join(outputDir, partialPath));
          if (saved.length > 0) { path = partialPath; bytes = saved.length; sha256 = createHash("sha256").update(saved).digest("hex"); status = "partial"; }
        } catch { /* Failed artifacts with no readable bytes have null file fields. */ }
      }
      const artifactFinishedAt = new Date().toISOString();
      const durationMs = Math.max(0, now() - monotonicStart);
      if (kind !== "capture_envelopes") {
        let record = captures.find(capture => capture.kind === kind);
        if (!record) {
          record = { kind, source: kind === "screenshot" ? "adb_screencap" : "operator", ...correlation, result: { ok: false, error } };
          captures.push(record);
        }
        Object.assign(record, { startedAt: artifactStart, finishedAt: artifactFinishedAt, durationMs });
      }
      artifacts.push({ kind, path, mimeType, status, bytes, sha256, startedAt: artifactStart,
        finishedAt: artifactFinishedAt, durationMs, ...correlation, ...(status === "complete" && image ? { image } : {}), ...(error ? { error } : {}) });
    };
    const screenshotIds = { commandId: `${evidenceId}-screenshot`, taskId: evidenceId };
    await store("screenshot", "screenshot.png", "image/png", async () => {
      if (remaining() <= 0) throw { code: "COMMAND_TIMEOUT", message: "Screenshot not dispatched: capture budget exhausted" };
      try {
        const image = await (dependencies.screenshot ?? captureScreenshot)(runtime, { timeoutMs: remaining(), signal: runner.signal, ...screenshotIds });
        captures.push({ kind: "screenshot", source: "adb_screencap", ...screenshotIds, result: { ok: true, bytes: image.length } });
        return image;
      } catch (error) {
        captures.push({ kind: "screenshot", source: "adb_screencap", ...screenshotIds, result: { ok: false, error: captureError(error, "capture", "screenshot") } });
        throw error;
      }
    }, verifyScreenshot, screenshotIds);
    const execution = { ...buildSnapshotExecution(), commandId: `${evidenceId}-hierarchy`, taskId: evidenceId };
    await store("hierarchy", "hierarchy.xml", "application/xml", async () => {
      if (remaining() < 1000) throw { code: "COMMAND_TIMEOUT", message: "Hierarchy not dispatched: less than the minimum execution budget remains" };
      const result = await (dependencies.snapshot ?? runExecution)(execution, { deviceId: runtime.deviceId, operatorPackage: runtime.operatorPackage,
        adbPath: runtime.adbPath, runner, signal: runner.signal, timeoutMs: remaining(), resultEnvelopeTimeoutMs: remaining(), logger: options.logger,
        ensureInteractiveAutomationReadyFn: async (config, probeOptions) => {
          const probe = await (probeOptions?.probeInteractiveStateFn ?? probeInteractiveState)(config);
          if (!probe.ok) return { ok: false, error: { code: probe.code, message: probe.message } };
          return isInteractiveAutomationReady(probe.state)
            ? { ok: true, state: probe.state }
            : { ok: false, error: buildDeviceNotInteractiveError(probe.state) };
        } });
      captures.push({ kind: "hierarchy", source: "operator", commandId: execution.commandId, taskId: execution.taskId, result });
      if (!result.ok) throw result.error;
      if (result.envelope.status !== "success") throw { code: result.envelope.errorCode ?? "EVIDENCE_CAPTURE_FAILED", message: result.envelope.error ?? "Hierarchy capture failed" };
      const step = result.envelope.stepResults.find(item => item.actionType === "snapshot" && item.success);
      if (step?.data.text === undefined) throw { code: "SNAPSHOT_EXTRACTION_FAILED", message: "Hierarchy capture returned no XML" };
      return Buffer.from(step.data.text, "utf8");
    }, data => { projectCompactSnapshot(data.toString("utf8"), execution, { maxNodes: 1 }); }, { commandId: execution.commandId, taskId: execution.taskId });
    const metadata = await (dependencies.metadata ?? collectEvidenceMetadata)(runtime, remaining);
    errors.push(...metadata.errors);
    await store("capture_envelopes", "captures.json", "application/json", async () => Buffer.from(JSON.stringify(captures, null, 2) + "\n"), () => undefined);
    const usable = artifacts.filter(artifact => (artifact.kind === "screenshot" || artifact.kind === "hierarchy") && artifact.status === "complete").length;
    const status = usable === 0 ? "failed" : usable === 2 && errors.length === 0 ? "complete" : "partial";
    const manifestPath = await writeEvidenceManifest(outputDir, { schemaVersion: 1, evidenceId, label: options.label ?? null, context,
      device: metadata.device, startedAt, finishedAt: new Date().toISOString(), status, artifacts, errors }, files);
    return { ok: status === "complete", status, manifestPath, evidenceId, ...(status !== "complete" ? { code: "EVIDENCE_CAPTURE_FAILED" as const } : {}) };
  } finally { runner.close(); }
}
