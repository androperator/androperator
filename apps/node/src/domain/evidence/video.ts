import { evidenceRoot, videoLockRoot, preflightDirectory, storageError, acquireVideoLock } from "./storage.js";
import { VideoProcessRunner } from "./videoProcessRunner.js";
import * as fs from "node:fs/promises";
import { join, dirname, basename, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getDefaultRuntimeConfig, type RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { resolveDevice } from "../devices/resolveDevice.js";
import { resolveOperatorPackageForRequest } from "../config/resolveOperatorPackage.js";
import { evidenceManifestSchema, type EvidenceManifest } from "../../contracts/evidence.js";
import { validateEvidenceCaptureOptions, type EvidenceCaptureOptions } from "./capture.js";
import { collectEvidenceMetadata } from "./metadata.js";
import { writeEvidenceManifest } from "./manifest.js";
import { readActiveDisplay } from "../observe/activeDisplay.js";
import { atomicJson, chooseVideoSize, fail, lockName, readState, releaseLock, sleep, terminal, videoError, type VideoState } from "./videoSupport.js";
import { inspectVideoDependencies, videoDependencyError } from "./videoDependencies.js";

export interface VideoStartOptions extends EvidenceCaptureOptions { durationSeconds: number; size?: string }
export interface VideoSessionOptions { session: string; deviceId?: string; operatorPackage?: string }
export interface VideoDependencies { baseDir?: string; config?: RuntimeConfig; workerPath?: string }
export interface VideoResult { ok: boolean; status: EvidenceManifest["status"]; manifestPath: string; sessionId: string; code?: string; recoveryRequired?: boolean }
export { evidenceRoot } from "./storage.js";
export function validateVideoStart(options: VideoStartOptions): void {
  validateEvidenceCaptureOptions(options);
  if (options.deviceId === undefined) fail("Video start requires an explicit deviceId", "EXECUTION_VALIDATION_FAILED");
  if (!Number.isInteger(options.durationSeconds) || options.durationSeconds < 1 || options.durationSeconds > 180) fail("durationSeconds must be an integer from 1 to 180", "EXECUTION_VALIDATION_FAILED");
  if (options.size !== undefined && !/^\d+x\d+$/.test(options.size)) fail("size must be WIDTHxHEIGHT", "EXECUTION_VALIDATION_FAILED");
}
export async function startVideo(options: VideoStartOptions, dependencies: VideoDependencies = {}): Promise<VideoResult> {
  validateVideoStart(options);
  const root = evidenceRoot(dependencies);
  const context = JSON.parse(JSON.stringify(options.context ?? {}));
  const config = dependencies.config ?? getDefaultRuntimeConfig({ deviceId: options.deviceId, operatorPackage: resolveOperatorPackageForRequest(options.operatorPackage), adbPath: process.env.ADB_PATH });
  validateEvidenceCaptureOptions({ operatorPackage: config.operatorPackage });
  const runtime = { ...config, deviceId: options.deviceId!, runner: dependencies.config?.runner ?? new VideoProcessRunner() };
  await resolveDevice(runtime);
  const dependencyIssues = await inspectVideoDependencies(runtime.runner);
  if (dependencyIssues.length > 0) throw videoDependencyError(dependencyIssues);
  const captureDisplay = await readActiveDisplay(runtime, 2000);
  const metadata = await collectEvidenceMetadata(runtime, () => 5000);
  const display = metadata.device.display;
  if (display.rotation === null) fail("Current display rotation is unavailable");
  const rotated = display.rotation % 2 === 1;
  const size = chooseVideoSize(captureDisplay?.width ?? (rotated ? display.height : display.width) ?? 0, captureDisplay?.height ?? (rotated ? display.width : display.height) ?? 0, options.size);
  const sessionId = randomUUID(), nonce = randomUUID();
  await preflightDirectory(root);
  const lockRoot = videoLockRoot();
  await preflightDirectory(lockRoot, true);
  const lockPath = join(lockRoot, lockName(runtime.deviceId));
  const outputDir = options.outputDir === undefined ? join(root, "bundles", sessionId) : resolve(options.outputDir);
  const state: VideoState = { sessionId, nonce, deviceId: runtime.deviceId, operatorPackage: runtime.operatorPackage, adbPath: runtime.adbPath,
    outputDir, lockPath, managed: options.outputDir === undefined, durationSeconds: options.durationSeconds, size,
    hostPid: null, hostStartedAt: null, remotePid: null, remoteStart: null, remotePath: `/data/local/tmp/androperator-video-${sessionId}.mp4`,
    deadline: Date.now() + options.durationSeconds * 1000 + 5000, updatedAt: Date.now(), recoveryRequired: false,
    backend: "scrcpy", maxEdge: options.size === undefined ? 1280 : Math.max(...size.split("x").map(Number)) };
  await acquireVideoLock(lockPath, { sessionId, nonce, outputDir });
  let workerDispatched = false;
  let startupManifest: EvidenceManifest | undefined;
  try {
    if (options.outputDir === undefined) await preflightDirectory(dirname(outputDir));
    try { await fs.mkdir(outputDir, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("Evidence output directory already exists", "EVIDENCE_OUTPUT_EXISTS"); storageError(error, outputDir); }
    await preflightDirectory(outputDir);
    const manifest: EvidenceManifest = { schemaVersion: 1, evidenceId: sessionId, label: options.label ?? null, context, device: metadata.device,
      startedAt: new Date().toISOString(), finishedAt: null, status: "starting", artifacts: [], errors: metadata.errors,
      video: { requestedDurationSeconds: options.durationSeconds, hostDurationMs: 0, mediaDurationMs: null, requestedSize: size, actualSize: null, codec: null, stopReason: null } };
    await atomicJson(join(outputDir, "session.json"), state);
    const manifestPath = await writeEvidenceManifest(outputDir, manifest);
    startupManifest = manifest;
    const workerPath = dependencies.workerPath ?? fileURLToPath(new URL("./videoWorker.js", import.meta.url));
    const worker = runtime.runner.spawn(process.execPath, [workerPath, outputDir], { detached: true, stdio: "ignore", shell: false });
    let spawnError: Error | undefined;
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      worker.once("spawn", () => { workerDispatched = true; resolveSpawn(); });
      worker.on("error", (error: Error) => { spawnError = error; rejectSpawn(error); });
    });
    worker.unref();
    const deadline = Date.now() + 5000;
    do {
      if (spawnError) throw spawnError;
      const result = await videoStatus({ session: manifestPath });
      if (result.status === "recording") return result;
      if (terminal(result.status)) return { ...result, ok: false };
      await sleep(50);
    } while (Date.now() < deadline);
    await atomicJson(join(outputDir, "stop.json"), { nonce });
    return { ok: false, status: "starting", sessionId, manifestPath, code: "COMMAND_TIMEOUT" };
  } catch (error) {
    if (!workerDispatched) {
      try {
        if (startupManifest) {
          startupManifest.status = "failed";
          startupManifest.finishedAt = new Date().toISOString();
          startupManifest.video!.stopReason = "startup_failure";
          startupManifest.errors.push(videoError(error, "startup"));
          const manifestPath = await writeEvidenceManifest(outputDir, startupManifest);
          return { ok: false, status: "failed", manifestPath, sessionId, code: "EVIDENCE_CAPTURE_FAILED" };
        }
      } finally { await releaseLock(state); }
    }
    throw error;
  }
}
async function loadSession(options: VideoSessionOptions): Promise<{ state: VideoState; manifest: EvidenceManifest }> {
  if (!isAbsolute(options.session) || basename(options.session) !== "manifest.json" || options.session.split(/[\\/]/).includes("..")) fail("session must be an absolute manifest path", "EXECUTION_VALIDATION_FAILED");
  let state: VideoState, manifest: EvidenceManifest;
  try {
    state = await readState(dirname(options.session));
    manifest = evidenceManifestSchema.parse(JSON.parse(await fs.readFile(options.session, "utf8")));
    if (manifest.evidenceId !== state.sessionId || !manifest.video) fail("Not a video session");
  } catch { fail("Video session not found or invalid", "EVIDENCE_SESSION_NOT_FOUND"); }
  if ((options.deviceId !== undefined && options.deviceId !== state.deviceId) || (options.operatorPackage !== undefined && options.operatorPackage !== state.operatorPackage)) fail("Target options conflict with the saved video session", "EXECUTION_VALIDATION_FAILED");
  return { state, manifest };
}
export async function videoStatus(options: VideoSessionOptions): Promise<VideoResult> {
  const { state, manifest } = await loadSession(options);
  const result: VideoResult = { ok: !["partial", "failed"].includes(manifest.status), status: manifest.status, manifestPath: options.session, sessionId: state.sessionId,
    ...(state.recoveryRequired ? { recoveryRequired: true, code: "EVIDENCE_RECOVERY_REQUIRED" } : {}) };
  if (terminal(manifest.status)) return { ...result, ...(!result.ok && !result.code ? { code: "EVIDENCE_CAPTURE_FAILED" } : {}) };
  // A fresh nonce-bound heartbeat proves that the original worker is still responding.
  // Never use a saved host PID as authority to signal or reclaim a lock.
  let alive = false;
  try {
    const heartbeat = JSON.parse(await fs.readFile(join(state.outputDir, "heartbeat.json"), "utf8"));
    alive = heartbeat.nonce === state.nonce && heartbeat.pid === state.hostPid && heartbeat.startedAt === state.hostStartedAt && Date.now() - heartbeat.updatedAt < 4000;
  } catch { /* Startup has a bounded acknowledgement grace period. */ }
  if (!alive && Date.now() - state.updatedAt > 5000) return { ...result, ok: false, status: "failed", recoveryRequired: true, code: "EVIDENCE_RECOVERY_REQUIRED" };
  return result;
}
export async function stopVideo(options: VideoSessionOptions): Promise<VideoResult> {
  const { state, manifest } = await loadSession(options);
  if (!terminal(manifest.status)) await atomicJson(join(state.outputDir, "stop.json"), { nonce: state.nonce });
  const deadline = Date.now() + 15000;
  let result: VideoResult;
  do {
    result = await videoStatus(options);
    if (terminal(result.status)) return { ...result, ok: result.status === "complete" };
    await sleep(100);
  } while (Date.now() < deadline);
  return { ...result, ok: false, code: "COMMAND_TIMEOUT" };
}
export async function managedVideoSession(sessionId: string, dependencies: VideoDependencies = {}): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) fail("Unknown video sessionId", "EVIDENCE_SESSION_NOT_FOUND");
  const path = join(evidenceRoot(dependencies), "bundles", sessionId, "manifest.json");
  const { state } = await loadSession({ session: path });
  if (!state.managed || state.sessionId !== sessionId) fail("Unknown managed video session", "EVIDENCE_SESSION_NOT_FOUND");
  return path;
}
