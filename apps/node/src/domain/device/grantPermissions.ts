import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import { type RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";

const DEFAULT_DEBUG_PACKAGE = "com.androperator.operator.dev";
const DEFAULT_RELEASE_PACKAGE = "com.androperator.operator";
const ACCESSIBILITY_SERVICE_CLASS =
  "androperator.operator.accessibilityservice.OperatorAccessibilityService";
const NOTIFICATION_LISTENER_SERVICE_CLASS =
  "action.notification.NotificationListenerService";

export interface AccessibilityGrantResult {
  ok: boolean;
  alreadyEnabled: boolean;
  error?: string;
}

export interface NotificationGrantResult {
  ok: boolean;
  skipped: boolean;
  error?: string;
}

export interface NotificationListenerGrantResult {
  ok: boolean;
  alreadyEnabled: boolean;
  error?: string;
}

export interface PermissionGrantResult {
  operatorPackage: string;
  accessibility: AccessibilityGrantResult;
  notification: NotificationGrantResult;
  notificationListener: NotificationListenerGrantResult;
}

export function hasListedPackage(packageListOutput: string, packageName: string): boolean {
  return packageListOutput
    .split("\n")
    .map(line => line.trim())
    .some(line => line === `package:${packageName}`);
}

export async function listInstalledOperatorPackages(config: RuntimeConfig): Promise<string[]> {
  const installedPackages: string[] = [];
  for (const pkg of [DEFAULT_RELEASE_PACKAGE, DEFAULT_DEBUG_PACKAGE]) {
    const result = await runAdb(config, ["shell", "pm", "list", "packages", pkg]);
    if (result.code === 0 && hasListedPackage(result.stdout, pkg)) {
      installedPackages.push(pkg);
    }
  }
  return installedPackages;
}

export async function detectOperatorPackage(config: RuntimeConfig): Promise<string | undefined> {
  const installedPackages = await listInstalledOperatorPackages(config);
  return installedPackages[0];
}

export async function grantAccessibilityPermission(
  config: RuntimeConfig,
  operatorPackage: string
): Promise<AccessibilityGrantResult> {
  const svc = `${operatorPackage}/${ACCESSIBILITY_SERVICE_CLASS}`;

  const currentResult = await runAdb(config, [
    "shell", "settings", "get", "secure", "enabled_accessibility_services",
  ]);
  if (currentResult.code !== 0) {
    return { ok: false, alreadyEnabled: false, error: currentResult.stderr || "Could not read accessibility services" };
  }

  const current = currentResult.stdout.trim();
  const alreadyEnabled = current.includes(svc);

  if (alreadyEnabled) {
    return { ok: true, alreadyEnabled: true };
  }

  const newValue = !current || current === "null" ? svc : `${current}:${svc}`;

  const enableResult = await runAdb(config, [
    "shell", "settings", "put", "secure", "accessibility_enabled", "1",
  ]);
  if (enableResult.code !== 0) {
    return { ok: false, alreadyEnabled: false, error: enableResult.stderr || "Could not set accessibility_enabled" };
  }

  const setResult = await runAdb(config, [
    "shell", "settings", "put", "secure", "enabled_accessibility_services", newValue,
  ]);
  if (setResult.code !== 0) {
    return { ok: false, alreadyEnabled: false, error: setResult.stderr || "Could not set enabled_accessibility_services" };
  }

  return { ok: true, alreadyEnabled: false };
}

export async function grantNotificationPermission(
  config: RuntimeConfig,
  operatorPackage: string
): Promise<NotificationGrantResult> {
  const result = await runAdb(config, [
    "shell", "pm", "grant", operatorPackage, "android.permission.POST_NOTIFICATIONS",
  ]);
  if (result.code !== 0) {
    const error = `${result.stderr} ${result.stdout}`.trim();
    const lowerError = error.toLowerCase();
    const expectedSkip =
      lowerError.includes("unknown permission") ||
      lowerError.includes("not a changeable permission type") ||
      lowerError.includes("already granted");

    if (expectedSkip) {
      return { ok: true, skipped: true, error: error || undefined };
    }

    return {
      ok: false,
      skipped: false,
      error: error || "Could not grant android.permission.POST_NOTIFICATIONS",
    };
  }
  return { ok: true, skipped: false };
}

export async function grantNotificationListenerPermission(
  config: RuntimeConfig,
  operatorPackage: string
): Promise<NotificationListenerGrantResult> {
  const svc = `${operatorPackage}/${NOTIFICATION_LISTENER_SERVICE_CLASS}`;

  const currentResult = await runAdb(config, [
    "shell", "settings", "get", "secure", "enabled_notification_listeners",
  ]);
  if (currentResult.code !== 0) {
    return { ok: false, alreadyEnabled: false, error: currentResult.stderr || "Could not read notification listeners" };
  }

  const current = currentResult.stdout.trim();
  const alreadyEnabled = current.split(":").includes(svc);
  // Notify NotificationManager even when the secure setting already lists the
  // component. A settings-only grant can leave Android's listener unbound.
  const grant = await runAdb(config, ["shell", "cmd", "notification", "allow_listener", svc]);
  const grantOutput = grant.stdout + grant.stderr;
  // Older Android images predate NotificationManager's shell grant command.
  const commandUnavailable = /unknown command|can't find service|not found|no shell command implementation/i.test(grantOutput);
  if (commandUnavailable) {
    const sdk = await runAdb(config, ["shell", "getprop", "ro.build.version.sdk"]);
    const api = Number(sdk.stdout.trim());
    if (sdk.code === 0 && Number.isInteger(api) && api >= 21 && api <= 26) {
      if (alreadyEnabled) return { ok: true, alreadyEnabled };
      const value = current && current !== "null" ? `${current}:${svc}` : svc;
      const legacy = await runAdb(config, ["shell", "settings", "put", "secure", "enabled_notification_listeners", value]);
      return legacy.code === 0 && !/exception|error/i.test(legacy.stdout + legacy.stderr)
        ? { ok: true, alreadyEnabled: false }
        : { ok: false, alreadyEnabled: false, error: legacy.stderr || legacy.stdout || "Could not grant notification access" };
    }
  }
  if (grant.code !== 0 || commandUnavailable || /exception|error|invalid listener/i.test(grantOutput)) {
    return { ok: false, alreadyEnabled, error: grant.stderr || grant.stdout || "Could not grant notification access; enable it in Android notification access settings." };
  }
  return { ok: true, alreadyEnabled };

}

export async function grantDevicePermissions(
  config: RuntimeConfig,
  operatorPackage?: string
): Promise<PermissionGrantResult> {
  const pkg = operatorPackage ?? config.operatorPackage ?? await detectOperatorPackage(config);
  if (!pkg) {
    return {
      operatorPackage: "<unknown>",
      accessibility: {
        ok: false,
        alreadyEnabled: false,
        error: "No Androperator Operator APK found on device. Install the APK first.",
      },
      notification: { ok: false, skipped: true },
      notificationListener: { ok: false, alreadyEnabled: false },
    };
  }

  const accessibility = await grantAccessibilityPermission(config, pkg);
  const notification = await grantNotificationPermission(config, pkg);
  const notificationListener = await grantNotificationListenerPermission(config, pkg);

  return { operatorPackage: pkg, accessibility, notification, notificationListener };
}
