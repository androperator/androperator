import http from "node:http";
import { rmSync } from "node:fs";
import type { Server } from "node:http";
import type { Logger } from "../../adapters/logger.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { formatError, formatSuccess, type OutputOptions } from "../output.js";
import { startServer } from "./serve.js";
import {
  cleanupDaemonFiles,
  getDaemonSocketPath,
  isDaemonRunning,
  readDaemonPidMetadata,
  spawnDaemonRun,
  stopDaemon,
  type DaemonPathsOptions,
  withDaemonLock,
  writeDaemonPidMetadata,
} from "../../domain/daemon/lifecycle.cjs";
import type { CliBuildIdentity } from "../../domain/version/compatibility.js";

interface DaemonRunOptions extends DaemonPathsOptions {
  deviceId?: string;
  operatorPackage?: string;
  verbose?: boolean;
  logger?: Logger;
  startServerImpl?: typeof startServer;
}

interface DaemonCommandOptions extends DaemonPathsOptions {
  format: OutputOptions["format"];
  deviceId?: string;
  operatorPackage?: string;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  spawnDaemonRunImpl?: typeof spawnDaemonRun;
}

const DEFAULT_START_TIMEOUT_MS = 3000;
const DEFAULT_START_POLL_INTERVAL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestDaemonJson<T>(socketPath: string, path: string, timeoutMs = 500): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ method: "GET", socketPath, path, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new Error(`Daemon returned HTTP ${res.statusCode ?? 0}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`Daemon request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function isSocketAlive(socketPath: string): Promise<boolean> {
  try {
    const response = await requestDaemonJson<{ ok?: unknown }>(socketPath, "/ping");
    return response.ok === true;
  } catch {
    return false;
  }
}

async function getSocketState(socketPath: string): Promise<"alive" | "missing" | "stale" | "not_ready"> {
  try {
    const response = await requestDaemonJson<{ ok?: unknown }>(socketPath, "/ping");
    return response.ok === true ? "alive" : "not_ready";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return "missing";
    }
    if (code === "ECONNREFUSED" || code === "ENOTSOCK") {
      return "stale";
    }
    return "not_ready";
  }
}

async function readDaemonVersion(socketPath: string): Promise<{ version: string; buildIdentity?: CliBuildIdentity }> {
  const response = await requestDaemonJson<{ version?: unknown; buildIdentity?: unknown }>(socketPath, "/version");
  if (typeof response.version !== "string") {
    throw new Error("Daemon returned invalid version metadata");
  }
  const buildIdentity = response.buildIdentity;
  if (
    buildIdentity !== undefined &&
    (
      typeof buildIdentity !== "object" ||
      buildIdentity === null ||
      Array.isArray(buildIdentity) ||
      typeof (buildIdentity as Partial<CliBuildIdentity>).entryPath !== "string" ||
      (
        typeof (buildIdentity as Partial<CliBuildIdentity>).mtimeMs !== "number" &&
        (buildIdentity as Partial<CliBuildIdentity>).mtimeMs !== null
      ) ||
      (
        typeof (buildIdentity as Partial<CliBuildIdentity>).size !== "number" &&
        (buildIdentity as Partial<CliBuildIdentity>).size !== null
      )
    )
  ) {
    throw new Error("Daemon returned invalid build identity metadata");
  }
  return { version: response.version, buildIdentity: buildIdentity as CliBuildIdentity | undefined };
}

async function waitForOwnedDaemon(
  socketPath: string,
  options: DaemonCommandOptions,
  timeoutMs: number,
  intervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await isSocketAlive(socketPath) && await isDaemonRunning(options.deviceId, options)) {
      return true;
    }
    await delay(intervalMs);
  }
  return false;
}

function daemonSuccess<T>(data: T, options: { format: OutputOptions["format"] }): string {
  return formatSuccess(data, { format: options.format });
}

export async function cmdDaemonRun(options: DaemonRunOptions): Promise<void> {
  const socketPath = getDaemonSocketPath(options.deviceId, options);

  let server: Server | undefined;
  let stopping = false;
  let ownsDaemonFiles = false;
  const cleanupAndExit = (exitCode: number) => {
    if (stopping) {
      return;
    }
    stopping = true;
    const finish = () => {
      cleanupDaemonFiles(options.deviceId, options);
      process.exit(exitCode);
    };
    if (!server) {
      if (ownsDaemonFiles) {
        finish();
      } else {
        process.exit(exitCode);
      }
      return;
    }
    server.close((error) => {
      if (error) {
        process.stderr.write(`Failed to close daemon server: ${String(error)}\n`);
      }
      finish();
    });
  };

  process.once("SIGTERM", () => cleanupAndExit(0));
  process.once("SIGINT", () => cleanupAndExit(0));

  try {
    await withDaemonLock(options.deviceId, async () => {
      const startServerImpl = options.startServerImpl ?? startServer;
      server = await startServerImpl({
        socketPath,
        daemonCli: true,
        daemonDeviceId: options.deviceId,
        operatorPackage: options.operatorPackage,
        verbose: options.verbose ?? false,
        logger: options.logger,
      });
      writeDaemonPidMetadata(options.deviceId, { pid: process.pid, startedAt: Date.now() }, options);
      ownsDaemonFiles = true;
    }, options);
  } catch (error) {
    if (ownsDaemonFiles) {
      cleanupDaemonFiles(options.deviceId, options);
    }
    throw error;
  }

  return new Promise(() => {});
}

export async function cmdDaemonStart(options: DaemonCommandOptions): Promise<string> {
  const socketPath = getDaemonSocketPath(options.deviceId, options);
  const timeoutMs = options.pollTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const intervalMs = options.pollIntervalMs ?? DEFAULT_START_POLL_INTERVAL_MS;
  const initialState = await getSocketState(socketPath);
  if (initialState === "alive") {
    if (await waitForOwnedDaemon(socketPath, options, timeoutMs, intervalMs)) {
      return daemonSuccess({ ok: true, daemon: { status: "already_running", socketPath } }, options);
    }
    return formatError({
      code: ERROR_CODES.DAEMON_START_FAILED,
      message: "Daemon socket is responding but is not owned by a managed Androperator daemon.",
      details: { socketPath },
    }, { format: options.format });
  }

  try {
    if (initialState === "stale") {
      const lockedState = await withDaemonLock(options.deviceId, async () => {
        const refreshedState = await getSocketState(socketPath);
        if (refreshedState === "stale") {
          rmSync(socketPath, { force: true });
          return "missing" as const;
        }
        return refreshedState;
      }, options);
      if (lockedState === "alive") {
        if (await waitForOwnedDaemon(socketPath, options, timeoutMs, intervalMs)) {
          return daemonSuccess({ ok: true, daemon: { status: "already_running", socketPath } }, options);
        }
        return formatError({
          code: ERROR_CODES.DAEMON_START_FAILED,
          message: "Daemon socket is responding but is not owned by a managed Androperator daemon.",
          details: { socketPath },
        }, { format: options.format });
      }
      if (lockedState === "not_ready") {
        if (await waitForOwnedDaemon(socketPath, options, timeoutMs, intervalMs)) {
          return daemonSuccess({ ok: true, daemon: { status: "already_running", socketPath } }, options);
        }
        return formatError({
          code: ERROR_CODES.DAEMON_START_FAILED,
          message: `Daemon socket exists but did not become ready within ${timeoutMs}ms.`,
          details: { socketPath, timeoutMs },
        }, { format: options.format });
      }
    } else if (initialState === "not_ready") {
      if (await waitForOwnedDaemon(socketPath, options, timeoutMs, intervalMs)) {
        return daemonSuccess({ ok: true, daemon: { status: "already_running", socketPath } }, options);
      }
      return formatError({
        code: ERROR_CODES.DAEMON_START_FAILED,
        message: `Daemon socket exists but did not become ready within ${timeoutMs}ms.`,
        details: { socketPath, timeoutMs },
      }, { format: options.format });
    }

    const spawnStatus = await withDaemonLock(options.deviceId, async () => {
      const refreshedState = await getSocketState(socketPath);
      if (refreshedState === "alive") {
        return await isDaemonRunning(options.deviceId, options) ? "already_running" : "unowned";
      }
      if (refreshedState === "not_ready") {
        return "not_ready";
      }
      if (refreshedState === "stale") {
        rmSync(socketPath, { force: true });
      }
      const spawnImpl = options.spawnDaemonRunImpl ?? spawnDaemonRun;
      spawnImpl(options.deviceId, options.operatorPackage, options);
      return "spawned";
    }, options);
    if (spawnStatus === "already_running") {
      return daemonSuccess({ ok: true, daemon: { status: "already_running", socketPath } }, options);
    }
    if (spawnStatus === "unowned") {
      if (await waitForOwnedDaemon(socketPath, options, timeoutMs, intervalMs)) {
        return daemonSuccess({ ok: true, daemon: { status: "already_running", socketPath } }, options);
      }
      return formatError({
        code: ERROR_CODES.DAEMON_START_FAILED,
        message: "Daemon socket is responding but is not owned by a managed Androperator daemon.",
        details: { socketPath },
      }, { format: options.format });
    }
    if (spawnStatus === "not_ready") {
      if (await waitForOwnedDaemon(socketPath, options, timeoutMs, intervalMs)) {
        return daemonSuccess({ ok: true, daemon: { status: "already_running", socketPath } }, options);
      }
      return formatError({
        code: ERROR_CODES.DAEMON_START_FAILED,
        message: `Daemon socket exists but did not become ready within ${timeoutMs}ms.`,
        details: { socketPath, timeoutMs },
      }, { format: options.format });
    }
  } catch (error) {
    return formatError({
      code: ERROR_CODES.DAEMON_START_FAILED,
      message: "Failed to spawn the Androperator daemon.",
      details: { socketPath, error: String(error) },
    }, { format: options.format });
  }

  if (await waitForOwnedDaemon(socketPath, options, timeoutMs, intervalMs)) {
    return daemonSuccess({ ok: true, daemon: { status: "started", socketPath } }, options);
  }

  return formatError({
    code: ERROR_CODES.DAEMON_START_FAILED,
    message: `Daemon did not become ready within ${timeoutMs}ms.`,
    details: { socketPath, timeoutMs },
  }, { format: options.format });
}

export async function cmdDaemonStop(options: DaemonCommandOptions): Promise<string> {
  const socketPath = getDaemonSocketPath(options.deviceId, options);
  try {
    const status = await stopDaemon(options.deviceId, options);
    return daemonSuccess({ ok: true, daemon: { status, socketPath } }, options);
  } catch (error) {
    return formatError({
      code: ERROR_CODES.DAEMON_STOP_FAILED,
      message: "Failed to stop the Androperator daemon.",
      details: { socketPath, error: String(error) },
    }, { format: options.format });
  }
}

export async function cmdDaemonStatus(options: DaemonCommandOptions): Promise<string> {
  const socketPath = getDaemonSocketPath(options.deviceId, options);
  const socketAlive = await isSocketAlive(socketPath);
  if (!socketAlive) {
    return daemonSuccess({ ok: true, daemon: { status: "not_running", socketPath } }, options);
  }

  if (!(await isDaemonRunning(options.deviceId, options))) {
    return daemonSuccess({ ok: true, daemon: { status: "unowned", socketPath } }, options);
  }

  const metadata = readDaemonPidMetadata(options.deviceId, options);
  let versionInfo: { version: string; buildIdentity?: CliBuildIdentity };
  try {
    versionInfo = await readDaemonVersion(socketPath);
  } catch {
    return daemonSuccess({ ok: true, daemon: { status: "not_running", socketPath } }, options);
  }
  const uptimeSeconds = metadata ? Math.max(0, Math.floor((Date.now() - metadata.startedAt) / 1000)) : 0;
  return daemonSuccess({
    ok: true,
    daemon: {
      status: "running",
      pid: metadata?.pid ?? null,
      version: versionInfo.version,
      buildIdentity: versionInfo.buildIdentity,
      uptimeSeconds,
      socketPath,
    },
  }, options);
}

export async function cmdDaemonRestart(options: DaemonCommandOptions): Promise<string> {
  const stopResult = await cmdDaemonStop(options);
  const parsedStopResult = JSON.parse(stopResult) as { code?: unknown };
  if (typeof parsedStopResult.code === "string") {
    return stopResult;
  }
  return await cmdDaemonStart(options);
}
