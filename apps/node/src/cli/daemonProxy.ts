import { persistentCliContext } from "../domain/executions/persistentCliContext.js";
import http from "node:http";
import { rm } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ERROR_CODES } from "../contracts/errors.js";
import type { RunExecutionResult } from "../domain/executions/runExecution.js";
import type { ResultEnvelope } from "../contracts/result.js";
import { ANDROPERATOR_RUN_ID_ENV_VAR, normalizeRunId } from "../contracts/logging.js";
import { resolveOperatorPackageForRequest } from "../domain/config/resolveOperatorPackage.js";
import { getDaemonSocketPath, isDaemonRunning, spawnDaemonRun, stopDaemon, withDaemonLock } from "../domain/daemon/lifecycle.cjs";
import { getCliBuildIdentity, getCliVersion, type CliBuildIdentity } from "../domain/version/compatibility.js";

export interface DaemonProxyOptions {
  rawDeviceId?: string;
  operatorPackage?: string;
  noDaemon?: boolean;
  allowPostDispatchFallback?: boolean;
  startTimeoutMs?: number;
  pollIntervalMs?: number;
  baseDir?: string;
}

export interface DaemonHttpSuccess {
  ok: true;
  body: string;
}

export interface DaemonHttpFailure {
  ok: false;
  error: unknown;
  dispatched: boolean;
}

export interface DaemonProxyDeps {
  spawnDaemonRunFn?: typeof spawnDaemonRun;
  stopDaemonFn?: typeof stopDaemon;
  httpGetFn?: (socketPath: string, path: string) => Promise<string>;
  httpPostFn?: (socketPath: string, path: string, body: unknown) => Promise<DaemonHttpSuccess | DaemonHttpFailure>;
  isDaemonAliveFn?: (socketPath: string) => Promise<boolean>;
  isDaemonRunningFn?: (rawDeviceId: string | undefined, options: DaemonProxyOptions) => Promise<boolean>;
}

const DEFAULT_START_TIMEOUT_MS = 3000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_POST_TIMEOUT_MS = 35000;
const POST_TIMEOUT_BUFFER_MS = 5000;

type DaemonReadinessState = "ready" | "replace" | "not_ready" | "unowned";
type DaemonStartAction = "ready" | "spawned" | "unowned" | "replace";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestSocket(method: "GET" | "POST", socketPath: string, path: string, body?: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      method,
      socketPath,
      path,
      headers: payload === undefined ? undefined : {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 3000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new Error(`Daemon returned HTTP ${res.statusCode ?? 0}: ${responseBody}`));
          return;
        }
        resolve(responseBody);
      });
    });
    req.on("timeout", () => req.destroy(new Error("Daemon request timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}

async function httpGet(socketPath: string, path: string): Promise<string> {
  return requestSocket("GET", socketPath, path);
}

async function httpPost(socketPath: string, path: string, body: unknown): Promise<DaemonHttpSuccess | DaemonHttpFailure> {
  let dispatched = false;
  try {
    const payload = JSON.stringify(body);
    const timeoutMs = getDaemonPostTimeoutMs(body);
    const responseBody = await new Promise<string>((resolve, reject) => {
      let connected = false;
      let finished = false;
      const markDispatchedIfSent = () => {
        if (connected && finished) {
          dispatched = true;
        }
      };
      const req = http.request({
        method: "POST",
        socketPath,
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve(raw);
        });
      });
      req.on("timeout", () => req.destroy(new Error(`Daemon POST timed out after ${timeoutMs}ms`)));
      req.on("error", reject);
      req.on("socket", (socket) => {
        if (socket.connecting) {
          socket.once("connect", () => {
            connected = true;
            markDispatchedIfSent();
          });
        } else {
          connected = true;
          markDispatchedIfSent();
        }
      });
      req.once("finish", () => {
        finished = true;
        markDispatchedIfSent();
      });
      req.end(payload);
    });
    return { ok: true, body: responseBody };
  } catch (error) {
    return { ok: false, error, dispatched };
  }
}

export function getDaemonPostTimeoutMs(body: unknown): number {
  const execution = typeof body === "object" && body !== null && "execution" in body
    ? (body as { execution?: unknown }).execution
    : undefined;
  const timeoutMs = typeof execution === "object" && execution !== null && "timeoutMs" in execution
    ? (execution as { timeoutMs?: unknown }).timeoutMs
    : undefined;
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs + POST_TIMEOUT_BUFFER_MS;
  }
  return DEFAULT_POST_TIMEOUT_MS;
}

async function isDaemonAlive(socketPath: string, deps: DaemonProxyDeps): Promise<boolean> {
  try {
    if (deps.isDaemonAliveFn) {
      return await deps.isDaemonAliveFn(socketPath);
    }
    const raw = await (deps.httpGetFn ?? httpGet)(socketPath, "/ping");
    const parsed = JSON.parse(raw) as { ok?: unknown };
    return parsed.ok === true;
  } catch {
    return false;
  }
}

async function isOwnedDaemon(
  rawDeviceId: string | undefined,
  options: DaemonProxyOptions,
  deps: DaemonProxyDeps
): Promise<boolean> {
  return await (deps.isDaemonRunningFn ?? isDaemonRunning)(rawDeviceId, options);
}

function isBuildIdentity(value: unknown): value is CliBuildIdentity {
  return isObject(value)
    && typeof value.entryPath === "string"
    && (typeof value.mtimeMs === "number" || value.mtimeMs === null)
    && (typeof value.size === "number" || value.size === null);
}

function buildIdentityMatches(left: CliBuildIdentity, right: CliBuildIdentity): boolean {
  return left.entryPath === right.entryPath && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function daemonVersionMatches(raw: string): boolean {
  const parsed = JSON.parse(raw) as { version?: unknown; buildIdentity?: unknown };
  return parsed.version === getCliVersion()
    && isBuildIdentity(parsed.buildIdentity)
    && buildIdentityMatches(parsed.buildIdentity, getCliBuildIdentity());
}

async function getDaemonReadinessState(
  rawDeviceId: string | undefined,
  socketPath: string,
  options: DaemonProxyOptions,
  deps: DaemonProxyDeps
): Promise<DaemonReadinessState> {
  const httpGetFn = deps.httpGetFn ?? httpGet;
  const pingRaw = await httpGetFn(socketPath, "/ping");
  const ping = JSON.parse(pingRaw) as { ok?: unknown };
  if (ping.ok !== true) {
    return "not_ready";
  }
  if (!(await isOwnedDaemon(rawDeviceId, options, deps))) {
    return "unowned";
  }
  try {
    return daemonVersionMatches(await httpGetFn(socketPath, "/version")) ? "ready" : "replace";
  } catch {
    return "replace";
  }
}

async function ensureDaemonReady(
  rawDeviceId: string | undefined,
  effectiveOperatorPackage: string,
  socketPath: string,
  options: DaemonProxyOptions,
  deps: DaemonProxyDeps
): Promise<boolean> {
  const httpGetFn = deps.httpGetFn ?? httpGet;
  try {
    const state = await getDaemonReadinessState(rawDeviceId, socketPath, options, deps);
    if (state === "ready") {
      return true;
    }
    if (state === "unowned") {
      return false;
    }
    if (state === "replace") {
      await (deps.stopDaemonFn ?? stopDaemon)(rawDeviceId, options);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED" || code === "ENOTSOCK") {
      await withDaemonLock(rawDeviceId, async () => {
        try {
          await httpGetFn(socketPath, "/ping");
        } catch (recheckError) {
          const recheckCode = (recheckError as NodeJS.ErrnoException).code;
          if (recheckCode === "ECONNREFUSED" || recheckCode === "ENOTSOCK") {
            await rm(socketPath, { force: true });
          }
        }
      }, options);
    }
  }

  const timeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const action = await withDaemonLock(rawDeviceId, async (): Promise<DaemonStartAction> => {
    try {
      const state = await getDaemonReadinessState(rawDeviceId, socketPath, options, deps);
      if (state === "ready") {
        return "ready";
      }
      if (state === "unowned") {
        return "unowned";
      }
      if (state === "replace") {
        return "replace";
      }
    } catch {
      // The initial path above handles stale socket cleanup. Missing/not-ready sockets continue to spawn.
    }

    (deps.spawnDaemonRunFn ?? spawnDaemonRun)(rawDeviceId, effectiveOperatorPackage, options);
    return "spawned";
  }, options);

  if (action === "ready") {
    return true;
  }
  if (action === "unowned" || action === "replace") {
    process.stderr.write(`[androperator] daemon unavailable after ${timeoutMs}ms; running direct for this call\n`);
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      if (await isDaemonAlive(socketPath, deps) && await isOwnedDaemon(rawDeviceId, options, deps)) {
        const versionRaw = await httpGetFn(socketPath, "/version");
        if (daemonVersionMatches(versionRaw)) {
          return true;
        }
      }
    } catch {
      // Keep polling until the daemon is fully ready.
    }
    await delay(pollIntervalMs);
  }

  process.stderr.write(`[androperator] daemon unavailable after ${timeoutMs}ms; running direct for this call\n`);
  return false;
}

function proxyLostResult(error: unknown, execution: unknown, startedAt: string): RunExecutionResult {
  return {
    ok: false,
    error: {
      code: ERROR_CODES.DAEMON_PROXY_ERROR,
      message: "Daemon response lost; action may have executed",
      details: {
        error: String(error), phase: "result_wait", dispatchState: "unknown",
        ...(isObject(execution) && typeof execution.commandId === "string" ? { commandId: execution.commandId } : {}),
        ...(isObject(execution) && typeof execution.taskId === "string" ? { taskId: execution.taskId } : {}),
        startedAt, completedAt: new Date().toISOString(),
      },
    },
  };
}

function getInheritedRunId(): string | undefined {
  return normalizeRunId(process.env[ANDROPERATOR_RUN_ID_ENV_VAR]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResultEnvelope(value: unknown): value is ResultEnvelope {
  return isObject(value)
    && typeof value.commandId === "string"
    && typeof value.taskId === "string"
    && (value.status === "success" || value.status === "failed")
    && Array.isArray(value.stepResults);
}

export function hasCallerRelativeScreenshotPath(execution: unknown): boolean {
  if (!isObject(execution) || !Array.isArray(execution.actions)) {
    return false;
  }
  return execution.actions.some((action) => {
    if (!isObject(action) || action.type !== "take_screenshot" || !isObject(action.params)) {
      return false;
    }
    const path = action.params.path;
    return typeof path === "string" && path.trim() !== "" && !isAbsolute(path);
  });
}

export function parseDaemonRunExecutionResult(raw: string): RunExecutionResult {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed) || typeof parsed.ok !== "boolean") {
    throw new Error("Daemon returned an invalid execution result");
  }
  if (parsed.ok === true) {
    if (
      typeof parsed.deviceId !== "string" ||
      parsed.terminalSource !== "androperator_result" ||
      !isResultEnvelope(parsed.envelope)
    ) {
      throw new Error("Daemon returned an invalid successful execution result");
    }
    return parsed as RunExecutionResult;
  }
  if (!isObject(parsed.error) || typeof parsed.error.code !== "string" || typeof parsed.error.message !== "string") {
    throw new Error("Daemon returned an invalid failed execution result");
  }
  if (parsed.deviceId !== undefined && typeof parsed.deviceId !== "string") {
    throw new Error("Daemon returned an invalid failed execution device id");
  }
  return parsed as RunExecutionResult;
}

export async function tryDaemonExecution(
  execution: unknown,
  options: DaemonProxyOptions,
  deps: DaemonProxyDeps = {}
): Promise<RunExecutionResult | null> {
  if (persistentCliContext.getStore() || process.env.ANDROPERATOR_NO_DAEMON === "1" || options.noDaemon || process.platform === "win32") {
    return null;
  }
  if (hasCallerRelativeScreenshotPath(execution)) {
    return null;
  }

  let ready = false;
  let socketPath: string;
  let effectiveOperatorPackage: string;
  try {
    socketPath = getDaemonSocketPath(options.rawDeviceId, options);
    effectiveOperatorPackage = resolveOperatorPackageForRequest(options.operatorPackage);
    ready = await ensureDaemonReady(options.rawDeviceId, effectiveOperatorPackage, socketPath, options, deps);
  } catch {
    return null;
  }
  if (!ready) {
    return null;
  }

  const startedAt = new Date().toISOString();
  try {
    const runId = getInheritedRunId();
    const postResult = await (deps.httpPostFn ?? httpPost)(socketPath, "/execute", {
      execution,
      deviceId: options.rawDeviceId,
      operatorPackage: effectiveOperatorPackage,
      ...(runId !== undefined ? { runId } : {}),
    });
    if (!postResult.ok) {
      if (!postResult.dispatched || options.allowPostDispatchFallback === true) {
        return null;
      }
      return proxyLostResult(postResult.error, execution, startedAt);
    }
    try {
      return parseDaemonRunExecutionResult(postResult.body);
    } catch (error) {
      if (options.allowPostDispatchFallback === true) {
        return null;
      }
      return proxyLostResult(error, execution, startedAt);
    }
  } catch (error) {
    return proxyLostResult(error, execution, startedAt);
  }
}
