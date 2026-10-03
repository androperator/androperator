import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { type ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import { type AndroperatorError } from "../../contracts/errors.js";
import { resolveDevice } from "../../domain/devices/resolveDevice.js";
import { getCliVersion, probeVersionCompatibility } from "../../domain/version/compatibility.js";
import type { OutputOptions } from "../output.js";
import { formatError, formatSuccess } from "../output.js";
import type { Logger } from "../../adapters/logger.js";

export async function cmdVersion(options: OutputOptions & {
  checkCompat?: boolean;
  deviceId?: string;
  operatorPackage?: string;
  runner?: ProcessRunner;
  logger?: Logger;
}): Promise<string> {
  if (!options.checkCompat) {
    try {
      return formatSuccess({ cliVersion: getCliVersion() }, options);
    } catch (error) {
      process.exitCode = 1;
      return formatError({
        code: "CLI_VERSION_INVALID",
        message: "CLI version metadata is missing or unreadable.",
        details: { cause: String(error) },
      }, options);
    }
  }

  const config = getDefaultRuntimeConfig({
    deviceId: options.deviceId,
    operatorPackage: options.operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE,
    adbPath: process.env.ADB_PATH,
    runner: options.runner,
    logger: options.logger,
  });

  try {
    const resolved = await resolveDevice(config);
    config.deviceId = resolved.deviceId;

    const result = await probeVersionCompatibility(config);
    process.exitCode = result.compatible ? 0 : 1;
    return formatSuccess({
      cliVersion: result.cliVersion,
      apkVersion: result.apkVersion,
      apkVersionCode: result.apkVersionCode,
      operatorPackage: result.operatorPackage,
      compatible: result.compatible,
      error: result.error,
      remediation: result.remediation,
    }, options);
  } catch (error) {
    process.exitCode = 1;
    return formatError(error as AndroperatorError, options);
  }
}
