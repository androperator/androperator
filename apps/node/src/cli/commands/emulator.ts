import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { OutputOptions } from "../output.js";
import { formatError, formatSuccess } from "../output.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { DEFAULT_EMULATOR_DATA_PARTITION_SIZE, DEFAULT_EMULATOR_DEVICE_PROFILE, SUPPORTED_EMULATOR_API_LEVEL } from "../../domain/android-emulators/constants.js";
import { inspectConfiguredAvd, listConfiguredAvds } from "../../domain/android-emulators/configuredAvds.js";
import { buildDefaultEmulatorAvdName, createAvd, deleteAvd, enableEmulatorDeveloperSettings, normalizeEmulatorDataPartitionSize, startAvd, stopAvd, waitForBootCompletion, waitForEmulatorRegistration } from "../../domain/android-emulators/lifecycle.js";
import { provisionEmulator } from "../../domain/android-emulators/provision.js";
import { listRunningEmulators } from "../../domain/android-emulators/runningEmulators.js";
import type { Logger } from "../../adapters/logger.js";

interface EmulatorCommandOptions extends OutputOptions {
  name?: string;
  apiLevel?: number;
  deviceProfile?: string;
  abi?: string;
  playStore?: boolean;
  dataPartitionSize?: string;
  logger?: Logger;
}

function parseDataPartitionSize(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_EMULATOR_DATA_PARTITION_SIZE;
  }
  try {
    return normalizeEmulatorDataPartitionSize(value);
  } catch {
    throw {
      code: "USAGE",
      message: "--storage-size must be a positive integer followed by G or GB, for example 12G",
      details: { value },
    };
  }
}

function getConfig(logger?: Logger) {
  return getDefaultRuntimeConfig({
    adbPath: process.env.ADB_PATH,
    emulatorPath: process.env.EMULATOR_PATH,
    sdkmanagerPath: process.env.SDKMANAGER_PATH,
    avdmanagerPath: process.env.AVDMANAGER_PATH,
    logger,
  });
}

export async function cmdEmulatorList(options: OutputOptions & { logger?: Logger }): Promise<string> {
  try {
    const config = getConfig(options.logger);
    const running = await listRunningEmulators(config);
    const avds = await listConfiguredAvds(config, new Set(running.map((emulator) => emulator.avdName)));
    return formatSuccess({ avds }, options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdEmulatorInspect(name: string, options: OutputOptions & { logger?: Logger }): Promise<string> {
  try {
    const config = getConfig(options.logger);
    const running = await listRunningEmulators(config);
    const avd = await inspectConfiguredAvd(name, new Set(running.map((emulator) => emulator.avdName)));
    return formatSuccess(avd, options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdEmulatorStatus(options: OutputOptions & { logger?: Logger }): Promise<string> {
  try {
    const config = getConfig(options.logger);
    const devices = await listRunningEmulators(config);
    return formatSuccess({ devices }, options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdEmulatorCreate(options: EmulatorCommandOptions): Promise<string> {
  try {
    const config = getConfig(options.logger);
    const dataPartitionSize = parseDataPartitionSize(options.dataPartitionSize);
    const name = options.name ?? buildDefaultEmulatorAvdName(dataPartitionSize);
    const apiLevel = options.apiLevel ?? SUPPORTED_EMULATOR_API_LEVEL;
    const systemImage = options.playStore === false
      ? `system-images;android-${apiLevel};google_apis;${options.abi ?? "arm64-v8a"}`
      : `system-images;android-${apiLevel};google_apis_playstore;${options.abi ?? "arm64-v8a"}`;
    await createAvd(config, {
      name,
      systemImage,
      deviceProfile: options.deviceProfile ?? DEFAULT_EMULATOR_DEVICE_PROFILE,
      dataPartitionSize,
    });
    const avd = await inspectConfiguredAvd(name);
    return formatSuccess(avd, options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdEmulatorStart(name: string, options: OutputOptions & { logger?: Logger }): Promise<string> {
  try {
    const config = getConfig(options.logger);
    const avd = await inspectConfiguredAvd(name);
    if (!avd.exists) {
      throw { code: ERROR_CODES.EMULATOR_NOT_FOUND, message: `AVD ${name} not found` };
    }
    const runningList = await listRunningEmulators(config);
    if (runningList.some((e) => e.avdName === name)) {
      throw { code: ERROR_CODES.EMULATOR_ALREADY_RUNNING, message: `Emulator ${name} is already running` };
    }
    await startAvd(config, name);
    const serial = await waitForEmulatorRegistration(config, name);
    await waitForBootCompletion(config, serial);
    await enableEmulatorDeveloperSettings(config, serial);
    return formatSuccess({ type: "emulator", avdName: name, serial, booted: true }, options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdEmulatorStop(name: string, options: OutputOptions & { logger?: Logger }): Promise<string> {
  try {
    const config = getConfig(options.logger);
    await stopAvd(config, name);
    return formatSuccess({ ok: true, avdName: name, stopped: true }, options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdEmulatorDelete(name: string, options: OutputOptions & { logger?: Logger }): Promise<string> {
  try {
    const config = getConfig(options.logger);
    await deleteAvd(config, name);
    return formatSuccess({ ok: true, avdName: name, deleted: true }, options);
  } catch (error) {
    return formatError(error, options);
  }
}

export async function cmdProvisionEmulator(options: OutputOptions & { logger?: Logger; dataPartitionSize?: string }): Promise<string> {
  try {
    const config = getConfig(options.logger);
    const result = await provisionEmulator(config, {
      dataPartitionSize: parseDataPartitionSize(options.dataPartitionSize),
    });
    return formatSuccess(result, options);
  } catch (error) {
    return formatError(error, options);
  }
}
