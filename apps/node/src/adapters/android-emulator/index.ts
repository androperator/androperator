import type { EmulatorBackend } from "./contracts.js";
import { selectedEmulatorBackend } from "./packageSource.js";

/** Load only the selected implementation so rollback does not depend on local package readiness. */
export const emulatorBackend: EmulatorBackend = selectedEmulatorBackend() === "legacy"
  ? (await import("./legacy.js")).legacyEmulatorBackend
  : (await import("./packageBackend.js")).packageEmulatorBackend;
