import { emulatorBackend } from "../../adapters/android-emulator/index.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { HostToolAvailability } from "../../adapters/android-emulator/contracts.js";
export type { HostToolAvailability } from "../../adapters/android-emulator/contracts.js";

export function checkRequiredEmulatorTools(config: RuntimeConfig): Promise<HostToolAvailability[]> {
  return emulatorBackend.checkRequiredEmulatorTools(config);
}

export function assertRequiredEmulatorTools(config: RuntimeConfig): Promise<void> {
  return emulatorBackend.assertRequiredEmulatorTools(config);
}
