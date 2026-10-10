import { createHash } from "node:crypto";

export const PERSISTENT_CLI_COMMANDS = new Set(["open", "close", "click", "scroll", "snapshot", "screenshot", "read-value", "press"]);
export interface PersistentCliReply {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Compare ambient configuration without transmitting environment values or secrets. */
export function cliEnvironmentIdentity(env: NodeJS.ProcessEnv = process.env): string {
  const entries = Object.entries(env)
    .filter(([key, value]) => value !== undefined && key !== "ANDROPERATOR_RUN_ID" && key !== "ANDROPERATOR_LOG_DIR")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

// This only chooses an optimization. The canonical parser still validates every argument.
export function canTryPersistentCli(argv: string[]): boolean {
  return PERSISTENT_CLI_COMMANDS.has(argv[0])
    && !argv.some(value => value === "--no-daemon" || value === "--help" || value === "--version"
      || value === "pretty" || value.includes("timeout"));
}
