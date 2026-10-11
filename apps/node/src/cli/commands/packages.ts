import { ERROR_CODES } from "../../contracts/errors.js";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import { resolveDevice } from "../../domain/devices/resolveDevice.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { OutputOptions } from "../output.js";
import { formatSuccess, formatError } from "../output.js";
import type { Logger } from "../../adapters/logger.js";

export async function cmdPackagesList(options: {
  format: OutputOptions["format"];
  deviceId?: string;
  thirdParty?: boolean;
  logger?: Logger;
}): Promise<string> {
  const config = getDefaultRuntimeConfig({
    deviceId: options.deviceId,
    adbPath: process.env.ADB_PATH,
    logger: options.logger,
  });
  try {
    const resolved = await resolveDevice(config);
    config.deviceId = resolved.deviceId;
    const args = options.thirdParty ? ["shell", "pm", "list", "packages", "-3"] : ["shell", "pm", "list", "packages"];
    const { stdout, stderr, code } = await runAdb(config, args);
    if (code !== 0 || stderr.trim() !== "") {
      throw {
        code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
        message: "Package listing failed. Check the device connection and package manager, then retry packages list.",
        details: { adbExitCode: code, stderr: stderr.trim() },
      };
    }
    const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const packages: string[] = [];
    for (const line of lines) {
      const match = /^package:([^\s:]+)$/.exec(line);
      if (!match) {
        throw {
          code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
          message: "Package listing returned invalid output. Check the package manager, then retry packages list.",
          details: { adbExitCode: code },
        };
      }
      packages.push(match[1]);
    }
    return formatSuccess({ packages }, options);
  } catch (e) {
    return formatError(e, options);
  }
}
