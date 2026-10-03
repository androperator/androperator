import type { Logger } from "../../adapters/logger.js";
import { setupHost, type HostSetupResult } from "../../domain/host/hostSetup.js";
import { copyBundledSkills, resolveClaudeSkillsDir, resolveCodexSkillsDir, type CopyBundledSkillsError, type CopyBundledSkillsSuccess } from "../../domain/skills/copyBundledSkills.js";
import { syncSkills, type SyncSkillsError, type SyncSkillsResult } from "../../domain/skills/syncSkills.js";
import { DEFAULT_OPERATOR_PACKAGE } from "../../domain/config/resolveOperatorPackage.js";
import { runOperatorRemediate, type OperatorRemediateCommandError, type OperatorRemediateResult } from "./operatorRemediate.js";
import type { OutputOptions } from "../output.js";

type InstallStatus = "ok" | "warn" | "failed";

interface InstallBestEffortStep {
  ok: boolean;
  status: "ok" | "warn";
  message: string;
}

export interface InstallSkillsStepResult extends InstallBestEffortStep {
  synced?: true;
  registryPath?: string | null;
  code?: string;
}

export interface InstallBundledSkillsStepResult extends InstallBestEffortStep {
  installedDir?: string;
  claudeSkillsDir?: string;
  codexSkillsDir?: string;
  agentDiscoveryDirs?: CopyBundledSkillsSuccess["agentDiscoveryDirs"];
  skills?: string[];
  count?: number;
  envHint?: string;
  code?: string;
}

export interface InstallCommandFailure {
  ok: false;
  status: "failed";
  operatorPackage: string;
  message: string;
  deviceSelectionRequired: false;
  lastDeviceSerial: null;
  summary: {
    totalDevices: 0;
    connectedDevices: 0;
    ready: 0;
    warn: 0;
    remediated: 0;
    adbUnready: 0;
    failed: 0;
    skillsStatus: "warn";
    bundledSkillsStatus: "warn";
    hostStatus: "failed";
  };
  error: OperatorRemediateCommandError;
}

export interface InstallCommandResult {
  ok: boolean;
  status: InstallStatus;
  operatorPackage: string;
  message: string;
  deviceSelectionRequired: boolean;
  lastDeviceSerial: string | null;
  summary: OperatorRemediateResult["summary"] & {
    skillsStatus: InstallSkillsStepResult["status"];
    bundledSkillsStatus: InstallBundledSkillsStepResult["status"];
    hostStatus: HostSetupResult["status"];
  };
  steps: {
    operatorRemediation: OperatorRemediateResult;
    skillsInstall: InstallSkillsStepResult;
    bundledSkillsInstall: InstallBundledSkillsStepResult;
    hostSetup: HostSetupResult;
  };
}

export interface InstallCommandDeps {
  runOperatorRemediateImpl?: typeof runOperatorRemediate;
  syncSkillsImpl?: typeof syncSkills;
  copyBundledSkillsImpl?: typeof copyBundledSkills;
  setupHostImpl?: typeof setupHost;
}

function isOperatorRemediationError(result: OperatorRemediateResult | OperatorRemediateCommandError): result is OperatorRemediateCommandError {
  return "code" in result;
}

function toSkillsInstallStep(result: SyncSkillsResult | SyncSkillsError): InstallSkillsStepResult {
  if (!result.ok) {
    return {
      ok: false,
      status: "warn",
      code: result.code,
      message: result.message,
    };
  }

  return {
    ok: true,
    status: "ok",
    synced: result.synced,
    registryPath: result.registryPath,
    message: result.message,
  };
}

function getBundledSkillsEnvHint(env: NodeJS.ProcessEnv | undefined): string | undefined {
  const sourceDir = env?.ANDROPERATOR_BUNDLED_SKILLS;
  if (sourceDir === undefined || sourceDir === "") {
    return undefined;
  }
  return `Using ANDROPERATOR_BUNDLED_SKILLS=${sourceDir}`;
}

function toBundledSkillsInstallStep(
  result: CopyBundledSkillsSuccess | CopyBundledSkillsError,
  env: NodeJS.ProcessEnv | undefined,
): InstallBundledSkillsStepResult {
  if (!result.ok) {
    return {
      ok: false,
      status: "warn",
      code: result.code,
      message: result.message,
    };
  }

  return {
    ok: true,
    status: "ok",
    installedDir: result.installedDir,
    claudeSkillsDir: resolveClaudeSkillsDir({ env }),
    codexSkillsDir: resolveCodexSkillsDir({ env }),
    agentDiscoveryDirs: result.agentDiscoveryDirs,
    skills: result.skills,
    count: result.skills.length,
    envHint: getBundledSkillsEnvHint(env),
    message: "Bundled-skills installed.",
  };
}

function deriveLastDeviceSerial(result: OperatorRemediateResult): string | null {
  if (result.summary.connectedDevices !== 1) {
    return null;
  }

  const connectedDevice = result.devices.find((device) => device.adbState === "device");
  return connectedDevice?.deviceId ?? null;
}

function buildInstallMessage(options: {
  operatorRemediation: OperatorRemediateResult;
  skillsInstall: InstallSkillsStepResult;
  bundledSkillsInstall: InstallBundledSkillsStepResult;
  hostSetup: HostSetupResult;
  deviceSelectionRequired: boolean;
}): { ok: boolean; status: InstallStatus; message: string } {
  const {
    operatorRemediation,
    skillsInstall,
    bundledSkillsInstall,
    hostSetup,
    deviceSelectionRequired,
  } = options;

  if (!hostSetup.ok) {
    return {
      ok: false,
      status: "failed",
      message: hostSetup.message,
    };
  }

  if (operatorRemediation.summary.connectedDevices === 0) {
    return {
      ok: false,
      status: "failed",
      message: "Post-bootstrap install completed, but no connected Android devices were found.",
    };
  }

  if (!operatorRemediation.ok) {
    return {
      ok: false,
      status: "failed",
      message: "Host install completed, but some connected devices still need remediation.",
    };
  }

  const warnings: string[] = [];
  if (deviceSelectionRequired) {
    warnings.push("multiple connected devices are ready; future commands must use --device");
  }
  if (operatorRemediation.summary.warn > 0) {
    warnings.push("some connected devices still report warnings");
  }
  if (operatorRemediation.summary.adbUnready > 0) {
    warnings.push("some visible devices still need ADB recovery");
  }
  if (!skillsInstall.ok) {
    warnings.push("runtime skills install needs attention");
  }
  if (!bundledSkillsInstall.ok) {
    warnings.push("bundled-skills install needs attention");
  }
  if (hostSetup.status === "warn") {
    warnings.push(hostSetup.message);
  }

  if (warnings.length > 0) {
    return {
      ok: true,
      status: "warn",
      message: `Install completed with warnings: ${warnings.join("; ")}.`,
    };
  }

  return {
    ok: true,
    status: "ok",
    message: "Install complete.",
  };
}

function renderInstallPrettyOutput(result: InstallCommandResult | InstallCommandFailure): string {
  const lines = [
    `Androperator install: ${result.status.toUpperCase()}`,
    result.message,
  ];

  if ("error" in result) {
    return lines.join("\n");
  }

  lines.push(
    `Operator package: ${result.operatorPackage}`,
    "",
    "Steps:",
    `- Operator remediation: ${result.steps.operatorRemediation.message}`,
    `- Skills install: ${result.steps.skillsInstall.message}`,
    `- Bundled-skills install: ${result.steps.bundledSkillsInstall.message}`,
    `- Host setup: ${result.steps.hostSetup.message}`,
  );

  if (result.steps.operatorRemediation.devices.length > 0) {
    lines.push("", "Devices:");
    for (const device of result.steps.operatorRemediation.devices) {
      lines.push(`- ${device.deviceId} - ${device.status}: ${device.message}`);
    }
  }

  if (result.deviceSelectionRequired) {
    lines.push("", "Future commands must target one device explicitly with --device.");
  }

  if (result.summary.adbUnready > 0) {
    lines.push("Some visible devices still need ADB recovery before they can be targeted.");
  }

  const followUp: string[] = [];

  if (!result.ok) {
    if (!result.steps.hostSetup.ok) {
      followUp.push("Retry host artifact setup after resolving the failure: androperator host setup");
    } else if (result.summary.connectedDevices === 0) {
      followUp.push(`Connect and authorize a device, then rerun: androperator install --operator-package ${result.operatorPackage}`);
    } else if (!result.steps.operatorRemediation.ok) {
      followUp.push(`Rerun remediation after resolving device issues: androperator operator remediate --operator-package ${result.operatorPackage}`);
    }
  } else {
    if (result.deviceSelectionRequired) {
      followUp.push(`Verify one device explicitly with: androperator doctor --device <device_id> --output pretty --operator-package ${result.operatorPackage}`);
    }
    if (!result.steps.skillsInstall.ok) {
      followUp.push("Install runtime skills later with: androperator skills install");
    }
    if (!result.steps.bundledSkillsInstall.ok) {
      followUp.push("Repair bundled-skills later with: androperator bundled-skills install");
    }
    if (result.steps.hostSetup.status === "warn") {
      followUp.push("Rerun host artifact setup after resolving the warning if needed: androperator host setup");
    }
  }

  if (followUp.length > 0) {
    lines.push("", "Follow-up:");
    for (const step of followUp) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join("\n");
}

export async function cmdInstall(
  options: OutputOptions & {
    operatorPackage?: string;
    logger?: Logger;
  },
  deps: InstallCommandDeps = {},
): Promise<string> {
  const runOperatorRemediateImpl = deps.runOperatorRemediateImpl ?? runOperatorRemediate;
  const syncSkillsImpl = deps.syncSkillsImpl ?? syncSkills;
  const copyBundledSkillsImpl = deps.copyBundledSkillsImpl ?? copyBundledSkills;
  const setupHostImpl = deps.setupHostImpl ?? setupHost;

  const operatorRemediationResult = await runOperatorRemediateImpl({
    format: "json",
    operatorPackage: options.operatorPackage,
    logger: options.logger,
  });

  if (isOperatorRemediationError(operatorRemediationResult)) {
    const failure: InstallCommandFailure = {
      ok: false,
      status: "failed",
      operatorPackage: options.operatorPackage ?? DEFAULT_OPERATOR_PACKAGE,
      message: operatorRemediationResult.message,
      deviceSelectionRequired: false,
      lastDeviceSerial: null,
      summary: {
        totalDevices: 0,
        connectedDevices: 0,
        ready: 0,
        warn: 0,
        remediated: 0,
        adbUnready: 0,
        failed: 0,
        skillsStatus: "warn",
        bundledSkillsStatus: "warn",
        hostStatus: "failed",
      },
      error: operatorRemediationResult,
    };
    process.exitCode = 1;
    return options.format === "pretty"
      ? renderInstallPrettyOutput(failure)
      : JSON.stringify(failure);
  }

  const skillsInstall = toSkillsInstallStep(await syncSkillsImpl("main"));
  const bundledSkillsInstall = toBundledSkillsInstallStep(
    await copyBundledSkillsImpl({ env: process.env }),
    process.env,
  );
  const lastDeviceSerial = deriveLastDeviceSerial(operatorRemediationResult);
  const hostSetup = await setupHostImpl({
    registryPath: skillsInstall.ok ? skillsInstall.registryPath ?? null : null,
    lastDeviceSerial,
    operatorPackage: operatorRemediationResult.operatorPackage,
    env: process.env,
  });
  const deviceSelectionRequired = operatorRemediationResult.summary.connectedDevices > 1;
  const overall = buildInstallMessage({
    operatorRemediation: operatorRemediationResult,
    skillsInstall,
    bundledSkillsInstall,
    hostSetup,
    deviceSelectionRequired,
  });

  if (!overall.ok) {
    process.exitCode = 1;
  }

  const result: InstallCommandResult = {
    ok: overall.ok,
    status: overall.status,
    operatorPackage: operatorRemediationResult.operatorPackage,
    message: overall.message,
    deviceSelectionRequired,
    lastDeviceSerial,
    summary: {
      ...operatorRemediationResult.summary,
      skillsStatus: skillsInstall.status,
      bundledSkillsStatus: bundledSkillsInstall.status,
      hostStatus: hostSetup.status,
    },
    steps: {
      operatorRemediation: operatorRemediationResult,
      skillsInstall,
      bundledSkillsInstall,
      hostSetup,
    },
  };

  return options.format === "pretty"
    ? renderInstallPrettyOutput(result)
    : JSON.stringify(result);
}
