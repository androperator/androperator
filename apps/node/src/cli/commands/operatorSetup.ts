import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { setupOperator } from "../../domain/device/setupOperator.js";
import { resolveOperatorPackageForRequest } from "../../domain/config/resolveOperatorPackage.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import type { OutputOptions } from "../output.js";
import { formatSuccess, formatError } from "../output.js";
import type { PermissionGrantResult } from "../../domain/device/setupOperator.js";
import type { Logger } from "../../adapters/logger.js";

export function didAllPermissionsAlreadyExist(permissions?: PermissionGrantResult): boolean {
  if (!permissions) {
    return false;
  }

  return Boolean(
    permissions.accessibility.alreadyEnabled &&
    permissions.notificationListener.alreadyEnabled &&
    !permissions.notification.skipped
  );
}

export async function cmdOperatorSetup(options: {
  format: OutputOptions["format"];
  apkPath: string;
  deviceId?: string;
  operatorPackage?: string;
  logger?: Logger;
}): Promise<string> {
  const operatorPackage = resolveOperatorPackageForRequest(options.operatorPackage);
  const config = getDefaultRuntimeConfig({
    deviceId: options.deviceId,
    operatorPackage,
    adbPath: process.env.ADB_PATH,
    logger: options.logger,
  });

  const result = await setupOperator(config, options.apkPath, operatorPackage);

  // Install phase failure.
  if (!result.install.ok) {
    const isNotFound = result.install.error?.startsWith("APK file not found");
    return formatError(
      {
        code: isNotFound ? ERROR_CODES.OPERATOR_APK_NOT_FOUND : ERROR_CODES.OPERATOR_INSTALL_FAILED,
        message: result.install.error ?? "APK install failed.",
        operatorPackage: result.operatorPackage,
        install: result.install,
      },
      options
    );
  }

  // Permission grant phase failure.
  if (result.permissions) {
    const { accessibility, notification, notificationListener } = result.permissions;
    const permFailed =
      !accessibility.ok ? accessibility
        : !notification.ok ? notification
          : !notificationListener.ok ? notificationListener
            : undefined;

    if (permFailed) {
      return formatError(
        {
          code: ERROR_CODES.OPERATOR_GRANT_FAILED,
          message: permFailed.error ?? "Failed to grant required device permissions.",
          operatorPackage: result.operatorPackage,
          install: result.install,
          permissions: {
            accessibility,
            notification,
            notificationListener,
          },
        },
        options
      );
    }
  }

  // Verification phase failure.
  if (result.verification && !result.verification.ok) {
    return formatError(
      {
        code: ERROR_CODES.OPERATOR_VERIFY_FAILED,
        message: result.verification.error ?? "Operator verification failed after install.",
        operatorPackage: result.operatorPackage,
        install: result.install,
        permissions: result.permissions
          ? {
            accessibility: result.permissions.accessibility,
            notification: result.permissions.notification,
            notificationListener: result.permissions.notificationListener,
          }
          : undefined,
        verification: result.verification,
      },
      options
    );
  }

  // All phases succeeded.
  const permissionsAlreadyEnabled = didAllPermissionsAlreadyExist(result.permissions);

  return formatSuccess(
    {
      operatorPackage: result.operatorPackage,
      install: result.install,
      permissions: result.permissions
        ? {
          accessibility: result.permissions.accessibility,
          notification: result.permissions.notification,
          notificationListener: result.permissions.notificationListener,
        }
        : undefined,
      verification: result.verification,
      message: permissionsAlreadyEnabled
        ? "Operator installed. Required permissions were already enabled."
        : "Operator installed and ready. Run androperator doctor to verify.",
    },
    options
  );
}
