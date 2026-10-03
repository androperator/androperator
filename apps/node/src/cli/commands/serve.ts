import express from "express";
import { Server } from "node:http";
import { runExecution } from "../../domain/executions/runExecution.js";
import { listDevices } from "../../domain/devices/listDevices.js";
import { androperatorEvents, ANDROPERATOR_EVENT_TYPES } from "../../domain/observe/events.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { listConfiguredAvds, inspectConfiguredAvd } from "../../domain/android-emulators/configuredAvds.js";
import { listRunningEmulators } from "../../domain/android-emulators/runningEmulators.js";
import { buildDefaultEmulatorAvdName, createAvd, deleteAvd, enableEmulatorDeveloperSettings, normalizeEmulatorDataPartitionSize, startAvd, stopAvd, waitForBootCompletion, waitForEmulatorRegistration } from "../../domain/android-emulators/lifecycle.js";
import { provisionEmulator } from "../../domain/android-emulators/provision.js";
import { DEFAULT_EMULATOR_DEVICE_PROFILE, SUPPORTED_EMULATOR_API_LEVEL } from "../../domain/android-emulators/constants.js";
import type { Logger } from "../../adapters/logger.js";
import { normalizeSkillRunId } from "../../contracts/logging.js";
import { resolveOperatorPackageForRequest } from "../../domain/config/resolveOperatorPackage.js";
import { getCliBuildIdentity, getCliVersion } from "../../domain/version/compatibility.js";

export interface ServeAppOptions {
  verbose: boolean;
  operatorPackage?: string;
  logger?: Logger;
}

export interface ServeOptions extends ServeAppOptions {
  port?: number;
  host?: string;
  socketPath?: string;
}

export function mapServeErrorCodeToStatus(code: string): number {
  switch (code) {
    case ERROR_CODES.EXECUTION_CONFLICT_IN_FLIGHT: return 423;
    case ERROR_CODES.DEVICE_NOT_FOUND: return 404;
    case ERROR_CODES.NO_DEVICES: return 404;
    case ERROR_CODES.MULTIPLE_DEVICES_DEVICE_ID_REQUIRED: return 400;
    case ERROR_CODES.EXECUTION_VALIDATION_FAILED: return 400;
    case ERROR_CODES.PAYLOAD_TOO_LARGE: return 413;
    case ERROR_CODES.RESULT_ENVELOPE_TIMEOUT: return 504;
    case ERROR_CODES.DEVICE_NOT_INTERACTIVE: return 409;
    case ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING: return 409;
    case ERROR_CODES.DEVICE_SHELL_UNAVAILABLE: return 503;
    case ERROR_CODES.EMULATOR_NOT_FOUND: return 404;
    case ERROR_CODES.EMULATOR_NOT_RUNNING: return 404;
    case ERROR_CODES.EMULATOR_UNSUPPORTED: return 409;
    case ERROR_CODES.EMULATOR_ALREADY_RUNNING: return 409;
    default: return 500;
  }
}

function extractRequestSkillRunId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("skillRunId" in body)) {
    return undefined;
  }
  const value = (body as { skillRunId?: unknown }).skillRunId;
  if (typeof value !== "string") {
    return undefined;
  }
  return normalizeSkillRunId(value);
}

function requestLoggerForSkillRun(options: ServeAppOptions, skillRunId: string | undefined): Logger | undefined {
  return skillRunId === undefined ? options.logger : options.logger?.child({ skillRunId });
}

export async function cmdServe(options: ServeOptions): Promise<void> {
  try {
    await startServer(options);
    // Long running
    return new Promise(() => {});
  } catch (e) {
    const errorMessage = `Failed to start server: ${String(e)}`;
    options.logger?.emit({
      ts: new Date().toISOString(),
      level: "error",
      event: "serve.server.started",
      message: errorMessage,
    });
    process.stderr.write(`${errorMessage}\n`);
    process.exit(1);
  }
}

export async function startServer(options: ServeOptions): Promise<Server> {
  const hasTcpOptions = options.port !== undefined || options.host !== undefined;
  const hasSocketOptions = options.socketPath !== undefined;
  if (hasTcpOptions === hasSocketOptions) {
    throw new Error("Exactly one serve transport must be provided: port/host or socketPath");
  }
  if (hasTcpOptions && options.port === undefined) {
    throw new Error("TCP serve transport requires port");
  }

  const app = createServeApp(options);
  const tcpPort = options.port as number;

  return new Promise((resolve, reject) => {
    const onListen = (server: Server) => {
      const addr = server.address();
      const actualPort = addr && typeof addr === "object" ? addr.port : options.port;
      const startupMessage = options.socketPath
        ? `Androperator API server listening on ${options.socketPath}`
        : `Androperator API server listening on http://${options.host}:${actualPort}`;
      options.logger?.emit({
        ts: new Date().toISOString(),
        level: "info",
        event: "serve.server.started",
        message: startupMessage,
      });
      process.stderr.write(`${startupMessage}\n`);
      if (options.verbose) {
        const routes = [
          "- GET  /ping",
          "- GET  /version",
          "- GET  /devices",
          "- POST /execute",
          "- POST /snapshot",
          "- POST /screenshot",
          "- GET  /events (SSE)",
        ];
        for (const r of routes) {
          options.logger?.emit({
            ts: new Date().toISOString(),
            level: "debug",
            event: "serve.server.started",
            message: r,
          });
        }
        process.stderr.write(routes.join("\n") + "\n");
      }
      resolve(server);
    };

    const server = options.socketPath
      ? app.listen(options.socketPath, () => onListen(server))
      : options.host === undefined
        ? app.listen(tcpPort, () => onListen(server))
        : app.listen(tcpPort, options.host, () => onListen(server));

    server.on("error", (err) => {
      reject(err);
    });
  });
}

export function createServeApp(options: ServeAppOptions): express.Application {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  const resolveServeOperatorPackage = (requestOperatorPackage: string | undefined): string =>
    resolveOperatorPackageForRequest(requestOperatorPackage ?? options.operatorPackage);

  // Log all requests when a logger is configured (filtered by log level at the file sink).
  // Without a logger, fall back to console.log only when --verbose is set (legacy behavior).
  app.use((req, _res, next) => {
    const clientIp = req.socket.remoteAddress || "unknown";
    const requestLogger = requestLoggerForSkillRun(options, extractRequestSkillRunId(req.body));
    if (requestLogger) {
      requestLogger.emit({
        ts: new Date().toISOString(),
        level: "info",
        event: "serve.http.request",
        message: `${req.method} ${req.url} from ${clientIp}`,
      });
    } else if (options.verbose) {
      console.log(`[HTTP] ${req.method} ${req.url} from ${clientIp}`);
    }
    next();
  });

  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/version", (_req, res) => {
    res.json({ version: getCliVersion(), buildIdentity: getCliBuildIdentity() });
  });

  // REST: List devices
  app.get("/devices", async (_req, res) => {
    try {
      const config = getDefaultRuntimeConfig({
        adbPath: process.env.ADB_PATH,
        operatorPackage: resolveServeOperatorPackage(undefined),
        logger: options.logger,
      });
      const devices = await listDevices(config);
      res.json({ ok: true, devices });
    } catch (e) {
      res.status(500).json({ 
        ok: false, 
        error: { 
          code: "INTERNAL_ERROR", 
          message: options.verbose ? String(e) : "Failed to list devices" 
        } 
      });
    }
  });

  function getEmulatorConfig() {
    return getDefaultRuntimeConfig({
      adbPath: process.env.ADB_PATH,
      emulatorPath: process.env.EMULATOR_PATH,
      sdkmanagerPath: process.env.SDKMANAGER_PATH,
      avdmanagerPath: process.env.AVDMANAGER_PATH,
      operatorPackage: resolveServeOperatorPackage(undefined),
      logger: options.logger,
    });
  }

  function parseEmulatorDataPartitionSizeFromBody(body: Record<string, unknown>): { ok: true; value: string | undefined } | { ok: false; message: string } {
    const aliases = ["storageSize", "size", "diskSize", "dataPartitionSize"];
    const provided = aliases
      .map((field) => ({ field, value: body[field] }))
      .filter((entry) => entry.value !== undefined);
    if (provided.length === 0) {
      return { ok: true, value: undefined };
    }
    if (provided.length > 1) {
      return { ok: false, message: "Use only one emulator storage size field: storageSize, size, diskSize, or dataPartitionSize" };
    }
    const value = provided[0].value;
    if (typeof value !== "string") {
      return { ok: false, message: `${provided[0].field} must be a string such as 12G or 12GB` };
    }
    try {
      return { ok: true, value: normalizeEmulatorDataPartitionSize(value) };
    } catch {
      return { ok: false, message: `${provided[0].field} must be a positive integer followed by G or GB, for example 12G` };
    }
  }

  // REST: Execute command
  app.post("/execute", async (req, res) => {
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ ok: false, error: { code: "INVALID_BODY", message: "Invalid or missing JSON body" } });
      return;
    }

    const { execution, deviceId, operatorPackage, skillRunId } = req.body;
    
    if (!execution) {
      res.status(400).json({ ok: false, error: { code: "MISSING_EXECUTION", message: "Missing 'execution' in body" } });
      return;
    }

    if (deviceId !== undefined && typeof deviceId !== "string") {
      res.status(400).json({ ok: false, error: { code: "INVALID_DEVICE_ID", message: "'deviceId' must be a string" } });
      return;
    }
    if (typeof deviceId === "string" && deviceId.trim().length === 0) {
      res.status(400).json({ ok: false, error: { code: "INVALID_DEVICE_ID", message: "'deviceId' must be a non-empty string when provided" } });
      return;
    }

    if (operatorPackage !== undefined && typeof operatorPackage !== "string") {
      res.status(400).json({ ok: false, error: { code: "INVALID_OPERATOR_PACKAGE", message: "'operatorPackage' must be a string" } });
      return;
    }
    if (typeof operatorPackage === "string" && operatorPackage.trim().length === 0) {
      res.status(400).json({ ok: false, error: { code: "INVALID_OPERATOR_PACKAGE", message: "'operatorPackage' must be a non-empty string" } });
      return;
    }

    if (skillRunId !== undefined && typeof skillRunId !== "string") {
      res.status(400).json({ ok: false, error: { code: "INVALID_SKILL_RUN_ID", message: "'skillRunId' must be a string when provided" } });
      return;
    }
    if (typeof skillRunId === "string" && skillRunId.trim().length === 0) {
      res.status(400).json({ ok: false, error: { code: "INVALID_SKILL_RUN_ID", message: "'skillRunId' must be a non-empty string when provided" } });
      return;
    }
    if (typeof skillRunId === "string" && normalizeSkillRunId(skillRunId) === undefined) {
      res.status(400).json({ ok: false, error: { code: "INVALID_SKILL_RUN_ID", message: "'skillRunId' must start with 'skillrun_' and contain only safe identifier characters" } });
      return;
    }

    try {
      const requestSkillRunId = normalizeSkillRunId(skillRunId);
      const result = await runExecution(execution, {
        deviceId,
        operatorPackage: resolveServeOperatorPackage(operatorPackage),
        logger: requestLoggerForSkillRun(options, requestSkillRunId),
      });

      if (result.ok) {
        res.json(result);
      } else {
        res.status(mapServeErrorCodeToStatus(result.error.code)).json(result);
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: String(e) } });
    }
  });



  app.post("/snapshot", async (req, res) => {
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ ok: false, error: { code: "INVALID_BODY", message: "Invalid or missing JSON body" } });
      return;
    }

    const { deviceId, operatorPackage } = req.body;
    
    if (deviceId !== undefined && typeof deviceId !== "string") {
      res.status(400).json({ ok: false, error: { code: "INVALID_DEVICE_ID", message: "'deviceId' must be a string" } });
      return;
    }
    if (typeof deviceId === "string" && deviceId.trim().length === 0) {
      res.status(400).json({ ok: false, error: { code: "INVALID_DEVICE_ID", message: "'deviceId' must be a non-empty string when provided" } });
      return;
    }

    if (operatorPackage !== undefined && typeof operatorPackage !== "string") {
      res.status(400).json({ ok: false, error: { code: "INVALID_OPERATOR_PACKAGE", message: "'operatorPackage' must be a string" } });
      return;
    }
    if (typeof operatorPackage === "string" && operatorPackage.trim().length === 0) {
      res.status(400).json({ ok: false, error: { code: "INVALID_OPERATOR_PACKAGE", message: "'operatorPackage' must be a non-empty string" } });
      return;
    }

    const ts = Date.now();
    const executionInput = {
      commandId: `serve-snap-${ts}`,
      taskId: `serve-snap-${ts}`,
      source: "serve-api",
      expectedFormat: "android-ui-automator",
      timeoutMs: 30000,
      actions: [{ id: "snap", type: "snapshot" }],
    };

    try {
      const result = await runExecution(executionInput, { 
        deviceId, 
        operatorPackage: resolveServeOperatorPackage(operatorPackage),
        logger: options.logger,
      });
      if (result.ok) {
        res.json(result);
      } else {
        res.status(mapServeErrorCodeToStatus(result.error.code)).json(result);
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: String(e) } });
    }
  });

  app.post("/screenshot", async (req, res) => {
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ ok: false, error: { code: "INVALID_BODY", message: "Invalid or missing JSON body" } });
      return;
    }

    const { deviceId, operatorPackage, path } = req.body;

    if (deviceId !== undefined && typeof deviceId !== "string") {
      res.status(400).json({ ok: false, error: { code: "INVALID_DEVICE_ID", message: "'deviceId' must be a string" } });
      return;
    }
    if (typeof deviceId === "string" && deviceId.trim().length === 0) {
      res.status(400).json({ ok: false, error: { code: "INVALID_DEVICE_ID", message: "'deviceId' must be a non-empty string when provided" } });
      return;
    }

    if (operatorPackage !== undefined && typeof operatorPackage !== "string") {
      res.status(400).json({ ok: false, error: { code: "INVALID_OPERATOR_PACKAGE", message: "'operatorPackage' must be a string" } });
      return;
    }
    if (typeof operatorPackage === "string" && operatorPackage.trim().length === 0) {
      res.status(400).json({ ok: false, error: { code: "INVALID_OPERATOR_PACKAGE", message: "'operatorPackage' must be a non-empty string" } });
      return;
    }

    if (path !== undefined && (typeof path !== "string" || path.trim() === "")) {
      res.status(400).json({ ok: false, error: { code: "INVALID_PATH", message: "'path' must be a non-empty string" } });
      return;
    }

    const ts = Date.now();
    const executionInput = {
      commandId: `serve-shot-${ts}`,
      taskId: `serve-shot-${ts}`,
      source: "serve-api",
      expectedFormat: "android-ui-automator",
      timeoutMs: 30000,
      actions: [{ id: "shot", type: "take_screenshot", params: path !== undefined ? { path } : {} }],
    };

    try {
      const result = await runExecution(executionInput, { 
        deviceId, 
        operatorPackage: resolveServeOperatorPackage(operatorPackage),
        logger: options.logger,
      });
      if (result.ok) {
        res.json(result);
      } else {
        res.status(mapServeErrorCodeToStatus(result.error.code)).json(result);
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: String(e) } });
    }
  });

  app.get("/android/emulators", async (_req, res) => {
    try {
      const config = getEmulatorConfig();
      const running = await listRunningEmulators(config);
      const avds = await listConfiguredAvds(config, new Set(running.map((emulator) => emulator.avdName)));
      res.json({ ok: true, avds });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      res.status(mapServeErrorCodeToStatus(e.code ?? "INTERNAL_ERROR")).json({ ok: false, error: { code: e.code ?? "INTERNAL_ERROR", message: e.message ?? String(error) } });
    }
  });

  app.get("/android/emulators/running", async (_req, res) => {
    try {
      const config = getEmulatorConfig();
      const devices = await listRunningEmulators(config);
      res.json({ ok: true, devices });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      res.status(mapServeErrorCodeToStatus(e.code ?? "INTERNAL_ERROR")).json({ ok: false, error: { code: e.code ?? "INTERNAL_ERROR", message: e.message ?? String(error) } });
    }
  });

  app.get("/android/emulators/:name", async (req, res) => {
    try {
      const config = getEmulatorConfig();
      const running = await listRunningEmulators(config);
      const avd = await inspectConfiguredAvd(req.params.name, new Set(running.map((emulator) => emulator.avdName)));
      res.json({ ok: true, ...avd });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      res.status(mapServeErrorCodeToStatus(e.code ?? "INTERNAL_ERROR")).json({ ok: false, error: { code: e.code ?? "INTERNAL_ERROR", message: e.message ?? String(error) } });
    }
  });

  app.post("/android/emulators/create", async (req, res) => {
    try {
      const config = getEmulatorConfig();
      const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
      const apiLevel = typeof body.apiLevel === "number" ? body.apiLevel : SUPPORTED_EMULATOR_API_LEVEL;
      const abi = typeof body.abi === "string" && body.abi.length > 0 ? body.abi : "arm64-v8a";
      const deviceProfile = typeof body.deviceProfile === "string" && body.deviceProfile.length > 0
        ? body.deviceProfile
        : DEFAULT_EMULATOR_DEVICE_PROFILE;
      const playStore = body.playStore !== false;
      const dataPartitionSize = parseEmulatorDataPartitionSizeFromBody(body);
      if (!dataPartitionSize.ok) {
        res.status(400).json({ ok: false, error: { code: "INVALID_BODY", message: dataPartitionSize.message } });
        return;
      }
      const name = typeof body.name === "string" && body.name.length > 0
        ? body.name
        : buildDefaultEmulatorAvdName(dataPartitionSize.value);
      const systemImage = playStore
        ? `system-images;android-${apiLevel};google_apis_playstore;${abi}`
        : `system-images;android-${apiLevel};google_apis;${abi}`;

      await createAvd(config, { name, systemImage, deviceProfile, dataPartitionSize: dataPartitionSize.value });
      const avd = await inspectConfiguredAvd(name);
      res.json({ ok: true, ...avd });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      res.status(mapServeErrorCodeToStatus(e.code ?? "INTERNAL_ERROR")).json({ ok: false, error: { code: e.code ?? "INTERNAL_ERROR", message: e.message ?? String(error) } });
    }
  });

  app.post("/android/emulators/:name/start", async (req, res) => {
    try {
      const config = getEmulatorConfig();
      const name = req.params.name;
      const avd = await inspectConfiguredAvd(name);
      if (!avd.exists) {
        res.status(mapServeErrorCodeToStatus(ERROR_CODES.EMULATOR_NOT_FOUND)).json({ ok: false, error: { code: ERROR_CODES.EMULATOR_NOT_FOUND, message: `AVD ${name} not found` } });
        return;
      }
      const runningList = await listRunningEmulators(config);
      if (runningList.some((e) => e.avdName === name)) {
        res.status(mapServeErrorCodeToStatus(ERROR_CODES.EMULATOR_ALREADY_RUNNING)).json({ ok: false, error: { code: ERROR_CODES.EMULATOR_ALREADY_RUNNING, message: `Emulator ${name} is already running` } });
        return;
      }
      startAvd(config, name);
      const serial = await waitForEmulatorRegistration(config, name);
      await waitForBootCompletion(config, serial);
      await enableEmulatorDeveloperSettings(config, serial);
      res.json({ ok: true, type: "emulator", avdName: name, serial, booted: true });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      res.status(mapServeErrorCodeToStatus(e.code ?? "INTERNAL_ERROR")).json({ ok: false, error: { code: e.code ?? "INTERNAL_ERROR", message: e.message ?? String(error) } });
    }
  });

  app.post("/android/emulators/:name/stop", async (req, res) => {
    try {
      const config = getEmulatorConfig();
      await stopAvd(config, req.params.name);
      res.json({ ok: true, avdName: req.params.name, stopped: true });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      res.status(mapServeErrorCodeToStatus(e.code ?? "INTERNAL_ERROR")).json({ ok: false, error: { code: e.code ?? "INTERNAL_ERROR", message: e.message ?? String(error) } });
    }
  });

  app.delete("/android/emulators/:name", async (req, res) => {
    try {
      const config = getEmulatorConfig();
      await deleteAvd(config, req.params.name);
      res.json({ ok: true, avdName: req.params.name, deleted: true });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      res.status(mapServeErrorCodeToStatus(e.code ?? "INTERNAL_ERROR")).json({ ok: false, error: { code: e.code ?? "INTERNAL_ERROR", message: e.message ?? String(error) } });
    }
  });

  app.post("/android/provision/emulator", async (req, res) => {
    try {
      const config = getEmulatorConfig();
      const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
      const dataPartitionSize = parseEmulatorDataPartitionSizeFromBody(body);
      if (!dataPartitionSize.ok) {
        res.status(400).json({ ok: false, error: { code: "INVALID_BODY", message: dataPartitionSize.message } });
        return;
      }
      const result = await provisionEmulator(config, { dataPartitionSize: dataPartitionSize.value });
      res.json({ ok: true, ...result });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      res.status(mapServeErrorCodeToStatus(e.code ?? "INTERNAL_ERROR")).json({ ok: false, error: { code: e.code ?? "INTERNAL_ERROR", message: e.message ?? String(error) } });
    }
  });

  // REST: Get skill by ID
  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const clientIp = req.socket.remoteAddress || "unknown";

    // Log client connection
    options.logger?.emit({
      ts: new Date().toISOString(),
      level: "info",
      event: "serve.sse.client.connected",
      message: `SSE client connected from ${clientIp}`,
    });

    const cleanup = () => {
      androperatorEvents.off(ANDROPERATOR_EVENT_TYPES.RESULT, onResult);
      androperatorEvents.off(ANDROPERATOR_EVENT_TYPES.EXECUTION, onExecution);
    };

    const onResult = (data: { deviceId: string; envelope: any }) => {
      try {
        if (!res.writableEnded) {
          res.write(`event: ${ANDROPERATOR_EVENT_TYPES.RESULT}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      } catch (err) {
        const msg = `SSE write failed: ${String(err)}`;
        if (options.logger) {
          options.logger.emit({ ts: new Date().toISOString(), level: "warn", event: "serve.sse.write_failed", message: msg });
        } else {
          process.stderr.write(`[androperator] ${msg}\n`);
        }
        cleanup();
      }
    };

    const onExecution = (data: { deviceId: string; input: unknown; result: any }) => {
      try {
        if (!res.writableEnded) {
          res.write(`event: ${ANDROPERATOR_EVENT_TYPES.EXECUTION}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      } catch (err) {
        const msg = `SSE execution write failed: ${String(err)}`;
        if (options.logger) {
          options.logger.emit({ ts: new Date().toISOString(), level: "warn", event: "serve.sse.write_failed", message: msg });
        } else {
          process.stderr.write(`[androperator] ${msg}\n`);
        }
        cleanup();
      }
    };

    androperatorEvents.on(ANDROPERATOR_EVENT_TYPES.RESULT, onResult);
    androperatorEvents.on(ANDROPERATOR_EVENT_TYPES.EXECUTION, onExecution);

    req.on("close", () => {
      options.logger?.emit({
        ts: new Date().toISOString(),
        level: "info",
        event: "serve.sse.client.disconnected",
        message: `SSE client disconnected from ${clientIp}`,
      });
      cleanup();
    });
    req.on("error", (err) => {
      const msg = `SSE req error: ${String(err)}`;
      if (options.logger) {
        options.logger.emit({ ts: new Date().toISOString(), level: "warn", event: "serve.sse.write_failed", message: msg });
      } else {
        process.stderr.write(`[androperator] ${msg}\n`);
      }
      cleanup();
    });
    res.on("error", (err) => {
      const msg = `SSE res error: ${String(err)}`;
      if (options.logger) {
        options.logger.emit({ ts: new Date().toISOString(), level: "warn", event: "serve.sse.write_failed", message: msg });
      } else {
        process.stderr.write(`[androperator] ${msg}\n`);
      }
      cleanup();
    });

    // Send initial heartbeat
    try {
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({ code: "CONNECTED", message: "Androperator SSE stream active" })}\n\n`);
    } catch (err) {
      const msg = `SSE heartbeat failed: ${String(err)}`;
      if (options.logger) {
        options.logger.emit({ ts: new Date().toISOString(), level: "warn", event: "serve.sse.write_failed", message: msg });
      } else {
        process.stderr.write(`[androperator] ${msg}\n`);
      }
      cleanup();
    }
  });

  // Error handler middleware (must be registered after all routes)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // JSON parse error
    if (err instanceof SyntaxError && "status" in err && err.status === 400 && "body" in err) {
      res.status(400).json({ ok: false, error: { code: "INVALID_JSON", message: "Malformed JSON body" } });
      return;
    }
    // Payload too large
    if (err && (err.status === 413 || err.type === "entity.too.large")) {
      res.status(413).json({ ok: false, error: { code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: "Payload exceeds 100kb limit" } });
      return;
    }
    
    // Catch-all 500
    const msg = `Unhandled error: ${String(err)}`;
    if (options.logger) {
      options.logger.emit({ ts: new Date().toISOString(), level: "error", event: "serve.http.error", message: msg });
    } else {
      process.stderr.write(`[androperator] ${msg}\n`);
    }
    res.status(500).json({ ok: false, error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } });
  });

  return app;
}
