import { spawn } from "node:child_process";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number | null;
  error?: Error;
}

export interface ProcessRunner {
  run(command: string, args: string[], options?: { timeoutMs?: number; cwd?: string; input?: string }): Promise<ProcessResult>;
  runShell(command: string, options?: { timeoutMs?: number; cwd?: string }): Promise<ProcessResult>;
  // For logcat/streaming
  spawn(command: string, args: string[], options?: { detached?: boolean; stdio?: any; shell?: boolean; env?: NodeJS.ProcessEnv }): any;
}

// One set of parent hooks covers concurrent runs without accumulating signal listeners.
const ownedGroups = new Set<number>();
const interruptionSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function killGroup(pid: number): void {
  try { process.kill(-pid, "SIGKILL"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function cleanupGroups(): void {
  for (const pid of ownedGroups) {
    try { killGroup(pid); } catch { /* Cleanup must not prevent parent termination. */ }
  }
}

function removeParentHooks(): void {
  process.removeListener("exit", cleanupGroups);
  for (const signal of interruptionSignals) process.removeListener(signal, onInterruption);
}

function onInterruption(signal: NodeJS.Signals): void {
  cleanupGroups();
  // Restore Node's default signal handling when the application has no handler.
  if (process.listenerCount(signal) === 1) {
    removeParentHooks();
    process.kill(process.pid, signal);
  }
}

function trackGroup(pid: number): () => void {
  if (ownedGroups.size === 0) {
    process.on("exit", cleanupGroups);
    for (const signal of interruptionSignals) process.prependListener(signal, onInterruption);
  }
  ownedGroups.add(pid);
  return () => {
    ownedGroups.delete(pid);
    if (ownedGroups.size === 0) removeParentHooks();
  };
}

export class NodeProcessRunner implements ProcessRunner {
  async run(command: string, args: string[], options?: { timeoutMs?: number; cwd?: string; input?: string }): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const stdin = options?.input !== undefined ? "pipe" : "ignore";
      const proc = spawn(command, args, {
        cwd: options?.cwd,
        detached: process.platform !== "win32",
        stdio: [stdin, "pipe", "pipe"],
        shell: false,
      });
      const untrack = process.platform !== "win32" && proc.pid !== undefined
        ? trackGroup(proc.pid) : () => {};
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d) => (stdout += d.toString()));
      proc.stderr?.on("data", (d) => (stderr += d.toString()));

      // A tool may exit or time out before consuming all supplied input.
      proc.stdin?.on("error", () => {});
      if (options?.input !== undefined) {
        proc.stdin?.write(options.input);
        proc.stdin?.end();
      }

      const timeoutMs = options?.timeoutMs ?? 30_000;
      const t = setTimeout(() => {
        // Kill the owned group: SDK and shell children may keep output pipes open.
        if (process.platform !== "win32" && proc.pid !== undefined) {
          try {
            killGroup(proc.pid);
          } catch {
            proc.kill("SIGKILL");
          }
        } else {
          proc.kill("SIGKILL");
        }
        untrack();
        proc.stdin?.destroy();
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        // Settle here rather than waiting for close or accepting a later zero exit.
        resolve({ stdout, stderr: `${stderr}\nProcess timed out after ${timeoutMs}ms`, code: null });
      }, timeoutMs);

      proc.on("error", (err) => {
        clearTimeout(t);
        untrack();
        resolve({ stdout, stderr, code: (err as any).code === "ENOENT" ? 127 : 1, error: err });
      });

      proc.on("close", (code) => {
        clearTimeout(t);
        untrack();
        resolve({ stdout, stderr, code: code ?? null });
      });
    });
  }

  async runShell(command: string, options?: { timeoutMs?: number; cwd?: string }): Promise<ProcessResult> {
    const isWin = process.platform === "win32";
    if (isWin) {
      return this.run("cmd.exe", ["/c", command], options);
    }
    return this.run("bash", ["-lc", command], options);
  }

  spawn(command: string, args: string[], options?: { detached?: boolean; stdio?: any; shell?: boolean; env?: NodeJS.ProcessEnv }): any {
    const detached = options?.detached ?? false;
    const stdio = options?.stdio ?? (detached ? ["ignore", "ignore", "ignore"] : ["ignore", "pipe", "pipe"]);
    return spawn(command, args, {
      detached,
      stdio,
      shell: options?.shell ?? false,
      env: options?.env,
    });
  }
}
