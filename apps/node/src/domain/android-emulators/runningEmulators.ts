import { emulatorBackend } from "../../adapters/android-emulator/index.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { inspectConfiguredAvd } from "./configuredAvds.js";
import type { RunningEmulator } from "./types.js";

export function getRunningEmulatorAvdName(config: RuntimeConfig, serial: string): Promise<string> {
  return emulatorBackend.getRunningEmulatorAvdName(config, serial);
}

export function isEmulatorBooted(config: RuntimeConfig, serial: string): Promise<boolean> {
  return emulatorBackend.isEmulatorBooted(config, serial);
}

export async function listRunningEmulators(config: RuntimeConfig): Promise<RunningEmulator[]> {
  const running: RunningEmulator[] = [];
  for (const emulator of await emulatorBackend.listRunningEmulators(config)) {
    const avd = await inspectConfiguredAvd(emulator.avdName, new Set([emulator.avdName]));
    running.push({ ...emulator, supported: avd.supported, unsupportedReasons: avd.unsupportedReasons });
  }
  return running;
}

export async function resolveRunningEmulatorByName(config: RuntimeConfig, name: string): Promise<RunningEmulator | undefined> {
  return (await listRunningEmulators(config)).find((emulator) => emulator.avdName === name);
}
