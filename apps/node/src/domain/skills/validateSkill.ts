import { access, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import {
  loadRegistry,
  findSkillById,
  getRepoRoot,
} from "../../adapters/skills-repo/localSkillsRegistry.js";
import type { SkillEntry } from "../../contracts/skills.js";
import {
  REGISTRY_READ_FAILED,
  SKILL_NOT_FOUND,
  SKILL_VALIDATION_FAILED,
  isSupportedSkillContractInputSchema,
} from "../../contracts/skills.js";
import { validateExecution, type ValidationFailure } from "../executions/validateExecution.js";
import { parseSkillManifestMetadata } from "./skillManifest.js";
import { normalizeStableJsonValue } from "./stableJson.js";
import {
  isOrchestratedHarnessScriptPath,
  normalizeSkillPathSeparators,
  resolveRepoRelativeSkillPath,
} from "./pathUtils.js";

const SKILL_DRY_RUN_SKIP_REASON =
  "skill has no pre-compiled artifacts; payload is generated at runtime by the skill script";
const VALID_SKILL_TYPES = new Set(["replay", "orchestrated"]);
const SKILL_TYPE_COMPAT_ALLOWLIST = new Map([
  ["au.com.polyaire.airtouch5.set-zone-state", "script"],
]);

interface GeneratedIndexArtifactsSnapshot {
  registry: unknown;
  minIndex: unknown;
  jsonl: unknown[];
  manifest: unknown;
  byApp: Record<string, unknown>;
  byPrefix: Record<string, unknown>;
}

export interface ValidateSkillDryRunSkipped {
  payloadValidation: "skipped";
  reason: string;
}

export interface ValidateSkillResult {
  ok: true;
  skill: SkillEntry;
  registryPath: string;
  dryRun?: ValidateSkillDryRunSkipped;
  checks: {
    skillJsonPath: string;
    skillFilePath: string;
    scriptPaths: string[];
    artifactPaths: string[];
  };
}

export interface ValidateSkillError {
  ok: false;
  code: string;
  message: string;
  details?: {
    skillJsonPath?: string;
    missingFields?: string[];
    missingFiles?: string[];
    mismatchFields?: string[];
    artifact?: string;
    actionId?: string;
    actionType?: string;
    invalidKeys?: string[];
    hint?: string;
    path?: string;
    reason?: string;
  };
}

export interface ValidateAllSkillsResult {
  ok: true;
  registryPath: string;
  totalSkills: number;
  validSkills: Array<{
    skill: SkillEntry;
    checks: ValidateSkillResult["checks"];
  }>;
}

export interface ValidateAllSkillsError {
  ok: false;
  code: string;
  message: string;
  registryPath?: string;
  details?: {
    totalSkills: number;
    validCount: number;
    invalidCount: number;
    failures: Array<{
      skillId: string;
      code: string;
      message: string;
      details?: ValidateSkillError["details"];
    }>;
  };
}

function getSkillJsonRelativePath(skill: SkillEntry): string {
  return join(skill.path, "skill.json");
}

function normalizeSkillPathArray(paths: string[] | undefined): string[] {
  return (paths ?? []).map((path) => normalizeSkillPathSeparators(path));
}

function normalizeKeywordArray(keywords: string[] | undefined): string[] {
  return Array.from(new Set(
    (keywords ?? [])
      .map((keyword) => keyword.trim().toLowerCase())
      .filter((keyword) => keyword.length > 0)
  )).sort();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function findMismatchFields(skill: SkillEntry, parsed: Partial<SkillEntry>): string[] {
  const mismatches: string[] = [];
  if (parsed.id !== skill.id) mismatches.push("id");
  if (parsed.applicationId !== skill.applicationId) mismatches.push("applicationId");
  if (parsed.intent !== skill.intent) mismatches.push("intent");
  if (parsed.summary !== skill.summary) mismatches.push("summary");
  if (JSON.stringify(normalizeKeywordArray(parsed.keywords)) !== JSON.stringify(normalizeKeywordArray(skill.keywords))) mismatches.push("keywords");
  if (normalizeSkillPathSeparators(parsed.path ?? "") !== normalizeSkillPathSeparators(skill.path)) mismatches.push("path");
  if (normalizeSkillPathSeparators(parsed.skillFile ?? "") !== normalizeSkillPathSeparators(skill.skillFile)) mismatches.push("skillFile");
  if (JSON.stringify(normalizeSkillPathArray(parsed.scripts)) !== JSON.stringify(normalizeSkillPathArray(skill.scripts))) mismatches.push("scripts");
  if (JSON.stringify(normalizeSkillPathArray(parsed.artifacts)) !== JSON.stringify(normalizeSkillPathArray(skill.artifacts))) mismatches.push("artifacts");
  if (JSON.stringify(normalizeStableJsonValue(parsed.contract ?? null)) !== JSON.stringify(normalizeStableJsonValue(skill.contract ?? null))) mismatches.push("contract");
  return mismatches;
}

function findUnsupportedContractInputSchemas(skill: SkillEntry): string[] {
  if (!skill.contract) {
    return [];
  }

  return Object.entries(skill.contract.inputs)
    .filter(([, schema]) => !isSupportedSkillContractInputSchema(schema))
    .map(([inputName]) => inputName);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function extractFrontmatterBlock(rawSkillFile: string): string | null {
  const match = rawSkillFile.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : null;
}

function normalizeSkillTypeValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function readSkillTypeFrontmatter(rawSkillFile: string): string | undefined {
  const frontmatter = extractFrontmatterBlock(rawSkillFile);
  if (frontmatter === null) {
    return undefined;
  }

  const match = frontmatter.match(/^androperator-skill-type:\s*([^\r\n#]+?)\s*(?:#.*)?$/m);
  if (!match) {
    return undefined;
  }

  const normalized = normalizeSkillTypeValue(match[1] ?? "");
  return normalized.length > 0 ? normalized : undefined;
}

function validateSkillTypeFrontmatter(
  skill: SkillEntry,
  skillFilePath: string,
  rawSkillFile: string,
): ValidateSkillError | null {
  const skillType = readSkillTypeFrontmatter(rawSkillFile);
  if (skillType === undefined) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} is missing required androperator-skill-type frontmatter`,
      details: {
        path: skillFilePath,
        missingFields: ["androperator-skill-type"],
        reason: "SKILL.md frontmatter must declare androperator-skill-type: replay or orchestrated.",
      },
    };
  }

  if (VALID_SKILL_TYPES.has(skillType)) {
    return null;
  }

  const allowlistedType = SKILL_TYPE_COMPAT_ALLOWLIST.get(skill.id);
  if (allowlistedType === skillType) {
    return null;
  }

  return {
    ok: false,
    code: SKILL_VALIDATION_FAILED,
    message: `Skill ${skill.id} has an unsupported androperator-skill-type frontmatter value`,
    details: {
      path: skillFilePath,
      reason: `Expected androperator-skill-type to be replay or orchestrated; found ${JSON.stringify(skillType)}.`,
    },
  };
}

function sortSkillsForGeneratedArtifacts(skills: SkillEntry[]): SkillEntry[] {
  return [...skills].sort((left, right) => left.id.localeCompare(right.id));
}

function getSkillPrefixShard(skillId: string): string {
  return createHash("sha1").update(skillId).digest("hex").slice(0, 2);
}

function stripGeneratedArtifactTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripGeneratedArtifactTimestamps(entry));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "generatedAt")
      .map(([key, entryValue]) => [key, stripGeneratedArtifactTimestamps(entryValue)])
  );
}

function stripGeneratedArtifactChecksums(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripGeneratedArtifactChecksums(entry));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "sha256")
      .map(([key, entryValue]) => [key, stripGeneratedArtifactChecksums(entryValue)])
  );
}

function buildExpectedGeneratedArtifacts(registry: { skills: SkillEntry[] }): GeneratedIndexArtifactsSnapshot {
  const sortedSkills = sortSkillsForGeneratedArtifacts(registry.skills);
  const appIds = Array.from(new Set(sortedSkills.map((skill) => skill.applicationId))).sort();
  const prefixMap = new Map<string, SkillEntry[]>();

  for (const skill of sortedSkills) {
    const prefix = getSkillPrefixShard(skill.id);
    const existing = prefixMap.get(prefix) ?? [];
    existing.push(skill);
    prefixMap.set(prefix, existing);
  }

  const sortedPrefixes = Array.from(prefixMap.keys()).sort();
  const byApp = Object.fromEntries(appIds.map((applicationId) => {
    const filteredSkills = sortedSkills.filter((skill) => skill.applicationId === applicationId);
    return [
      `${applicationId}.json`,
      {
        schemaVersion: "1.0",
        applicationId,
        count: filteredSkills.length,
        skills: filteredSkills,
      },
    ];
  }));
  const byPrefix = Object.fromEntries(sortedPrefixes.map((prefix) => {
    const filteredSkills = prefixMap.get(prefix) ?? [];
    return [
      `${prefix}.json`,
      {
        schemaVersion: "1.0",
        prefix,
        count: filteredSkills.length,
        skills: filteredSkills,
      },
    ];
  }));

  return {
    registry: {
      $schema: "./skills-registry.schema.json",
      schemaVersion: "1.0",
      skills: sortedSkills,
    },
    minIndex: {
      schemaVersion: "1.0",
      count: sortedSkills.length,
      skills: sortedSkills.map((skill) => ({
        id: skill.id,
        applicationId: skill.applicationId,
        intent: skill.intent,
        summary: skill.summary,
        path: skill.path,
      })),
    },
    jsonl: sortedSkills,
    manifest: {
      schemaVersion: "1.0",
      totalSkills: sortedSkills.length,
      artifacts: {
        registry: { file: "skills/skills-registry.json", count: sortedSkills.length },
        minIndex: { file: "skills/generated/skills-index.min.json", count: sortedSkills.length },
        jsonlIndex: { file: "skills/generated/skills-index.jsonl", count: sortedSkills.length },
      },
      shards: {
        byApp: appIds.map((applicationId) => ({
          applicationId,
          file: `skills/generated/by-app/${applicationId}.json`,
          count: sortedSkills.filter((skill) => skill.applicationId === applicationId).length,
        })),
        byPrefix: sortedPrefixes.map((prefix) => ({
          prefix,
          file: `skills/generated/by-prefix/${prefix}.json`,
          count: (prefixMap.get(prefix) ?? []).length,
        })),
      },
    },
    byApp,
    byPrefix,
  };
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readJsonlFile(path: string): Promise<unknown[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

async function readGeneratedShardDirectory(directoryPath: string): Promise<Record<string, unknown>> {
  const entries = (await readdir(directoryPath))
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  const pairs = await Promise.all(entries.map(async (entry) => {
    const path = join(directoryPath, entry);
    return [entry, await readJsonFile(path)] as const;
  }));

  return Object.fromEntries(pairs);
}

function areGeneratedArtifactsEqual(
  actual: unknown,
  expected: unknown,
  options: { ignoreSha256?: boolean } = {},
): boolean {
  const normalize = (value: unknown) => {
    const withoutTimestamps = stripGeneratedArtifactTimestamps(value);
    const withoutChecksums = options.ignoreSha256
      ? stripGeneratedArtifactChecksums(withoutTimestamps)
      : withoutTimestamps;
    return JSON.stringify(normalizeStableJsonValue(withoutChecksums));
  };

  return normalize(actual) === normalize(expected);
}

function computeSha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readManifestEntryChecksum(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const sha256 = (value as { sha256?: unknown }).sha256;
  return typeof sha256 === "string" && sha256.length > 0 ? sha256 : null;
}

async function validateGeneratedManifestChecksums(
  manifest: unknown,
  repoRoot: string,
): Promise<ValidateSkillError | null> {
  if (typeof manifest !== "object" || manifest === null) {
    return buildGeneratedArtifactsStaleError(
      join(repoRoot, "skills", "generated", "manifest.json"),
      "manifest.json has an invalid structure. Rerun scripts/generate_skill_indexes.sh in the skills repo.",
    );
  }

  const entries: Array<{ label: string; file: string; sha256: string | null }> = [];
  const recordManifestEntry = (label: string, file: string, value: unknown) => {
    entries.push({ label, file, sha256: readManifestEntryChecksum(value) });
  };

  const manifestRecord = manifest as {
    artifacts?: Record<string, unknown>;
    shards?: { byApp?: unknown[]; byPrefix?: unknown[] };
  };
  const artifacts = manifestRecord.artifacts ?? {};

  const readManifestEntryFile = (label: string, value: unknown): string | null => {
    if (typeof value !== "object" || value === null || typeof (value as { file?: unknown }).file !== "string") {
      return null;
    }
    const file = (value as { file: string }).file;
    recordManifestEntry(label, file, value);
    return file;
  };

  if (readManifestEntryFile("manifest registry artifact", artifacts.registry) === null) {
    return buildGeneratedArtifactsStaleError(
      join(repoRoot, "skills", "generated", "manifest.json"),
      "manifest.json has an invalid registry artifact entry. Rerun scripts/generate_skill_indexes.sh in the skills repo.",
    );
  }

  if (readManifestEntryFile("manifest min-index artifact", artifacts.minIndex) === null) {
    return buildGeneratedArtifactsStaleError(
      join(repoRoot, "skills", "generated", "manifest.json"),
      "manifest.json has an invalid min-index artifact entry. Rerun scripts/generate_skill_indexes.sh in the skills repo.",
    );
  }

  if (readManifestEntryFile("manifest jsonl artifact", artifacts.jsonlIndex) === null) {
    return buildGeneratedArtifactsStaleError(
      join(repoRoot, "skills", "generated", "manifest.json"),
      "manifest.json has an invalid jsonl artifact entry. Rerun scripts/generate_skill_indexes.sh in the skills repo.",
    );
  }

  const byAppEntries = Array.isArray(manifestRecord.shards?.byApp) ? manifestRecord.shards.byApp : [];
  for (const entry of byAppEntries) {
    if (typeof entry !== "object" || entry === null || typeof (entry as { file?: unknown }).file !== "string") {
      return buildGeneratedArtifactsStaleError(
        join(repoRoot, "skills", "generated", "manifest.json"),
        "manifest.json has an invalid by-app shard entry. Rerun scripts/generate_skill_indexes.sh in the skills repo.",
      );
    }
    recordManifestEntry(`manifest by-app shard ${(entry as { file: string }).file}`, (entry as { file: string }).file, entry);
  }

  const byPrefixEntries = Array.isArray(manifestRecord.shards?.byPrefix) ? manifestRecord.shards.byPrefix : [];
  for (const entry of byPrefixEntries) {
    if (typeof entry !== "object" || entry === null || typeof (entry as { file?: unknown }).file !== "string") {
      return buildGeneratedArtifactsStaleError(
        join(repoRoot, "skills", "generated", "manifest.json"),
        "manifest.json has an invalid by-prefix shard entry. Rerun scripts/generate_skill_indexes.sh in the skills repo.",
      );
    }
    recordManifestEntry(`manifest by-prefix shard ${(entry as { file: string }).file}`, (entry as { file: string }).file, entry);
  }

  for (const entry of entries) {
      if (entry.sha256 === null) {
        return buildGeneratedArtifactsStaleError(
          join(repoRoot, "skills", "generated", "manifest.json"),
          `${entry.label} is missing a sha256 checksum. Rerun scripts/generate_skill_indexes.sh in the skills repo.`,
        );
      }

    let artifactPath: string;
    try {
      artifactPath = resolveRepoRelativeSkillPath(repoRoot, entry.file);
    } catch {
      return buildGeneratedArtifactsStaleError(
        join(repoRoot, "skills", "generated", "manifest.json"),
        `${entry.label} has an invalid file path ${JSON.stringify(entry.file)}. Rerun scripts/generate_skill_indexes.sh in the skills repo.`,
      );
    }

    const actualSha256 = computeSha256Hex(await readFile(artifactPath, "utf8"));
    if (actualSha256 !== entry.sha256) {
      return buildGeneratedArtifactsStaleError(
        artifactPath,
        `${entry.label} sha256 does not match the current file contents. Rerun scripts/generate_skill_indexes.sh in the skills repo.`,
      );
    }
  }

  return null;
}

function buildGeneratedArtifactsStaleError(path: string, detail: string): ValidateSkillError {
  return {
    ok: false,
    code: SKILL_VALIDATION_FAILED,
    message: "Generated skill indexes are stale. Rerun scripts/generate_skill_indexes.sh in the skills repo.",
    details: {
      path,
      reason: detail,
    },
  };
}

async function validateGeneratedArtifactsFresh(
  registry: { skills: SkillEntry[] },
  resolvedRegistryPath: string,
): Promise<ValidateSkillError | null> {
  const repoRoot = getRepoRoot(resolvedRegistryPath);
  const generatorScriptPath = join(repoRoot, "scripts", "generate_skill_indexes.sh");
  if (!(await fileExists(generatorScriptPath))) {
    return null;
  }

  const generatedRoot = join(repoRoot, "skills", "generated");
  const minIndexPath = join(generatedRoot, "skills-index.min.json");
  const jsonlPath = join(generatedRoot, "skills-index.jsonl");
  const manifestPath = join(generatedRoot, "manifest.json");
  const byAppDir = join(generatedRoot, "by-app");
  const byPrefixDir = join(generatedRoot, "by-prefix");

  const requiredPaths = [resolvedRegistryPath, minIndexPath, jsonlPath, manifestPath, byAppDir, byPrefixDir];
  for (const path of requiredPaths) {
    if (!(await fileExists(path))) {
      return buildGeneratedArtifactsStaleError(
        path,
        `Missing generator-owned artifact at ${path}. Rerun scripts/generate_skill_indexes.sh in the skills repo.`,
      );
    }
  }

  try {
    const expected = buildExpectedGeneratedArtifacts(registry);
    const actual = {
      registry: await readJsonFile(resolvedRegistryPath),
      minIndex: await readJsonFile(minIndexPath),
      jsonl: await readJsonlFile(jsonlPath),
      manifest: await readJsonFile(manifestPath),
      byApp: await readGeneratedShardDirectory(byAppDir),
      byPrefix: await readGeneratedShardDirectory(byPrefixDir),
    };

    const manifestChecksumValidation = await validateGeneratedManifestChecksums(actual.manifest, repoRoot);
    if (manifestChecksumValidation !== null) {
      return manifestChecksumValidation;
    }

    const comparisons: Array<{
      label: string;
      path: string;
      actualValue: unknown;
      expectedValue: unknown;
      ignoreSha256?: boolean;
    }> = [
      { label: "skills-registry.json", path: resolvedRegistryPath, actualValue: actual.registry, expectedValue: expected.registry },
      { label: "skills-index.min.json", path: minIndexPath, actualValue: actual.minIndex, expectedValue: expected.minIndex },
      { label: "skills-index.jsonl", path: jsonlPath, actualValue: actual.jsonl, expectedValue: expected.jsonl },
      {
        label: "manifest.json",
        path: manifestPath,
        actualValue: actual.manifest,
        expectedValue: expected.manifest,
        ignoreSha256: true,
      },
      { label: "generated by-app shards", path: byAppDir, actualValue: actual.byApp, expectedValue: expected.byApp },
      { label: "generated by-prefix shards", path: byPrefixDir, actualValue: actual.byPrefix, expectedValue: expected.byPrefix },
    ];

    for (const comparison of comparisons) {
      if (!areGeneratedArtifactsEqual(comparison.actualValue, comparison.expectedValue, { ignoreSha256: comparison.ignoreSha256 })) {
        return buildGeneratedArtifactsStaleError(
          comparison.path,
          `${comparison.label} do not match the current registry contents. Rerun scripts/generate_skill_indexes.sh in the skills repo.`,
        );
      }
    }

    return null;
  } catch (error) {
    return buildGeneratedArtifactsStaleError(
      generatorScriptPath,
      `Could not verify generated skill indexes: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function validateLoadedSkill(
  skill: SkillEntry,
  resolvedRegistryPath: string,
  options?: { dryRun?: boolean }
): Promise<ValidateSkillResult | ValidateSkillError> {
  const repoRoot = getRepoRoot(resolvedRegistryPath);
  const skillJsonPath = resolveRepoRelativeSkillPath(repoRoot, getSkillJsonRelativePath(skill));
  const skillFilePath = resolveRepoRelativeSkillPath(repoRoot, skill.skillFile);

  if (!Array.isArray(skill.scripts)) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} registry entry is missing required scripts`,
      details: {
        skillJsonPath,
        missingFields: ["scripts"],
        reason: "scripts must be an array",
      },
    };
  }

  if (skill.artifacts !== undefined && !Array.isArray(skill.artifacts)) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} registry entry has an invalid artifacts value`,
      details: {
        skillJsonPath,
        reason: "artifacts must be an array when present",
      },
    };
  }

  if (skill.keywords !== undefined && !isStringArray(skill.keywords)) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} registry entry has an invalid keywords value`,
      details: {
        skillJsonPath,
        reason: "keywords must be an array of strings when present",
      },
    };
  }

  const scriptPaths = skill.scripts.map((file) => resolveRepoRelativeSkillPath(repoRoot, file));
  // Artifacts are optional for script-only skills, but when present they must be explicit arrays.
  const artifactPaths = skill.artifacts === undefined ? [] : skill.artifacts.map((file) => resolveRepoRelativeSkillPath(repoRoot, file));
  const missingFiles: string[] = [];

  for (const file of [skillJsonPath, skillFilePath, ...scriptPaths, ...artifactPaths]) {
    try {
      await access(file);
    } catch {
      missingFiles.push(file);
    }
  }

  if (missingFiles.length > 0) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} is missing required files`,
      details: {
        skillJsonPath,
        missingFiles,
      },
    };
  }

  const raw = await readFile(skillJsonPath, "utf8");
  const rawSkillFile = await readFile(skillFilePath, "utf8");
  let parsed: Partial<SkillEntry>;
  try {
    parsed = JSON.parse(raw) as Partial<SkillEntry>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} has an invalid skill.json payload`,
      details: {
        skillJsonPath,
        reason,
      },
    };
  }

  if (parsed.keywords !== undefined && !isStringArray(parsed.keywords)) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} has an invalid skill.json keywords value`,
      details: {
        skillJsonPath,
        reason: "keywords must be an array of strings when present",
      },
    };
  }

  const mismatchFields = findMismatchFields(skill, parsed);
  if (mismatchFields.length > 0) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} metadata does not match the registry entry`,
      details: {
        skillJsonPath,
        mismatchFields,
      },
    };
  }

  const skillTypeValidation = validateSkillTypeFrontmatter(skill, skillFilePath, rawSkillFile);
  if (skillTypeValidation !== null) {
    return skillTypeValidation;
  }

  const manifestResult = parseSkillManifestMetadata(skillJsonPath, parsed);
  if (!manifestResult.ok) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} has an invalid agent manifest`,
      details: {
        skillJsonPath,
        reason: manifestResult.message,
      },
    };
  }

  const unsupportedContractInputSchemas = findUnsupportedContractInputSchemas(skill);
  if (unsupportedContractInputSchemas.length > 0) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} declares unsupported contract input schemas`,
      details: {
        skillJsonPath,
        invalidKeys: unsupportedContractInputSchemas,
        reason: "contract.inputs supports only 'string', 'integer', and 'integer[<min>,<max>]' schemas in v1.",
      },
    };
  }

  if (manifestResult.metadata.agent && !skill.scripts.some((scriptPath) => isOrchestratedHarnessScriptPath(scriptPath))) {
    return {
      ok: false,
      code: SKILL_VALIDATION_FAILED,
      message: `Skill ${skill.id} is missing the required orchestrated harness`,
      details: {
        skillJsonPath,
        reason: "Agent-driven skills must declare scripts/run.js in the registry scripts list.",
      },
    };
  }

  if (options?.dryRun) {
    if (artifactPaths.length === 0) {
      return {
        ok: true,
        skill,
        registryPath: resolvedRegistryPath,
        dryRun: {
          payloadValidation: "skipped",
          reason: SKILL_DRY_RUN_SKIP_REASON,
        },
        checks: {
          skillJsonPath,
          skillFilePath,
          scriptPaths,
          artifactPaths,
        },
      };
    }

    for (let index = 0; index < artifactPaths.length; index++) {
      const artifactPath = artifactPaths[index];
      const artifact = basename(skill.artifacts?.[index] ?? artifactPath);
      let rawArtifact: string;
      try {
        rawArtifact = await readFile(artifactPath, "utf8");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          code: SKILL_VALIDATION_FAILED,
          message: `Skill ${skill.id}: artifact payload schema violation`,
          details: {
            artifact,
            reason: `Failed to read artifact: ${message}`,
          },
        };
      }

      let parsedArtifact: unknown;
      try {
        parsedArtifact = JSON.parse(rawArtifact);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          code: SKILL_VALIDATION_FAILED,
          message: `Skill ${skill.id}: artifact payload schema violation`,
          details: {
            artifact,
            reason: `Failed to parse artifact JSON: ${message}`,
          },
        };
      }

      try {
        validateExecution(parsedArtifact);
      } catch (e) {
        const failure = e as ValidationFailure;
        return {
          ok: false,
          code: SKILL_VALIDATION_FAILED,
          message: `Skill ${skill.id}: artifact payload schema violation`,
          details: {
            artifact,
            path: failure.details?.path,
            reason: failure.details?.reason,
            actionId: failure.details?.actionId,
            actionType: failure.details?.actionType,
            invalidKeys: failure.details?.invalidKeys,
            hint: failure.details?.hint,
          },
        };
      }
    }
  }

  return {
    ok: true,
    skill,
    registryPath: resolvedRegistryPath,
    checks: {
      skillJsonPath,
      skillFilePath,
      scriptPaths,
      artifactPaths,
    },
  };
}

export async function validateSkill(
  skillId: string,
  registryPath?: string,
  options?: { dryRun?: boolean }
): Promise<ValidateSkillResult | ValidateSkillError> {
  try {
    const loaded = await loadRegistry(registryPath);
    const skill = findSkillById(loaded.registry, skillId);
    if (!skill) {
      return { ok: false, code: SKILL_NOT_FOUND, message: `Skill not found: ${skillId}` };
    }
    return await validateLoadedSkill(skill, loaded.resolvedPath, options);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, code: REGISTRY_READ_FAILED, message };
  }
}

export async function validateAllSkills(
  registryPath?: string,
  options?: { dryRun?: boolean }
): Promise<ValidateAllSkillsResult | ValidateAllSkillsError> {
  try {
    const loaded = await loadRegistry(registryPath);
    const generatedArtifactsValidation = loaded.indexed
      ? await validateGeneratedArtifactsFresh(loaded.registry, loaded.resolvedPath)
      : null;
    if (generatedArtifactsValidation !== null) {
      return {
        ok: false,
        code: generatedArtifactsValidation.code,
        message: generatedArtifactsValidation.message,
        registryPath: loaded.resolvedPath,
        details: {
          totalSkills: loaded.registry.skills.length,
          validCount: 0,
          invalidCount: 1,
          failures: [{
            skillId: "<generated-indexes>",
            code: generatedArtifactsValidation.code,
            message: generatedArtifactsValidation.message,
            details: generatedArtifactsValidation.details,
          }],
        },
      };
    }
    const validSkills: ValidateAllSkillsResult["validSkills"] = [];
    const failures: NonNullable<ValidateAllSkillsError["details"]>["failures"] = [];

    for (const skill of loaded.registry.skills) {
      const result = await validateLoadedSkill(skill, loaded.resolvedPath, options);
      if (result.ok) {
        validSkills.push({
          skill: result.skill,
          checks: result.checks,
        });
      } else {
        failures.push({
          skillId: skill.id,
          code: result.code,
          message: result.message,
          details: result.details,
        });
      }
    }

    if (failures.length > 0) {
      return {
        ok: false,
        code: SKILL_VALIDATION_FAILED,
        message: `${failures.length} of ${loaded.registry.skills.length} registered skills failed validation`,
        registryPath: loaded.resolvedPath,
        details: {
          totalSkills: loaded.registry.skills.length,
          validCount: validSkills.length,
          invalidCount: failures.length,
          failures,
        },
      };
    }

    return {
      ok: true,
      registryPath: loaded.resolvedPath,
      totalSkills: loaded.registry.skills.length,
      validSkills,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, code: REGISTRY_READ_FAILED, message };
  }
}
