import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ANDROID_AUTO_COMMANDS, isAndroidAutoKey, type AndroidAutoKey } from "./commands.js";
import { autoError } from "./session.js";

const MAX_MESSAGE_BYTES = 8192;
export function androidAutoSocketPath(deviceId: string, baseDir = join(homedir(), ".androperator", "android-auto")): string {
  const hash = createHash("sha256").update(deviceId).digest("hex").slice(0, 24);
  return process.platform === "win32" ? `\\\\.\\pipe\\androperator-dhu-${hash}` : join(baseDir, `${hash}.sock`);
}

export interface DhuInputSession {
  isReady?(): boolean;
  press(key: AndroidAutoKey, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

function reply(socket: Socket, value: unknown): void {
  if (!socket.destroyed) socket.write(JSON.stringify(value) + "\n");
}

/** The socket lease lasts for the whole execution, including intervening phone actions. */
export async function startAndroidAutoBroker(deviceId: string, session: DhuInputSession, path = androidAutoSocketPath(deviceId)) {
  if (process.platform !== "win32") {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
  }
  const clients = new Set<Socket>();
  let owner: Socket | undefined;
  let closing = false;
  const server = createServer(socket => {
    clients.add(socket);
    let buffer = "";
    let inFlight: AbortController | undefined;
    socket.setTimeout(120000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("close", () => {
      clients.delete(socket);
      if (owner === socket) owner = undefined;
      if (inFlight) {
        inFlight.abort();
        void close();
      }
    });
    socket.on("data", chunk => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) { socket.destroy(); return; }
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        let request: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("object required");
          request = parsed as Record<string, unknown>;
        } catch {
          socket.destroy(); return;
        }
        const fail = (code: string, message: string) => reply(socket, { id: request.id, ok: false, code, message });
        if (typeof request.id !== "string" || request.id.length > 100 || request.deviceId !== deviceId) {
          fail("EXECUTION_VALIDATION_FAILED", "Invalid Android Auto request identity"); continue;
        }
        if (request.operation === "status") { reply(socket, { id: request.id, ok: true, deviceId, ready: session.isReady?.() ?? true }); continue; }
        if (request.operation === "stop") {
          reply(socket, { id: request.id, ok: true });
          void close(); return;
        }
        if (request.operation === "acquire") {
          if (session.isReady?.() === false) { fail("ANDROID_AUTO_NOT_READY", "DHU is still connecting"); continue; }
          if (owner !== undefined || closing) { fail("EXECUTION_CONFLICT_IN_FLIGHT", "Android Auto session is busy"); continue; }
          owner = socket;
          reply(socket, { id: request.id, ok: true }); continue;
        }
        if (request.operation !== "press" || owner !== socket || inFlight !== undefined || closing) {
          fail("EXECUTION_CONFLICT_IN_FLIGHT", "Acquire an idle Android Auto execution lease first"); continue;
        }
        if (typeof request.key !== "string" || !isAndroidAutoKey(request.key) ||
            !Number.isInteger(request.timeoutMs) || (request.timeoutMs as number) < 1 || (request.timeoutMs as number) > 120000) {
          fail("EXECUTION_VALIDATION_FAILED", "Invalid Android Auto key or timeout"); continue;
        }
        const key = request.key;
        const controller = new AbortController();
        inFlight = controller;
        const timer = setTimeout(() => controller.abort(), request.timeoutMs as number);
        void session.press(key, request.timeoutMs as number, controller.signal).then(() => {
          reply(socket, { id: request.id, ok: true, dhuCommand: ANDROID_AUTO_COMMANDS[key] });
        }, error => {
          fail(typeof error?.code === "string" ? error.code : "ANDROID_AUTO_INPUT_UNCONFIRMED", String(error?.message ?? error));
          void close();
        }).finally(() => { clearTimeout(timer); inFlight = undefined; });
      }
    });
  });
  let closePromise: Promise<void> | undefined;
  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      for (const socket of clients) socket.end();
      try { await session.close(); } finally {
        for (const socket of clients) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    })();
    return closePromise;
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => { server.removeListener("error", reject); resolve(); });
  });
  if (process.platform !== "win32") await chmod(path, 0o600);
  server.on("error", () => { void close(); });
  return { close, closed: new Promise<void>(resolve => server.once("close", resolve)) };
}

export class AndroidAutoClient {
  private buffer = "";
  private pending?: { id: string; resolve: (value: Record<string, unknown>) => void; reject: (error: unknown) => void };
  private failure?: ReturnType<typeof autoError>;
  private constructor(private readonly socket: Socket) {
    socket.on("error", error => this.fail(autoError("ANDROID_AUTO_SESSION_UNAVAILABLE", error.message)));
    socket.on("close", () => this.fail(autoError("ANDROID_AUTO_SESSION_CLOSED", "Android Auto session closed; restart android-auto start")));
    socket.on("data", chunk => {
      this.buffer += chunk.toString();
      if (Buffer.byteLength(this.buffer) > MAX_MESSAGE_BYTES) { this.fail(autoError("ANDROID_AUTO_PROTOCOL_ERROR", "Oversized session response")); return; }
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop()!;
      for (const line of lines) {
        try {
          const response = JSON.parse(line) as Record<string, unknown>;
          if (!this.pending || response.id !== this.pending.id || typeof response.ok !== "boolean") throw new Error("Uncorrelated response");
          const pending = this.pending;
          this.pending = undefined;
          if (response.ok) pending.resolve(response);
          else pending.reject(autoError(typeof response.code === "string" ? response.code : "ANDROID_AUTO_PROTOCOL_ERROR", String(response.message)));
        } catch (error) { this.fail(autoError("ANDROID_AUTO_PROTOCOL_ERROR", String(error))); }
      }
    });
  }
  private fail(error: ReturnType<typeof autoError>): void {
    this.failure = error;
    this.pending?.reject(error);
    this.pending = undefined;
    this.socket.destroy();
  }
  static connect(path: string): AndroidAutoClient {
    return new AndroidAutoClient(createConnection(path));
  }
  async request(deviceId: string, operation: string, timeoutMs: number, key?: AndroidAutoKey, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (this.failure) throw this.failure;
    if (this.pending) throw autoError("EXECUTION_CONFLICT_IN_FLIGHT", "Android Auto request already in flight");
    if (signal?.aborted) throw autoError("RESULT_TRANSPORT_CANCELLED", "Android Auto request canceled before dispatch");
    const id = randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => this.fail(autoError("RESULT_TRANSPORT_CANCELLED", "Android Auto request canceled; delivery may be uncertain"));
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        this.pending = { id, resolve, reject };
        timer = setTimeout(() => this.fail(autoError("COMMAND_TIMEOUT", "Android Auto request timed out; delivery may be uncertain")), timeoutMs);
        signal?.addEventListener("abort", cancel, { once: true });
        this.socket.write(JSON.stringify({ id, deviceId, operation, key, timeoutMs }) + "\n");
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  close(): void { this.socket.end(); }
}
