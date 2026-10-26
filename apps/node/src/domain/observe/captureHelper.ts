import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { verifyScreenshot } from "./screenshotMetadata.js";

export type CaptureScale = 100 | 50 | 25;
export interface CaptureHelperDiagnostics {
  phase: "setup" | "handshake" | "frame" | "idle";
  event: "child_error" | "stdin_error" | "stdout_error" | "stderr_error" | "child_close" | "spawn_error" | "setup_failed" | "session_closed" | "timeout" | "cancelled" | "capture_failed" | "protocol";
  requestAttempted: boolean;
  exitCode?: number | null;
  exitSignal?: string | null;
  errorCode?: string;
}

const SAFE_PIPE_ERROR_CODES = new Set(["EPIPE", "ECONNRESET", "ECONNABORTED", "EIO", "EBADF", "ENOENT", "EACCES", "EPERM", "ENOTCONN", "ETIMEDOUT", "EINTR"]);
const SAFE_EXIT_SIGNALS = new Set(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGPIPE", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGQUIT", "SIGTRAP"]);
function safePipeError(error: unknown): Pick<CaptureHelperDiagnostics, "errorCode"> {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && SAFE_PIPE_ERROR_CODES.has(code) ? { errorCode: code } : {};
}

export class CaptureHelperError extends Error {
  diagnostics?: Readonly<CaptureHelperDiagnostics>;
  readonly code = "EVIDENCE_CAPTURE_FAILED";
  fallbackAllowed = false;
  fallbackAttempted = false;
  protectedContent: "present" | "absent" | "unknown" = "unknown";
  constructor(readonly reason: "unavailable" | "incompatible" | "rejected" | "protocol" | "transport" | "cancelled" | "timeout" | "busy", message: string) { super(message); }
}
const fail = (reason: CaptureHelperError["reason"], message: string) => new CaptureHelperError(reason, message);
const sessions = new Map<string, Session>();
const artifactPath = fileURLToPath(new URL("../../../capture-helper/capture.dex", import.meta.url));
const manifestPath = fileURLToPath(new URL("../../../capture-helper/manifest.json", import.meta.url));
const keyFor = (config: RuntimeConfig) => `${config.adbPath}\0${config.deviceId}`;
const owners = new Set<Session>();
process.once("exit", () => { for (const session of owners) session.close(); });

export async function bundledCaptureHelper() {
  let bytes: Buffer;
  let manifest: { protocol: number; sha256: string };
  try {
    bytes = await readFile(artifactPath);
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch { throw fail("unavailable", "Capture helper bundle is missing or unreadable. Reinstall the Node package, then retry screenshot."); }
  if (manifest.protocol !== 1 || manifest.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
    throw fail("incompatible", "Capture helper bundle checksum/protocol mismatch; reinstall this Node package.");
  }
  return { path: artifactPath, sha256: manifest.sha256 as string };
}

export interface HelperImage {
  buffer: Buffer;
  metadata: Record<string, string>;
}

/** One owned ADB pipe, no public socket. A failed frame permanently poisons its session. */
class Session {
  readonly id = randomUUID();
  private child?: ChildProcessWithoutNullStreams;
  private pending?: { resolve: (value: { header: any; buffer: Buffer }) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  private bytes: Buffer = Buffer.alloc(0);
  private dead?: CaptureHelperError;
  private phase: CaptureHelperDiagnostics["phase"] = "setup";
  private requestAttempted = false;
  private sequence = 0;
  private captureNanos = 0n;
  private idle?: NodeJS.Timeout;
  private remote?: string;
  private readonly setupAbort = new AbortController();
  busy = true;
  constructor(private readonly config: RuntimeConfig) { owners.add(this); }

  close(error = fail("transport", "Capture helper closed. Retry only the screenshot; navigation was not replayed."),
    event: CaptureHelperDiagnostics["event"] = ["timeout", "cancelled", "protocol"].includes(error.reason)
      ? error.reason as "timeout" | "cancelled" | "protocol" : "session_closed",
    facts: Pick<CaptureHelperDiagnostics, "exitCode" | "exitSignal" | "errorCode"> = {}) {
    if (this.dead) return;
    error.diagnostics ??= Object.freeze({ phase: this.phase, event, requestAttempted: this.requestAttempted, ...facts });
    this.dead = error;
    this.setupAbort.abort(error);
    if (this.idle) clearTimeout(this.idle);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(this.dead); this.pending = undefined; }
    // EOF lets the shell wrapper remove only this session's private directory.
    this.child?.stdin.end();
    // Keep the pipe briefly alive for EOF cleanup, then bound a stuck helper.
    if (this.child) {
      const child = this.child;
      const timer = setTimeout(() => child.kill("SIGKILL"), 250);
      timer.unref();
    }
    owners.delete(this);
    if (sessions.get(keyFor(this.config)) === this) sessions.delete(keyFor(this.config));
  }

  private wait(timeout: number) {
    if (this.dead) return Promise.reject(this.dead);
    if (timeout <= 0) return Promise.reject(fail("timeout", "Screenshot deadline exhausted."));
    return new Promise<{ header: any; buffer: Buffer }>((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => this.close(fail("timeout", "Capture helper timed out; retry screenshot.")), timeout) };
    });
  }

  private receive(chunk: Buffer) {
    if (!this.pending) return this.close(fail("protocol", "Unsolicited or stale capture response rejected."));
    this.bytes = Buffer.concat([this.bytes, chunk]);
    if (this.bytes.length > 64 * 1024 * 1024 + 4096) return this.close(fail("protocol", "Capture response exceeds limit."));
    const end = this.bytes.indexOf(10);
    if (end < 0) {
      if (this.bytes.length > 4096) this.close(fail("protocol", "Capture header exceeds limit."));
      return;
    }
    try {
      if (end > 4096) throw Error();
      const header = JSON.parse(this.bytes.subarray(0, end).toString("utf8"));
      if (header.protocol !== 1 || header.session !== this.id) throw Error();
      const length = header.status === "ok" ? header.length : 0;
      if (!Number.isSafeInteger(length) || length < 0 || length > 64 * 1024 * 1024) throw Error();
      const total = end + 1 + length;
      if (this.bytes.length < total) return;
      if (this.bytes.length !== total) throw Error();
      const buffer = this.bytes.subarray(end + 1);
      this.bytes = Buffer.alloc(0);
      const pending = this.pending;
      this.pending = undefined;
      clearTimeout(pending.timer);
      pending.resolve({ header, buffer });
    } catch { this.close(fail("protocol", "Malformed, stale or mismatched capture frame rejected.")); }
  }

  async start(deadline: number) {
    const artifact = await bundledCaptureHelper();
    const run = async (args: string[]) => {
      if (this.dead) throw this.dead;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw fail("timeout", "Capture setup deadline exhausted.");
      const result = await this.config.runner.run(this.config.adbPath, ["-s", this.config.deviceId!, ...args], { timeoutMs: Math.ceil(remaining), signal: this.setupAbort.signal });
      if (this.dead) throw this.dead;
      // Timer delivery and the fractional deadline clock can straddle the boundary.
      // Preserve an explicit process timeout even if the clock is still just before it.
      if (result.timedOut || performance.now() >= deadline) throw fail("timeout", "Capture setup deadline exhausted.");
      if (result.code !== 0 || result.error) throw fail("unavailable", "Cannot deploy capture helper. Check ADB connection and /data/local/tmp space; retry screenshot.");
      return result.stdout;
    };
    this.remote = `/data/local/tmp/androperator-capture-${this.id}`;
    try {
      await run(["shell", `umask 077; mkdir '${this.remote}'`]);
      await run(["push", artifact.path, `${this.remote}/capture.dex`]);
      const sum = await run(["shell", "sha256sum", `${this.remote}/capture.dex`]);
      if (sum.trim().split(/\s+/)[0] !== artifact.sha256) throw fail("incompatible", "Deployed capture helper checksum mismatch.");
      if (this.dead) throw this.dead;
      this.phase = "handshake";
      const handshake = this.wait(deadline - performance.now());
      void handshake.catch(() => undefined); // A synchronous spawn failure must not leave an unhandled rejection.
      let child: ChildProcessWithoutNullStreams;
      try { child = this.config.runner.spawn(this.config.adbPath, ["-s", this.config.deviceId!, "shell", "-T",
        `trap 'rm -rf ${this.remote}' EXIT; CLASSPATH=${this.remote}/capture.dex app_process /system/bin CaptureHelper ${this.id}`],
        { stdio: ["pipe", "pipe", "pipe"], shell: false }) as ChildProcessWithoutNullStreams;
      } catch (cause) {
        this.transportFailure("spawn_error", safePipeError(cause));
        throw this.dead;
      }
      this.child = child;
      child.stdout.on("data", chunk => this.receive(chunk));
      child.stderr.on("data", () => undefined); // Never retain device or private screen diagnostics.
      child.stderr.on("error", error => this.transportFailure("stderr_error", safePipeError(error)));
      child.on("error", error => this.transportFailure("child_error", safePipeError(error)));
      child.stdin.on("error", error => this.transportFailure("stdin_error", safePipeError(error)));
      child.stdout.on("error", error => this.transportFailure("stdout_error", safePipeError(error)));
      child.on("close", (code, signal) => this.transportFailure("child_close", {
        exitCode: Number.isSafeInteger(code) ? code : null,
        exitSignal: signal === null || signal === undefined ? null : SAFE_EXIT_SIGNALS.has(signal) ? signal : "unknown",
      }));
      const { header } = await handshake;
      if (header.status === "incompatible") {
        const api = Number.isInteger(header.androidApi) ? header.androidApi : "unknown";
        throw fail("incompatible", `Android API ${api}: direct scaled capture API unavailable. Stock capture and resize can provide the requested size.`);
      }
      if (header.status === "unavailable" && header.missingCapability === "hardware_buffer_initialization") {
        throw fail("unavailable", "Android cannot initialize a hardware buffer in the shell helper. Stock capture and resize can provide the requested size; no screen capture was attempted by the helper.");
      }
      if (header.status === "unavailable") throw fail("unavailable", "Android capture service could not initialize. Stock capture and resize can provide the requested size; check device readiness if that also fails.");
      if (header.status !== "ready") throw fail("protocol", "Invalid capture handshake.");
      this.phase = "idle";
    } catch (cause) {
      const error = cause instanceof CaptureHelperError ? cause : fail("transport", "Capture helper setup failed. Check ADB and retry only the screenshot.");
      this.close(error, "setup_failed");
      // Only the newly allocated directory is ours, never another client's helper.
      // Cleanup has its own short bound and must not delay cancellation or fallback.
      void this.config.runner.run(this.config.adbPath, ["-s", this.config.deviceId!, "shell", "rm", "-rf", this.remote], { timeoutMs: 250 }).catch(() => undefined);
      throw error;
    }
  }

  private transportFailure(event: CaptureHelperDiagnostics["event"], facts: Pick<CaptureHelperDiagnostics, "exitCode" | "exitSignal" | "errorCode"> = {}) {
    this.close(fail("transport", `Capture helper transport failed during ${this.phase} (${event}). Retry only the screenshot; navigation was not replayed.`), event, facts);
  }

  async capture(scale: CaptureScale, deadline: number): Promise<HelperImage> {
    if (this.dead) throw this.dead;
    if (this.idle) clearTimeout(this.idle);
    this.phase = "frame";
    this.requestAttempted = false;
    this.child!.ref();
    for (const stream of [this.child!.stdin, this.child!.stdout, this.child!.stderr]) (stream as any).ref?.();
    const request = randomUUID();
    const received = this.wait(deadline - performance.now());
    void received.catch(() => undefined);
    this.requestAttempted = true; // A write attempt does not prove helper receipt.
    try { this.child!.stdin.write(`${request} ${scale}\n`); }
    catch (cause) { this.transportFailure("stdin_error", safePipeError(cause)); }
    const { header, buffer } = await received;
    if (this.dead) throw this.dead;
    if (header.request !== request) throw fail("protocol", "Stale screenshot request ID rejected.");
    if (header.status !== "ok") {
      const detail = header.reason === "protected_content" ? "Protected buffer rejected before pixel readback. Capture an ordinary unprotected screen."
        : header.reason === "secure_content" ? "Secure window rejected before pixel readback. Capture an ordinary unprotected screen."
        : "Display locked/off, geometry changed, or capture uncertain. Unlock or stabilize the display and retry screenshot.";
      const error = fail("rejected", `Capture rejected: ${detail} No fallback was attempted.`);
      if (header.reason === "protected_content") error.protectedContent = "present";
      throw error;
    }
    const { sourceWidth, sourceHeight, rotation, physicalId, captureNanos } = header;
    if (!Number.isSafeInteger(sourceWidth) || sourceWidth < 2 || !Number.isSafeInteger(sourceHeight) || sourceHeight < 2
      || sourceWidth * sourceHeight > 32_000_000 || ![0, 1, 2, 3].includes(rotation)
      || typeof physicalId !== "string" || !/^\d+$/.test(physicalId)
      || !["absent", "unknown"].includes(header.protectedContent)
      || header.scale !== scale || header.sequence !== this.sequence + 1
      || typeof captureNanos !== "string" || !/^\d+$/.test(captureNanos) || BigInt(captureNanos) <= this.captureNanos) {
      throw fail("protocol", "Screenshot geometry, sequence or capture timestamp mismatch.");
    }
    const image = verifyScreenshot(buffer);
    if (image.captureWidthPx !== Math.floor(sourceWidth * scale / 100) || image.captureHeightPx !== Math.floor(sourceHeight * scale / 100)) {
      throw fail("protocol", "Decoded screenshot dimensions do not match the requested scale.");
    }
    this.sequence = header.sequence;
    this.captureNanos = BigInt(captureNanos);
    this.phase = "idle";
    this.idle = setTimeout(() => this.close(), 30_000);
    this.idle.unref();
    this.child!.unref();
    for (const stream of [this.child!.stdin, this.child!.stdout, this.child!.stderr]) (stream as any).unref?.();
    return { buffer, metadata: { protectedContent: header.protectedContent, fallbackAttempted: "false", captureMethod: "shell_hardware_buffer", requestedScale: String(scale), appliedScale: String(scale),
      nativeWidthPx: String(sourceWidth), nativeHeightPx: String(sourceHeight), rotation: String(rotation), logicalDisplayId: "0", physicalDisplayId: physicalId,
      captureId: request, captureSessionId: this.id, captureSequence: String(header.sequence), deviceCaptureNanos: captureNanos } };
  }
}

export function closeCaptureHelpers(): void { for (const session of owners) session.close(); }

export async function captureWithHelper(config: RuntimeConfig, options: { scale: CaptureScale; timeoutMs: number; signal?: AbortSignal }): Promise<HelperImage> {
  if (!config.deviceId) throw fail("unavailable", "Screenshot requires an explicit resolved device.");
  if (![25, 50, 100].includes(options.scale)) throw fail("rejected", "scale must be 100, 50 or 25; example: screenshot --scale 25.");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw fail("timeout", "Screenshot timeoutMs must be finite and positive.");
  if (options.signal?.aborted) throw fail("cancelled", "Screenshot cancelled.");
  const deadline = performance.now() + options.timeoutMs;
  const key = keyFor(config);
  let session = sessions.get(key);
  if (session?.busy) throw fail("busy", "A screenshot is already in progress on this device. Await it before another capture.");
  const fresh = !session;
  session ??= new Session(config);
  session.busy = true;
  sessions.set(key, session);
  const abort = () => session!.close(fail("cancelled", "Screenshot cancelled; helper session discarded."));
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (fresh) {
      try { await session.start(deadline); }
      catch (error) {
        // Only setup failures permit a different backend. Never retry an uncertain frame.
        if (error instanceof CaptureHelperError && ["incompatible", "unavailable"].includes(error.reason)) error.fallbackAllowed = true;
        throw error;
      }
    }
    const result = await session.capture(options.scale, deadline);
    if (options.signal?.aborted) throw fail("cancelled", "Screenshot cancelled.");
    if (performance.now() >= deadline) throw fail("timeout", "Screenshot deadline exhausted during decoding.");
    return result;
  } catch (cause) {
    const error = cause instanceof CaptureHelperError ? cause : fail("protocol", "Screenshot acquisition or decoding failed; retry screenshot. No fallback was attempted.");
    session.close(error, "capture_failed");
    throw error;
  }
  finally { session.busy = false; options.signal?.removeEventListener("abort", abort); }
}

/** Capability probe only: does not capture pixels. Temporary deployment is removed on close. */
export async function probeCaptureHelper(config: RuntimeConfig): Promise<{ status: "supported" | "unavailable" | "incompatible"; detail: string }> {
  const session = new Session(config);
  try {
    await session.start(performance.now() + 5000);
    return { status: "supported", detail: "Direct scaled capture APIs available. Protected-content detection may be unknown; that does not block ordinary screenshots. Live capture and image contents are unverified until screenshot succeeds." };
  } catch (error) {
    return { status: error instanceof CaptureHelperError && error.reason === "incompatible" ? "incompatible" : "unavailable",
      detail: error instanceof Error ? error.message : "Capture helper probe failed; check ADB and reinstall Node package." };
  } finally { session.close(); }
}
