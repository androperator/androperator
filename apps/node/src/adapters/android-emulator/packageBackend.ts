import { runAdb } from "../android-bridge/adbClient.js";
import type { RuntimeConfig } from "../android-bridge/runtimeConfig.js";
import type { EmulatorBackend } from "./contracts.js";
import { resolveEmulatorPackage } from "./packageSource.js";

const source = resolveEmulatorPackage();
const emulator: typeof import("@androperator/emulator") = await import(source.entry);

/** Retain consumer SDK paths, injected runner, serial routing and structured ADB diagnostics. */
function sharedRuntime(config: RuntimeConfig): import("@androperator/emulator").RuntimeConfig {
  return {
    ...config,
    adb: (args, options) => {
      const hasSerial = args[0] === "-s";
      return runAdb(
        { ...config, deviceId: hasSerial ? args[1] : undefined },
        hasSerial ? args.slice(2) : args,
        options,
      );
    },
  };
}

export const packageEmulatorBackend: EmulatorBackend = {
  getAvdRoot: emulator.getAvdRoot,
  inspectConfiguredAvd: emulator.inspectConfiguredAvd,
  listConfiguredAvds: (config, names) => emulator.listConfiguredAvds(sharedRuntime(config), names),
  getRunningEmulatorAvdName: (config, serial) => emulator.getRunningEmulatorAvdName(sharedRuntime(config), serial),
  isEmulatorBooted: (config, serial) => emulator.isEmulatorBooted(sharedRuntime(config), serial),
  listRunningEmulators: (config) => emulator.listRunningEmulators(sharedRuntime(config)),
  checkRequiredEmulatorTools: (config) => emulator.checkRequiredEmulatorTools(sharedRuntime(config)),
  assertRequiredEmulatorTools: (config) => emulator.assertRequiredEmulatorTools(sharedRuntime(config)),
  normalizeEmulatorDataPartitionSize: emulator.normalizeEmulatorDataPartitionSize,
  validateAvdName: emulator.validateAvdName,
  setAvdDataPartitionSize: emulator.setAvdDataPartitionSize,
  isSystemImageInstalled: (config, image) => emulator.isSystemImageInstalled(sharedRuntime(config), image),
  acceptAndroidSdkLicenses: (config) => emulator.acceptAndroidSdkLicenses(sharedRuntime(config)),
  ensureSystemImageInstalled: (config, image, options) => emulator.ensureSystemImageInstalled(sharedRuntime(config), image, options),
  createAvd: (config, options) => emulator.createAvd(sharedRuntime(config), options),
  startAvd: (config, name, args) => emulator.startAvd(sharedRuntime(config), name, args),
  waitForEmulatorRegistration: (config, name, timeout) => emulator.waitForEmulatorRegistration(sharedRuntime(config), name, timeout),
  waitForBootCompletion: (config, serial, timeout) => emulator.waitForBootCompletion(sharedRuntime(config), serial, timeout),
  stopAvd: (config, name) => emulator.stopAvd(sharedRuntime(config), name),
  deleteAvd: (config, name) => emulator.deleteAvd(sharedRuntime(config), name),
};
