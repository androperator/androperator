
import { type RuntimeConfig } from "./runtimeConfig.js";

export interface AdbResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function quoteCommandPart(part: string): string {
  if (/^[A-Za-z0-9_./:=,+@%-]+$/.test(part)) {
    return part;
  }
  return JSON.stringify(part);
}

export function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteCommandPart).join(" ");
}

/**
 * Run adb with optional device serial. Does not interpolate payload in shell.
 */
export async function runAdb(
  config: RuntimeConfig,
  args: string[],
  options?: { timeoutMs?: number; logOutput?: boolean; redactedArgs?: string[]; signal?: AbortSignal }
): Promise<AdbResult> {
  const deviceArgs = config.deviceId ? ["-s", config.deviceId, ...args] : args;
  const loggedArgs = config.deviceId ? ["-s", config.deviceId, ...(options?.redactedArgs ?? args)] : (options?.redactedArgs ?? args);
  const start = Date.now();
  config.logger?.emit({
    ts: new Date().toISOString(),
    level: "debug",
    event: "adb.command",
    deviceId: config.deviceId,
    message: formatCommandLine(config.adbPath, loggedArgs),
  });
  const result = await config.runner.run(config.adbPath, deviceArgs, options);
  const durationMs = Date.now() - start;
  config.logger?.emit({
    ts: new Date().toISOString(),
    level: "debug",
    event: "adb.complete",
    deviceId: config.deviceId,
    message: `${formatCommandLine(config.adbPath, loggedArgs)} code=${result.code ?? "null"} durationMs=${durationMs}${options?.logOutput === false ? " stdout=[redacted] stderr=[redacted]" : ` stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`}`,
  });

  if (result.error && (result.error as any).code === "ENOENT") {
    return { stdout: result.stdout, stderr: `ADB command not found at path: ${config.adbPath}`, code: 127 };
  }

  return result;
}

/**
 * Check if adb is available and (optionally) server is reachable.
 */
export async function isAdbAvailable(config: RuntimeConfig): Promise<boolean> {
  const { code, stderr } = await runAdb(config, ["version"], { timeoutMs: 5000 });
  return code === 0 && !stderr.includes("command not found");
}
