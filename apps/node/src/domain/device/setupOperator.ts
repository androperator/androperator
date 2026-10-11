import { existsSync } from "node:fs";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import { type RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import {
  grantDevicePermissions,
  grantAccessibilityPermission,
  hasListedPackage,
  listInstalledOperatorPackages,
  type PermissionGrantResult,
} from "./grantPermissions.js";
import { probeInteractiveState, type InteractiveStateProbeResult } from "../doctor/checks/deviceInteractivity.js";
import { ERROR_CODES } from "../../contracts/errors.js";

const readinessDependencies = {
  probe: probeInteractiveState,
  wait: () => new Promise<void>(resolve => setTimeout(resolve, 500)),
};

export interface InstallPhaseResult {
  ok: boolean;
  error?: string;
  exitCode?: number | null;
}

export interface VerifyPhaseResult {
  ok: boolean;
  packageInstalled: boolean;
  readiness?: { ok: boolean; attempts: InteractiveStateProbeResult[] };
  error?: string;
}

export interface OperatorInstallResult {
  operatorPackage: string;
  install: InstallPhaseResult;
  permissions?: PermissionGrantResult;
  verification?: VerifyPhaseResult;
}

export type { PermissionGrantResult } from "./grantPermissions.js";

/**
 * Install the Androperator Operator APK and bring the device to a ready state.
 *
 * Steps:
 *   1. Validate apkPath exists on the local filesystem.
 *   2. Run `adb install -r <apkPath>`.
 *   3. Detect or use the provided receiver package.
 *   4. Grant required device permissions (accessibility, notification listener).
 *   5. Verify package presence and a live, non-waking Operator handshake.
 */
export async function setupOperator(
  config: RuntimeConfig,
  apkPath: string,
  operatorPackage?: string,
  dependencies = readinessDependencies
): Promise<OperatorInstallResult> {
  // Step 1: Check that the APK file exists before invoking adb.
  if (!existsSync(apkPath)) {
    return {
      operatorPackage: operatorPackage ?? "<unknown>",
      install: {
        ok: false,
        error: `APK file not found: ${apkPath}`,
      },
    };
  }

  // Step 2: Install APK.
  const adbInstall = await runAdb(config, ["install", "-r", apkPath]);
  if (adbInstall.code !== 0) {
    const error = [adbInstall.stderr, adbInstall.stdout].filter(Boolean).join(" ").trim();
    return {
      operatorPackage: operatorPackage ?? "<unknown>",
      install: {
        ok: false,
        error: error || "adb install returned a non-zero exit code",
        exitCode: adbInstall.code,
      },
    };
  }

  const install: InstallPhaseResult = { ok: true };

  // Step 3: Resolve receiver package.
  const installedPackages = operatorPackage ? [operatorPackage] : await listInstalledOperatorPackages(config);
  const pkg = installedPackages.length === 1 ? installedPackages[0] : undefined;
  if (!pkg) {
    const error =
      installedPackages.length > 1
        ? "Multiple Operator package variants are installed after setup. Use --operator-package to specify the package explicitly."
        : "Could not detect installed Operator package after install. Use --operator-package to specify the package explicitly.";
    return {
      operatorPackage: "<unknown>",
      install,
      verification: {
        ok: false,
        packageInstalled: false,
        error,
      },
    };
  }

  // Step 4: Grant permissions using shared domain logic.
  const permissions = await grantDevicePermissions(config, pkg);
  const permFailed =
    !permissions.accessibility.ok
      ? permissions.accessibility
      : !permissions.notification.ok
        ? permissions.notification
        : !permissions.notificationListener.ok
          ? permissions.notificationListener
          : undefined;

  if (permFailed) {
    return { operatorPackage: pkg, install, permissions };
  }

  // Step 5: Lightweight post-install verification.
  const pkgCheck = await runAdb(config, ["shell", "pm", "list", "packages", pkg]);
  const packageInstalled =
    pkgCheck.code === 0 && hasListedPackage(pkgCheck.stdout, pkg);

  const verification: VerifyPhaseResult = {
    ok: packageInstalled,
    packageInstalled,
    error: packageInstalled ? undefined : `Package ${pkg} was not found after install.`,
  };

  if (packageInstalled) {
    const selectedConfig = { ...config, operatorPackage: pkg };
    const attempts: InteractiveStateProbeResult[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await dependencies.probe(selectedConfig);
      attempts.push(result);
      verification.readiness = { ok: result.ok, attempts };
      verification.ok = result.ok;
      if (result.ok) break;
      verification.error = `Operator handshake failed: ${result.message}. Run doctor for recovery guidance.`;
      if (result.code !== ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING || attempt === 2) break;
      // Android can remove the new grant while processing package installation.
      // Re-read and restore only this service; never toggle other services or replay actions.
      await dependencies.wait();
      const repair = await grantAccessibilityPermission(selectedConfig, pkg);
      permissions.accessibility = {
        ...repair,
        alreadyEnabled: permissions.accessibility.alreadyEnabled && repair.alreadyEnabled,
      };
      if (!repair.ok) {
        return { operatorPackage: pkg, install, permissions, verification };
      }
    }
    if (verification.ok) delete verification.error;
  }

  return { operatorPackage: pkg, install, permissions, verification };
}
