import type { ProcessRunner, ProcessResult } from "../../adapters/android-bridge/processRunner.js";

/** One capture owns a deadline and cached device inventory; later work cannot dispatch after it. */
export class EvidenceBudgetRunner implements ProcessRunner {
  private readonly deadlineController = new AbortController();
  get signal(): AbortSignal { return this.deadlineController.signal; }
  private inventory?: ProcessResult;
  private readonly children = new Set<ReturnType<ProcessRunner["spawn"]>>();
  private readonly timer: NodeJS.Timeout;
  constructor(private readonly delegate: ProcessRunner, private readonly deadline: number) {
    this.timer = setTimeout(() => this.expire(), this.remaining());
  }
  private expire(): void {
    this.deadlineController.abort({ code: "COMMAND_TIMEOUT", message: "Evidence capture budget exhausted", details: { deadlineOwner: "evidence_capture" } });
    this.close();
  }
  remaining(): number { return Math.max(0, Math.floor(this.deadline - performance.now())); }
  private check(): number {
    const remaining = this.remaining();
    if (remaining <= 0) {
      this.expire();
      throw this.signal.reason;
    }
    return remaining;
  }
  async run(command: string, args: string[], options?: { timeoutMs?: number; cwd?: string; input?: string }): Promise<ProcessResult> {
    const timeoutMs = Math.min(this.check(), options?.timeoutMs ?? 30_000);
    const devices = (args.length === 1 && args[0] === "devices") || (args.length === 3 && args[0] === "-s" && args[2] === "devices");
    if (devices && this.inventory) return this.inventory;
    const result = await this.delegate.run(command, args, { ...options, timeoutMs });
    if (devices && result.code === 0) this.inventory = result;
    return result;
  }
  async runShell(): Promise<ProcessResult> { throw new Error("Evidence capture does not use shell commands"); }
  spawn(command: string, args: string[], options?: Parameters<ProcessRunner["spawn"]>[2]): ReturnType<ProcessRunner["spawn"]> {
    this.check();
    const child = this.delegate.spawn(command, args, options);
    this.children.add(child);
    child.once("close", () => this.children.delete(child));
    child.once("error", () => this.children.delete(child));
    return child;
  }
  close(): void {
    clearTimeout(this.timer);
    for (const child of this.children) child.kill("SIGKILL");
    this.children.clear();
  }
}
