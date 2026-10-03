import { mkdir, open } from "node:fs/promises";
import { getLoggerDestination, type Logger } from "../../../adapters/logger.js";
import type { DoctorCheckResult } from "../../../contracts/doctor.js";
import { ERROR_CODES } from "../../../contracts/errors.js";

export interface LogDestinationFileSystem {
  mkdir(path: string): Promise<unknown>;
  open(path: string): Promise<{ close(): Promise<void> }>;
}

const fileSystem: LogDestinationFileSystem = {
  mkdir: path => mkdir(path, { recursive: true }),
  open: path => open(path, "a"),
};

export async function checkLogDestination(
  logger?: Logger,
  fs: LogDestinationFileSystem = fileSystem,
): Promise<DoctorCheckResult> {
  const destination = getLoggerDestination(logger);
  try {
    await fs.mkdir(destination.logDir);
    const handle = await fs.open(destination.logPath);
    await handle.close();
    return {
      id: "host.logs.writable",
      status: "pass",
      summary: "Daily log destination is writable.",
      evidence: { ...destination, writable: true },
    };
  } catch (error) {
    return {
      id: "host.logs.writable",
      status: "warn",
      code: ERROR_CODES.LOG_DIRECTORY_UNWRITABLE,
      summary: "Daily log destination is not writable; device readiness is unaffected.",
      detail: `${destination.logPath}: ${error instanceof Error ? error.message : String(error)}`,
      evidence: { ...destination, writable: false },
      fix: {
        title: "Choose a writable log directory",
        platform: "any",
        steps: [{ kind: "manual", value: "Set ANDROPERATOR_LOG_DIR to a writable directory." }],
      },
    };
  }
}
