import type { EmulatorBackend } from "./contracts.js";
import { getAvdRoot, inspectConfiguredAvd, listConfiguredAvds } from "./legacy/configuredAvds.js";
import { getRunningEmulatorAvdName, isEmulatorBooted, listRunningEmulators } from "./legacy/runningEmulators.js";
import { assertRequiredEmulatorTools, checkRequiredEmulatorTools } from "./legacy/hostRequirements.js";
import { normalizeEmulatorDataPartitionSize, validateAvdName, setAvdDataPartitionSize,
  isSystemImageInstalled, acceptAndroidSdkLicenses, ensureSystemImageInstalled,
  createAvd, startAvd, waitForEmulatorRegistration, waitForBootCompletion,
  stopAvd, deleteAvd } from "./legacy/lifecycle.js";

/** Retained for comparison and rollback until the separate removal PR. */
export const legacyEmulatorBackend: EmulatorBackend = {
  getAvdRoot, inspectConfiguredAvd, listConfiguredAvds,
  getRunningEmulatorAvdName, isEmulatorBooted, listRunningEmulators,
  assertRequiredEmulatorTools, checkRequiredEmulatorTools,
  normalizeEmulatorDataPartitionSize, validateAvdName, setAvdDataPartitionSize,
  isSystemImageInstalled, acceptAndroidSdkLicenses, ensureSystemImageInstalled,
  createAvd, startAvd, waitForEmulatorRegistration, waitForBootCompletion,
  stopAvd, deleteAvd,
};
