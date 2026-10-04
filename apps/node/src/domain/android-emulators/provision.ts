import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { assertRequiredEmulatorTools } from "./hostRequirements.js";
import { type AndroperatorError, ERROR_CODES } from "../../contracts/errors.js";
import {
  DEFAULT_EMULATOR_DEVICE_PROFILE,
  DEFAULT_EMULATOR_SYSTEM_IMAGE,
} from "./constants.js";
import { inspectConfiguredAvd, listConfiguredAvds } from "./configuredAvds.js";
import {
  buildDefaultEmulatorAvdName,
  createAvd,
  enableEmulatorDeveloperSettings,
  startAvd,
  waitForBootCompletion,
  waitForEmulatorRegistration,
} from "./lifecycle.js";
import { listRunningEmulators } from "./runningEmulators.js";
import type { ConfiguredAvd, ProvisionedEmulator } from "./types.js";

function buildError(
  code: AndroperatorError["code"],
  message: string,
  details?: Record<string, unknown>
): AndroperatorError {
  return { code, message, details };
}

function findBestSupportedAvd(avds: ConfiguredAvd[], desiredName: string): ConfiguredAvd | undefined {
  const supported = avds.filter((avd) => avd.supported);
  if (supported.length === 0) return undefined;
  const preferred = supported.find((avd) => avd.name === desiredName);
  if (preferred) return preferred;
  return [...supported].sort((a, b) => a.name.localeCompare(b.name))[0];
}

export async function provisionEmulator(
  config: RuntimeConfig,
  options?: {
    name?: string;
    systemImage?: string;
    deviceProfile?: string;
    dataPartitionSize?: string;
  }
): Promise<ProvisionedEmulator> {
  await assertRequiredEmulatorTools(config);

  const desiredName = options?.name ?? buildDefaultEmulatorAvdName(options?.dataPartitionSize);
  const systemImage = options?.systemImage ?? DEFAULT_EMULATOR_SYSTEM_IMAGE;
  const deviceProfile = options?.deviceProfile ?? DEFAULT_EMULATOR_DEVICE_PROFILE;

  const running = await listRunningEmulators(config);
  const runningSupported = running.find((emulator) => emulator.supported);
  if (runningSupported) {
    if (!runningSupported.booted) {
      await waitForBootCompletion(config, runningSupported.serial);
    }
    await enableEmulatorDeveloperSettings(config, runningSupported.serial);
    return {
      type: "emulator",
      avdName: runningSupported.avdName,
      serial: runningSupported.serial,
      booted: true,
      created: false,
      started: false,
      reused: true,
    };
  }

  const configured = await listConfiguredAvds(config);
  const supportedConfigured = findBestSupportedAvd(configured, desiredName);
  if (supportedConfigured) {
    await startAvd(config, supportedConfigured.name);
    const serial = await waitForEmulatorRegistration(config, supportedConfigured.name);
    await waitForBootCompletion(config, serial);
    await enableEmulatorDeveloperSettings(config, serial);
    return {
      type: "emulator",
      avdName: supportedConfigured.name,
      serial,
      booted: true,
      created: false,
      started: true,
      reused: true,
    };
  }

  const desired = await inspectConfiguredAvd(desiredName);
  if (desired.exists && !desired.supported) {
    throw buildError(
      ERROR_CODES.EMULATOR_UNSUPPORTED,
      `Existing AVD ${desiredName} is unsupported and cannot be auto-provisioned`,
      { name: desiredName, unsupportedReasons: desired.unsupportedReasons }
    );
  }

  if (!desired.exists) {
    await createAvd(config, {
      name: desiredName,
      systemImage,
      deviceProfile,
      dataPartitionSize: options?.dataPartitionSize,
    });
  }

  await startAvd(config, desiredName);
  const serial = await waitForEmulatorRegistration(config, desiredName);
  await waitForBootCompletion(config, serial);
  await enableEmulatorDeveloperSettings(config, serial);
  return {
    type: "emulator",
    avdName: desiredName,
    serial,
    booted: true,
    created: !desired.exists,
    started: true,
    reused: false,
  };
}
