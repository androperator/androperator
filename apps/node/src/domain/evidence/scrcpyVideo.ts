import { FFMPEG_VIDEO_TIMING_ARGS } from "./ffmpegCapabilities.js";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import { evidenceManifestSchema, type EvidenceArtifact, type EvidenceError } from "../../contracts/evidence.js";
import { atomicJson, fail, releaseLock, videoError, type VideoState } from "./videoSupport.js";
import { verifyVideo, VIDEO_DECODE_TIMEOUT_MS, type VideoProbeMetadata } from "./videoVerification.js";
import type { VideoWorkerClock } from "./videoWorker.js";
import { writeEvidenceManifest } from "./manifest.js";

export function scrcpyArguments(state: VideoState): string[] {
  return [`--serial=${state.deviceId}`, "--no-window", "--no-audio", "--no-control",
    "--video-codec=h264", `--max-size=${state.maxEdge ?? 1280}`, "--record-format=mkv",
    `--record=${join(state.outputDir, "capture.partial.mkv")}`, `--time-limit=${state.durationSeconds}`];
}

export interface VideoSegment { start: number; end?: number; width: number; height: number; frames: number }
/** Use decoded frame geometry, not the container's initial stream dimensions. */
export function videoSegments(probe: { frames?: Array<{ width?: number; height?: number; best_effort_timestamp_time?: string }> }): VideoSegment[] {
  const segments: VideoSegment[] = [];
  let previousTime = -1;
  for (const frame of probe.frames ?? []) {
    const { width, height } = frame;
    const time = Number(frame.best_effort_timestamp_time);
    if (!Number.isSafeInteger(width) || width! < 2 || !Number.isSafeInteger(height) || height! < 2
      || frame.best_effort_timestamp_time?.trim() === "" || !Number.isFinite(time) || time < 0 || time <= previousTime) {
      fail("Video frame geometry or timestamp is invalid");
    }
    const previous = segments.at(-1);
    if (!previous || previous.width !== width || previous.height !== height) {
      if (previous) previous.end = time;
      segments.push({ start: time, width: width!, height: height!, frames: 1 });
    } else previous.frames++;
    previousTime = time;
  }
  if (!segments.length) fail("Recorder produced no decodable video frames");
  return segments;
}

export function segmentSize(segment: VideoSegment, state: VideoState, first: boolean): string {
  // Preserve the caller's exact initial size, including an explicitly requested upscale.
  if (first) {
    const [width, height] = state.size.split("x").map(Number);
    if (Math.abs((segment.width / segment.height) / (width / height) - 1) > 0.02) {
      fail("Display geometry changed during recorder startup; initial aspect ratio does not match the request");
    }
    return state.size;
  }
  const scale = Math.min(1, (state.maxEdge ?? 1280) / Math.max(segment.width, segment.height));
  return `${Math.max(2, Math.floor(segment.width * scale / 2) * 2)}x${Math.max(2, Math.floor(segment.height * scale / 2) * 2)}`;
}

/** Own only the live child handle. A saved PID never authorizes a signal. */
export async function runScrcpyVideoWorker(state: VideoState, runner: ProcessRunner, clock: VideoWorkerClock, readArtifact: typeof fs.readFile): Promise<void> {
  const outputDir = state.outputDir;
  const manifest = evidenceManifestSchema.parse(JSON.parse(await fs.readFile(join(outputDir, "manifest.json"), "utf8")));
  const owner = JSON.parse(await fs.readFile(state.lockPath, "utf8"));
  if (owner.nonce !== state.nonce || owner.sessionId !== state.sessionId || manifest.status !== "starting") fail("Worker does not own a starting session");
  state.hostPid = process.pid;
  state.hostStartedAt = new Date(performance.timeOrigin).toISOString();
  const started = clock.monotonic();
  let recordingStarted = started;
  let recordingStopped: number | undefined;
  const source = join(outputDir, "capture.partial.mkv");
  let child: ReturnType<ProcessRunner["spawn"]> | undefined;
  let spawned = false, closed = false, recording = false, stopSent = false, truncated = false, verified = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  let closeObserved = false;
  let startupFailure: "deadline" | "early_exit" | "process_error" | null = null;
  let startupElapsedMs = 0;
  let cleanupSignal: string | null = null;
  let processError: Error | undefined;
  let diagnostics = Buffer.alloc(0);
  const receipts: Array<Record<string, unknown>> = [];
  const persist = async () => { state.updatedAt = clock.now(); await atomicJson(join(outputDir, "session.json"), state); };
  const heartbeat = async () => atomicJson(join(outputDir, "heartbeat.json"), {
    nonce: state.nonce, pid: process.pid, startedAt: state.hostStartedAt, updatedAt: clock.now(),
  });
  const heartbeatTimer = setInterval(() => { void heartbeat().catch(() => undefined); }, 500);
  const stopRequested = async () => {
    try { return JSON.parse(await fs.readFile(join(outputDir, "stop.json"), "utf8")).nonce === state.nonce; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  const artifact = async (path: string, kind: EvidenceArtifact["kind"], mimeType: string, error?: EvidenceError, allowMissing = false) => {
    try {
      const data = await readArtifact(join(outputDir, path));
      if (!data.length && kind !== "encoder_stderr") throw new Error("No artifact bytes available");
      manifest.artifacts.push({ kind, path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), mimeType,
        status: error ? "partial" : "complete", startedAt: manifest.startedAt, finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, clock.monotonic() - started), ...(error ? { error } : {}) });
    } catch (caught) {
      const missingOutput = allowMissing && error !== undefined && (caught as NodeJS.ErrnoException).code === "ENOENT";
      const failure = missingOutput ? error : videoError(caught, "artifact");
      if (!missingOutput) manifest.errors.push(failure);
      manifest.artifacts.push({ kind, path: null, bytes: null, sha256: null, mimeType, status: "failed", error: failure,
        startedAt: manifest.startedAt, finishedAt: new Date().toISOString(), durationMs: Math.max(0, clock.monotonic() - started) });
    }
  };
  try {
    await persist();
    await heartbeat();
    child = runner.spawn("scrcpy", scrcpyArguments(state), { stdio: ["ignore", "pipe", "pipe"], shell: false,
      env: { ...process.env, ADB: state.adbPath } });
    const collect = (chunk: Buffer) => {
      const combined = Buffer.concat([diagnostics, chunk]);
      truncated ||= combined.length > 1024 * 1024;
      diagnostics = combined.subarray(0, 1024 * 1024);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("spawn", () => { spawned = true; });
    child.on("error", (error: Error) => { processError = error; if (!spawned) closed = true; });
    child.on("close", (code: number | null, signal: string | null) => {
      exitCode = code; exitSignal = signal ?? null; closeObserved = true; closed = true;
    });
    const startupDeadline = clock.now() + 4000;
    while (!closed && !processError && clock.now() < startupDeadline) {
      try { await fs.stat(source); recording = true; recordingStarted = clock.monotonic(); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await clock.sleep(50);
    }
    startupElapsedMs = Math.max(0, clock.monotonic() - started);
    if (!recording || closed || processError) {
      startupFailure = processError ? "process_error" : closed ? "early_exit" : "deadline";
      fail(startupFailure === "deadline" ? "Recorder startup deadline expired after 4000ms"
        : `Recorder failed during startup: ${startupFailure} (exit=${exitCode}, signal=${exitSignal})`);
    }
    state.deadline = clock.now() + state.durationSeconds * 1000;
    await persist();
    manifest.status = "recording";
    await writeEvidenceManifest(outputDir, manifest);
    let stopDeadline: number | undefined;
    while (!closed) {
      if (processError) throw processError;
      const requested = await stopRequested();
      if (!stopSent && (requested || clock.now() >= state.deadline)) {
        stopSent = true;
        recordingStopped = clock.monotonic();
        manifest.video!.stopReason = requested ? "requested" : "duration_cap";
        manifest.status = "finalizing";
        await writeEvidenceManifest(outputDir, manifest);
        child.kill("SIGINT");
        stopDeadline = clock.now() + 5000;
      }
      if (stopDeadline !== undefined && clock.now() > stopDeadline) fail("scrcpy did not terminate after stop", "EVIDENCE_RECOVERY_REQUIRED");
      await clock.sleep(50);
    }
    recordingStopped ??= clock.monotonic();
    manifest.video!.hostDurationMs = Math.max(0, clock.monotonic() - started);
    manifest.video!.stopReason ??= "duration_cap";
    if (processError) throw processError;
    if (exitCode !== 0) fail(`Recorder ended unexpectedly: exit ${exitCode}`);
    if (!stopSent && manifest.video!.hostDurationMs < state.durationSeconds * 1000 - 1500) fail("Recorder exited before the requested duration cap");
    manifest.status = "finalizing";
    await writeEvidenceManifest(outputDir, manifest);
    const probe = await runner.run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_frames",
      "-show_entries", "frame=width,height,best_effort_timestamp_time", "-of", "json", source], { timeoutMs: VIDEO_DECODE_TIMEOUT_MS });
    if (probe.code !== 0 || probe.error || probe.stderr.trim()) fail(`Video frame inspection failed: ${probe.stderr || probe.error?.message || probe.code}`);
    const segments = videoSegments(JSON.parse(probe.stdout));
    let mediaDurationMs = 0;
    const sizes = new Set<string>();
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const size = segmentSize(segment, state, index === 0);
      const name = index === 0 ? "video" : `video-${String(index + 1).padStart(4, "0")}`;
      const partial = `${name}.partial.mp4`, final = `${name}.mp4`;
      let probed: VideoProbeMetadata | undefined;
      try {
        // A fixed-size encode per span gives each MP4 its own correct codec headers.
        // Output seeking decodes preceding parameter sets before selecting the span.
        // Keep the source timebase so close VFR timestamps cannot round together.
        const encoded = await runner.run("ffmpeg", ["-v", "error", "-nostdin", "-nostats", "-xerror", "-threads", "2",
          "-i", source, "-ss", String(segment.start), ...(segment.end === undefined ? [] : ["-t", String(segment.end - segment.start)]),
          "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", `scale=${size.replace("x", ":")},setsar=1`,
          // B-frame reordering can shorten MP4 duration tables across sparse VFR gaps.
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-bf", "0", "-threads", "2", ...FFMPEG_VIDEO_TIMING_ARGS, join(outputDir, partial)],
        { timeoutMs: VIDEO_DECODE_TIMEOUT_MS });
        if (encoded.code !== 0 || encoded.error || encoded.stderr.trim()) fail(`Video segment encoding failed: ${encoded.stderr || encoded.error?.message || encoded.code}`);
        const metadata = await verifyVideo(runner, join(outputDir, partial), size, value => { probed = value; }, segment.frames);
        await fs.rename(join(outputDir, partial), join(outputDir, final));
        mediaDurationMs += metadata.mediaDurationMs;
        sizes.add(metadata.actualSize);
        receipts.push({ path: final, ...segment, ...metadata });
        await artifact(final, "video", "video/mp4");
      } catch (error) {
        const failure = videoError(error, "segment");
        manifest.errors.push(failure);
        receipts.push({ path: partial, ...segment, ...probed, error: failure });
        await artifact(partial, "video", "video/mp4", failure, true);
      }
    }
    manifest.video!.mediaDurationMs = mediaDurationMs;
    manifest.video!.actualSize = sizes.size === 1 ? [...sizes][0] : null;
    manifest.video!.codec = sizes.size ? "h264" : null;
    const clipsVerified = manifest.artifacts.length === segments.length && manifest.artifacts.every(value => value.status === "complete");
    const recordingDurationMs = Math.min(state.durationSeconds * 1000,
      Math.max(0, (recordingStopped ?? clock.monotonic()) - recordingStarted));
    // Startup and stop/encode latency are not time that the recorder was asked to cover.
    const coverageShortfall = recordingDurationMs - mediaDurationMs;
    const coverageIncomplete = coverageShortfall > Math.max(2000, recordingDurationMs * 0.1);
    if (clipsVerified && coverageIncomplete) {
      manifest.errors.push(videoError({ message:
        `Media timeline covers ${mediaDurationMs}ms of a ${recordingDurationMs}ms recording interval; session coverage is unverified` }, "coverage"));
    }
    verified = clipsVerified && !coverageIncomplete;
    if (verified) await fs.unlink(source);
  } catch (error) {
    manifest.errors.push(videoError(error));
    manifest.video!.stopReason = recording ? "failure" : "startup_failure";
    if (child && !closed) {
      state.recoveryRequired = true;
      const terminateOwnedChild = async (signal: "SIGINT" | "SIGKILL") => {
        cleanupSignal = signal;
        try { child!.kill(signal); }
        catch (cleanupError) { manifest.errors.push(videoError(cleanupError, "cleanup")); }
        const deadline = clock.now() + 2000;
        while (!closed && clock.now() < deadline) await clock.sleep(50);
      };
      if (!recording) {
        // Use the normal scrcpy stop path first so a successful close can confirm cleanup.
        await terminateOwnedChild("SIGINT");
        if (closeObserved && exitCode === 0 && exitSignal === null && !processError) state.recoveryRequired = false;
      }
      if (!closed) await terminateOwnedChild("SIGKILL");
      // Forced closure alone cannot confirm Android-side cleanup; retain recovery ownership.
    }
  } finally {
    try {
      if (manifest.video!.hostDurationMs === 0) manifest.video!.hostDurationMs = Math.max(0, clock.monotonic() - started);
      if (!verified) await artifact("capture.partial.mkv", "video", "video/x-matroska", manifest.errors.at(-1) ?? videoError({ message: "Recording could not be finalized" }));
      if (truncated) manifest.errors.push(videoError({ message: "Recorder diagnostics exceeded the 1 MiB retention limit" }));
      await fs.writeFile(join(outputDir, "encoder.stderr.txt"), diagnostics, { mode: 0o600 });
      await artifact("encoder.stderr.txt", "encoder_stderr", "text/plain", truncated ? manifest.errors.at(-1) : undefined);
      await atomicJson(join(outputDir, "captures.json"), [{ kind: "video", source: "scrcpy", sessionId: state.sessionId,
        exitCode, exitSignal, stopSent, videoVerified: verified,
        startup: { failure: startupFailure, elapsedMs: startupElapsedMs, spawned,
          processErrorCode: (processError as NodeJS.ErrnoException | undefined)?.code ?? null },
        cleanup: { signal: cleanupSignal, closeObserved, recoveryRequired: state.recoveryRequired },
        segments: receipts, errors: manifest.errors }]);
      await artifact("captures.json", "capture_envelopes", "application/json");
      manifest.finishedAt = new Date().toISOString();
      manifest.status = verified && manifest.errors.length === 0 && manifest.artifacts.every(value => value.status === "complete") ? "complete"
        : manifest.artifacts.some(value => value.kind === "video" && value.path !== null) ? "partial" : "failed";
      if (state.recoveryRequired) manifest.errors.push(videoError({ code: "EVIDENCE_RECOVERY_REQUIRED", message: "Recorder termination requires manual verification; device lock retained. Recovery checks: https://docs.androperator.com/api/evidence/#video-artifacts-and-recovery" }, "recovery"));
      await persist();
      await writeEvidenceManifest(outputDir, manifest);
      if (!state.recoveryRequired) await releaseLock(state);
    } finally { clearInterval(heartbeatTimer); }
  }
}
