import { emulatorBackend } from "../../adapters/android-emulator/index.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { applyCompatibility } from "./compatibility.js";
import type { ConfiguredAvd } from "./types.js";

export function getAvdRoot(): string {
  return emulatorBackend.getAvdRoot();
}

export async function inspectConfiguredAvd(name: string, runningNames: Set<string> = new Set()): Promise<ConfiguredAvd> {
  return applyCompatibility(await emulatorBackend.inspectConfiguredAvd(name, runningNames));
}

export async function listConfiguredAvds(config: RuntimeConfig, runningNames: Set<string> = new Set()): Promise<ConfiguredAvd[]> {
  return (await emulatorBackend.listConfiguredAvds(config, runningNames)).map(applyCompatibility);
}
