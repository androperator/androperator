import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { grantDevicePermissions } from "../../domain/device/grantPermissions.js";
import type { OutputOptions } from "../output.js";
import { formatSuccess, formatError } from "../output.js";
import type { Logger } from "../../adapters/logger.js";

export async function cmdGrantDevicePermissions(options: {
  format: OutputOptions["format"];
  deviceId?: string;
  operatorPackage?: string;
  logger?: Logger;
}): Promise<string> {
  const config = getDefaultRuntimeConfig({
    deviceId: options.deviceId,
    operatorPackage: options.operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE,
    adbPath: process.env.ADB_PATH,
    logger: options.logger,
  });

  const result = await grantDevicePermissions(config, options.operatorPackage);

  const failedGrant =
    !result.accessibility.ok ? result.accessibility
      : !result.notification.ok ? result.notification
      : !result.notificationListener.ok ? result.notificationListener
      : undefined;

  if (failedGrant) {
    return formatError(
      {
        code: "GRANT_DEVICE_PERMISSIONS_FAILED",
        message: failedGrant.error ?? "Failed to grant required device permissions.",
        operatorPackage: result.operatorPackage,
        accessibility: result.accessibility,
        notification: result.notification,
        notificationListener: result.notificationListener,
      },
      options
    );
  }

  return formatSuccess(
    {
      operatorPackage: result.operatorPackage,
      accessibility: result.accessibility,
      notification: result.notification,
      notificationListener: result.notificationListener,
      message: result.accessibility.alreadyEnabled && result.notificationListener.alreadyEnabled
        ? "Required device permissions were already enabled."
        : "Required device permissions enabled. Run androperator doctor to verify.",
    },
    options
  );
}
