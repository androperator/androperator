import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { type ProcessRunner, NodeProcessRunner } from "./processRunner.js";
import type { Logger } from "../logger.js";

export const DEFAULT_ACTION_AGENT_COMMAND = "app.androperator.operator.ACTION_AGENT_COMMAND";
export const EXTRA_AGENT_PAYLOAD = "payload";

export interface RuntimeConfig {
  /** Root directory of the androperator project */
  projectRoot: string;
  /** adb binary path */
  adbPath: string;
  /** emulator binary path */
  emulatorPath: string;
  /** sdkmanager binary path */
  sdkmanagerPath: string;
  /** avdmanager binary path */
  avdmanagerPath: string;
  /** Target device serial (optional; resolved by domain if not set) */
  deviceId?: string;
  /** Receiver package for broadcast -p (required at dispatch time) */
  operatorPackage: string;
  /** Action name for agent command broadcast */
  actionAgentCommand: string;
  /** Intent extra key for JSON payload */
  payloadExtraKey: string;
  /** Process runner for executing commands (optional, defaults to NodeProcessRunner) */
  runner: ProcessRunner;
  /** Structured logger for lifecycle and debug diagnostics */
  logger?: Logger;
}

function resolveDefaultSdkToolPath(
  fallback: string,
  candidatePaths: string[]
): string {
  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return fallback;
}

function resolveOperatorPackageValue(
  provided: string | undefined,
  envValue: string | undefined,
): string {
  const candidate = provided ?? envValue;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "com.androperator.operator";
}

export function getDefaultRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<RuntimeConfig>;
  const { operatorPackage: overrideOperatorPackage, ...restOverrides } = definedOverrides;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const defaultProjectRoot = join(__dirname, "../../../../..");
  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;

  const defaultEmulatorPath = resolveDefaultSdkToolPath("emulator", [
    ...(androidHome ? [join(androidHome, "emulator", "emulator")] : []),
  ]);

  const defaultSdkmanagerPath = resolveDefaultSdkToolPath("sdkmanager", [
    ...(androidHome ? [join(androidHome, "cmdline-tools", "latest", "bin", "sdkmanager")] : []),
  ]);

  const defaultAvdmanagerPath = resolveDefaultSdkToolPath("avdmanager", [
    ...(androidHome ? [join(androidHome, "cmdline-tools", "latest", "bin", "avdmanager")] : []),
  ]);

  return {
    projectRoot: defaultProjectRoot,
    adbPath: "adb",
    emulatorPath: defaultEmulatorPath,
    sdkmanagerPath: defaultSdkmanagerPath,
    avdmanagerPath: defaultAvdmanagerPath,
    operatorPackage: resolveOperatorPackageValue(
      overrideOperatorPackage,
      process.env.ANDROPERATOR_OPERATOR_PACKAGE,
    ),
    actionAgentCommand: DEFAULT_ACTION_AGENT_COMMAND,
    payloadExtraKey: EXTRA_AGENT_PAYLOAD,
    runner: new NodeProcessRunner(),
    ...restOverrides,
  };
}
