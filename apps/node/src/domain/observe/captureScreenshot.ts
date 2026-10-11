import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { formatCommandLine } from "../../adapters/android-bridge/adbClient.js";
import { readActiveDisplay } from "./activeDisplay.js";

/** Targeted host capture shared by execution post-processing and evidence bundles. */
export async function captureScreenshot(
  config: RuntimeConfig,
  options: { timeoutMs: number; commandId?: string; taskId?: string; signal?: AbortSignal },
): Promise<Buffer> {
  if (!config.deviceId) throw new Error("Screenshot capture requires a resolved device");
  if (options.timeoutMs <= 0) throw { code: "COMMAND_TIMEOUT", message: "Screenshot budget exhausted" };
  if (options.signal?.aborted) throw options.signal.reason;
  const selectionStarted = performance.now();
  const display = await readActiveDisplay(config, Math.min(options.timeoutMs, 2000), options.signal);
  const remainingMs = options.timeoutMs - (performance.now() - selectionStarted);
  if (remainingMs <= 0) throw { code: "COMMAND_TIMEOUT", message: "Screenshot budget exhausted during display selection" };
  if (options.signal?.aborted) throw options.signal.reason;
  const args = ["-s", config.deviceId, "exec-out", "screencap", "-p", ...(display ? ["-d", display.physicalId] : [])];
  const command = formatCommandLine(config.adbPath, args);
  const start = performance.now();
  const metadata = { commandId: options.commandId, taskId: options.taskId, deviceId: config.deviceId };
  config.logger?.emit({ ts: new Date().toISOString(), level: "debug", event: "adb.command", ...metadata, message: command });
  return await new Promise<Buffer>((resolve, reject) => {
    const proc = config.runner.spawn(config.adbPath, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure: { code: string; message: string } | undefined;
    const onAbort = () => {
      failure ??= options.signal!.reason;
      proc.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      failure = { code: "COMMAND_TIMEOUT", message: "Screenshot capture timed out" };
      proc.kill("SIGKILL");
    }, remainingMs);
    proc.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) {
        failure = { code: "EVIDENCE_CAPTURE_FAILED", message: "Screenshot exceeds 64 MiB capture limit" };
        proc.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    // Drain stderr without logging potentially private device output.
    proc.stderr?.on("data", () => undefined);
    proc.on("error", (error: Error) => { cleanup(); reject(error); });
    proc.on("close", (code: number | null) => {
      cleanup();
      config.logger?.emit({ ts: new Date().toISOString(), level: "debug", event: "adb.complete", ...metadata,
        message: `${command} code=${code ?? "null"} durationMs=${Math.round(performance.now() - start)} stdout=[redacted] stderr=[redacted]` });
      const buffer = Buffer.concat(chunks);
      if (failure) reject({ ...failure, partialBuffer: buffer });
      else if (code !== 0 || buffer.length === 0) reject({ code: "EVIDENCE_CAPTURE_FAILED", message: `screencap failed (exit ${code}, ${buffer.length} bytes)`, partialBuffer: buffer });
      else resolve(buffer);
    });
  });
}
