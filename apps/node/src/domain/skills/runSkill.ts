import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { loadRegistry, findSkillById, getRepoRoot } from "../../adapters/skills-repo/localSkillsRegistry.js";
import type { Logger } from "../../adapters/logger.js";
import { ANDROPERATOR_SKILL_RUN_ID_ENV_VAR, normalizeSkillRunId } from "../../contracts/logging.js";
import {
  hasMeaningfulSkillContract,
  parseSkillContractInputSchema,
  REGISTRY_READ_FAILED,
  SKILL_NOT_FOUND,
  SKILL_SCRIPT_NOT_FOUND,
  SKILL_EXECUTION_FAILED,
  SKILL_EXECUTION_TIMEOUT,
  SKILL_OUTPUT_ASSERTION_FAILED,
  SKILL_RESULT_PARSE_FAILED,
  SKILL_AGENT_CLI_UNAVAILABLE,
  SKILL_VALIDATION_FAILED,
  type SkillContract,
  type SkillAgentConfig,
} from "../../contracts/skills.js";
import {
  emittedSkillResultSchema,
  SKILL_RESULT_CONTRACT_MINOR_VERSION,
  SKILL_RESULT_FRAME_PREFIX,
  validateSupportedSkillResultContractVersion,
  type SkillResult,
  type SkillResultSource,
} from "../../contracts/skillResult.js";
import {
  readSkillManifestMetadata,
  type SkillManifestReadResult,
} from "./skillManifest.js";
import { normalizeStableJsonValue } from "./stableJson.js";
import {
  resolveConfiguredAgentCli,
  resolveAgentCliExecutable,
  SKILL_AGENT_CLI_ENV_VAR,
} from "./agentCli.js";
import { ANDROPERATOR_DEVICE_ID_ENV_VAR } from "./skillsConfig.js";
import { isOrchestratedHarnessScriptPath, resolveRepoRelativeSkillPath } from "./pathUtils.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const SKILL_AGENT_CLI_PATH_ENV_VAR = "ANDROPERATOR_SKILL_AGENT_CLI_PATH";
const SKILL_AGENT_TIMEOUT_MS_ENV_VAR = "ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS";
const SKILL_INPUTS_ENV_VAR = "ANDROPERATOR_SKILL_INPUTS";
const SKILL_PROGRAM_ENV_VAR = "ANDROPERATOR_SKILL_PROGRAM";
const SKILL_ID_ENV_VAR = "ANDROPERATOR_SKILL_ID";
const SKILLS_REGISTRY_ENV_VAR = "ANDROPERATOR_SKILLS_REGISTRY";

export interface SkillRunSuccess {
  ok: true;
  status: "success";
  skillId: string;
  skillRunId: string;
  logPath?: string;
  output: string;
  exitCode: number;
  durationMs: number;
  skillResult: SkillResult | null;
}

export interface SkillRunIndeterminate {
  ok: null;
  status: "indeterminate";
  code: "SKILL_VERIFICATION_INDETERMINATE";
  message: string;
  skillId: string;
  skillRunId: string;
  logPath?: string;
  output: string;
  exitCode: number;
  durationMs: number;
  skillResult: SkillResult | null;
}

export interface SkillRunError {
  ok: false;
  status: "failed";
  code: string;
  message: string;
  skillId?: string;
  skillRunId: string;
  logPath?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  /** Present when code is SKILL_OUTPUT_ASSERTION_FAILED */
  output?: string;
  expectedSubstring?: string;
  skillResult: SkillResult | null;
}

export type SkillRunResult = SkillRunSuccess | SkillRunIndeterminate;

export interface SkillRunEnv {
  /** Path to CLI binary used by skill scripts */
  ANDROPERATOR_BIN?: string;
  /** Operator package passed as --operator-package on every CLI call within a skill */
  ANDROPERATOR_OPERATOR_PACKAGE?: string;
  /** Selected device id propagated by the CLI wrapper */
  ANDROPERATOR_DEVICE_ID?: string;
  [key: string]: string | undefined;
}

export interface SkillRunCallbacks {
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  logger?: Logger;
  skillRunId?: string;
  logLocationEmitted?: boolean;
}

interface SkillSourceResolutionSuccess {
  ok: true;
  source: SkillResultSource;
}

interface SkillSourceResolutionFailure {
  ok: false;
  message: string;
}

type SkillSourceResolution = SkillSourceResolutionSuccess | SkillSourceResolutionFailure;

interface SkillFrameParseSuccess {
  ok: true;
  skillResult: SkillResult | null;
}

interface SkillFrameParseFailure {
  ok: false;
  message: string;
}

interface SkillContractVerificationOutcome {
  ok: boolean;
  message?: string;
}

interface TrustedContractInputsResult {
  ok: true;
  inputs: Record<string, unknown>;
}

interface TrustedContractInputsError {
  ok: false;
  message: string;
}

type TrustedContractInputsResolution = TrustedContractInputsResult | TrustedContractInputsError;

function signalSkillChildWithLogging(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
  logger: Logger | undefined,
  skillId: string
): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      logger?.emit({
        ts: new Date().toISOString(),
        level: "warn",
        event: "skills.run.signal_fallback",
        skillId,
        message: `Skill ${skillId} could not signal its detached process group with ${signal}; falling back to direct child termination`,
      });
    }
  }
  child.kill(signal);
}

async function resolveSkillResultSource(
  manifestResult: SkillManifestReadResult
): Promise<SkillSourceResolution> {
  if (!manifestResult.ok) {
    return {
      ok: false,
      message: manifestResult.message,
    };
  }

  if (!manifestResult.metadata.agent) {
    return { ok: true, source: { kind: "script" } };
  }

  return { ok: true, source: { kind: "agent", agentCli: manifestResult.metadata.agent.cli } };
}

function parseSkillResultFrame(
  stdout: string,
  expectedSkillId: string,
  sourceResolution: SkillSourceResolution,
  requireTerminalFrame: boolean,
  logger?: Logger
): SkillFrameParseSuccess | SkillFrameParseFailure {
  const lines = stdout.split(/\r?\n/);
  const nonEmptyLines = lines
    .map((line) => ({ raw: line, trimmed: line.trim() }))
    .filter((line) => line.trimmed.length > 0);
  const markerIndexes = nonEmptyLines
    .map((line, index) => (line.raw === SKILL_RESULT_FRAME_PREFIX ? index : -1))
    .filter((index) => index >= 0);
  if (nonEmptyLines.length === 0) {
    return requireTerminalFrame
      ? { ok: false, message: "Agent-driven skills must emit a terminal SkillResult frame" }
      : { ok: true, skillResult: null };
  }

  if (markerIndexes.length === 0) {
    return requireTerminalFrame
      ? { ok: false, message: "Agent-driven skills must emit a terminal SkillResult frame" }
      : { ok: true, skillResult: null };
  }

  if (nonEmptyLines.length === 1) {
    return { ok: false, message: "SkillResult frame marker was not followed by a JSON line" };
  }

  const jsonLine = nonEmptyLines[nonEmptyLines.length - 1].trimmed;
  const markerLine = nonEmptyLines[nonEmptyLines.length - 2].raw;

  if (markerLine !== SKILL_RESULT_FRAME_PREFIX) {
    return { ok: false, message: "SkillResult frame must be the terminal non-empty stdout suffix" };
  }

  if (!jsonLine.startsWith("{")) {
    return { ok: false, message: "SkillResult frame marker must be followed by a JSON object line" };
  }

  if (!sourceResolution.ok) {
    return {
      ok: false,
      message: `${sourceResolution.message}. Framed SkillResult output requires authoritative source metadata.`,
    };
  }

  if (markerIndexes.length > 1 || markerIndexes[0] !== nonEmptyLines.length - 2) {
    return { ok: false, message: "Skill emitted multiple SkillResult frames or a non-terminal SkillResult marker" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonLine);
  } catch (error) {
    return {
      ok: false,
      message: `SkillResult frame contained invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
    return { ok: false, message: "SkillResult frame must be a JSON object" };
  }

  if ("source" in parsedJson) {
    return { ok: false, message: "SkillResult frame must not include source; runSkill injects it" };
  }

  const schemaResult = emittedSkillResultSchema.safeParse(parsedJson);
  if (!schemaResult.success) {
    return {
      ok: false,
      message: `SkillResult frame failed validation: ${schemaResult.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")}`,
    };
  }

  const contractVersionValidation = validateSupportedSkillResultContractVersion(schemaResult.data.contractVersion);
  if (!contractVersionValidation.ok) {
    return { ok: false, message: contractVersionValidation.message };
  }

  if (contractVersionValidation.minorAhead) {
    logger?.emit({
      ts: new Date().toISOString(),
      level: "warn",
      event: "skills.run.skill_result_minor_version_ahead",
      message: `SkillResult contractVersion ${schemaResult.data.contractVersion} is newer than supported minor ${SKILL_RESULT_CONTRACT_MINOR_VERSION}; unknown fields will be ignored`,
    });
  }

  if (schemaResult.data.skillId !== expectedSkillId) {
    return {
      ok: false,
      message: `SkillResult skillId ${schemaResult.data.skillId} did not match invoked skill ${expectedSkillId}`,
    };
  }

  return {
    ok: true,
    skillResult: {
      ...schemaResult.data,
      source: sourceResolution.source,
    },
  };
}

function renderVerificationMatcher(
  matcher: string,
  inputs: Record<string, unknown> | undefined
): string | null {
  let missingPlaceholder = false;
  const rendered = matcher.replaceAll(/\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
    const value = inputs?.[key];
    if (value === undefined || value === null) {
      missingPlaceholder = true;
      return "";
    }
    return String(value);
  });
  return missingPlaceholder ? null : rendered;
}

function extractTextEvidence(evidence: unknown): string | null {
  if (typeof evidence !== "object" || evidence === null || !("kind" in evidence)) {
    return null;
  }
  const typedEvidence = evidence as { kind?: unknown; text?: unknown };
  return typedEvidence.kind === "text" && typeof typedEvidence.text === "string"
    ? typedEvidence.text
    : null;
}

function normalizeTerminalVerificationText(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ");
}

function escapeRegexLiteral(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function terminalVerificationTextMatches(expectedText: string, observedText: string): boolean {
  const normalizedExpected = normalizeTerminalVerificationText(expectedText);
  const normalizedObserved = normalizeTerminalVerificationText(observedText);
  if (normalizedObserved === normalizedExpected) {
    return true;
  }

  const decorativeSuffixPattern = new RegExp(
    `^${escapeRegexLiteral(normalizedExpected)}(?:[^\\p{L}\\p{N}]+)?$`,
    "u"
  );
  return decorativeSuffixPattern.test(normalizedObserved);
}

function parseDeclaredContractInputValue(schema: string, rawValue: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const parsedSchema = parseSkillContractInputSchema(schema);
  if (parsedSchema === null) {
    return {
      ok: false,
      message: `unsupported declared input schema '${schema.trim()}'`,
    };
  }

  if (parsedSchema.kind === "string") {
    return { ok: true, value: rawValue };
  }
  if (!/^-?\d+$/.test(rawValue)) {
    return { ok: false, message: `expected integer input for schema '${parsedSchema.schema}'` };
  }
  const parsedValue = Number.parseInt(rawValue, 10);
  if (parsedValue < parsedSchema.min || parsedValue > parsedSchema.max) {
    return {
      ok: false,
      message: `expected integer input in range [${parsedSchema.min},${parsedSchema.max}] for schema '${parsedSchema.schema}'`,
    };
  }
  return { ok: true, value: parsedValue };
}

function getOrderedDeclaredContractInputs(contract: SkillContract): Array<[string, string]> {
  return Object.entries(contract.inputs).sort(([leftKey], [rightKey]) => {
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
}

function toCliFlagName(inputName: string): string {
  return inputName.replace(/_/g, "-");
}

function resolveNamedContractInputRawValue(args: string[], inputName: string): string | null {
  const flagName = `--${toCliFlagName(inputName)}`;
  let resolvedValue: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === flagName) {
      const next = args[index + 1];
      if (typeof next === "string" && !next.startsWith("--")) {
        resolvedValue = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith(`${flagName}=`)) {
      resolvedValue = arg.slice(flagName.length + 1);
    }
  }
  return resolvedValue;
}

function resolvePositionalFallbackArgs(
  args: string[],
  declaredInputNames: string[]
): string[] {
  const declaredFlags = new Set(declaredInputNames.map(inputName => `--${toCliFlagName(inputName)}`));
  const positionalArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (declaredFlags.has(arg)) {
      const next = args[index + 1];
      if (typeof next === "string" && !next.startsWith("--")) {
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--")) {
      if (arg.includes("=")) {
        positionalArgs.push(arg);
        continue;
      }
      const next = args[index + 1];
      if (typeof next === "string" && !next.startsWith("--")) {
        // Treat bare --flag value pairs as option-shaped input, not positional fallback,
        // so unknown named flags cannot leak their value into declared contract inputs.
        index += 1;
        continue;
      }
      positionalArgs.push(arg);
      continue;
    }
    positionalArgs.push(arg);
  }

  return positionalArgs;
}

function resolveTrustedContractInputs(
  contract: SkillContract,
  args: string[]
): TrustedContractInputsResolution {
  const declaredInputs = getOrderedDeclaredContractInputs(contract);
  if (declaredInputs.length === 0) {
    return { ok: true, inputs: {} };
  }

  const resolvedRawInputs = new Map<string, string>();
  const unresolvedDeclaredInputs: Array<[string, string]> = [];

  for (const [inputName, schema] of declaredInputs) {
    const namedRawValue = resolveNamedContractInputRawValue(args, inputName);
    if (namedRawValue === null) {
      unresolvedDeclaredInputs.push([inputName, schema]);
      continue;
    }
    resolvedRawInputs.set(inputName, namedRawValue);
  }

  const positionalArgs = resolvePositionalFallbackArgs(args, declaredInputs.map(([inputName]) => inputName));
  if (positionalArgs.length < unresolvedDeclaredInputs.length) {
    const namedCount = resolvedRawInputs.size;
    const positionalCount = positionalArgs.length;
    return {
      ok: false,
      message: `Skill declared ${declaredInputs.length} contract inputs but only ${namedCount} named ${namedCount === 1 ? "input" : "inputs"} and ${positionalCount} positional ${positionalCount === 1 ? "arg" : "args"} were available.`,
    };
  }

  const positionalRawInputs = positionalArgs.slice(-unresolvedDeclaredInputs.length);
  const trustedInputs = Object.create(null) as Record<string, unknown>;
  let positionalIndex = 0;
  for (const [inputName, schema] of declaredInputs) {
    const rawValue = resolvedRawInputs.has(inputName)
      ? resolvedRawInputs.get(inputName) ?? ""
      : positionalRawInputs[positionalIndex++] ?? "";
    const parseResult = parseDeclaredContractInputValue(schema, rawValue);
    if (!parseResult.ok) {
      return {
        ok: false,
        message: `Could not trust declared input '${inputName}': ${parseResult.message}.`,
      };
    }
    trustedInputs[inputName] = parseResult.value;
  }

  return { ok: true, inputs: trustedInputs };
}

function declaredInputsMatchTrustedInputs(
  trustedInputs: Record<string, unknown>,
  reportedInputs: Record<string, unknown> | undefined
): boolean {
  const normalizedReportedInputs = normalizeStableJsonValue(reportedInputs ?? {}) as Record<string, unknown>;
  for (const [key, trustedValue] of Object.entries(trustedInputs)) {
    if (!Object.hasOwn(normalizedReportedInputs, key)) {
      return false;
    }
    if (JSON.stringify(normalizeStableJsonValue(trustedValue)) !== JSON.stringify(normalizedReportedInputs[key])) {
      return false;
    }
  }
  return true;
}

function verifyDeclaredSkillContract(
  contract: SkillContract | null,
  skillResult: SkillResult | null,
  trustedInvocationArgs: string[]
): SkillContractVerificationOutcome {
  if (contract === null || !hasMeaningfulSkillContract(contract) || contract.verification === null) {
    return { ok: true };
  }

  if (skillResult === null) {
    return {
      ok: false,
      message: "Skill declared verification but did not emit a SkillResult to prove it.",
    };
  }

  if (skillResult.status === "failed") {
    return {
      ok: false,
      message: "SkillResult reported failed status for a declared verification run.",
    };
  }

  const trustedInputsResolution = resolveTrustedContractInputs(contract, trustedInvocationArgs);
  if (!trustedInputsResolution.ok) {
    return {
      ok: false,
      message: trustedInputsResolution.message,
    };
  }

  if (!declaredInputsMatchTrustedInputs(trustedInputsResolution.inputs, skillResult.inputs)) {
    return {
      ok: false,
      message: "SkillResult inputs did not match the trusted invocation inputs for the declared contract.",
    };
  }

  const renderedMatcher = renderVerificationMatcher(contract.verification.matcher, trustedInputsResolution.inputs);
  if (renderedMatcher === null) {
    return {
      ok: false,
      message: `Trusted invocation inputs did not provide the values required to render declared matcher '${contract.verification.matcher}'.`,
    };
  }

  if (skillResult.terminalVerification?.status !== "verified") {
    return {
      ok: false,
      message: "Skill declared verification but terminalVerification was not proved.",
    };
  }

  const expectedText = extractTextEvidence(skillResult.terminalVerification.expected);
  const observedText = extractTextEvidence(skillResult.terminalVerification.observed);
  if (observedText === null || !terminalVerificationTextMatches(renderedMatcher, observedText)) {
    return {
      ok: false,
      message: expectedText === renderedMatcher
        ? `Skill terminal verification expected '${renderedMatcher}' but observed '${observedText ?? "<missing>"}'.`
        : `Skill terminal verification did not match declared matcher '${renderedMatcher}'.`,
    };
  }

  return { ok: true };
}

async function skillJsonRawMayDeclareContract(repoRoot: string, skillPath: string): Promise<boolean> {
  const skillJsonPath = resolveRepoRelativeSkillPath(repoRoot, join(skillPath, "skill.json"));
  try {
    const raw = await readFile(skillJsonPath, "utf-8");
    const contractPropertyMatch = /(?:^|[{,]\s*)"contract"\s*:\s*\{/.exec(raw);
    if (!contractPropertyMatch) {
      return false;
    }

    const trailingRaw = raw.slice(contractPropertyMatch.index);
    const hasNonEmptyInputs = /"inputs"\s*:\s*\{\s*"/.test(trailingRaw);
    const hasGoalObject = /"goal"\s*:\s*\{/.test(trailingRaw);
    const hasVerificationObject = /"verification"\s*:\s*\{/.test(trailingRaw);
    return hasNonEmptyInputs || hasGoalObject || hasVerificationObject;
  } catch {
    return false;
  }
}

export function createSkillRunId(): string {
  return `skillrun_${Date.now()}_${randomUUID()}`;
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildTailCommand(logPath: string): string {
  return `tail -f ${shellQuote(logPath)}`;
}

export function buildSkillRunLogMetadata(skillRunId: string, logPath?: string): { skillRunId: string; path?: string; tailCommand?: string } {
  return {
    skillRunId,
    ...(logPath !== undefined ? {
      path: logPath,
      tailCommand: buildTailCommand(logPath),
    } : {}),
  };
}

export function buildSkillRunLogs(result: SkillRunResult | SkillRunError): { skillRunId: string; path?: string; tailCommand?: string } {
  return buildSkillRunLogMetadata(result.skillRunId, result.logPath);
}

export async function runSkill(
  skillId: string,
  args: string[],
  registryPath?: string,
  timeoutMs?: number,
  env?: SkillRunEnv,
  callbacks?: SkillRunCallbacks,
  expectContains?: string
): Promise<SkillRunResult | SkillRunError> {
  let resolvedPath: string;
  let sourceResolution: SkillSourceResolution = { ok: true, source: { kind: "script" } };
  let resolvedAgentConfig: SkillAgentConfig | null = null;
  let resolvedContract: SkillContract | null = null;
  let resolvedAgentExecutablePath: string | null = null;
  let skillProgramPath: string | null = null;
  let resolvedRegistryPath: string | null = null;
  let effectiveTimeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
  };
  if (env !== undefined) {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete childEnv[key];
      }
    }
  }
  const inheritedSkillRunId =
    normalizeSkillRunId(env?.[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR]) ??
    normalizeSkillRunId(process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR]);
  const skillRunId = normalizeSkillRunId(callbacks?.skillRunId) ?? inheritedSkillRunId ?? createSkillRunId();
  childEnv[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = skillRunId;
  const skillLogger = callbacks?.logger?.child({ skillId, skillRunId });
  const initialLogPath = skillLogger?.logPath();
  const tailCommand = initialLogPath !== undefined ? buildTailCommand(initialLogPath) : undefined;
  const addRunMetadata = <T extends object>(result: T): T & { skillRunId: string; logPath?: string } => {
    const currentLogPath = skillLogger?.logPath();
    return {
      ...result,
      skillRunId,
      ...(currentLogPath !== undefined ? { logPath: currentLogPath } : {}),
    };
  };

  if (callbacks?.logLocationEmitted !== true) {
    skillLogger?.emit({
      ts: new Date().toISOString(),
      level: "info",
      event: "skills.run.log_location",
      skillId,
      logPath: initialLogPath,
      tailCommand,
      message: initialLogPath !== undefined
        ? `Skill ${skillId} run ${skillRunId} logging to ${initialLogPath}; observe with: ${tailCommand}`
        : `Skill ${skillId} run ${skillRunId} started without a persisted log artifact`,
    });
  }

  try {
    const loaded = await loadRegistry(registryPath);
    resolvedRegistryPath = loaded.resolvedPath;
    const skill = findSkillById(loaded.registry, skillId);
    if (!skill) {
      return addRunMetadata({ ok: false, status: "failed", code: SKILL_NOT_FOUND, message: `Skill not found: ${skillId}`, skillId, skillResult: null });
    }

    if (!skill.scripts || skill.scripts.length === 0) {
      return addRunMetadata({
        ok: false,
        status: "failed",
        code: SKILL_SCRIPT_NOT_FOUND,
        message: `Skill ${skillId} has no scripts defined`,
        skillId,
        skillResult: null,
      });
    }

    const repoRoot = getRepoRoot(loaded.resolvedPath);
    const scriptRelative = skill.scripts.find((s) => extname(s) === ".js") ??
      skill.scripts.find((s) => extname(s) === ".sh") ??
      skill.scripts[0];
    if (!scriptRelative) {
      return addRunMetadata({
        ok: false,
        status: "failed",
        code: SKILL_SCRIPT_NOT_FOUND,
        message: `Skill ${skillId} has no runnable script defined`,
        skillId,
        skillResult: null,
      });
    }

    const harnessScriptRelative = skill.scripts.find((scriptPath) => isOrchestratedHarnessScriptPath(scriptPath));
    const manifestResult = await readSkillManifestMetadata(repoRoot, skill.path);
    if (!manifestResult.ok) {
      const rawSkillJsonDeclaresContract = await skillJsonRawMayDeclareContract(repoRoot, skill.path);
      if (harnessScriptRelative || hasMeaningfulSkillContract(skill.contract) || rawSkillJsonDeclaresContract) {
        return addRunMetadata({
          ok: false,
          status: "failed",
          code: SKILL_VALIDATION_FAILED,
          message: manifestResult.message,
          skillId,
          skillResult: null,
        });
      }
    }
    if (manifestResult.ok) {
      sourceResolution = await resolveSkillResultSource(manifestResult);
      resolvedContract = manifestResult.metadata.contract;
    } else {
      sourceResolution = harnessScriptRelative
        ? {
            ok: false,
            message: manifestResult.message,
          }
        : {
            ok: true,
            source: {
              kind: "script",
            },
          };
    }
    skillProgramPath = resolveRepoRelativeSkillPath(repoRoot, skill.skillFile);

    const manifestAgent = manifestResult.ok ? manifestResult.metadata.agent : undefined;
    const isAgentDriven = manifestAgent !== null && manifestAgent !== undefined;
    const runnableScriptRelative = isAgentDriven
      ? harnessScriptRelative
      : scriptRelative;

    if (!runnableScriptRelative) {
      return addRunMetadata({
        ok: false,
        status: "failed",
        code: SKILL_SCRIPT_NOT_FOUND,
        message: isAgentDriven
          ? `Agent-driven skill ${skillId} requires scripts/run.js`
          : `Skill ${skillId} has no runnable script defined`,
        skillId,
        skillResult: null,
      });
    }

    resolvedPath = resolveRepoRelativeSkillPath(repoRoot, runnableScriptRelative);

    if (isAgentDriven) {
      const effectiveAgentConfig = resolveConfiguredAgentCli(manifestAgent, childEnv);
      if (!effectiveAgentConfig.ok) {
        return addRunMetadata({
          ok: false,
          status: "failed",
          code: SKILL_AGENT_CLI_UNAVAILABLE,
          message: `Skill ${skillId} requires agent CLI '${manifestAgent.cli}', but it is unavailable. ${effectiveAgentConfig.message}`,
          skillId,
          skillResult: null,
        });
      }
      resolvedAgentConfig = effectiveAgentConfig.agent;
      effectiveTimeoutMs = timeoutMs ?? resolvedAgentConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const agentResolution = await resolveAgentCliExecutable(
        resolvedAgentConfig,
        resolveRepoRelativeSkillPath(repoRoot, skill.path),
        childEnv
      );
      if (!agentResolution.ok) {
        return addRunMetadata({
          ok: false,
          status: "failed",
          code: SKILL_AGENT_CLI_UNAVAILABLE,
          message: `Skill ${skillId} requires agent CLI '${resolvedAgentConfig.cli}', but it is unavailable. ${agentResolution.message}`,
          skillId,
          skillResult: null,
        });
      }
      resolvedAgentExecutablePath = agentResolution.executablePath;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return addRunMetadata({ ok: false, status: "failed", code: REGISTRY_READ_FAILED, message, skillResult: null });
  }

  try {
    await access(resolvedPath);
  } catch {
    return addRunMetadata({
      ok: false,
      status: "failed",
      code: SKILL_SCRIPT_NOT_FOUND,
      message: `Script not found: ${resolvedPath}`,
      skillId,
      skillResult: null,
    });
  }

  if (resolvedAgentConfig && skillProgramPath !== null) {
    try {
      await access(skillProgramPath);
    } catch {
      return addRunMetadata({
        ok: false,
        status: "failed",
        code: SKILL_SCRIPT_NOT_FOUND,
        message: `Skill program not found: ${skillProgramPath}`,
        skillId,
        skillResult: null,
      });
    }
  }

  const ext = extname(resolvedPath);
  const cmd = ext === ".js" ? process.execPath : resolvedPath;
  const forwardedArgs = resolvedAgentConfig
    ? args
    : childEnv[ANDROPERATOR_DEVICE_ID_ENV_VAR]
      ? [childEnv[ANDROPERATOR_DEVICE_ID_ENV_VAR], ...args]
      : args;
  const cmdArgs = ext === ".js" ? [resolvedPath, ...forwardedArgs] : forwardedArgs;
  const timeout = effectiveTimeoutMs;

  // Merge provided env with process.env, with provided env taking precedence
  if (resolvedAgentConfig && resolvedAgentExecutablePath && skillProgramPath) {
    childEnv[SKILL_AGENT_CLI_ENV_VAR] = resolvedAgentConfig.cli;
    childEnv[SKILL_AGENT_CLI_PATH_ENV_VAR] = resolvedAgentExecutablePath;
    childEnv[SKILL_AGENT_TIMEOUT_MS_ENV_VAR] = String(effectiveTimeoutMs);
    childEnv[SKILL_INPUTS_ENV_VAR] = JSON.stringify(args);
    childEnv[SKILL_PROGRAM_ENV_VAR] = skillProgramPath;
    childEnv[SKILL_ID_ENV_VAR] = skillId;
    if (resolvedRegistryPath !== null) {
      childEnv[SKILLS_REGISTRY_ENV_VAR] = resolvedRegistryPath;
    }
  }

  const start = Date.now();
  return new Promise((resolve) => {
    skillLogger?.emit({
      ts: new Date().toISOString(),
      level: "info",
      event: "skills.run.start",
      skillId,
      message: `Skill ${skillId} spawned`,
    });

    const child = spawn(cmd, cmdArgs, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let forwardedSignal: NodeJS.Signals | undefined;

    const handleTerminationSignal = (signal: NodeJS.Signals) => {
      if (settled || forwardedSignal !== undefined) {
        return;
      }
      forwardedSignal = signal;
      signalSkillChildWithLogging(child, signal, skillLogger, skillId);
    };

    const sigintListener = () => {
      handleTerminationSignal("SIGINT");
    };
    const sigtermListener = () => {
      handleTerminationSignal("SIGTERM");
    };

    process.once("SIGINT", sigintListener);
    process.once("SIGTERM", sigtermListener);

    const finish = (result: SkillRunResult | SkillRunError) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      process.removeListener("SIGINT", sigintListener);
      process.removeListener("SIGTERM", sigtermListener);
      resolve(result);
    };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      skillLogger?.emit({
        ts: new Date().toISOString(),
        level: "info",
        event: "skills.run.output",
        skillId,
        stream: "stdout",
        message: text,
      });
      callbacks?.onOutput?.(text, "stdout");
      stdout += text;
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      skillLogger?.emit({
        ts: new Date().toISOString(),
        level: "info",
        event: "skills.run.output",
        skillId,
        stream: "stderr",
        message: text,
      });
      callbacks?.onOutput?.(text, "stderr");
      stderr += text;
    });

    child.on("error", (err) => {
      const errCode =
        typeof (err as { code?: unknown }).code === "string"
          ? (err as { code?: string }).code
          : "SPAWN_FAILED";
      finish(addRunMetadata({
        ok: false,
        status: "failed",
        code: SKILL_EXECUTION_FAILED,
        message: `Skill ${skillId} ${errCode}: ${err.message}`,
        skillId,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
        skillResult: null,
      }));
    });

    child.on("close", (code, signal) => {
      const durationMs = Date.now() - start;
      if (forwardedSignal !== undefined) {
        process.removeListener("SIGINT", sigintListener);
        process.removeListener("SIGTERM", sigtermListener);
        process.kill(process.pid, forwardedSignal);
        return;
      }
      if (timedOut) {
        finish(addRunMetadata({
          ok: false,
          status: "failed",
          code: SKILL_EXECUTION_TIMEOUT,
          message: `Skill ${skillId} timed out after ${timeout}ms`,
          skillId,
          stdout: stdout || undefined,
          stderr: stderr || undefined,
          skillResult: null,
        }));
        return;
      }

      const requireTerminalFrame =
        code === 0 && signal === null && sourceResolution.ok && sourceResolution.source.kind === "agent";
      const parsedSkillResult = parseSkillResultFrame(
        stdout,
        skillId,
        sourceResolution,
        requireTerminalFrame,
        skillLogger
      );
      if (!parsedSkillResult.ok) {
        finish(addRunMetadata({
          ok: false,
          status: "failed",
          code: SKILL_RESULT_PARSE_FAILED,
          message: parsedSkillResult.message,
          skillId,
          exitCode: code ?? undefined,
          stdout: stdout || undefined,
          stderr: stderr || undefined,
          skillResult: null,
        }));
        return;
      }

      if (code !== 0) {
        const exitCode = code ?? 1;
        skillLogger?.emit({
          ts: new Date().toISOString(),
          level: "error",
          event: "skills.run.failed",
          skillId,
          message: `Skill ${skillId} exited with code ${exitCode} after ${durationMs}ms`,
        });
        skillLogger?.emit({
          ts: new Date().toISOString(),
          level: "info",
          event: "skills.run.complete",
          skillId,
          exitCode,
          message: `Skill ${skillId} exited with code ${exitCode} after ${durationMs}ms`,
        });
        finish(addRunMetadata({
          ok: false,
          status: "failed",
          code: SKILL_EXECUTION_FAILED,
          message: `Skill ${skillId} exited with code ${exitCode}`,
          skillId,
          exitCode,
          stdout: stdout || undefined,
          stderr: stderr || undefined,
          skillResult: parsedSkillResult.skillResult,
        }));
        return;
      }

      skillLogger?.emit({
        ts: new Date().toISOString(),
        level: "info",
        event: "skills.run.complete",
        skillId,
        exitCode: 0,
        message: `Skill ${skillId} exited with code 0 after ${durationMs}ms`,
      });
      if (expectContains !== undefined && !stdout.includes(expectContains)) {
        finish(addRunMetadata({
          ok: false,
          status: "failed",
          code: SKILL_OUTPUT_ASSERTION_FAILED,
          message: `Skill ${skillId} output did not include expected text`,
          skillId,
          output: stdout,
          expectedSubstring: expectContains,
          skillResult: parsedSkillResult.skillResult,
        }));
        return;
      }
      const contractVerification = verifyDeclaredSkillContract(resolvedContract, parsedSkillResult.skillResult, args);
      const hasDeclaredVerification = resolvedContract !== null
        && hasMeaningfulSkillContract(resolvedContract)
        && resolvedContract.verification !== null;
      if (hasDeclaredVerification && parsedSkillResult.skillResult?.status === "failed") {
        finish(addRunMetadata({
          ok: false,
          status: "failed",
          code: SKILL_EXECUTION_FAILED,
          message: `Skill ${skillId} reported failed status while executing a declared verification contract`,
          skillId,
          exitCode: 0,
          stdout: stdout || undefined,
          stderr: stderr || undefined,
          skillResult: parsedSkillResult.skillResult,
        }));
        return;
      }
      if (hasDeclaredVerification && !contractVerification.ok) {
        finish(addRunMetadata({
          ok: null,
          status: "indeterminate",
          code: "SKILL_VERIFICATION_INDETERMINATE",
          message: contractVerification.message ?? "Declared verification was not proved.",
          skillId,
          output: stdout,
          exitCode: 0,
          durationMs,
          skillResult: parsedSkillResult.skillResult,
        }));
        return;
      }
      finish(addRunMetadata({
        ok: true,
        status: "success",
        skillId,
        output: stdout,
        exitCode: 0,
        durationMs,
        skillResult: parsedSkillResult.skillResult,
      }));
    });

    timeoutId = setTimeout(() => {
      timedOut = true;
      skillLogger?.emit({
        ts: new Date().toISOString(),
        level: "error",
        event: "skills.run.timeout",
        skillId,
        message: `Skill ${skillId} timed out after ${timeout}ms`,
      });
      signalSkillChildWithLogging(child, "SIGTERM", skillLogger, skillId);
    }, timeout);
  });
}
