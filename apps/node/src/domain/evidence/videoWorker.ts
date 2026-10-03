import { VideoProcessRunner } from "./videoProcessRunner.js";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import { evidenceManifestSchema, type EvidenceManifest, type EvidenceArtifact } from "../../contracts/evidence.js";
import { writeEvidenceManifest } from "./manifest.js";
import { atomicJson, checked, fail, readState, releaseLock, sleep, verifyRemote, videoError } from "./videoSupport.js";
import { runScrcpyVideoWorker } from "./scrcpyVideo.js";

import { verifyVideo } from "./videoVerification.js";
export { verifyVideo, VIDEO_DECODE_TIMEOUT_MS, type VideoProbeMetadata } from "./videoVerification.js";

export interface VideoWorkerClock { now(): number; monotonic(): number; sleep(ms: number): Promise<void> }
const systemClock: VideoWorkerClock = { now: () => Date.now(), monotonic: () => performance.now(), sleep };

/** The sole session writer. Callers request stop through a nonce-bound file, never a host PID. */
export async function runVideoWorker(outputDir: string, runner: ProcessRunner = new VideoProcessRunner(), clock: VideoWorkerClock = systemClock, readArtifact: typeof fs.readFile = fs.readFile): Promise<void> {
  const state = await readState(outputDir);
  if (state.backend === "scrcpy") return runScrcpyVideoWorker(state, runner, clock, readArtifact);
  const manifest: EvidenceManifest = evidenceManifestSchema.parse(JSON.parse(await fs.readFile(join(outputDir, "manifest.json"), "utf8")));
  const lock = JSON.parse(await fs.readFile(state.lockPath, "utf8"));
  if (lock.nonce !== state.nonce || lock.sessionId !== state.sessionId || manifest.status !== "starting") fail("Worker does not own a starting session");
  state.hostPid = process.pid;
  state.hostStartedAt = new Date(performance.timeOrigin).toISOString();
  const started = clock.monotonic();
  let lastHeartbeat = 0;
  let stderr = "";
  let stderrBuffer = Buffer.alloc(0);
  let stderrTruncated = false;
  let stdout = "";
  let closed = false;
  let exitCode: number | null = null;
  let processError: Error | undefined;
  let notifyClosed!: () => void;
  const recorderClosed = new Promise<void>(resolve => { notifyClosed = resolve; });
  let child: ReturnType<ProcessRunner["spawn"]> | undefined;
  let stopSent = false;
  let recordingStarted = false;
  let videoVerified = false;
  const persist = async () => {
    state.updatedAt = clock.now();
    await atomicJson(join(outputDir, "session.json"), state);
  };
  const heartbeat = async () => {
    if (clock.now() - lastHeartbeat < 500) return;
    await atomicJson(join(outputDir, "heartbeat.json"), { nonce: state.nonce, pid: process.pid, startedAt: state.hostStartedAt, updatedAt: clock.now() });
    lastHeartbeat = clock.now();
  };
  const stopRequested = async () => {
    try { return JSON.parse(await fs.readFile(join(outputDir, "stop.json"), "utf8")).nonce === state.nonce; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  const heartbeatTimer = setInterval(() => { void heartbeat().catch(() => undefined); }, 500);
  try {
    await persist();
    await heartbeat();
    // All interpolated values are generated UUIDs or validated integers/dimensions.
    const script = `echo $$; exec screenrecord --size ${state.size} --time-limit ${state.durationSeconds} ${state.remotePath}`;
    child = runner.spawn(state.adbPath, ["-s", state.deviceId, "shell", "sh", "-c", `'${script}'`], { stdio: ["ignore", "pipe", "pipe"], shell: false });
    child.stdout?.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(0, 65536); });
    child.stderr?.on("data", (chunk: Buffer) => {
      const combined = Buffer.concat([stderrBuffer, chunk]);
      stderrTruncated ||= combined.length > 1024 * 1024;
      stderrBuffer = combined.subarray(0, 1024 * 1024);
      stderr = stderrBuffer.toString();
    });
    child.on("error", (error: Error) => { processError = error; closed = true; });
    child.on("close", (code: number | null) => { exitCode = code; closed = true; notifyClosed(); });
    const startupDeadline = clock.now() + 4000;
    while (!/^\d+\r?\n/.test(stdout) && !closed && clock.now() < startupDeadline) { await heartbeat(); await clock.sleep(50); }
    if (closed || !/^\d+\r?\n/.test(stdout)) fail(`Recorder failed to start: ${processError?.message ?? (stderr || "no PID acknowledgement")}`);
    state.remotePid = Number(stdout.split(/\r?\n/)[0]);
    await persist();
    state.remoteStart = await verifyRemote(runner, state);
    await clock.sleep(100);
    if (closed || stderr.trim()) fail(`Recorder startup failed: ${stderr || "process exited"}`);
    recordingStarted = true;
    state.deadline = clock.now() + state.durationSeconds * 1000;
    await persist();
    manifest.status = "recording";
    await writeEvidenceManifest(outputDir, manifest);
    while (!closed) {
      await heartbeat();
      if (!stopSent && await stopRequested()) {
        try {
          await verifyRemote(runner, state);
          if (closed) break;
          // Recheck identity in the same remote shell immediately before signaling.
          const pid = state.remotePid!;
          const signal = `test "$(cat /proc/${pid}/stat | cut -d ' ' -f 22)" = "${state.remoteStart}" && tr '\\000' '\\n' < /proc/${pid}/cmdline | grep -Fx '${state.remotePath}' >/dev/null && kill -2 ${pid}`;
          await checked(runner, state.adbPath, ["-s", state.deviceId, "shell", "sh", "-c", `'${signal.replaceAll("'", "'\\''")}'`], 2000);
        } catch (error) {
          // The duration cap may win while the identity check or signal is in flight.
          // Only an observed successful close permits normal finalization; never retry a signal.
          if (!closed) await Promise.race([recorderClosed, clock.sleep(250)]);
          if (closed && exitCode === 0 && !processError) break;
          throw error;
        }
        stopSent = true;
        manifest.video!.stopReason = "requested";
        manifest.status = "finalizing";
        await writeEvidenceManifest(outputDir, manifest);
      }
      if (clock.now() > state.deadline + 10000) fail("Recorder did not terminate after its device-side duration cap", "EVIDENCE_RECOVERY_REQUIRED");
      await clock.sleep(100);
    }
    manifest.video!.hostDurationMs = Math.max(0, clock.monotonic() - started);
    manifest.video!.stopReason ??= "duration_cap";
    if (processError || (exitCode !== 0 && !(stopSent && exitCode === 130))) fail(`Recorder connection ended unexpectedly: ${processError?.message ?? `exit ${exitCode}`}`);
    if (!stopSent && manifest.video!.hostDurationMs < state.durationSeconds * 1000 - 1500) fail("Recorder exited before the requested duration cap");
    manifest.status = "finalizing";
    await writeEvidenceManifest(outputDir, manifest);
    await checked(runner, state.adbPath, ["-s", state.deviceId, "pull", state.remotePath, join(outputDir, "video.partial.mp4")]);
    // Both probe updates and the final result contain only codec, actualSize, and mediaDurationMs.
    // Raw ffprobe objects are never merged into the manifest.
    Object.assign(manifest.video!, await verifyVideo(runner, join(outputDir, "video.partial.mp4"), state.size, metadata => Object.assign(manifest.video!, metadata)));
    await fs.rename(join(outputDir, "video.partial.mp4"), join(outputDir, "video.mp4"));
    videoVerified = true;
    await checked(runner, state.adbPath, ["-s", state.deviceId, "shell", "rm", state.remotePath]);
  } catch (error) {
    manifest.errors.push(videoError(error));
    manifest.video!.stopReason ??= recordingStarted ? "failure" : "startup_failure";
    // An unavailable connection is not proof that the remote recorder stopped.
    state.recoveryRequired = child !== undefined && !processError && (!closed || (exitCode !== 0 && !(stopSent && exitCode === 130)));
    if (child && !closed) child.kill("SIGKILL"); // Only the locally owned ADB child, never a persisted PID.
  } finally {
    try {
      if (manifest.video!.hostDurationMs === 0) manifest.video!.hostDurationMs = clock.monotonic() - started;
      manifest.finishedAt = new Date().toISOString();
      const artifact = async (kind: EvidenceArtifact["kind"], path: string, mimeType: string, error?: ReturnType<typeof videoError>) => {
        let bytes: number | null = null, sha256: string | null = null, savedPath: string | null = null;
        let readError: unknown;
        try {
          const data = await readArtifact(join(outputDir, path));
          if (data.length || kind === "encoder_stderr") { bytes = data.length; sha256 = createHash("sha256").update(data).digest("hex"); savedPath = path; }
        } catch (caught) { readError = caught; }
        const failure = error ?? (savedPath === null ? { ...videoError(readError ?? { message: "No artifact bytes available" }, "artifact"), component: kind } : undefined);
        if (failure && !manifest.errors.includes(failure)) manifest.errors.push(failure);
        manifest.artifacts.push({ kind, path: savedPath, bytes, sha256, mimeType, status: savedPath === null ? "failed" : failure ? "partial" : "complete",
          startedAt: manifest.startedAt, finishedAt: manifest.finishedAt!, durationMs: clock.monotonic() - started, ...(failure ? { error: failure } : {}) });
      };
      await fs.writeFile(join(outputDir, "encoder.stderr.txt"), stderrBuffer, { mode: 0o600 });
      await atomicJson(join(outputDir, "captures.json"), [{ kind: "video", source: "adb_screenrecord", sessionId: state.sessionId,
        remotePid: state.remotePid, remoteStart: state.remoteStart, exitCode, stopSent, videoVerified, errors: manifest.errors }]);
      await artifact("video", videoVerified ? "video.mp4" : "video.partial.mp4", "video/mp4", videoVerified ? undefined : manifest.errors.at(-1));
      const stderrError = stderrTruncated ? { ...videoError({ message: "Encoder stderr exceeded the 1 MiB retention limit" }), component: "encoder_stderr" } : undefined;
      if (stderrError) manifest.errors.push(stderrError);
      await artifact("encoder_stderr", "encoder.stderr.txt", "text/plain", stderrError);
      await artifact("capture_envelopes", "captures.json", "application/json");
      manifest.status = videoVerified && manifest.artifacts.every(artifact => artifact.status === "complete") && manifest.errors.length === 0 ? "complete" : manifest.artifacts.some(a => a.kind === "video" && a.path !== null) ? "partial" : "failed";
      if (state.recoveryRequired) manifest.errors.push(videoError({ code: "EVIDENCE_RECOVERY_REQUIRED", message: `Remote recorder ownership requires manual verification; lock retained. Remote file: ${state.remotePath}` }, "recovery"));
      await persist();
      await writeEvidenceManifest(outputDir, manifest);
      if (!state.recoveryRequired) await releaseLock(state);
    } finally { clearInterval(heartbeatTimer); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVideoWorker(process.argv[2]).catch(() => { process.exitCode = 1; });
}
