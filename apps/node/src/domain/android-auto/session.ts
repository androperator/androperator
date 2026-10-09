import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PNG } from "pngjs";
import { ANDROID_AUTO_COMMANDS, type AndroidAutoKey } from "./commands.js";

export function autoError(code: string, message: string): { code: string; message: string } {
  return { code, message };
}

/** Owns one DHU process and its stdin; never attaches to arbitrary running processes. */
export class DhuSession {
  private output = "";
  private outputBytes = 0;
  private lastErrorAt = -1;
  readonly closed: Promise<void>;
  private ended = false;
  private inputClosed = false;
  private outputLine = "";
  private busy = false;
  private closePromise?: Promise<void>;
  private constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly directory: string) {
    this.closed = new Promise(resolve => child.once("close", () => resolve()));
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      this.outputBytes += Buffer.byteLength(text);
      this.output = (this.output + text).slice(-16384);
      const lines = (this.outputLine + text).split("\n");
      this.outputLine = lines.pop()!.slice(-2048);
      if (lines.some(line => /\[E\]|unknown command|invalid command/i.test(line))) this.lastErrorAt = this.outputBytes;
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", error => { this.output = error.message; this.inputClosed = true; });
    child.on("close", () => { this.ended = true; });
    child.stdin.on("error", () => { this.inputClosed = true; });
  }

  static async start(binary: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<DhuSession> {
    const directory = await mkdtemp(join(tmpdir(), "androperator-dhu-"));
    await writeFile(join(directory, "headunit.ini"), "[general]\ninputmode=rotary\nresolution=800x480\ndpi=160\n", { mode: 0o600 });
    const child = spawn(binary, ["--config=headunit.ini", "--input=rotary", `--adb=127.0.0.1:${port}`], {
      cwd: directory, stdio: "pipe", windowsHide: true,
    });
    const session = new DhuSession(child, directory);
    try {
      // A valid frame proves the projection session is ready, unlike a process exit code
      // (DHU 2.0 can exit zero after a failed connection).
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        session.checkAlive(signal);
        try {
          await session.barrier(Math.min(1000, deadline - Date.now()), signal);
          return session;
        } catch (error) {
          session.checkAlive(signal);
          if ((error as { code?: string }).code !== "ANDROID_AUTO_INPUT_UNCONFIRMED") throw error;
        }
      }
      throw autoError("ANDROID_AUTO_NOT_READY", "DHU did not produce a projection frame. Start the phone's Android Auto head unit server and complete its setup prompts.");
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  private checkAlive(signal?: AbortSignal): void {
    if (signal?.aborted) throw autoError("RESULT_TRANSPORT_CANCELLED", "Android Auto session canceled");
    if (this.ended || this.inputClosed) throw autoError("ANDROID_AUTO_SESSION_CLOSED", `DHU exited or its input closed: ${this.output.slice(-2000)}`);
  }

  private write(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child.stdin.write(command + "\n", error => error ? reject(error) : resolve());
    });
  }

  private async barrier(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const name = `frame-${randomUUID()}.png`;
    const path = join(this.directory, name);
    const deadline = Date.now() + timeoutMs;
    try {
      await this.write(`screenshot ${name}`);
      while (Date.now() < deadline) {
        this.checkAlive(signal);
        try {
          const bytes = await readFile(path);
          // The file may still be being written. Accept only a complete, decodable PNG.
          PNG.sync.read(bytes, { checkCRC: true });
          return;
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT" && !(error instanceof Error)) throw error;
        }
        await delay(Math.min(40, Math.max(1, deadline - Date.now())), undefined, { signal });
      }
      throw autoError("ANDROID_AUTO_INPUT_UNCONFIRMED", "DHU did not complete the frame barrier; the input may have been delivered. Do not replay it automatically.");
    } finally {
      await rm(path, { force: true });
    }
  }

  async press(key: AndroidAutoKey, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (this.busy) throw autoError("EXECUTION_CONFLICT_IN_FLIGHT", "DHU already has an input in flight");
    this.checkAlive(signal);
    this.busy = true;
    const startOutput = this.outputBytes;
    try {
      await this.write(ANDROID_AUTO_COMMANDS[key]);
      await this.barrier(timeoutMs, signal);
      if (this.lastErrorAt > startOutput) throw autoError("ANDROID_AUTO_INPUT_UNCONFIRMED", `DHU reported an error after input: ${this.output.slice(-2000)}`);
    } catch (error) {
      // An ambiguous input must not remain queued for a later caller.
      await this.close();
      throw error;
    } finally {
      this.busy = false;
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOwned();
    return this.closePromise;
  }

  private async closeOwned(): Promise<void> {
    if (!this.ended && this.child.pid !== undefined) {
      this.child.kill("SIGTERM");
      await Promise.race([this.closed, delay(500, undefined, { ref: false })]);
      if (!this.ended) {
        this.child.kill("SIGKILL");
        await Promise.race([this.closed, delay(500, undefined, { ref: false })]);
      }
    }
    this.ended = true;
    await rm(this.directory, { recursive: true, force: true });
  }
}
