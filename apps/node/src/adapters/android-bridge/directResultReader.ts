import { createHash, randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { runAdb } from "./adbClient.js";
import { broadcastAgentCommand } from "./broadcastAgentCommand.js";
import { parseTerminalEnvelope } from "./envelopeParser.js";
import type { RuntimeConfig } from "./runtimeConfig.js";
import type { LogcatResult, LogcatResultOptions } from "./logcatResultReader.js";
import { ERROR_CODES, isClawperatorError } from "../../contracts/errors.js";

export const DIRECT_RESULT_ACTION = "app.clawperator.operator.ACTION_PREPARE_RESULT_CONNECTION";
export const MAX_DIRECT_RESULT_BYTES = 32 * 1024 * 1024;
const CONTROL_FRAME_BYTES = 4096;

/** Bounded, linear copying even when a large frame arrives in tiny TCP fragments. */
export class DirectFrameReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private remaining: Buffer = Buffer.alloc(0);
  constructor(socket: Socket) { this.iterator = socket[Symbol.asyncIterator](); }
  private async readExactly(size: number): Promise<Buffer> {
    const result = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      if (this.remaining.length === 0) {
        const next = await this.iterator.next();
        if (next.done) throw new Error("Direct result connection closed before frame completion");
        this.remaining = next.value;
      }
      const copied = Math.min(size - offset, this.remaining.length);
      this.remaining.copy(result, offset, 0, copied);
      this.remaining = this.remaining.subarray(copied);
      offset += copied;
    }
    return result;
  }
  async frame(limit = CONTROL_FRAME_BYTES): Promise<Buffer> {
    const size = (await this.readExactly(4)).readUInt32BE();
    if (size === 0 || size > limit) throw new Error("Invalid direct result frame length");
    return this.readExactly(size);
  }
  async control(type: string): Promise<Record<string, unknown>> {
    const value = JSON.parse((await this.frame()).toString("utf8"));
    if (!value || value.type !== type) throw new Error(`Expected direct result ${type} frame`);
    return value;
  }
}

export function writeDirectFrame(socket: Socket, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  socket.write(Buffer.concat([header, bytes]));
}

/** Experimental, per-command result connection. Never retries dispatch or falls back to logcat. */
export async function waitForDirectResult(
  config: RuntimeConfig,
  options: LogcatResultOptions,
  onBroadcast: (beginDispatchCapture: () => void, sessionId: string) => Promise<{ success: boolean }>,
): Promise<LogcatResult> {
  const sessionId = randomUUID();
  const started = performance.now();
  let socket: Socket | undefined;
  let port: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure: Error | undefined;
  let failureCode: string = ERROR_CODES.RESULT_TRANSPORT_FAILED;
  let timingConfirmation = "missing";
  let dispatched = false;
  let acceptedResult: Extract<LogcatResult, { ok: true }> | undefined;
  const timings: Record<string, number> = {};
  const fail = (error: Error, code: string = ERROR_CODES.RESULT_TRANSPORT_FAILED) => {
    if (failure === undefined) { failure = error; failureCode = code; }
    socket?.destroy(error);
  };
  const cancel = () => {
    const reason = options.cancelSignal?.reason;
    fail(new Error(isClawperatorError(reason) ? reason.message : "Direct result wait canceled; dispatched actions are not replayed"),
      isClawperatorError(reason) ? reason.code : ERROR_CODES.RESULT_TRANSPORT_CANCELLED);
  };
  const checkActive = () => { if (failure) throw failure; };
  const armDeadline = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(new Error("Direct result deadline exceeded"), ERROR_CODES.COMMAND_TIMEOUT), ms);
  };
  try {
    if (!config.deviceId) throw new Error("Direct result connection requires a resolved device");
    options.cancelSignal?.addEventListener("abort", cancel, { once: true });
    if (options.cancelSignal?.aborted) cancel();
    checkActive();
    armDeadline(10_000);
    const prepared = await broadcastAgentCommand(
      { ...config, actionAgentCommand: DIRECT_RESULT_ACTION },
      JSON.stringify({ protocol: 1, sessionId, commandId: options.commandId, taskId: options.taskId,
        lifetimeMs: Math.min(options.timeoutMs + 15_000, 150_000) }),
      { timeoutMs: 5000 },
    );
    checkActive();
    if (!prepared.success) throw new Error("Could not prepare Operator result connection");
    const forward = await runAdb(config, ["forward", "tcp:0", `localabstract:${config.operatorPackage}.result.${sessionId}`], { timeoutMs: 5000 });
    if (forward.code === 0 && /^\d+$/.test(forward.stdout.trim())) port = Number(forward.stdout.trim());
    checkActive();
    if (port === undefined || port < 1 || port > 65535) throw new Error("Could not allocate device result forward");
    socket = createConnection({ host: "127.0.0.1", port });
    // Keep an error listener installed even between reads; the iterator also observes failures.
    socket.on("error", error => { failure ??= error; });
    await once(socket, "connect");
    socket.setNoDelay(true);
    const reader = new DirectFrameReader(socket);
    const ready = await reader.control("ready");
    if (ready.protocol !== 1 || ready.sessionId !== sessionId || ready.operatorPackage !== config.operatorPackage ||
        ready.commandId !== options.commandId || ready.taskId !== options.taskId) {
      throw new Error("Direct result handshake identity or protocol mismatch");
    }
    const pingStarted = performance.now();
    writeDirectFrame(socket, { type: "ping", sessionId });
    await reader.control("pong");
    timings.handshakeRoundTripMs = performance.now() - pingStarted;
    timings.connectionSetupMs = performance.now() - started;
    checkActive();
    armDeadline(options.timeoutMs);
    const dispatchStarted = performance.now();
    dispatched = true;
    // Observe errors immediately, but do not delay receipt on the adb process exiting.
    void onBroadcast(() => {}, sessionId).then(result => {
      if (!result.success) fail(new Error("Command broadcast failed; execution outcome may be unknown"));
    }, error => fail(error instanceof Error ? error : new Error(String(error))));
    const header = await reader.control("result");
    const receiptStarted = performance.now();
    timings.dispatchToResultHeaderMs = receiptStarted - dispatchStarted;
    if (header.sessionId !== sessionId || header.commandId !== options.commandId || header.taskId !== options.taskId ||
        !Number.isInteger(header.byteLength) || (header.byteLength as number) < 1 || (header.byteLength as number) > MAX_DIRECT_RESULT_BYTES) {
      throw new Error("Invalid direct result metadata");
    }
    const bytes = await reader.frame(header.byteLength as number);
    timings.resultReceiveMs = performance.now() - receiptStarted;
    if (bytes.length !== header.byteLength || createHash("sha256").update(bytes).digest("hex") !== header.sha256) {
      throw new Error("Direct result length or checksum mismatch");
    }
    const parsed = parseTerminalEnvelope(bytes.toString("utf8"), options.commandId);
    if (!parsed || parsed === "malformed" || parsed.envelope.taskId !== options.taskId) throw new Error("Invalid direct result envelope");
    timings.resultReceiveAndValidateMs = performance.now() - receiptStarted;
    timings.resultBytes = bytes.length;
    checkActive();
    acceptedResult = { ok: true, ...parsed };
    // Receipt is already authoritative. Missing optional timing confirmation cannot undo it.
    armDeadline(1000);
    writeDirectFrame(socket, { type: "ack", sessionId });
    const completion = await reader.control("timing");
    for (const key of ["androidResultWriteMs", "androidResultAckRoundTripMs"]) {
      const value = completion[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid direct result timing");
      timings[key] = value;
    }
    timingConfirmation = "received";
    return acceptedResult;
  } catch (error) {
    if (acceptedResult) return acceptedResult;
    return { ok: false, code: failureCode,
      error: error instanceof Error ? error.message : String(error),
      diagnostics: { transport: "direct", dispatchAttempted: dispatched, executionPosition: "unknown", ...timings } };
  } finally {
    clearTimeout(timer);
    options.cancelSignal?.removeEventListener("abort", cancel);
    socket?.destroy();
    if (port !== undefined) {
      const removed = await runAdb(config, ["forward", "--remove", `tcp:${port}`], { timeoutMs: 2000 }).catch(() => undefined);
      if (removed?.code !== 0) config.logger?.emit({ ts: new Date().toISOString(), level: "warn", event: "transport.direct.cleanup_failed",
        commandId: options.commandId, taskId: options.taskId, deviceId: config.deviceId, message: `Could not remove owned forward tcp:${port}` });
    }
    config.logger?.emit({ ts: new Date().toISOString(), level: "info", event: "transport.direct.timing",
      commandId: options.commandId, taskId: options.taskId, deviceId: config.deviceId,
      message: JSON.stringify({ transport: "direct", outcome: acceptedResult ? "received" : "failed", timingConfirmation, ...timings,
        totalTransportLifecycleMs: performance.now() - started }) });
  }
}
