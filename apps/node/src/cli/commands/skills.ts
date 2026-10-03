import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { listSkills } from "../../domain/skills/listSkills.js";
import { getSkill } from "../../domain/skills/getSkill.js";
import { compileArtifact } from "../../domain/skills/compileArtifact.js";
import { syncSkills } from "../../domain/skills/syncSkills.js";
import { searchSkills } from "../../domain/skills/searchSkills.js";
import {
  runSkill,
  buildSkillRunLogMetadata,
  buildSkillRunLogs,
  createSkillRunId,
  type SkillRunEnv,
} from "../../domain/skills/runSkill.js";
import { scaffoldSkill } from "../../domain/skills/scaffoldSkill.js";
import { validateAllSkills, validateSkill } from "../../domain/skills/validateSkill.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { SKILL_RESULT_FRAME_PREFIX } from "../../contracts/skillResult.js";
import { SKILL_OUTPUT_ASSERTION_FAILED } from "../../contracts/skills.js";
import type { DoctorCheckResult } from "../../contracts/doctor.js";
import type { OutputOptions } from "../output.js";
import { formatSuccess, formatError } from "../output.js";
import { getCliVersion } from "../../domain/version/compatibility.js";
import { getAlternateOperatorVariant } from "../../domain/version/compatibility.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { checkApkPresence } from "../../domain/doctor/checks/readinessChecks.js";
import {
  ensureInteractiveAutomationReady,
  probeInteractiveState,
  toPublicInteractiveAutomationError,
} from "../../domain/doctor/checks/deviceInteractivity.js";
import { resolveDevice } from "../../domain/devices/resolveDevice.js";
import type { Logger } from "../../adapters/logger.js";
import { ANDROPERATOR_SKILL_RUN_ID_ENV_VAR, normalizeSkillRunId, type LogEvent } from "../../contracts/logging.js";
import {
  ANDROPERATOR_BIN_ENV_VAR,
  ANDROPERATOR_DEVICE_ID_ENV_VAR,
  ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR,
  resolveSkillBinCommand,
  resolveOperatorPackage,
} from "../../domain/skills/skillsConfig.js";

function isIgnorablePipeError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

function suppressStreamPipeErrors(stream: EventEmitter): () => void {
  const onError = (error: unknown) => {
    if (!isIgnorablePipeError(error)) {
      process.nextTick(() => {
        throw error instanceof Error ? error : new Error(String(error));
      });
    }
  };
  stream.on("error", onError);
  return () => {
    stream.off("error", onError);
  };
}

function emitCliEvent(logger: Logger | undefined, event: Omit<LogEvent, "ts">): void {
  logger?.emit({
    ts: new Date().toISOString(),
    ...event,
  });
}

function splitTextIntoLinesPreservingEndings(text: string): string[] {
  const matches = text.match(/[^\r\n]*(?:\r?\n|$)/g) ?? [];
  return matches.filter((line) => line.length > 0);
}

function lineWithoutTrailingNewline(line: string): string {
  return line.replace(/\r?\n$/, "");
}

function stripTrailingSkillResultFrame(stdout: string): string {
  const lines = splitTextIntoLinesPreservingEndings(stdout);
  if (lines.length === 0) {
    return stdout;
  }

  let jsonLineIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lineWithoutTrailingNewline(lines[index]).trim().length > 0) {
      jsonLineIndex = index;
      break;
    }
  }
  if (jsonLineIndex < 0) {
    return stdout;
  }

  let markerLineIndex = -1;
  for (let index = jsonLineIndex - 1; index >= 0; index -= 1) {
    if (lineWithoutTrailingNewline(lines[index]).trim().length > 0) {
      markerLineIndex = index;
      break;
    }
  }
  if (markerLineIndex < 0) {
    return stdout;
  }

  if (lineWithoutTrailingNewline(lines[markerLineIndex]) !== SKILL_RESULT_FRAME_PREFIX) {
    return stdout;
  }

  return lines.slice(0, markerLineIndex).join("");
}

function createPrettyStdoutForwarder(writer: (chunk: string) => void) {
  let incomplete = "";
  let protectedLines: string[] = [];
  let protectedNonEmptyIndexes: number[] = [];
  let protectingFrameTail = false;

  const flushProtectedPrefix = () => {
    while (protectingFrameTail && protectedNonEmptyIndexes.length > 2) {
      const firstProtectedIndex = protectedNonEmptyIndexes[protectedNonEmptyIndexes.length - 2];
      if (firstProtectedIndex <= 0) {
        break;
      }

      writer(protectedLines.slice(0, firstProtectedIndex).join(""));
      protectedLines = protectedLines.slice(firstProtectedIndex);
      protectedNonEmptyIndexes = protectedNonEmptyIndexes
        .filter((index) => index >= firstProtectedIndex)
        .map((index) => index - firstProtectedIndex);
    }

    if (
      protectingFrameTail
      && !protectedLines.some((line) => lineWithoutTrailingNewline(line) === SKILL_RESULT_FRAME_PREFIX)
    ) {
      writer(protectedLines.join(""));
      protectedLines = [];
      protectedNonEmptyIndexes = [];
      protectingFrameTail = false;
    }
  };

  const bufferProtectedLine = (line: string) => {
    protectedLines.push(line);
    if (lineWithoutTrailingNewline(line).trim().length > 0) {
      protectedNonEmptyIndexes.push(protectedLines.length - 1);
    }
    flushProtectedPrefix();
  };

  return {
    onChunk(chunk: string) {
      incomplete += chunk;
      const completeLines = splitTextIntoLinesPreservingEndings(incomplete);
      const trailingLine = completeLines.at(-1);
      const trailingIsComplete = trailingLine === undefined || trailingLine.endsWith("\n");
      const readyLines = trailingIsComplete ? completeLines : completeLines.slice(0, -1);

      for (const line of readyLines) {
        if (!protectingFrameTail && lineWithoutTrailingNewline(line) === SKILL_RESULT_FRAME_PREFIX) {
          protectingFrameTail = true;
        }

        if (protectingFrameTail) {
          bufferProtectedLine(line);
        } else {
          writer(line);
        }
      }

      incomplete = trailingIsComplete ? "" : trailingLine ?? "";
    },
    finish(options: { stripTerminalFrame: boolean }) {
      if (incomplete.length > 0) {
        if (!protectingFrameTail && lineWithoutTrailingNewline(incomplete) === SKILL_RESULT_FRAME_PREFIX) {
          protectingFrameTail = true;
        }
        if (protectingFrameTail) {
          bufferProtectedLine(incomplete);
        } else {
          writer(incomplete);
        }
        incomplete = "";
      }

      const protectedTail = protectedLines.join("");
      writer(options.stripTerminalFrame ? stripTrailingSkillResultFrame(protectedTail) : protectedTail);
      protectedLines = [];
      protectedNonEmptyIndexes = [];
      protectingFrameTail = false;
    },
  };
}

function sanitizePrettySkillStdout(stdout: string | undefined, skillResultPresent: boolean): string | undefined {
  if (stdout === undefined || !skillResultPresent) {
    return stdout;
  }
  return stripTrailingSkillResultFrame(stdout);
}

interface CommandLikeError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  deviceId?: string;
}

export type ResolveInteractiveSkillTargetResult =
  | { ok: true; deviceId: string; apkPresence: DoctorCheckResult }
  | { ok: false; error: CommandLikeError };

function normalizeCommandLikeError(error: unknown): CommandLikeError {
  if (typeof error === "object" && error !== null) {
    const maybeCode = "code" in error ? error.code : undefined;
    const maybeMessage = "message" in error ? error.message : undefined;
    const maybeDetails = "details" in error ? error.details : undefined;
    if (typeof maybeCode === "string" && typeof maybeMessage === "string") {
      return {
        code: maybeCode,
        message: maybeMessage,
        details: typeof maybeDetails === "object" && maybeDetails !== null
          ? maybeDetails as Record<string, unknown>
          : undefined,
      };
    }
  }

  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function resolveInteractiveSkillTarget(
  operatorPackage: string,
  options?: {
    adbPath?: string;
    deviceId?: string;
    logger?: Logger;
    resolveDeviceImpl?: typeof resolveDevice;
    checkApkPresenceImpl?: typeof checkApkPresence;
    ensureInteractiveAutomationReadyImpl?: typeof ensureInteractiveAutomationReady;
    probeInteractiveStateImpl?: typeof probeInteractiveState;
  }
): Promise<ResolveInteractiveSkillTargetResult> {
  try {
    const logger = options?.logger;
    const resolveDeviceImpl = options?.resolveDeviceImpl ?? resolveDevice;
    const checkApkPresenceImpl = options?.checkApkPresenceImpl ?? checkApkPresence;
    const ensureInteractiveAutomationReadyImpl = options?.ensureInteractiveAutomationReadyImpl ?? ensureInteractiveAutomationReady;
    const probeInteractiveStateImpl = options?.probeInteractiveStateImpl ?? probeInteractiveState;

    const resolvedDevice = await resolveDeviceImpl(getDefaultRuntimeConfig({
      adbPath: options?.adbPath,
      deviceId: options?.deviceId,
      operatorPackage,
      logger,
    }));

    const config = getDefaultRuntimeConfig({
      adbPath: options?.adbPath,
      deviceId: resolvedDevice.deviceId,
      operatorPackage,
      logger,
    });
    const apkPresence = await checkApkPresenceImpl(config);
    if (apkPresence.status !== "pass") {
      return {
        ok: true,
        deviceId: resolvedDevice.deviceId,
        apkPresence,
      };
    }

    const readiness = await ensureInteractiveAutomationReadyImpl(config, {
      probeInteractiveStateFn: probeInteractiveStateImpl,
    });
    if (!readiness.ok) {
      const publicError = readiness.error.code === ERROR_CODES.DEVICE_NOT_INTERACTIVE
        ? toPublicInteractiveAutomationError(readiness.error)
        : readiness.error;
      return {
        ok: false,
        error: {
          ...publicError,
          deviceId: resolvedDevice.deviceId,
        },
      };
    }

    return {
      ok: true,
        deviceId: resolvedDevice.deviceId,
        apkPresence,
      };
  } catch (error) {
    return {
      ok: false,
      error: normalizeCommandLikeError(error),
    };
  }
}

export async function cmdSkillsList(options: { format: OutputOptions["format"] }): Promise<string> {
  const result = await listSkills();
  if (result.ok) {
    return formatSuccess({ skills: result.skills, count: result.skills.length }, options);
  }
  return formatError({ code: result.code, message: result.message }, options);
}

export async function cmdSkillsGet(
  skillId: string,
  options: { format: OutputOptions["format"] }
): Promise<string> {
  const result = await getSkill(skillId);
  if (result.ok) {
    return formatSuccess({ skill: result.skill }, options);
  }
  return formatError({ code: result.code, message: result.message }, options);
}

export async function cmdSkillsCompileArtifact(
  skillId: string,
  artifact: string,
  varsJson: string,
  options: { format: OutputOptions["format"] }
): Promise<string> {
  // CLI help examples for `--artifact` use `climate-status`.
  const result = await compileArtifact(skillId, artifact, varsJson ?? "{}");
  if (result.ok) {
    return formatSuccess({ execution: result.execution }, options);
  }
  return formatError(
    { code: result.code, message: result.message, details: result.details },
    options
  );
}

export async function cmdSkillsSync(
  ref: string,
  options: { format: OutputOptions["format"] }
): Promise<string> {
  const result = await syncSkills(ref);
  if (result.ok) {
    return formatSuccess({ synced: result.synced, message: result.message }, options);
  }
  return formatError({ code: result.code, message: result.message }, options);
}

export async function cmdSkillsInstall(
  options: { format: OutputOptions["format"] }
): Promise<string> {
  const result = await syncSkills("main");
  if (result.ok) {
    return formatSuccess({
      synced: result.synced,
      message: result.message,
      registryPath: result.registryPath,
    }, options);
  }
  return formatError({ code: result.code, message: result.message }, options);
}

export async function cmdSkillsUpdate(
  ref: string,
  options: { format: OutputOptions["format"] }
): Promise<string> {
  const result = await syncSkills(ref || "main");
  if (result.ok) {
    return formatSuccess({ synced: result.synced, message: result.message }, options);
  }
  return formatError({ code: result.code, message: result.message }, options);
}

export async function cmdSkillsSearch(
  query: { app?: string; intent?: string; keyword?: string },
  options: { format: OutputOptions["format"] }
): Promise<string> {
  const result = await searchSkills(query);
  if (result.ok) {
    return formatSuccess({ skills: result.skills, count: result.skills.length }, options);
  }
  return formatError({ code: result.code, message: result.message }, options);
}

export async function cmdSkillsForApp(
  packageId: string,
  options: { format: OutputOptions["format"] }
): Promise<string> {
  return cmdSkillsSearch({ app: packageId }, options);
}

export async function cmdSkillsRun(
  skillId: string,
  args: string[],
  timeoutMs: number | undefined,
  expectContains: string | undefined,
  operatorPackage: string | undefined,
  options: {
    format: OutputOptions["format"];
    skipValidate?: boolean;
    deviceId?: string;
    runSkillImpl?: typeof runSkill;
    validateSkillImpl?: typeof validateSkill;
    resolveInteractiveSkillTargetImpl?: typeof resolveInteractiveSkillTarget;
    logger?: Logger;
  }
): Promise<string> {
  // Resolve the env vars for the skill script
  // Priority: explicit flag > env var > default
  const resolvedBin = resolveSkillBinCommand();
  const resolvedOperatorPackage = operatorPackage ?? resolveOperatorPackage();
  const skillRunId = normalizeSkillRunId(process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR]) ?? createSkillRunId();
  const cliLogger = options.logger?.child({ skillId, deviceId: options.deviceId, skillRunId });
  let preRunLogs = buildSkillRunLogMetadata(skillRunId, cliLogger?.logPath());
  const currentPreRunLogs = () => buildSkillRunLogMetadata(skillRunId, cliLogger?.logPath());

  emitCliEvent(cliLogger, {
    level: "info",
    event: "skills.run.log_location",
    skillId,
    logPath: preRunLogs.path,
    tailCommand: preRunLogs.tailCommand,
    message: preRunLogs.path !== undefined
      ? `Skill ${skillId} run ${skillRunId} logging to ${preRunLogs.path}; observe with: ${preRunLogs.tailCommand}`
      : `Skill ${skillId} run ${skillRunId} started without a persisted log artifact`,
  });
  preRunLogs = currentPreRunLogs();

  const env: SkillRunEnv = {
    [ANDROPERATOR_BIN_ENV_VAR]: resolvedBin,
    [ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR]: resolvedOperatorPackage,
    [ANDROPERATOR_DEVICE_ID_ENV_VAR]: undefined,
  };
  if (options.deviceId !== undefined) {
    if (options.deviceId.trim().length === 0) {
      return formatError({
        status: "failed",
        code: "INVALID_DEVICE_ID",
        message: "'deviceId' must be a non-empty string when provided",
        logs: preRunLogs,
      }, options);
    }
    env[ANDROPERATOR_DEVICE_ID_ENV_VAR] = options.deviceId;
  }

  const runSkillImpl = options.runSkillImpl ?? runSkill;
  const validateSkillImpl = options.validateSkillImpl ?? validateSkill;
  const resolveInteractiveSkillTargetImpl = options.resolveInteractiveSkillTargetImpl ?? resolveInteractiveSkillTarget;
  let validationSkipped = false;
  if (!options.skipValidate) {
    const validation = await validateSkillImpl(skillId, undefined, { dryRun: true });
    if (!validation.ok) {
      return formatError({
        status: "failed",
        code: validation.code,
        message: validation.message,
        details: validation.details,
        logs: preRunLogs,
      }, options);
    }
    validationSkipped = validation.dryRun?.payloadValidation === "skipped";
  }

  const interactiveTarget = await resolveInteractiveSkillTargetImpl(resolvedOperatorPackage, {
    adbPath: process.env.ADB_PATH,
    deviceId: options.deviceId,
    logger: cliLogger,
  });
  if (!interactiveTarget.ok) {
    const interactiveError = interactiveTarget.error;
    return formatError(
      {
        ...(interactiveError.code === ERROR_CODES.DEVICE_NOT_INTERACTIVE
          ? toPublicInteractiveAutomationError(interactiveError)
          : interactiveError),
        status: "failed",
        logs: currentPreRunLogs(),
      },
      options
    );
  }

  const apkPresence = interactiveTarget.apkPresence;
  let apkStatus = `OK (${resolvedOperatorPackage})`;
  if (apkPresence.status === "warn") {
    const alternateVariant = getAlternateOperatorVariant(resolvedOperatorPackage);
    apkStatus = `WARN - ${apkPresence.summary}${apkPresence.detail ? ` ${apkPresence.detail}` : ""} Use --operator-package ${alternateVariant} or reinstall the matching APK.`;
  } else if (apkPresence.status === "fail") {
    apkStatus = `FAIL - ${apkPresence.summary}${apkPresence.detail ? ` ${apkPresence.detail}` : ""}`;
  }

  const logDate = new Date();
  const yyyy = String(logDate.getFullYear());
  const mm = String(logDate.getMonth() + 1).padStart(2, "0");
  const dd = String(logDate.getDate()).padStart(2, "0");
  const logPath = preRunLogs.path ?? join(homedir(), ".androperator", "logs", `androperator-${yyyy}-${mm}-${dd}.log`);
  const tailCommand = preRunLogs.tailCommand ?? buildSkillRunLogMetadata(skillRunId, logPath).tailCommand;
  const bannerMessage = `[Androperator] v${getCliVersion()}  APK: ${apkStatus}  Logs: ${logPath}  Hint: ${tailCommand}  Docs: https://docs.androperator.com/llms.txt`;
  if (cliLogger !== undefined) {
    emitCliEvent(cliLogger, {
      level: "debug",
      event: "cli.banner",
      skillId,
      message: bannerMessage,
    });
  } else if (options.format !== "json") {
    process.stdout.write(`${bannerMessage}\n`);
  }

  if (validationSkipped) {
    const validationMessage = "  [INFO] Payload validation skipped: no pre-compiled artifacts";
    if (cliLogger !== undefined) {
      emitCliEvent(cliLogger, {
        level: "debug",
        event: "cli.validation",
        skillId,
        message: validationMessage,
      });
    } else if (options.format !== "json") {
      process.stderr.write(`${validationMessage}\n`);
    }
  }

  const result = options.format !== "json"
    ? await (async () => {
        const removeStdoutErrorListener = suppressStreamPipeErrors(process.stdout);
        const removeStderrErrorListener = suppressStreamPipeErrors(process.stderr);
        const stdoutForwarder = createPrettyStdoutForwarder((chunk) => {
          try {
            process.stdout.write(chunk);
          } catch (error) {
            if (!isIgnorablePipeError(error)) {
              throw error;
            }
          }
        });
        try {
          const runResult = await runSkillImpl(skillId, args, undefined, timeoutMs, env, {
            onOutput: (chunk, stream) => {
              try {
                if (stream === "stdout") {
                  stdoutForwarder.onChunk(chunk);
                } else {
                  process.stderr.write(chunk);
                }
              } catch (error) {
                if (!isIgnorablePipeError(error)) {
                  throw error;
                }
              }
            },
            logger: cliLogger,
            skillRunId,
            logLocationEmitted: true,
          }, expectContains);
          stdoutForwarder.finish({
            stripTerminalFrame: runResult.skillResult !== null,
          });
          return runResult;
        } finally {
          removeStdoutErrorListener();
          removeStderrErrorListener();
        }
      })()
    : await runSkillImpl(skillId, args, undefined, timeoutMs, env, {
        logger: cliLogger,
        skillRunId,
        logLocationEmitted: true,
      }, expectContains);
  if (result.status === "success") {
    if (options.format === "json" && result.skillResult !== null) {
      return formatSuccess(
        {
          status: result.status,
          skillResult: result.skillResult,
          durationMs: result.durationMs,
          logs: buildSkillRunLogs(result),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(expectContains !== undefined ? { expectedSubstring: expectContains } : {}),
        },
        options
      );
    }
    return formatSuccess({
      status: result.status,
      skillId: result.skillId,
      output: options.format === "pretty"
        ? sanitizePrettySkillStdout(result.output, result.skillResult !== null)
        : result.output,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      skillResult: result.skillResult,
      logs: buildSkillRunLogs(result),
      timeoutMs: timeoutMs ?? undefined,
      expectedSubstring: expectContains ?? undefined,
    }, options);
  }
  if (result.status === "indeterminate") {
    if (options.format === "json" && result.skillResult !== null) {
      return formatSuccess(
        {
          status: result.status,
          code: result.code,
          message: result.message,
          skillResult: result.skillResult,
          durationMs: result.durationMs,
          logs: buildSkillRunLogs(result),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(expectContains !== undefined ? { expectedSubstring: expectContains } : {}),
        },
        options
      );
    }
    return formatSuccess({
      status: result.status,
      code: result.code,
      message: result.message,
      skillId: result.skillId,
      output: options.format === "pretty"
        ? sanitizePrettySkillStdout(result.output, result.skillResult !== null)
        : result.output,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      skillResult: result.skillResult,
      logs: buildSkillRunLogs(result),
      timeoutMs: timeoutMs ?? undefined,
      expectedSubstring: expectContains ?? undefined,
    }, options);
  }
  if (result.code === SKILL_OUTPUT_ASSERTION_FAILED) {
    return formatError({
      status: result.status,
      code: SKILL_OUTPUT_ASSERTION_FAILED,
      message: result.message,
      skillId: result.skillId,
      output: options.format === "pretty"
        ? sanitizePrettySkillStdout(result.output, result.skillResult !== null)
        : result.output,
      skillResult: result.skillResult,
      logs: buildSkillRunLogs(result),
      expectedSubstring: result.expectedSubstring,
      timeoutMs: timeoutMs ?? undefined,
    }, options);
  }
  return formatError({
    status: result.status,
    code: result.code,
    message: result.message,
    skillId: result.skillId,
    exitCode: result.exitCode,
    stdout: options.format === "pretty"
      ? sanitizePrettySkillStdout(result.stdout, result.skillResult !== null)
      : result.stdout,
    stderr: result.stderr,
    skillResult: result.skillResult,
    logs: buildSkillRunLogs(result),
    timeoutMs: timeoutMs ?? undefined,
    expectedSubstring: expectContains ?? undefined,
  }, options);
}

export async function cmdSkillsNew(
  skillId: string,
  options: { format: OutputOptions["format"]; summary?: string; recordingContextPath?: string }
): Promise<string> {
  const result = await scaffoldSkill(skillId, {
    summary: options.summary,
    recordingContextPath: options.recordingContextPath,
  });
  if (result.ok) {
    return formatSuccess({
      created: true,
      skillId: result.skillId,
      registryPath: result.registryPath,
      skillPath: result.skillPath,
      files: result.files,
      ...(result.recordingContextPath ? { recordingContextPath: result.recordingContextPath } : {}),
      next: "Edit `SKILL.md` and `scripts/run.js`, then run `androperator skills validate <skill_id>`; if this repo uses generated indexes, rerun `scripts/generate_skill_indexes.sh` and `androperator skills validate --all`",
    }, options);
  }
  return formatError({ code: result.code, message: result.message }, options);
}

export async function cmdSkillsValidate(
  skillId: string,
  options: { format: OutputOptions["format"]; dryRun?: boolean; logger?: Logger }
): Promise<string> {
  const result = await validateSkill(skillId, undefined, { dryRun: options.dryRun });
  if (result.ok) {
    const rendered = formatSuccess({
      valid: true,
      skill: result.skill,
      registryPath: result.registryPath,
      ...(result.dryRun ? { dryRun: result.dryRun } : {}),
      checks: result.checks,
    }, options);
    if (result.dryRun?.payloadValidation === "skipped") {
      const validationMessage = "  [INFO] Payload validation skipped: no pre-compiled artifacts";
      if (options.logger !== undefined) {
        emitCliEvent(options.logger.child({ skillId }), {
          level: "debug",
          event: "cli.validation",
          skillId,
          message: validationMessage,
        });
      } else if (options.format !== "json") {
        process.stderr.write(`${validationMessage}\n`);
      }
    }
    return rendered;
  }
  return formatError({
    code: result.code,
    message: result.message,
    details: result.details,
  }, options);
}

export async function cmdSkillsValidateAll(
  options: { format: OutputOptions["format"]; dryRun?: boolean; logger?: Logger }
): Promise<string> {
  const result = await validateAllSkills(undefined, { dryRun: options.dryRun });
  if (result.ok) {
    if (options.dryRun) {
      for (const validSkill of result.validSkills) {
        if (validSkill.checks.artifactPaths.length === 0) {
          const validationMessage = "  [INFO] Payload validation skipped: no pre-compiled artifacts";
          if (options.logger !== undefined) {
            emitCliEvent(options.logger.child({ skillId: validSkill.skill.id }), {
              level: "debug",
              event: "cli.validation",
              skillId: validSkill.skill.id,
              message: validationMessage,
            });
          } else if (options.format !== "json") {
            process.stderr.write(`${validationMessage}\n`);
          }
        }
      }
    }
    return formatSuccess({
      valid: true,
      totalSkills: result.totalSkills,
      registryPath: result.registryPath,
      validSkills: result.validSkills,
    }, options);
  }
  return formatError({
    code: result.code,
    message: result.message,
    registryPath: result.registryPath,
    details: result.details,
  }, options);
}
