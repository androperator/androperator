import { setTimeout as delay } from "node:timers/promises";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { runAndroidSdkTool } from "../../adapters/android-sdk/hostToolClient.js";
import { type AndroperatorError, ERROR_CODES } from "../../contracts/errors.js";
import {
  ADB_REGISTRATION_TIMEOUT_MS,
  BOOT_POLL_INTERVAL_MS,
  DEFAULT_EMULATOR_AVD_NAME,
  DEFAULT_EMULATOR_DATA_PARTITION_SIZE,
  DEFAULT_EMULATOR_DEVICE_PROFILE,
  EMULATOR_DATA_PARTITION_SIZE_PATTERN,
  DEFAULT_EMULATOR_SYSTEM_IMAGE,
  EMULATOR_BOOT_TIMEOUT_MS,
} from "./constants.js";
import { getAvdRoot, inspectConfiguredAvd } from "./configuredAvds.js";
import { isEmulatorBooted, resolveRunningEmulatorByName } from "./runningEmulators.js";

function buildError(
  code: AndroperatorError["code"],
  message: string,
  details?: Record<string, unknown>
): AndroperatorError {
  return { code, message, details };
}

export function normalizeEmulatorDataPartitionSize(size: string): string {
  const normalized = size.trim().toUpperCase();
  const match = normalized.match(EMULATOR_DATA_PARTITION_SIZE_PATTERN);
  if (!match) {
    throw buildError(
      ERROR_CODES.ANDROID_AVD_CREATE_FAILED,
      "Emulator data partition size must be a positive integer followed by G or GB",
      { value: size, expectedFormat: "<positive_integer>G|GB" }
    );
  }
  return `${match[1]}G`;
}

export function buildDefaultEmulatorAvdName(
  size: string = DEFAULT_EMULATOR_DATA_PARTITION_SIZE
): string {
  const normalizedSize = normalizeEmulatorDataPartitionSize(size).toLowerCase().replace(/g$/, "gb");
  return `${DEFAULT_EMULATOR_AVD_NAME}-${normalizedSize}`;
}

export function validateAvdName(name: string): void {
  if (basename(name) !== name || name.includes("\\")) {
    throw buildError(
      ERROR_CODES.ANDROID_AVD_CREATE_FAILED,
      "AVD names must not include path separators",
      { name }
    );
  }
}

function getAvdConfigPath(name: string): string {
  validateAvdName(name);
  return join(getAvdRoot(), `${name}.avd`, "config.ini");
}

async function setAvdConfigValue(path: string, key: string, value: string): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw buildError(
      ERROR_CODES.ANDROID_AVD_CREATE_FAILED,
      `Failed to read created AVD config at ${path}`,
      { path, cause: error instanceof Error ? error.message : String(error) }
    );
  }

  const line = `${key}=${value}`;
  const lines = contents.length > 0 ? contents.split("\n") : [];
  const index = lines.findIndex((existing) => existing.trimStart().startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = line;
  } else {
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines[lines.length - 1] = line;
      lines.push("");
    } else {
      lines.push(line);
    }
  }
  try {
    await writeFile(path, lines.join("\n"), "utf8");
  } catch (error) {
    throw buildError(
      ERROR_CODES.ANDROID_AVD_CREATE_FAILED,
      `Failed to write AVD config at ${path}`,
      { path, key, value, cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

export async function setAvdDataPartitionSize(
  name: string,
  size: string = DEFAULT_EMULATOR_DATA_PARTITION_SIZE
): Promise<void> {
  await setAvdConfigValue(getAvdConfigPath(name), "disk.dataPartition.size", normalizeEmulatorDataPartitionSize(size));
}

async function deleteCreatedAvdAfterFailedConfigUpdate(
  config: RuntimeConfig,
  name: string,
  cause: unknown
): Promise<never> {
  const result = await runAndroidSdkTool(config, "avdmanager", ["delete", "avd", "--name", name], {
    timeoutMs: 60_000,
  });
  const typedCause = cause as { message?: string; details?: Record<string, unknown> };
  throw buildError(
    ERROR_CODES.ANDROID_AVD_CREATE_FAILED,
    typedCause.message ?? `Failed to configure Android Virtual Device ${name}`,
    {
      ...(typedCause.details ?? {}),
      name,
      cleanup: {
        attempted: true,
        succeeded: result.code === 0,
        stderr: result.stderr,
      },
    }
  );
}

export async function isSystemImageInstalled(config: RuntimeConfig, systemImage: string): Promise<boolean> {
  const result = await runAndroidSdkTool(config, "sdkmanager", ["--list_installed"], { timeoutMs: 30_000 });
  if (result.code !== 0) {
    throw buildError(
      ERROR_CODES.ANDROID_SYSTEM_IMAGE_INSTALL_FAILED,
      result.stderr || "Failed to query installed Android system images",
      { systemImage }
    );
  }
  return result.stdout.includes(systemImage);
}

export async function acceptAndroidSdkLicenses(config: RuntimeConfig): Promise<void> {
  const result = await runAndroidSdkTool(config, "sdkmanager", ["--licenses"], {
    timeoutMs: 120_000,
    input: "y\n".repeat(100),
  });
  if (result.code !== 0) {
    throw buildError(
      ERROR_CODES.ANDROID_SYSTEM_IMAGE_INSTALL_FAILED,
      result.stderr || "Failed to accept Android SDK licenses"
    );
  }
}

export async function ensureSystemImageInstalled(
  config: RuntimeConfig,
  systemImage: string = DEFAULT_EMULATOR_SYSTEM_IMAGE
): Promise<void> {
  if (await isSystemImageInstalled(config, systemImage)) {
    return;
  }

  await acceptAndroidSdkLicenses(config);
  const result = await runAndroidSdkTool(config, "sdkmanager", [systemImage], { timeoutMs: 300_000 });
  if (result.code !== 0) {
    throw buildError(
      ERROR_CODES.ANDROID_SYSTEM_IMAGE_INSTALL_FAILED,
      result.stderr || "Failed to install Android system image",
      { systemImage }
    );
  }
}

export async function createAvd(
  config: RuntimeConfig,
  options: {
    name: string;
    systemImage?: string;
    deviceProfile?: string;
    dataPartitionSize?: string;
  }
): Promise<void> {
  const systemImage = options.systemImage ?? DEFAULT_EMULATOR_SYSTEM_IMAGE;
  const deviceProfile = options.deviceProfile ?? DEFAULT_EMULATOR_DEVICE_PROFILE;
  const dataPartitionSize = options.dataPartitionSize ?? DEFAULT_EMULATOR_DATA_PARTITION_SIZE;
  validateAvdName(options.name);
  const existedBeforeCreate = (await inspectConfiguredAvd(options.name)).exists;

  await ensureSystemImageInstalled(config, systemImage);
  const result = await runAndroidSdkTool(
    config,
    "avdmanager",
    ["create", "avd", "--force", "--name", options.name, "--package", systemImage, "--device", deviceProfile],
    { timeoutMs: 120_000, input: "no\n" }
  );
  if (result.code !== 0) {
    throw buildError(
      ERROR_CODES.ANDROID_AVD_CREATE_FAILED,
      result.stderr || "Failed to create Android Virtual Device",
      { name: options.name, systemImage, deviceProfile }
    );
  }

  try {
    await setAvdDataPartitionSize(options.name, dataPartitionSize);
  } catch (error) {
    if (!existedBeforeCreate) {
      await deleteCreatedAvdAfterFailedConfigUpdate(config, options.name, error);
    }
    throw error;
  }
}

export function startAvd(
  config: RuntimeConfig,
  name: string,
  extraArgs: string[] = []
): void {
  const args = [`@${name}`, "-no-snapshot-load", "-no-boot-anim", ...extraArgs];
  const child = config.runner.spawn(config.emulatorPath, args, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    shell: false,
  });
  if (child && typeof child.unref === "function") {
    child.unref();
  }
}

export async function waitForEmulatorRegistration(
  config: RuntimeConfig,
  name: string,
  timeoutMs: number = ADB_REGISTRATION_TIMEOUT_MS
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const running = await resolveRunningEmulatorByName(config, name);
    if (running) {
      return running.serial;
    }
    await delay(BOOT_POLL_INTERVAL_MS);
  }

  throw buildError(
    ERROR_CODES.EMULATOR_START_FAILED,
    `Timed out waiting for emulator ${name} to appear in adb`,
    { name, timeoutMs }
  );
}

export async function waitForBootCompletion(
  config: RuntimeConfig,
  serial: string,
  timeoutMs: number = EMULATOR_BOOT_TIMEOUT_MS
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isEmulatorBooted(config, serial)) {
      return;
    }
    await delay(BOOT_POLL_INTERVAL_MS);
  }

  throw buildError(
    ERROR_CODES.EMULATOR_BOOT_TIMEOUT,
    `Timed out waiting for emulator ${serial} to finish booting`,
    { serial, timeoutMs }
  );
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

export async function stopAvd(config: RuntimeConfig, name: string): Promise<void> {
  const running = await resolveRunningEmulatorByName(config, name);
  if (!running) {
    throw buildError(ERROR_CODES.EMULATOR_NOT_RUNNING, `Emulator ${name} is not running`, { name });
  }

  const result = await runAdb({ ...config, deviceId: running.serial }, ["emu", "kill"]);
  if (result.code !== 0) {
    throw buildError(
      ERROR_CODES.EMULATOR_STOP_FAILED,
      result.stderr || `Failed to stop emulator ${name}`,
      { name, serial: running.serial }
    );
  }
}

export async function deleteAvd(config: RuntimeConfig, name: string): Promise<void> {
  const running = await resolveRunningEmulatorByName(config, name);
  if (running) {
    throw buildError(
      ERROR_CODES.EMULATOR_ALREADY_RUNNING,
      `Cannot delete running emulator ${name}`,
      { name, serial: running.serial }
    );
  }

  const existing = await inspectConfiguredAvd(name);
  if (!existing.exists) {
    throw buildError(ERROR_CODES.EMULATOR_NOT_FOUND, `AVD ${name} does not exist`, { name });
  }

  const result = await runAndroidSdkTool(config, "avdmanager", ["delete", "avd", "--name", name], {
    timeoutMs: 60_000,
  });
  if (result.code !== 0) {
    throw buildError(
      ERROR_CODES.EMULATOR_DELETE_FAILED,
      result.stderr || `Failed to delete emulator ${name}`,
      { name }
    );
  }
}
