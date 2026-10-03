import { execFileSync, spawn } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ANDROPERATOR_RUN_ID_ENV_VAR } from "../../contracts/logging.js";

export interface DaemonPathsOptions {
  baseDir?: string;
  processController?: {
    isAlive(pid: number): boolean;
    isDaemonProcess?(pid: number, metadata: DaemonMetadata): boolean;
    kill(pid: number, signal: NodeJS.Signals): void;
  };
  terminationTimeoutMs?: number;
  terminationPollIntervalMs?: number;
  cliEntryPath?: string;
  lockTimeoutMs?: number;
  lockPollIntervalMs?: number;
}

export interface DaemonMetadata {
  pid: number;
  startedAt: number;
  daemonKey: string;
  cliEntryPath: string;
  rawDeviceId?: string;
}

const DEFAULT_TERMINATION_TIMEOUT_MS = 2000;
const DEFAULT_TERMINATION_POLL_INTERVAL_MS = 100;
const DEFAULT_LOCK_TIMEOUT_MS = 3000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 25;

interface DaemonLockMetadata {
  pid: number;
  createdAt: number;
}

function getProcessController(options?: DaemonPathsOptions): NonNullable<DaemonPathsOptions["processController"]> {
  return options?.processController ?? {
    isAlive(pid: number): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "EPERM";
      }
    },
    kill(pid: number, signal: NodeJS.Signals): void {
      process.kill(pid, signal);
    },
    isDaemonProcess(pid: number, metadata: DaemonMetadata): boolean {
      try {
        const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
          encoding: "utf8",
          timeout: 1000,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (!/\bdaemon\s+run\b/.test(command) || !command.includes(metadata.cliEntryPath)) {
          return false;
        }
        if (metadata.rawDeviceId !== undefined && metadata.rawDeviceId.trim().length > 0) {
          return command.includes("--device") && command.includes(metadata.rawDeviceId);
        }
        return !command.includes("--device");
      } catch {
        return false;
      }
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDaemonMetadata(path: string): DaemonMetadata | undefined {
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (raw.length === 0) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<DaemonMetadata>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.startedAt === "number" &&
      Number.isFinite(parsed.startedAt) &&
      typeof parsed.daemonKey === "string" &&
      parsed.daemonKey.length > 0 &&
      typeof parsed.cliEntryPath === "string" &&
      parsed.cliEntryPath.length > 0 &&
      (parsed.rawDeviceId === undefined || typeof parsed.rawDeviceId === "string")
    ) {
      return {
        pid: parsed.pid,
        startedAt: parsed.startedAt,
        daemonKey: parsed.daemonKey,
        cliEntryPath: parsed.cliEntryPath,
        rawDeviceId: parsed.rawDeviceId,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readDaemonLockMetadata(path: string): DaemonLockMetadata | undefined {
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (raw.length === 0) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<DaemonLockMetadata>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt)
    ) {
      return { pid: parsed.pid, createdAt: parsed.createdAt };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function removeDaemonFiles(rawDeviceId: string | undefined, options?: DaemonPathsOptions): void {
  rmSync(getDaemonPidPath(rawDeviceId, options), { force: true });
  rmSync(getDaemonSocketPath(rawDeviceId, options), { force: true });
}

function removeDaemonPidMetadata(rawDeviceId: string | undefined, metadata: DaemonMetadata, options?: DaemonPathsOptions): void {
  const pidPath = getDaemonPidPath(rawDeviceId, options);
  if (metadataMatches(readDaemonMetadata(pidPath), metadata)) {
    rmSync(pidPath, { force: true });
  }
}

function metadataMatches(left: DaemonMetadata | undefined, right: DaemonMetadata): boolean {
  return left?.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.daemonKey === right.daemonKey &&
    left.cliEntryPath === right.cliEntryPath &&
    left.rawDeviceId === right.rawDeviceId;
}

function isDaemonProcess(metadata: DaemonMetadata, controller: NonNullable<DaemonPathsOptions["processController"]>): boolean {
  return controller.isDaemonProcess?.(metadata.pid, metadata) ?? true;
}

export function sanitizeDaemonKey(rawDeviceId: string | undefined): string {
  if (rawDeviceId === undefined || rawDeviceId.trim().length === 0) {
    return "default";
  }
  return `id-${Buffer.from(rawDeviceId, "utf8").toString("base64url")}`;
}

export function getDaemonDir(options?: DaemonPathsOptions): string {
  const dir = options?.baseDir ?? join(homedir(), ".androperator", "daemon");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stats = statSync(dir);
  if (!stats.isDirectory()) {
    throw new Error(`${dir} is not a directory`);
  }
  const currentMode = stats.mode & 0o777;
  if (currentMode !== 0o700) {
    chmodSync(dir, 0o700);
  }
  return dir;
}

export function getDaemonSocketPath(rawDeviceId: string | undefined, options?: DaemonPathsOptions): string {
  return join(getDaemonDir(options), `daemon-${sanitizeDaemonKey(rawDeviceId)}.sock`);
}

export function getDaemonPidPath(rawDeviceId: string | undefined, options?: DaemonPathsOptions): string {
  return join(getDaemonDir(options), `daemon-${sanitizeDaemonKey(rawDeviceId)}.pid`);
}

export function getDaemonLogPath(rawDeviceId: string | undefined, options?: DaemonPathsOptions): string {
  return join(getDaemonDir(options), `daemon-${sanitizeDaemonKey(rawDeviceId)}.log`);
}

export function getDaemonLockPath(rawDeviceId: string | undefined, options?: DaemonPathsOptions): string {
  return join(getDaemonDir(options), `daemon-${sanitizeDaemonKey(rawDeviceId)}.lock`);
}

export async function withDaemonLock<T>(
  rawDeviceId: string | undefined,
  fn: () => Promise<T> | T,
  options?: DaemonPathsOptions
): Promise<T> {
  const lockPath = getDaemonLockPath(rawDeviceId, options);
  const timeoutMs = options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pollIntervalMs = options?.lockPollIntervalMs ?? DEFAULT_LOCK_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        const metadata = readDaemonLockMetadata(lockPath);
        if (metadata && !isPidAlive(metadata.pid)) {
          rmSync(lockPath, { force: true });
          continue;
        }
      }
      if (code !== "EEXIST" || Date.now() >= deadline) {
        throw error;
      }
      await delay(pollIntervalMs);
    }
  }

  try {
    return await fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

export async function isDaemonRunning(rawDeviceId: string | undefined, options?: DaemonPathsOptions): Promise<boolean> {
  const metadata = readDaemonMetadata(getDaemonPidPath(rawDeviceId, options));
  if (!metadata) {
    return false;
  }
  const controller = getProcessController(options);
  return controller.isAlive(metadata.pid) && isDaemonProcess(metadata, controller);
}

export async function stopDaemon(
  rawDeviceId: string | undefined,
  options?: DaemonPathsOptions
): Promise<"stopped" | "not_running"> {
  return await withDaemonLock(rawDeviceId, async () => {
    const pidPath = getDaemonPidPath(rawDeviceId, options);
    const metadata = readDaemonMetadata(pidPath);
    if (!metadata) {
      return "not_running";
    }

    const controller = getProcessController(options);
    if (!controller.isAlive(metadata.pid)) {
      // A stale PID file does not prove ownership of the socket path. Another
      // process may have bound it after this daemon exited, so only clear our
      // metadata. Daemon start can later remove a confirmed stale socket.
      removeDaemonPidMetadata(rawDeviceId, metadata, options);
      return "not_running";
    }

    if (!isDaemonProcess(metadata, controller)) {
      // Do not unlink a socket belonging to an unverified process, including
      // a reused PID or another Androperator checkout.
      removeDaemonPidMetadata(rawDeviceId, metadata, options);
      return "not_running";
    }

    if (!metadataMatches(readDaemonMetadata(pidPath), metadata)) {
      return "not_running";
    }
    controller.kill(metadata.pid, "SIGTERM");
    const timeoutMs = options?.terminationTimeoutMs ?? DEFAULT_TERMINATION_TIMEOUT_MS;
    const pollIntervalMs = options?.terminationPollIntervalMs ?? DEFAULT_TERMINATION_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!controller.isAlive(metadata.pid)) {
        if (metadataMatches(readDaemonMetadata(pidPath), metadata)) {
          removeDaemonFiles(rawDeviceId, options);
        }
        return "stopped";
      }
      await delay(pollIntervalMs);
    }

    throw new Error(`Daemon process ${metadata.pid} did not exit within ${timeoutMs}ms`);
  }, options);
}

export function spawnDaemonRun(
  rawDeviceId: string | undefined,
  operatorPackage?: string,
  options?: DaemonPathsOptions
): void {
  const logPath = getDaemonLogPath(rawDeviceId, options);
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  const logFd = openSync(logPath, "a", 0o600);
  try {
    const cliEntryPath = options?.cliEntryPath ?? process.argv[1];
    const args = [cliEntryPath, "daemon", "run"];
    if (rawDeviceId !== undefined && rawDeviceId.trim().length > 0) {
      args.push("--device", rawDeviceId);
    }
    if (operatorPackage !== undefined && operatorPackage.trim().length > 0) {
      args.push("--operator-package", operatorPackage);
    }

    // Strip skill run correlation so the long-lived daemon does not inherit a
    // stale runId from the caller that triggered this start.
    const daemonEnv = { ...process.env };
    delete daemonEnv[ANDROPERATOR_RUN_ID_ENV_VAR];

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: daemonEnv,
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }
}

export function readDaemonPidMetadata(
  rawDeviceId: string | undefined,
  options?: DaemonPathsOptions
): DaemonMetadata | undefined {
  return readDaemonMetadata(getDaemonPidPath(rawDeviceId, options));
}

export function writeDaemonPidMetadata(
  rawDeviceId: string | undefined,
  metadata: Pick<DaemonMetadata, "pid" | "startedAt"> & Partial<Pick<DaemonMetadata, "daemonKey" | "cliEntryPath" | "rawDeviceId">>,
  options?: DaemonPathsOptions
): void {
  const normalizedMetadata: DaemonMetadata = {
    pid: metadata.pid,
    startedAt: metadata.startedAt,
    daemonKey: metadata.daemonKey ?? sanitizeDaemonKey(rawDeviceId),
    cliEntryPath: metadata.cliEntryPath ?? (options?.cliEntryPath ?? process.argv[1] ?? "unknown"),
    rawDeviceId: metadata.rawDeviceId ?? rawDeviceId,
  };
  writeFileSync(getDaemonPidPath(rawDeviceId, options), `${JSON.stringify(normalizedMetadata)}\n`, { mode: 0o600 });
}

export function cleanupDaemonFiles(rawDeviceId: string | undefined, options?: DaemonPathsOptions): void {
  removeDaemonFiles(rawDeviceId, options);
}
