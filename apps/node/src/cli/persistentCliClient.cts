import http from "node:http";
import { randomUUID } from "node:crypto";
import { getDaemonSocketPath, isDaemonRunning } from "../domain/daemon/lifecycle.cjs";
import { getCliBuildIdentity, getCliVersion } from "../domain/version/cliIdentity.cjs";
import { canTryPersistentCli, cliEnvironmentIdentity, type PersistentCliReply } from "./persistentCliProtocol.cjs";

interface WireReply { body: string; status: number; }
export interface PersistentCliClientDeps {
  owned?: typeof isDaemonRunning;
  socketPath?: typeof getDaemonSocketPath;
  request?: typeof request;
}

async function request(socketPath: string, method: "GET" | "POST", route: string, payload?: string): Promise<WireReply> {
  return new Promise((resolve, reject) => {
    // Once a POST socket connects, conservatively regard all failures as uncertain.
    let connected = false;
    const req = http.request({ socketPath, method, path: route, timeout: method === "POST" ? 35000 : 3000,
      headers: payload === undefined ? undefined : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, res => {
      res.setEncoding("utf8");
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ body, status: res.statusCode ?? 0 }));
      res.on("aborted", () => reject(Object.assign(new Error("Daemon response aborted"), { connected: true })));
      res.on("error", error => reject(Object.assign(error, { connected: true })));
    });
    req.on("socket", socket => {
      if (socket.connecting) socket.once("connect", () => { connected = true; });
      else connected = true;
    });
    req.on("timeout", () => req.destroy(new Error("Daemon request timed out")));
    req.on("error", error => reject(Object.assign(error, { connected })));
    req.end(payload);
  });
}

export async function tryPersistentCli(argv: string[], deps: PersistentCliClientDeps = {}): Promise<PersistentCliReply | null> {
  if (!canTryPersistentCli(argv) || process.platform === "win32" || process.env.ANDROPERATOR_NO_DAEMON === "1") return null;
  const index = Math.max(argv.lastIndexOf("--device"), argv.lastIndexOf("--device-id"));
  const deviceId = index < 0 ? undefined : argv[index + 1];
  if (index >= 0 && (deviceId === undefined || !deviceId.trim() || deviceId.startsWith("--"))) return null;
  let socketPath: string;
  const send = deps.request ?? request;
  const buildIdentity = getCliBuildIdentity();
  try {
    socketPath = (deps.socketPath ?? getDaemonSocketPath)(deviceId);
    if (!await (deps.owned ?? isDaemonRunning)(deviceId)) return null;
    const version = await send(socketPath, "GET", "/version");
    if (version.status !== 200) return null;
    const server = JSON.parse(version.body);
    if (server.persistentCli !== 1 || server.version !== getCliVersion() || JSON.stringify(server.buildIdentity) !== JSON.stringify(buildIdentity)) return null;
  } catch { return null; }
  const requestId = randomUUID();
  let payload: string;
  try { payload = JSON.stringify({ requestId, argv, deviceId, buildIdentity, cwd: process.cwd(),
    environment: cliEnvironmentIdentity(), runId: process.env.ANDROPERATOR_RUN_ID, logDir: process.env.ANDROPERATOR_LOG_DIR });
  } catch { return null; }
  if (Buffer.byteLength(payload) > 95000) return null;
  try {
    const response = await send(socketPath, "POST", "/cli", payload);
    const parsed = JSON.parse(response.body);
    if (response.status === 200 && parsed.requestId === requestId) {
      if (parsed.kind === "declined") return null;
      if (parsed.kind === "completed" && typeof parsed.stdout === "string" && typeof parsed.stderr === "string"
        && (parsed.exitCode === 0 || parsed.exitCode === 1)) {
        return { stdout: parsed.stdout, stderr: parsed.stderr, exitCode: parsed.exitCode };
      }
    }
  } catch (error) {
    if ((error as { connected?: boolean }).connected === false) return null;
  }
  return { stdout: JSON.stringify({ code: "DAEMON_PROXY_ERROR", message: "Daemon response lost; action may have executed",
    details: { phase: "result_wait", dispatchState: "unknown", requestId } }) + "\n", stderr: "", exitCode: 1 };
}
