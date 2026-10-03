import { type RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { type DoctorReport, type DoctorCheckResult } from "../../contracts/doctor.js";
import { resolveDevice } from "../devices/resolveDevice.js";
import {
  checkNodeVersion,
  checkAdbPresence,
  checkAdbServer,
  checkDefaultOrchestratedSkillAgentCli,
  checkInstalledOrchestratedSkillAgentCliAvailability,
  checkBundledSkillsStaleness,
} from "./checks/hostChecks.js";
import {
  checkDeviceDiscovery,
  checkDeviceCapabilities
} from "./checks/deviceChecks.js";
import {
  checkApkPresence,
  buildDeviceInteractiveStateCheckFromState,
  checkVersionCompatibility,
  checkSettings,
  checkDeviceInteractiveState,
  runHandshake,
  runSmokeTest
} from "./checks/readinessChecks.js";
import {
  checkJavaVersion,
  runAndroidBuild,
  runAndroidInstall,
  runAndroidLaunch
} from "./checks/buildChecks.js";
import { isCriticalDoctorCheck, requiredDoctorCheckIds, type RequiredDoctorCheckId } from "./criticalChecks.js";
import type { Logger } from "../../adapters/logger.js";
import { checkLogDestination } from "./checks/logChecks.js";
import { checkVideoDependencies } from "./checks/videoChecks.js";

export interface RunDoctorOptions {
  config: RuntimeConfig;
  full?: boolean;
  fix?: boolean;
  logger?: Logger;
}

export interface DoctorServiceDeps {
  checkLogDestination?: typeof checkLogDestination;
  runHandshake?: typeof runHandshake;
  checkDeviceInteractiveState?: typeof checkDeviceInteractiveState;
  runSmokeTest?: typeof runSmokeTest;
}

type RuntimeConfigWithDoctorOverrides = RuntimeConfig & {
  bundledSkillsDir?: string;
};

export class DoctorService {
  constructor(private readonly deps: DoctorServiceDeps = {}) {}

  async run(options: RunDoctorOptions): Promise<DoctorReport> {
    const config = { ...options.config, logger: options.logger ?? options.config.logger };
    const checks: DoctorCheckResult[] = [];
    checks.push(await (this.deps.checkLogDestination ?? checkLogDestination)(config.logger));
    let handshake: DoctorCheckResult | undefined;
    const runners: Record<RequiredDoctorCheckId, () => Promise<DoctorCheckResult>> = {
      "host.node.version": checkNodeVersion,
      "host.adb.presence": () => checkAdbPresence(config),
      "host.adb.server": () => checkAdbServer(config),
      "host.java.version": () => checkJavaVersion(config),
      "build.android.assemble": () => runAndroidBuild(config),
      "device.discovery": async () => {
        const discovery = await checkDeviceDiscovery(config);
        if (discovery.status === "pass" && config.deviceId === undefined) {
          try {
            config.deviceId = (await resolveDevice(config)).deviceId;
          } catch (error) {
            return {
              ...discovery,
              status: "fail",
              summary: "Device selection could not be verified.",
              detail: error instanceof Error ? error.message : String(error),
            };
          }
        }
        return discovery;
      },
      "build.android.install": () => runAndroidInstall(config),
      "build.android.launch": () => runAndroidLaunch(config),
      "device.capability": () => checkDeviceCapabilities(config),
      "readiness.apk.presence": () => checkApkPresence(config),
      "readiness.version.compatibility": () => checkVersionCompatibility(config),
      "readiness.handshake": async () => {
        handshake = await (this.deps.runHandshake ?? runHandshake)(config);
        return handshake;
      },
      "readiness.device.interactive": async () => {
        const state = extractInteractiveStateFromEvidence(handshake?.evidence);
        if (state !== undefined) return buildDeviceInteractiveStateCheckFromState(state);
        return (this.deps.checkDeviceInteractiveState ?? checkDeviceInteractiveState)(config);
      },
      "readiness.smoke": () => (this.deps.runSmokeTest ?? runSmokeTest)(config),
    };

    for (const id of requiredDoctorCheckIds(options.full)) {
      const check = await runners[id]();
      checks.push(check);
      if (check.status !== "pass") break;
      if (id === "host.adb.presence") {
        checks.push(await checkVideoDependencies(config));
        checks.push(await checkDefaultOrchestratedSkillAgentCli(config));
        checks.push(await checkInstalledOrchestratedSkillAgentCliAvailability(config));
        checks.push(await checkBundledSkillsStaleness(config, {
          installedDir: (config as RuntimeConfigWithDoctorOverrides).bundledSkillsDir,
        }));
      }
      if (id === "readiness.version.compatibility") {
        checks.push(...await checkSettings(config));
      }
    }
    return this.finalize(checks, config, options);
  }

  private async finalize(checks: DoctorCheckResult[], config: RuntimeConfig, options: RunDoctorOptions): Promise<DoctorReport> {
    const logger = config.logger;
    for (const check of checks) {
      logger?.emit({
        ts: new Date().toISOString(),
        level: check.status === "fail" ? "error" : check.status === "warn" ? "warn" : "info",
        event: "doctor.check",
        deviceId: config.deviceId,
        message: `${check.id} status=${check.status}${check.code ? ` code=${check.code}` : ""}${check.summary ? ` ${check.summary}` : ""}`,
      });
    }

    const requiredIds = requiredDoctorCheckIds(options.full);
    const blockedBy = checks.filter(check => isCriticalDoctorCheck(check) && check.status !== "pass").map(check => check.id);
    const skippedChecks = requiredIds.filter(id => !checks.some(check => check.id === id)).map(id => ({
      id,
      reason: "Required check was not run because prerequisite verification did not complete.",
      blockedBy: [...blockedBy],
    }));
    const criticalOk = requiredIds.every(id => checks.some(check => check.id === id && check.status === "pass"));
    const ok = criticalOk;
    const allOk = checks.every(check => check.status === "pass");

    const nextActions: string[] = [];
    let remediationAttempted = false;
    if (criticalOk && allOk) {
      nextActions.push("Docs: https://docs.androperator.com/getting-started/first-time-setup/");
      nextActions.push(
        config.deviceId
          ? `Try: androperator snapshot --device ${config.deviceId}`
          : "Try: androperator snapshot --device <device_id>"
      );
    }

    for (const check of checks) {
      if (check.status === "pass") continue;
      if (check.fix) {
        for (const step of check.fix.steps) {
          if (step.kind === "shell") {
            if (options.fix) {
              remediationAttempted = true;
              try {
                await config.runner.runShell(step.value);
              } catch {
                // Keep diagnostics deterministic even if best-effort fix fails.
              }
            } else {
              nextActions.push(step.value);
            }
            continue;
          }
          nextActions.push(step.value);
        }
      }
      if (check.deviceGuidance) {
        nextActions.push(`On device, open ${check.deviceGuidance.screen} and follow the listed steps.`);
      }
    }

    if (remediationAttempted) {
      // One remediation pass only. Report fresh prerequisites and handshake.
      return this.run({ ...options, config, fix: false });
    }

    return {
      ok,
      criticalOk,
      deviceId: config.deviceId,
      operatorPackage: config.operatorPackage,
      checks,
      skippedChecks,
      nextActions: nextActions.length > 0 ? [...new Set(nextActions)] : undefined,
    };
  }
}

function extractInteractiveStateFromEvidence(
  evidence: DoctorCheckResult["evidence"]
): { screenOn: boolean; deviceLocked: boolean; userUnlocked: boolean } | undefined {
  if (
    evidence !== undefined
    && typeof evidence.screenOn === "boolean"
    && typeof evidence.deviceLocked === "boolean"
    && typeof evidence.userUnlocked === "boolean"
  ) {
    return {
      screenOn: evidence.screenOn,
      deviceLocked: evidence.deviceLocked,
      userUnlocked: evidence.userUnlocked,
    };
  }

  return undefined;
}
