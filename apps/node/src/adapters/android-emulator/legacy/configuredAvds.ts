import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeConfig } from "../../android-bridge/runtimeConfig.js";
import { runAndroidSdkTool } from "../../android-sdk/hostToolClient.js";
import type { ConfiguredAvdDetails as ConfiguredAvd } from "../contracts.js";

type IniMap = Record<string, string>;

export function getAvdRoot(): string {
  const androidAvdHome = process.env.ANDROID_AVD_HOME;
  if (typeof androidAvdHome === "string" && androidAvdHome.trim().length > 0) {
    return androidAvdHome.trim();
  }
  return join(homedir(), ".android", "avd");
}

function parseIni(contents: string): IniMap {
  const map: IniMap = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    map[key] = value;
  }
  return map;
}

function parseApiLevel(config: IniMap, root: IniMap): number | null {
  const target = config.target ?? root.target;
  if (target) {
    const match = target.match(/android-(\d+)/);
    if (match) {
      return Number(match[1]);
    }
  }

  const systemImage = config["image.sysdir.1"];
  if (!systemImage) {
    return null;
  }
  const match = systemImage.match(/android-(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseSystemImage(config: IniMap): string | null {
  const sysdir = config["image.sysdir.1"];
  if (!sysdir) {
    return null;
  }
  return sysdir.replace(/\/+$/, "").replaceAll("/", ";");
}

function parsePlayStore(config: IniMap): boolean {
  const explicit = config["PlayStore.enabled"]?.toLowerCase();
  if (explicit === "true" || explicit === "yes") {
    return true;
  }

  const tagId = config["tag.id"]?.toLowerCase();
  if (tagId === "google_apis_playstore") {
    return true;
  }

  const systemImage = config["image.sysdir.1"]?.toLowerCase();
  return systemImage?.includes("google_apis_playstore") ?? false;
}

function parseDeviceProfile(config: IniMap): string | null {
  return config["hw.device.name"] ?? null;
}

async function readIniIfPresent(path: string): Promise<IniMap> {
  try {
    const contents = await readFile(path, "utf8");
    return parseIni(contents);
  } catch {
    return {};
  }
}

export async function inspectConfiguredAvd(
  name: string,
  runningNames: Set<string> = new Set()
): Promise<ConfiguredAvd> {
  const avdRoot = getAvdRoot();
  const config = await readIniIfPresent(join(avdRoot, `${name}.avd`, "config.ini"));
  const root = await readIniIfPresent(join(avdRoot, `${name}.ini`));
  const exists = Object.keys(config).length > 0 || Object.keys(root).length > 0;

  return {
    name,
    exists,
    running: runningNames.has(name),
    apiLevel: parseApiLevel(config, root),
    abi: config["abi.type"] ?? null,
    playStore: parsePlayStore(config),
    deviceProfile: parseDeviceProfile(config),
    systemImage: parseSystemImage(config),
  };
}

export async function listConfiguredAvds(config: RuntimeConfig, runningNames: Set<string> = new Set()): Promise<ConfiguredAvd[]> {
  const result = await runAndroidSdkTool(config, "emulator", ["-list-avds"], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to list configured AVDs");
  }

  const names = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const avds: ConfiguredAvd[] = [];
  for (const name of names) {
    avds.push(await inspectConfiguredAvd(name, runningNames));
  }
  return avds;
}
