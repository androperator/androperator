import { runAdb } from "../../android-bridge/adbClient.js";
import type { RuntimeConfig } from "../../android-bridge/runtimeConfig.js";
import { listDevices } from "../../../domain/devices/listDevices.js";
import type { RunningEmulatorDetails as RunningEmulator } from "../contracts.js";

function isEmulatorSerial(serial: string): boolean {
  return serial.startsWith("emulator-");
}

function parseEmulatorAvdName(stdout: string): string {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "OK");
  if (lines.length === 0) {
    throw new Error("Emulator did not return an AVD name");
  }
  return lines[0];
}

async function isBootPropComplete(
  config: RuntimeConfig,
  serial: string,
  prop: "sys.boot_completed" | "dev.bootcomplete"
): Promise<boolean> {
  const result = await runAdb({ ...config, deviceId: serial }, ["shell", "getprop", prop]);
  return result.code === 0 && result.stdout.trim() === "1";
}

export async function getRunningEmulatorAvdName(config: RuntimeConfig, serial: string): Promise<string> {
  const result = await runAdb({ ...config, deviceId: serial }, ["emu", "avd", "name"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to resolve AVD name for ${serial}`);
  }
  return parseEmulatorAvdName(result.stdout);
}

export async function isEmulatorBooted(config: RuntimeConfig, serial: string): Promise<boolean> {
  const [sysBootCompleted, devBootComplete] = await Promise.all([
    isBootPropComplete(config, serial, "sys.boot_completed"),
    isBootPropComplete(config, serial, "dev.bootcomplete"),
  ]);
  return sysBootCompleted && devBootComplete;
}

export async function listRunningEmulators(config: RuntimeConfig): Promise<RunningEmulator[]> {
  const devices = await listDevices(config);
  const emulators = devices.filter((device) => device.state === "device" && isEmulatorSerial(device.serial));
  const running: RunningEmulator[] = [];

  for (const device of emulators) {
    const avdName = await getRunningEmulatorAvdName(config, device.serial);
    const booted = await isEmulatorBooted(config, device.serial);

    running.push({
      type: "emulator",
      avdName,
      serial: device.serial,
      booted,
    });
  }

  return running;
}

export async function resolveRunningEmulatorByName(
  config: RuntimeConfig,
  name: string
): Promise<RunningEmulator | undefined> {
  const emulators = await listRunningEmulators(config);
  return emulators.find((emulator) => emulator.avdName === name);
}
