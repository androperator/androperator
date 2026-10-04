import { emulatorBackend } from "../../adapters/android-emulator/index.js";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { type AndroperatorError, ERROR_CODES } from "../../contracts/errors.js";
import { DEFAULT_EMULATOR_AVD_NAME, DEFAULT_EMULATOR_DATA_PARTITION_SIZE,
  DEFAULT_EMULATOR_DEVICE_PROFILE, DEFAULT_EMULATOR_SYSTEM_IMAGE } from "./constants.js";

export function normalizeEmulatorDataPartitionSize(size: string): string {
  return emulatorBackend.normalizeEmulatorDataPartitionSize(size);
}
export function validateAvdName(name: string): void {
  emulatorBackend.validateAvdName(name);
}
export function buildDefaultEmulatorAvdName(size: string = DEFAULT_EMULATOR_DATA_PARTITION_SIZE): string {
  const normalizedSize = normalizeEmulatorDataPartitionSize(size).toLowerCase().replace(/g$/, "gb");
  return `${DEFAULT_EMULATOR_AVD_NAME}-${normalizedSize}`;
}
export function setAvdDataPartitionSize(name: string, size: string = DEFAULT_EMULATOR_DATA_PARTITION_SIZE): Promise<void> {
  return emulatorBackend.setAvdDataPartitionSize(name, size);
}
export function isSystemImageInstalled(config: RuntimeConfig, systemImage: string): Promise<boolean> {
  return emulatorBackend.isSystemImageInstalled(config, systemImage);
}
export function acceptAndroidSdkLicenses(config: RuntimeConfig): Promise<void> {
  return emulatorBackend.acceptAndroidSdkLicenses(config);
}
export function ensureSystemImageInstalled(config: RuntimeConfig, systemImage: string = DEFAULT_EMULATOR_SYSTEM_IMAGE): Promise<void> {
  return emulatorBackend.ensureSystemImageInstalled(config, systemImage, { acceptLicenses: true });
}
export function createAvd(config: RuntimeConfig, options: {
  name: string; systemImage?: string; deviceProfile?: string; dataPartitionSize?: string;
}): Promise<void> {
  return emulatorBackend.createAvd(config, {
    name: options.name,
    systemImage: options.systemImage ?? DEFAULT_EMULATOR_SYSTEM_IMAGE,
    deviceProfile: options.deviceProfile ?? DEFAULT_EMULATOR_DEVICE_PROFILE,
    dataPartitionSize: options.dataPartitionSize ?? DEFAULT_EMULATOR_DATA_PARTITION_SIZE,
    replace: true,
    acceptLicenses: true,
  });
}
export function startAvd(config: RuntimeConfig, name: string, extraArgs: string[] = []): Promise<void> {
  return emulatorBackend.startAvd(config, name, extraArgs);
}
export function waitForEmulatorRegistration(config: RuntimeConfig, name: string, timeoutMs?: number): Promise<string> {
  return emulatorBackend.waitForEmulatorRegistration(config, name, timeoutMs);
}
export function waitForBootCompletion(config: RuntimeConfig, serial: string, timeoutMs?: number): Promise<void> {
  return emulatorBackend.waitForBootCompletion(config, serial, timeoutMs);
}
export function stopAvd(config: RuntimeConfig, name: string): Promise<void> {
  return emulatorBackend.stopAvd(config, name);
}
export function deleteAvd(config: RuntimeConfig, name: string): Promise<void> {
  return emulatorBackend.deleteAvd(config, name);
}

function buildError(
  code: AndroperatorError["code"],
  message: string,
  details?: Record<string, unknown>
): AndroperatorError {
  return { code, message, details };
}

export async function enableEmulatorDeveloperSettings(
  config: RuntimeConfig,
  serial: string
): Promise<void> {
  const developmentSettings = await runAdb(
    { ...config, deviceId: serial },
    ["shell", "settings", "put", "global", "development_settings_enabled", "1"]
  );
  if (developmentSettings.code !== 0) {
    throw buildError(
      ERROR_CODES.EMULATOR_START_FAILED,
      `Failed to enable Developer Options on emulator ${serial}`,
      { serial, stderr: developmentSettings.stderr }
    );
  }

  const adbSettings = await runAdb(
    { ...config, deviceId: serial },
    ["shell", "settings", "put", "global", "adb_enabled", "1"]
  );
  if (adbSettings.code !== 0) {
    throw buildError(
      ERROR_CODES.EMULATOR_START_FAILED,
      `Failed to enable adb on emulator ${serial}`,
      { serial, stderr: adbSettings.stderr }
    );
  }
}
