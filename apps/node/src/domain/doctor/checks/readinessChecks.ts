import { runAdb } from "../../../adapters/android-bridge/adbClient.js";
import { type RuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { type DoctorCheckResult } from "../../../contracts/doctor.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import type { StepResult } from "../../../contracts/result.js";
import { runExecution } from "../../executions/runExecution.js";
import { waitForResultEnvelope } from "../../../adapters/android-bridge/logcatResultReader.js";
import {
  buildDeviceNotInteractiveError,
  isInteractiveAutomationReady,
  parseDoctorPingInteractiveState,
  probeInteractiveState,
  runDoctorPingCommand,
  toInteractiveStateEvidence,
} from "./deviceInteractivity.js";
import type { InternalInteractiveState, InteractiveStateProbeResult } from "./deviceInteractivity.js";
import {
  getAlternateOperatorVariant,
  getCliVersion,
  getOperatorPackageApkPath,
  hasListedPackage,
  probeVersionCompatibility,
} from "../../version/compatibility.js";
import { DEFAULT_OPERATOR_PACKAGE } from "../../config/resolveOperatorPackage.js";
import { buildResultEnvelopeTimeoutHint } from "../../executions/timeoutGuidance.js";
import { DOCTOR_DOCS_URLS } from "../docsUrls.js";

function buildMissingApkFixSteps(config: RuntimeConfig): Array<{ kind: "shell" | "manual"; value: string }> {
  if (config.operatorPackage === DEFAULT_OPERATOR_PACKAGE) {
    return [
      {
        kind: "shell",
        value: "androperator operator download",
      },
      {
        kind: "shell",
        value: `androperator operator setup --apk ${getOperatorPackageApkPath(config.operatorPackage)} --device ${config.deviceId}`,
      },
    ];
  }

  const matchingApkLabel = config.operatorPackage.endsWith(".dev") ? "matching local debug APK" : "matching local APK";
  const buildGuidance = config.operatorPackage.endsWith(".dev")
    ? "rebuild the debug app from the same checkout"
    : `build or obtain the APK for ${config.operatorPackage} from the same checkout`;

  return [
    {
      kind: "manual",
      value: `If you do not already have a ${matchingApkLabel} at ${getOperatorPackageApkPath(config.operatorPackage)}, ${buildGuidance} before rerunning setup.`,
    },
    {
      kind: "shell",
      value: `androperator operator setup --apk ${getOperatorPackageApkPath(config.operatorPackage)} --device ${config.deviceId} --operator-package ${config.operatorPackage}`,
    },
  ];
}

export async function checkApkPresence(config: RuntimeConfig): Promise<DoctorCheckResult> {
  const packageList = await runAdb(config, ["shell", "pm", "list", "packages", config.operatorPackage]);
  if (packageList.code !== 0) {
    return {
      id: "readiness.apk.presence",
      status: "fail",
      code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
      summary: "Could not query installed packages on the device.",
      detail: packageList.stderr || undefined,
      evidence: {
        operatorPackage: config.operatorPackage,
        exitCode: packageList.code ?? undefined,
      },
    };
  }
  const isInstalled = hasListedPackage(packageList.stdout, config.operatorPackage);

  if (!isInstalled) {
    // Check if the other variant is installed
    const otherVariant = getAlternateOperatorVariant(config.operatorPackage);

    const alternateList = await runAdb(config, ["shell", "pm", "list", "packages", otherVariant]);
    if (alternateList.code !== 0) {
      return {
        id: "readiness.apk.presence",
        status: "fail",
        code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
        summary: "Could not query installed packages on the device.",
        detail: alternateList.stderr || undefined,
        evidence: {
          operatorPackage: otherVariant,
          exitCode: alternateList.code ?? undefined,
        },
      };
    }
    if (hasListedPackage(alternateList.stdout, otherVariant)) {
      return {
        id: "readiness.apk.presence",
        status: "fail",
        code: ERROR_CODES.OPERATOR_VARIANT_MISMATCH,
        summary: `Wrong Operator variant installed.`,
        detail: `Expected ${config.operatorPackage} but found ${otherVariant}.`,
        fix: {
          title: "Switch variant",
          platform: "any",
          steps: [
            { kind: "manual", value: `Use --operator-package ${otherVariant} or reinstall the correct APK` },
            { kind: "manual", value: `Public installs typically use com.androperator.operator; local debug builds use com.androperator.operator.dev` },
          ],
          docsUrl: DOCTOR_DOCS_URLS.operator,
        },
      };
    }

    return {
      id: "readiness.apk.presence",
      status: "fail",
      code: ERROR_CODES.OPERATOR_NOT_INSTALLED,
      summary: "Operator APK not installed.",
      detail: `Package ${config.operatorPackage} was not found on the device.`,
      evidence: {
        cliVersion: getCliVersion(),
        operatorPackage: config.operatorPackage,
      },
      fix: {
        title: "Install Operator APK",
        platform: "any",
        steps: buildMissingApkFixSteps(config),
        docsUrl: DOCTOR_DOCS_URLS.setup,
      },
    };
  }

  return {
    id: "readiness.apk.presence",
    status: "pass",
    summary: `Operator APK (${config.operatorPackage}) is installed.`,
  };
}

export async function checkSettings(config: RuntimeConfig): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];

  const devOptions = await runAdb(config, ["shell", "settings", "get", "global", "development_settings_enabled"]);
  if (devOptions.stdout.trim() !== "1") {
    results.push({
      id: "readiness.settings.dev_options",
      status: "warn",
      code: ERROR_CODES.DEVICE_DEV_OPTIONS_DISABLED,
      summary: "Developer options are disabled.",
      detail: "Enable Developer Options in Android Settings (Tap Build Number 7 times).",
    });
  } else {
    results.push({ id: "readiness.settings.dev_options", status: "pass", summary: "Developer options are enabled." });
  }

  const adbEnabled = await runAdb(config, ["shell", "settings", "get", "global", "adb_enabled"]);
  if (adbEnabled.stdout.trim() !== "1") {
    results.push({
      id: "readiness.settings.usb_debugging",
      status: "warn",
      code: ERROR_CODES.DEVICE_USB_DEBUGGING_DISABLED,
      summary: "USB debugging is disabled.",
    });
  } else {
    results.push({ id: "readiness.settings.usb_debugging", status: "pass", summary: "USB debugging is enabled." });
  }

  return results;
}

export async function checkVersionCompatibility(config: RuntimeConfig): Promise<DoctorCheckResult> {
  const result = await probeVersionCompatibility(config);
  const errorCode = result.error?.code ?? ERROR_CODES.VERSION_INCOMPATIBLE;

  if (result.compatible) {
    return {
      id: "readiness.version.compatibility",
      status: "pass",
      summary: `CLI ${result.cliVersion} is compatible with installed APK ${result.apkVersion}.`,
      evidence: {
        cliVersion: result.cliVersion,
        apkVersion: result.apkVersion,
        apkVersionCode: result.apkVersionCode,
        operatorPackage: result.operatorPackage,
      },
    };
  }

  return {
    id: "readiness.version.compatibility",
    status: "fail",
    code: errorCode,
    summary: errorCode === ERROR_CODES.VERSION_INCOMPATIBLE
      ? "CLI and installed APK versions are not compatible."
      : "Could not verify CLI and installed APK version compatibility.",
    detail: result.error?.message,
    fix: result.remediation && result.remediation.length > 0
      ? {
        title: "Align CLI and APK versions",
        platform: "any",
        steps: result.remediation.map(step => ({ kind: "manual" as const, value: step })),
        docsUrl: DOCTOR_DOCS_URLS.compatibility,
      }
      : undefined,
    evidence: {
      cliVersion: result.cliVersion,
      apkVersion: result.apkVersion,
      apkVersionCode: result.apkVersionCode,
      operatorPackage: result.operatorPackage,
    },
  };
}

export async function runHandshake(
  config: RuntimeConfig,
  _waitForResultEnvelope = waitForResultEnvelope
): Promise<DoctorCheckResult> {
  await runAdb(config, ["logcat", "-c"]);
  const result = await runDoctorPingCommand(config, _waitForResultEnvelope);

  if (result.ok) {
    if (result.envelope.status === "success") {
      const doctorPingStep = result.envelope.stepResults.find(step => step.actionType === "doctor_ping");
      if (doctorPingStep?.success !== true) {
        return {
          id: "readiness.handshake",
          status: "fail",
          code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
          summary: "Handshake did not include a successful doctor_ping step.",
        };
      }
      const interactiveEvidence = doctorPingStep.success
        ? (() => {
            const parsedEvidence = tryBuildInteractiveStateEvidence(doctorPingStep);
            return parsedEvidence.ok ? parsedEvidence.evidence : undefined;
          })()
        : undefined;
      return {
        id: "readiness.handshake",
        status: "pass",
        summary: "Handshake successful.",
        detail: "Node successfully dispatched a command and received a valid result envelope.",
        evidence: interactiveEvidence,
      };
    } else {
      const deviceFlag = config.deviceId ? ` --device ${config.deviceId}` : "";
      const pkgFlag = config.operatorPackage ? ` --operator-package ${config.operatorPackage}` : "";
      return {
        id: "readiness.handshake",
        status: "fail",
        code: ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING,
        summary: "Handshake failed (runtime error).",
        detail: `Operator returned an error: ${result.envelope.error}`,
        fix: {
          title: "Grant accessibility permissions via adb",
          platform: "any",
          steps: [
            { kind: "shell", value: `androperator grant-device-permissions${deviceFlag}${pkgFlag}` },
          ],
          docsUrl: DOCTOR_DOCS_URLS.operator,
        },
        deviceGuidance: {
          screen: "Accessibility Settings",
          steps: ["Ensure Androperator Accessibility Service is ON in Android Settings"],
        },
      };
    }
  }

  if ("timeout" in result && result.timeout) {
    const deviceFlag = config.deviceId ? ` --device ${config.deviceId}` : "";
    const pkgFlag = config.operatorPackage ? ` --operator-package ${config.operatorPackage}` : "";
    const timeoutHint = buildResultEnvelopeTimeoutHint(result.diagnostics, {
      deviceId: config.deviceId,
      operatorPackage: config.operatorPackage,
    });
    const timeoutMessage = [
      `No [Androperator-Result] envelope received within 7000ms.`,
      `Broadcast dispatch: ${result.diagnostics.broadcastDispatchStatus}.`,
      `Operator package: ${config.operatorPackage}.`,
      config.deviceId ? `Device: ${config.deviceId}.` : undefined,
      (result.diagnostics.lastCorrelatedEvents?.length ?? 0) > 0
        ? "Re-run with --verbose to inspect correlated Android log lines."
        : undefined,
      timeoutHint,
    ].filter(Boolean).join(" ");
    return {
      id: "readiness.handshake",
      status: "fail",
      code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
      summary: "Handshake timed out.",
      detail: timeoutMessage,
      fix: {
        title: "Grant accessibility permissions via adb",
        platform: "any",
        steps: [
          { kind: "shell", value: `androperator grant-device-permissions${deviceFlag}${pkgFlag}` },
          { kind: "shell", value: `androperator snapshot${deviceFlag}${pkgFlag} --timeout 5000 --verbose` },
        ],
        docsUrl: DOCTOR_DOCS_URLS.operator,
      },
      deviceGuidance: {
        screen: "Accessibility Settings",
        steps: ["Ensure Androperator Accessibility Service is ON in Android Settings"],
      },
    };
  }

  if ("broadcastFailed" in result && result.broadcastFailed) {
    return {
      id: "readiness.handshake",
      status: "fail",
      code: result.diagnostics.code,
      summary: "Handshake broadcast failed.",
      detail: result.diagnostics.message,
    };
  }

  return {
    id: "readiness.handshake",
    status: "fail",
    summary: "Handshake failed with an unknown error.",
    detail: "error" in result ? result.error : "Unknown error",
  };
}

export async function checkDeviceInteractiveState(
  config: RuntimeConfig,
  _probeInteractiveState = probeInteractiveState
): Promise<DoctorCheckResult> {
  const result = await _probeInteractiveState(config);

  return buildDeviceInteractiveStateCheckResult(result);
}

export function buildDeviceInteractiveStateCheckResult(
  result: InteractiveStateProbeResult
): DoctorCheckResult {
  if (!result.ok) {
    return {
      id: "readiness.device.interactive",
      status: "fail",
      code: result.code,
      summary: "Could not verify whether the device is interactive.",
      detail: result.message,
    };
  }

  return buildDeviceInteractiveStateCheckFromState(result.state);
}

export function buildDeviceInteractiveStateCheckFromState(
  state: InternalInteractiveState
): DoctorCheckResult {
  const evidence = toInteractiveStateEvidence(state);

  if (isInteractiveAutomationReady(state)) {
    return {
      id: "readiness.device.interactive",
      status: "pass",
      summary: "Device is interactive.",
      evidence,
    };
  }

  const error = buildDeviceNotInteractiveError(state);

  return {
    id: "readiness.device.interactive",
    status: "fail",
    code: error.code,
    summary: "Device is not interactive.",
    detail: error.message.replace(/^Device is not interactive\. /, ""),
    fix: {
      title: "Recover interactive device state",
      platform: "any",
      steps: [
        { kind: "manual", value: "Wake the device if the screen is off." },
        { kind: "manual", value: "Unlock the device if the keyguard is showing." },
        { kind: "manual", value: "Complete the post-boot unlock if Android still reports the user as locked." },
      ],
      docsUrl: DOCTOR_DOCS_URLS.devices,
    },
    deviceGuidance: {
      screen: "Lock screen / current screen",
      steps: [
        "Wake the device if the screen is off.",
        "Unlock the device if the keyguard is showing.",
        "Complete the post-boot unlock if Android still reports the user as locked.",
      ],
    },
    evidence,
  };
}

function tryBuildInteractiveStateEvidence(
  stepResult: StepResult
): { ok: true; evidence: Record<string, unknown> } | { ok: true; evidence: undefined } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      evidence: toInteractiveStateEvidence(parseDoctorPingInteractiveState(stepResult)),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runSmokeTest(
  config: RuntimeConfig,
  execute = runExecution,
): Promise<DoctorCheckResult> {
  const commandId = `smoke-${Date.now()}`;
  const execution = {
    commandId,
    taskId: "doctor-smoke",
    source: "androperator-doctor",
    expectedFormat: "android-ui-automator" as const,
    actions: [
      { id: "s1", type: "close_app", params: { applicationId: "com.android.settings" } },
      { id: "s2", type: "open_app", params: { applicationId: "com.android.settings" } },
      { id: "s3", type: "snapshot" },
    ],
    timeoutMs: 10000,
  };

  const result = await execute(execution, {
    deviceId: config.deviceId,
    operatorPackage: config.operatorPackage,
    adbPath: config.adbPath,
    runner: config.runner,
    logger: config.logger,
    resultEnvelopeTimeoutMs: 12000,
  });

  if (result.ok && result.envelope.status === "success") {
    const completedSmoke = [
      { id: "s1", types: ["close_app"] },
      { id: "s2", types: ["open_app"] },
      { id: "s3", types: ["snapshot", "snapshot_ui"] },
    ].every(expected => result.envelope.stepResults.some(step =>
      step.id === expected.id && expected.types.includes(step.actionType) && step.success
    ));
    if (completedSmoke) {
      return {
        id: "readiness.smoke",
        status: "pass",
        summary: "Smoke test successful.",
        detail: "Settings app opened and observed via UI snapshot.",
      };
    }
  }

  return {
    id: "readiness.smoke",
    status: "fail",
    code: ERROR_CODES.SMOKE_OPEN_SETTINGS_FAILED,
    summary: "Smoke test failed.",
    detail: "Could not open Settings or observe its UI.",
  };
}
