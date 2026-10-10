import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { verifyScreenshot } from "./screenshotMetadata.js";

export type CaptureScale = 100 | 50 | 25;
export class CaptureHelperError extends Error {
  readonly code = "EVIDENCE_CAPTURE_FAILED";
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
  private dead?: Error;
  private sequence = 0;
  private captureNanos = 0n;
  private idle?: NodeJS.Timeout;
  private remote?: string;
  busy = true;
  constructor(private readonly config: RuntimeConfig) { owners.add(this); }

  close(error = fail("transport", "Capture helper closed. Retry the screenshot; navigation was not replayed.")) {
    if (this.dead) return;
    this.dead = error;
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
      const result = await this.config.runner.run(this.config.adbPath, ["-s", this.config.deviceId!, ...args], { timeoutMs: remaining });
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
      const handshake = this.wait(deadline - performance.now());
      void handshake.catch(() => undefined); // A synchronous spawn failure must not leave an unhandled rejection.
      const child = this.config.runner.spawn(this.config.adbPath, ["-s", this.config.deviceId!, "shell", "-T",
        `trap 'rm -rf ${this.remote}' EXIT; CLASSPATH=${this.remote}/capture.dex app_process /system/bin CaptureHelper ${this.id}`],
        { stdio: ["pipe", "pipe", "pipe"], shell: false }) as ChildProcessWithoutNullStreams;
      this.child = child;
      child.stdout.on("data", chunk => this.receive(chunk));
      child.stderr.on("data", () => undefined); // Never retain device or private screen diagnostics.
      child.on("error", () => this.close());
      child.stdin.on("error", () => this.close());
      child.on("close", () => this.close());
      const { header } = await handshake;
      if (header.status === "incompatible") {
        const api = Number.isInteger(header.androidApi) ? header.androidApi : "unknown";
        const cause = header.missingCapability === "protected_composition"
          ? "The device compositor lacks protected GPU composition. Reduced capture cannot reliably distinguish protected buffers from redacted output. Use another device with protected composition support and run androperator doctor; an OS upgrade alone may not resolve this hardware/driver capability."
          : "The Android build lacks a required capture API or buffer-safety check. Use a compatible device/build and run androperator doctor to verify capability.";
        throw fail("incompatible", `Android API ${api}: ${cause} Omit --scale (or Node scale) only for an explicit ordinary full-resolution capture with Android's standard redaction behavior. No automatic fallback was attempted.`);
      }
      if (header.status === "unavailable") throw fail("unavailable", "Android capture service could not initialize. Check device readiness and retry screenshot; no automatic fallback was attempted.");
      if (header.status !== "ready") throw fail("protocol", "Invalid capture handshake.");
    } catch (error) {
      this.close();
      // Only the newly allocated directory is ours, never another client's helper.
      try { await this.config.runner.run(this.config.adbPath, ["-s", this.config.deviceId!, "shell", "rm", "-rf", this.remote], { timeoutMs: 1000 }); } catch { /* Preserve the acquisition failure if disconnected during cleanup. */ }
      throw error;
    }
  }

  async capture(scale: CaptureScale, deadline: number): Promise<HelperImage> {
    if (this.dead) throw this.dead;
    if (this.idle) clearTimeout(this.idle);
    this.child!.ref();
    for (const stream of [this.child!.stdin, this.child!.stdout, this.child!.stderr]) (stream as any).ref?.();
    const request = randomUUID();
    const received = this.wait(deadline - performance.now());
    void received.catch(() => undefined);
    this.child!.stdin.write(`${request} ${scale}\n`);
    const { header, buffer } = await received;
    if (this.dead) throw this.dead;
    if (header.request !== request) throw fail("protocol", "Stale screenshot request ID rejected.");
    if (header.status !== "ok") {
      const detail = header.reason === "protected_content" ? "Protected buffer rejected before pixel readback. Capture an ordinary unprotected screen."
        : header.reason === "secure_content" ? "Secure window rejected before pixel readback. Capture an ordinary unprotected screen."
        : header.reason === "protected_composition" ? "Protected composition capability became unavailable. Use a device with protected GPU composition support and rerun doctor."
        : "Display locked/off, geometry changed, or capture uncertain. Unlock or stabilize the display and retry screenshot.";
      throw fail("rejected", `Capture rejected: ${detail} No fallback was attempted.`);
    }
    const { sourceWidth, sourceHeight, rotation, physicalId, captureNanos } = header;
    if (!Number.isSafeInteger(sourceWidth) || sourceWidth < 2 || !Number.isSafeInteger(sourceHeight) || sourceHeight < 2
      || sourceWidth * sourceHeight > 32_000_000 || ![0, 1, 2, 3].includes(rotation)
      || typeof physicalId !== "string" || !/^\d+$/.test(physicalId)
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
    this.idle = setTimeout(() => this.close(), 30_000);
    this.idle.unref();
    this.child!.unref();
    for (const stream of [this.child!.stdin, this.child!.stdout, this.child!.stderr]) (stream as any).unref?.();
    return { buffer, metadata: { captureMethod: "shell_hardware_buffer", requestedScale: String(scale), appliedScale: String(scale),
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
    if (fresh) await session.start(deadline);
    const result = await session.capture(options.scale, deadline);
    if (options.signal?.aborted) throw fail("cancelled", "Screenshot cancelled.");
    if (performance.now() >= deadline) throw fail("timeout", "Screenshot deadline exhausted during decoding.");
    return result;
  } catch (error) { session.close(); throw error; }
  finally { session.busy = false; options.signal?.removeEventListener("abort", abort); }
}

/** Capability probe only: does not capture pixels. Temporary deployment is removed on close. */
export async function probeCaptureHelper(config: RuntimeConfig): Promise<{ status: "supported" | "unavailable" | "incompatible"; detail: string }> {
  const session = new Session(config);
  try {
    await session.start(performance.now() + 5000);
    return { status: "supported", detail: "Shell capture APIs and protected GPU composition available. The helper rejects secure layers and protected output buffers before readback. Live capture and image contents are unverified until screenshot succeeds." };
  } catch (error) {
    return { status: error instanceof CaptureHelperError && error.reason === "incompatible" ? "incompatible" : "unavailable",
      detail: error instanceof Error ? error.message : "Capture helper probe failed; check ADB and reinstall Node package." };
  } finally { session.close(); }
}
