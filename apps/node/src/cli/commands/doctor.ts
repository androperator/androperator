import { runBackgroundObservationDoctor } from "../../domain/doctor/backgroundObservation.js";
import { formatError } from "../output.js";
/**
 * Doctor diagnostics for Androperator.
 * Checks host, device, and readiness state for end-to-end automation.
 */
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { DoctorService } from "../../domain/doctor/DoctorService.js";
import { isCriticalDoctorCheck } from "../../domain/doctor/criticalChecks.js";
import { type DoctorReport, type DoctorCheckResult } from "../../contracts/doctor.js";
import type { OutputOptions } from "../output.js";
import type { Logger } from "../../adapters/logger.js";

export async function cmdDoctor(options: {
  capability?: string;
  format: OutputOptions["format"];
  fix?: boolean;
  full?: boolean;
  /** Compatibility flag; readiness failures still exit nonzero. */
  checkOnly?: boolean;
  deviceId?: string;
  operatorPackage?: string;
  logger?: Logger;
}, deps: { doctorService?: Pick<DoctorService, "run"> } = {}): Promise<string> {
  const capability = options.capability ?? "interactive";
  if (!["interactive", "background-observation"].includes(capability) ||
      (capability === "background-observation" && (options.full || options.fix))) {
    process.exitCode = 1;
    return formatError({ code: "INVALID_ARGUMENT", message: "Use doctor --capability interactive or background-observation. Background mode does not allow --full or --fix." }, options);
  }
  const config = getDefaultRuntimeConfig({
    deviceId: options.deviceId,
    operatorPackage: options.operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE,
    adbPath: process.env.ADB_PATH,
  });

  const service = deps.doctorService ?? new DoctorService();
  const report = capability === "background-observation"
    ? await runBackgroundObservationDoctor(config)
    : { ...await service.run({ config, full: options.full, fix: options.fix, logger: options.logger }), capability: "interactive" as const };

  if (options.format === "json") {
    process.exitCode = getDoctorExitCode(report);
    return JSON.stringify(report, null, 2);
  }

  // Pretty human output
  process.exitCode = getDoctorExitCode(report);
  return renderPrettyDoctorReport(report);
}

function renderPrettyDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  const criticalChecks = report.capability === "background-observation" ? report.checks : report.checks.filter(isCriticalDoctorCheck);
  const advisoryChecks = report.capability === "background-observation" ? [] : report.checks.filter(check => !isCriticalDoctorCheck(check) && check.status !== "pass");
  const passedChecks = report.capability === "background-observation" ? [] : report.checks.filter(check => check.status === "pass" && !isCriticalDoctorCheck(check));
  const allOk = report.checks.every(check => check.status === "pass");

  lines.push("");
  lines.push(`Androperator Doctor Diagnostics (${report.capability ?? "interactive"})`);
  lines.push("");
  lines.push(`  Device:           ${report.deviceId !== undefined ? `\`${report.deviceId}\`` : "(auto-detect)"}`);
  lines.push(`  Operator package: ${report.operatorPackage !== undefined ? `\`${report.operatorPackage}\`` : "(default)"}`);
  lines.push("");

  if (criticalChecks.length > 0) {
    lines.push("Critical checks:");
    for (const check of criticalChecks) {
      renderCheck(lines, check);
    }
    lines.push("");
  }

  if (advisoryChecks.length > 0) {
    lines.push("Advisory checks:");
    for (const check of advisoryChecks) {
      renderCheck(lines, check);
    }
    lines.push("");
  }

  if (passedChecks.length > 0) {
    lines.push(`Additional passed checks: ${passedChecks.length}`);
    lines.push("");
  }

  for (const skipped of report.skippedChecks ?? []) {
    lines.push(`  [SKIP] \`${skipped.id}\`: ${skipped.reason} Blocked by: ${skipped.blockedBy.map(id => `\`${id}\``).join(", ")}`);
  }

  if (report.criticalOk ?? report.ok) {
    lines.push(allOk ? `[OK] Ready for ${report.capability ?? "interactive"}.` : "[OK] Ready to use Androperator. Advisory warnings are listed above.");
  } else {
    lines.push("[FAIL] Required setup verification did not complete successfully.");
  }

  if (report.nextActions && report.nextActions.length > 0) {
    lines.push("");
    lines.push("Next actions:");
    const shellSteps = new Set(report.checks.flatMap(check => check.fix?.steps.filter(step => step.kind === "shell").map(step => step.value) ?? []));
    for (const action of report.nextActions) {
      const displayedAction = action.startsWith("Try: androperator ")
        ? `Try: \`${action.slice("Try: ".length)}\``
        : shellSteps.has(action) ? `\`${action}\`` : formatDoctorText(action);
      lines.push(`  - ${displayedAction}`);
    }
  }

  return lines.join("\n");
}

function getDoctorExitCode(report: DoctorReport): number {
  // --check-only retains the same truthful readiness exit status.
  return (report.criticalOk ?? report.ok) ? 0 : 1;
}

function renderCheck(lines: string[], check: DoctorCheckResult): void {
  const status = check.status === "pass" ? "[OK]" : check.status === "warn" ? "[WARN]" : "[FAIL]";
  lines.push(`  ${status} ${formatDoctorText(check.summary)}`);
  if (check.status !== "pass" && check.detail) {
    lines.push(`    ${formatDoctorText(check.detail)}`);
  }
  if (check.status !== "pass" && check.fix) {
    lines.push(`    ${check.fix.title}:`);
    for (const step of check.fix.steps) {
      lines.push(`      - ${step.kind === "shell" ? `\`${step.value}\`` : formatDoctorText(step.value)}`);
    }
    if (check.fix.docsUrl) {
      lines.push(`      Docs: ${check.fix.docsUrl}`);
    }
  }
  if (check.status !== "pass" && check.deviceGuidance) {
    lines.push(`    On device (${check.deviceGuidance.screen}):`);
    for (const step of check.deviceGuidance.steps) {
      lines.push(`      - ${formatDoctorText(step)}`);
    }
  }
}

function formatDoctorText(value: string): string {
  // Keep report values unchanged for JSON and format only the human-readable view.
  const commandPrefixes = /^(Reinstall the CLI: |Verify adb shell access with: |Verify the checksum: |Install the matching APK: |Inspect the package dump with: )(.*)$/;
  const prefixedCommand = commandPrefixes.exec(value);
  if (prefixedCommand) return `${prefixedCommand[1]}\`${prefixedCommand[2]}\``;

  const withCommands = value
    .replace(/\[Androperator-Result\]/g, "`[Androperator-Result]`")
    .replace(/\b(?:brew install --cask android-platform-tools|sudo apt update && sudo apt install android-tools-adb|brew install scrcpy ffmpeg|androperator skills install|androperator doctor --device <device_serial>)(?=\b|[\s.,])/g, command => `\`${command}\``)
    .replace(/--operator-package [\w.]+/g, code => `\`${code}\``)
    .replace(/'([A-Za-z][\w.-]*)'/g, (_match, code: string) => `\`${code}\``);
  return withCommands.split(/(`[^`]*`)/g).map(segment => segment.startsWith("`")
    ? segment
    : segment.replace(/\b(?:ANDROPERATOR_[A-Z_]+|PATH|skill\.json(?:\.agent\.cliPath)?|skills-registry\.json|SKILL\.md|doctor_ping|host\.video\.dependencies|com\.androperator\.operator(?:\.dev)?|adb|ffmpeg|ffprobe|scrcpy|libx264)\b|--[a-z][\w-]*|-(?:fps_mode|enc_time_base)\s+\w+/g, code => `\`${code}\``)
  ).join("");
}
