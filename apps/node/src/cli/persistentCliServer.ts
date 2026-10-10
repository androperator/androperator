import type { Logger } from "../adapters/logger.js";
import { createAndroperatorLogger } from "../adapters/logger.js";
import { getCliBuildIdentity } from "../domain/version/cliIdentity.cjs";
import { normalizeRunId } from "../contracts/logging.js";
import { persistentCliContext } from "../domain/executions/persistentCliContext.js";
import { canTryPersistentCli, cliEnvironmentIdentity } from "./persistentCliProtocol.cjs";
import { runCli, isPersistentCliRequestEligible } from "./runner.js";

export async function handlePersistentCli(body: unknown, deviceId: string | undefined, serverLogger?: Logger): Promise<object> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { kind: "declined" };
  const value = body as Record<string, unknown>;
  const declined = { kind: "declined", requestId: value.requestId };
  if (typeof value.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(value.requestId)
    || !Array.isArray(value.argv) || !value.argv.every(arg => typeof arg === "string")
    || !canTryPersistentCli(value.argv) || value.cwd !== process.cwd()
    || value.environment !== cliEnvironmentIdentity() || value.deviceId !== deviceId
    || JSON.stringify(value.buildIdentity) !== JSON.stringify(getCliBuildIdentity())
    || (value.runId !== undefined && (typeof value.runId !== "string" || normalizeRunId(value.runId) === undefined))
    || (value.logDir !== undefined && typeof value.logDir !== "string")
    || !isPersistentCliRequestEligible(value.argv, deviceId)) return declined;
  let stdout = "", stderr = "";
  const warn = (text: string) => { stderr += text; };
  const runId = normalizeRunId(value.runId);
  serverLogger?.child(runId === undefined ? {} : { runId }).emit({ts: new Date().toISOString(),level:"debug",
    event:"serve.http.request",message:`Accepted CLI request ${value.requestId}`});
  const exitCode = await persistentCliContext.run({ warn }, () => runCli(value.argv as string[], {
    log: text => { stdout += text + "\n"; }, error: text => { stderr += text + "\n"; }, stderr: warn,
    exitCode: 0, starHints: false,
    createLogger: options => createAndroperatorLogger({ ...options, logDir: typeof value.logDir === "string" && value.logDir.trim() ? value.logDir : "~/.androperator/logs",
      inheritRunId: false, writeStderr: warn }).child(runId === undefined ? {} : { runId }),
  }));
  return { kind: "completed", requestId: value.requestId, stdout, stderr, exitCode };
}
