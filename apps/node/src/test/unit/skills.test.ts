import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import {
  ANDROPERATOR_BIN_ENV_VAR,
  ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR,
  DEFAULT_OPERATOR_PACKAGE,
  formatSkillBinCommand,
  resolveSkillBin,
  resolveSkillBinCommand,
  resolveOperatorPackage,
} from "../../domain/skills/skillsConfig.js";
import { getRepoRoot, getRegistryPath } from "../../adapters/skills-repo/localSkillsRegistry.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
import { listSkills } from "../../domain/skills/listSkills.js";
import { getSkill } from "../../domain/skills/getSkill.js";
import { compileArtifact } from "../../domain/skills/compileArtifact.js";
import { searchSkills } from "../../domain/skills/searchSkills.js";
import { buildSkillRunLogs, runSkill } from "../../domain/skills/runSkill.js";
import { scaffoldSkill } from "../../domain/skills/scaffoldSkill.js";
import { parseSkillManifestMetadata } from "../../domain/skills/skillManifest.js";
import { validateAllSkills, validateSkill } from "../../domain/skills/validateSkill.js";
import { validateExecution, validatePayloadSize } from "../../domain/executions/validateExecution.js";
import { cmdSkillsRun, resolveInteractiveSkillTarget } from "../../cli/commands/skills.js";
import type { SkillResult } from "../../contracts/skillResult.js";
import { ANDROPERATOR_SKILL_RUN_ID_ENV_VAR } from "../../contracts/logging.js";
import { createAndroperatorLogger } from "../../adapters/logger.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import {
  SKILL_NOT_FOUND,
  ARTIFACT_NOT_FOUND,
  COMPILE_VAR_MISSING,
  SKILL_SCRIPT_NOT_FOUND,
  SKILL_EXECUTION_FAILED,
  SKILL_EXECUTION_TIMEOUT,
  SKILL_OUTPUT_ASSERTION_FAILED,
  SKILL_RESULT_PARSE_FAILED,
  SKILL_AGENT_CLI_UNAVAILABLE,
  SKILL_ALREADY_EXISTS,
  SKILL_ID_INVALID,
  REGISTRY_READ_FAILED,
  SKILL_VALIDATION_FAILED,
  SKILLS_SCAFFOLD_FAILED,
} from "../../contracts/skills.js";

const TEST_REGISTRY_PATH = join(packageRoot, "src", "test", "fixtures", "skills", "skills-registry.json");
const TEST_SKILL_VALID_ARTIFACT = "test-skill-valid-artifact";
const TEST_SKILL_INVALID_ARTIFACT = "test-skill-invalid-artifact";
const TEST_SKILL_SCRIPT_ONLY = "test-skill-script-only";
const TEST_SKILL_EMPTY_ARTIFACTS = "test-skill-empty-artifacts";
const TEST_SKILL_PROGRESS = "com.test.progress";
const TEST_SKILL_RESULT = "com.test.skill-result";
const TEST_AGENT_SKILL_RESULT = "com.test.agent-skill-result";
const TEST_FIXTURE_CHUNKED_OUTPUT = "test-fixture-chunked-output";
const TEST_FIXTURE_MIXED_STREAMS = "test-fixture-mixed-streams";
const TEST_FIXTURE_SPLIT_WORD = "test-fixture-split-word";
const ORIGINAL_REGISTRY_PATH = process.env.ANDROPERATOR_SKILLS_REGISTRY;
const ORIGINAL_STDERR_WRITE = process.stderr.write.bind(process.stderr);
const VALID_RECORDING_EXPORT_JSON = `${JSON.stringify({
  exportVersion: 1,
  session: {
    sessionId: "demo-session",
    schemaVersion: 1,
    startedAt: 1710000000000,
    operatorPackage: "com.androperator.operator.dev",
  },
  snapshotMode: "omit",
  events: [],
  counts: {
    totalEvents: 0,
    byType: {},
  },
  packageTransitions: [],
  timeline: {
    firstEventTs: null,
    lastEventTs: null,
    durationMs: null,
  },
})}\n`;

function makeSkillMarkdown(skillId: string, skillType = "replay"): string {
  return `---
name: ${skillId}
androperator-skill-type: ${skillType}
description: |-
  Test fixture for ${skillId}
---

# ${skillId}
`;
}

function getGeneratedPrefixShard(skillId: string): string {
  return createHash("sha1").update(skillId).digest("hex").slice(0, 2);
}

function buildGeneratedArtifactsForTest(skills: Array<Record<string, unknown>>) {
  const sortedSkills = [...skills].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const appIds = Array.from(new Set(sortedSkills.map((skill) => String(skill.applicationId)))).sort();
  const byPrefix = new Map<string, Array<Record<string, unknown>>>();

  for (const skill of sortedSkills) {
    const prefix = getGeneratedPrefixShard(String(skill.id));
    const existing = byPrefix.get(prefix) ?? [];
    existing.push(skill);
    byPrefix.set(prefix, existing);
  }

  const sortedPrefixes = Array.from(byPrefix.keys()).sort();
  const stringifyGeneratedArtifact = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const computeSha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");
  const minIndex = {
    schemaVersion: "1.0",
    generatedAt: "2026-04-19T00:00:00Z",
    count: sortedSkills.length,
    skills: sortedSkills.map((skill) => ({
      id: skill.id,
      applicationId: skill.applicationId,
      intent: skill.intent,
      summary: skill.summary,
      path: skill.path,
    })),
  };
  const jsonl = `${sortedSkills.map((skill) => JSON.stringify(skill)).join("\n")}\n`;
  const byAppArtifacts = Object.fromEntries(appIds.map((applicationId) => [
    `${applicationId}.json`,
    {
      schemaVersion: "1.0",
      generatedAt: "2026-04-19T00:00:00Z",
      applicationId,
      count: sortedSkills.filter((skill) => String(skill.applicationId) === applicationId).length,
      skills: sortedSkills.filter((skill) => String(skill.applicationId) === applicationId),
    },
  ]));
  const byPrefixArtifacts = Object.fromEntries(sortedPrefixes.map((prefix) => [
    `${prefix}.json`,
    {
      schemaVersion: "1.0",
      generatedAt: "2026-04-19T00:00:00Z",
      prefix,
      count: (byPrefix.get(prefix) ?? []).length,
      skills: byPrefix.get(prefix) ?? [],
    },
  ]));
  const registryContents = stringifyGeneratedArtifact({
    $schema: "./skills-registry.schema.json",
    schemaVersion: "1.0",
    generatedAt: "2026-04-19T00:00:00Z",
    skills: sortedSkills,
  });
  const minIndexContents = stringifyGeneratedArtifact(minIndex);
  const byAppChecksums = Object.fromEntries(
    Object.entries(byAppArtifacts).map(([fileName, payload]) => [fileName, computeSha256Hex(stringifyGeneratedArtifact(payload))])
  );
  const byPrefixChecksums = Object.fromEntries(
    Object.entries(byPrefixArtifacts).map(([fileName, payload]) => [fileName, computeSha256Hex(stringifyGeneratedArtifact(payload))])
  );

  return {
    minIndex,
    jsonl,
    manifest: {
      schemaVersion: "1.0",
      generatedAt: "2026-04-19T00:00:00Z",
      totalSkills: sortedSkills.length,
      artifacts: {
        registry: { file: "skills/skills-registry.json", sha256: computeSha256Hex(registryContents), count: sortedSkills.length },
        minIndex: { file: "skills/generated/skills-index.min.json", sha256: computeSha256Hex(minIndexContents), count: sortedSkills.length },
        jsonlIndex: { file: "skills/generated/skills-index.jsonl", sha256: computeSha256Hex(jsonl), count: sortedSkills.length },
      },
      shards: {
        byApp: appIds.map((applicationId) => ({
          applicationId,
          file: `skills/generated/by-app/${applicationId}.json`,
          sha256: byAppChecksums[`${applicationId}.json`],
          count: sortedSkills.filter((skill) => String(skill.applicationId) === applicationId).length,
        })),
        byPrefix: sortedPrefixes.map((prefix) => ({
          prefix,
          file: `skills/generated/by-prefix/${prefix}.json`,
          sha256: byPrefixChecksums[`${prefix}.json`],
          count: (byPrefix.get(prefix) ?? []).length,
        })),
      },
    },
    byApp: byAppArtifacts,
    byPrefix: byPrefixArtifacts,
  };
}

async function writeGeneratedArtifactsForTest(
  repoRoot: string,
  skills: Array<Record<string, unknown>>,
): Promise<void> {
  const generatedRoot = join(repoRoot, "skills", "generated");
  const byAppDir = join(generatedRoot, "by-app");
  const byPrefixDir = join(generatedRoot, "by-prefix");
  const artifacts = buildGeneratedArtifactsForTest(skills);

  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await writeFile(join(repoRoot, "scripts", "generate_skill_indexes.sh"), "#!/usr/bin/env bash\n", "utf8");
  await mkdir(byAppDir, { recursive: true });
  await mkdir(byPrefixDir, { recursive: true });
  await writeFile(join(generatedRoot, "skills-index.min.json"), `${JSON.stringify(artifacts.minIndex, null, 2)}\n`, "utf8");
  await writeFile(join(generatedRoot, "skills-index.jsonl"), artifacts.jsonl, "utf8");
  await writeFile(join(generatedRoot, "manifest.json"), `${JSON.stringify(artifacts.manifest, null, 2)}\n`, "utf8");

  for (const [fileName, payload] of Object.entries(artifacts.byApp)) {
    await writeFile(join(byAppDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  for (const [fileName, payload] of Object.entries(artifacts.byPrefix)) {
    await writeFile(join(byPrefixDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

async function createTempValidationSkillRepo(options: {
  skillId: string;
  skillType?: string;
  registrySkills?: Array<Record<string, unknown>>;
  generatedSkills?: Array<Record<string, unknown>>;
}): Promise<{ root: string; registryPath: string; entry: Record<string, unknown>; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "androperator-skill-guardrails-"));
  const skillsDir = join(root, "skills");
  const skillDir = join(skillsDir, options.skillId);
  const registryPath = join(skillsDir, "skills-registry.json");
  const entry = {
    id: options.skillId,
    applicationId: "com.test",
    intent: "temp",
    summary: "Temporary validation skill",
    path: `skills/${options.skillId}`,
    skillFile: `skills/${options.skillId}/SKILL.md`,
    scripts: [`skills/${options.skillId}/scripts/run.js`],
    artifacts: [],
  };

  await mkdir(join(skillDir, "scripts"), { recursive: true });
  await copyFile(
    join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
    join(skillDir, "scripts", "run.js")
  );
  await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(options.skillId, options.skillType ?? "replay"), "utf8");
  await writeFile(join(skillDir, "skill.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");

  const registrySkills = options.registrySkills ?? [entry];
  await writeFile(
    registryPath,
    `${JSON.stringify({ $schema: "./skills-registry.schema.json", schemaVersion: "1.0", generatedAt: "2026-04-19T00:00:00Z", skills: registrySkills }, null, 2)}\n`,
    "utf8"
  );

  if (options.generatedSkills !== undefined) {
    await writeGeneratedArtifactsForTest(root, options.generatedSkills);
  }

  return {
    root,
    registryPath,
    entry,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

const originalLogDir = process.env.ANDROPERATOR_LOG_DIR;
let testLogDir: string;

before(async () => {
  testLogDir = await mkdtemp(join(tmpdir(), "local skill workspace-test-logs-"));
  process.env.ANDROPERATOR_LOG_DIR = testLogDir;
  process.env.ANDROPERATOR_SKILLS_REGISTRY = TEST_REGISTRY_PATH;
});

after(async () => {
  if (originalLogDir === undefined) delete process.env.ANDROPERATOR_LOG_DIR;
  else process.env.ANDROPERATOR_LOG_DIR = originalLogDir;
  await rm(testLogDir, { recursive: true, force: true });
  if (ORIGINAL_REGISTRY_PATH === undefined) {
    delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
  } else {
    process.env.ANDROPERATOR_SKILLS_REGISTRY = ORIGINAL_REGISTRY_PATH;
  }
});

afterEach(() => {
  process.stderr.write = ORIGINAL_STDERR_WRITE;
  process.exitCode = undefined;
  process.env.ANDROPERATOR_SKILLS_REGISTRY = TEST_REGISTRY_PATH;
});

function runCli(
  args: string[],
  options?: { env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cliPath = join(packageRoot, "dist", "cli", "index.js");
  return (async () => {
    const baseEnv = options?.env ?? {
      ...process.env,
      ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
    };
    const skillsRunIndex = args.findIndex((arg, index) => arg === "skills" && args[index + 1] === "run");
    const needsFakeAdb = skillsRunIndex >= 0
      && !((baseEnv.PATH ?? "").includes("androperator-fake-adb-"));
    const fakeAdbDir = needsFakeAdb
      ? await createFakeAdb({
          installed: true,
          operatorPackage: "com.androperator.operator.dev",
        })
      : undefined;
    const env = fakeAdbDir
      ? {
          ...baseEnv,
          PATH: `${fakeAdbDir}${baseEnv.PATH ? `:${baseEnv.PATH}` : ""}`,
        }
      : baseEnv;

    return new Promise((resolve) => {
      const proc = spawn(process.execPath, [cliPath, ...args], {
        cwd: packageRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d) => (stdout += d.toString()));
      proc.stderr?.on("data", (d) => (stderr += d.toString()));
      proc.on("close", (code) => {
        void (async () => {
          if (fakeAdbDir) {
            await rm(fakeAdbDir, { recursive: true, force: true });
          }
          resolve({ stdout, stderr, code: code ?? -1 });
        })();
      });
    });
  })();
}

function runNodeSnippet(
  script: string,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: options?.cwd ?? packageRoot,
      env: options?.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

function runNodeFile(
  filePath: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [filePath, ...args], {
      cwd: options?.cwd ?? packageRoot,
      env: options?.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

function normalizeMacTmpPath(path: string): string {
  return normalize(path).replace(/^\/private(?=\/var\/)/, "");
}

async function getPackageVersion(): Promise<string> {
  const pkg = await readFile(join(packageRoot, "package.json"), "utf8");
  const parsed = JSON.parse(pkg) as { version?: string };
  return parsed.version ?? "0.0.0";
}

async function createTempRegistryWithSkill(options: {
  skillId: string;
  scriptSourcePath: string;
  skillJsonContents: string;
  extraScriptSourcePaths?: string[];
  omitSkillFile?: boolean;
  skillFileRelativePath?: string;
  scriptRelativePath?: string;
}): Promise<{ registryPath: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "androperator-skill-result-source-"));
  const skillDir = join(root, "skills", options.skillId);
  const scriptsDir = join(skillDir, "scripts");
  await mkdir(scriptsDir, { recursive: true });

  const scriptRelativePath = options.scriptRelativePath ?? "scripts/run.js";
  const scriptDest = join(root, "skills", options.skillId, scriptRelativePath.replace(/^scripts\//, "scripts/"));
  await mkdir(dirname(scriptDest), { recursive: true });
  await copyFile(options.scriptSourcePath, scriptDest);
  for (const extraSourcePath of options.extraScriptSourcePaths ?? []) {
    await copyFile(extraSourcePath, join(scriptsDir, basename(extraSourcePath)));
  }
  if (!options.omitSkillFile) {
    const skillProgramPath = options.skillFileRelativePath === undefined
      ? join(skillDir, "SKILL.md")
      : join(root, options.skillFileRelativePath);
    await mkdir(dirname(skillProgramPath), { recursive: true });
    await writeFile(skillProgramPath, makeSkillMarkdown(options.skillId), "utf8");
  }
  await writeFile(join(skillDir, "skill.json"), options.skillJsonContents);
  let parsedSkillJson: Record<string, unknown> | null = null;
  try {
    const candidate = JSON.parse(options.skillJsonContents) as unknown;
    if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
      parsedSkillJson = candidate as Record<string, unknown>;
    }
  } catch {
    parsedSkillJson = null;
  }

  const registryPath = join(root, "skills", "skills-registry.json");
  await writeFile(
    registryPath,
    JSON.stringify({
      schemaVersion: "1.0",
      generatedAt: "2026-04-11T00:00:00Z",
      skills: [
        {
          id: options.skillId,
          applicationId: "com.test",
          intent: "temp",
          summary: "Temporary test skill",
          path: `skills/${options.skillId}`,
          skillFile: options.skillFileRelativePath ?? `skills/${options.skillId}/SKILL.md`,
          scripts: [`skills/${options.skillId}/${scriptRelativePath}`],
          artifacts: [],
          ...(parsedSkillJson !== null && Object.prototype.hasOwnProperty.call(parsedSkillJson, "contract")
            ? { contract: parsedSkillJson.contract }
            : {}),
        },
      ],
    }),
    "utf8"
  );

  return {
    registryPath,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function createTempRegistryWithInlineScript(options: {
  skillId: string;
  scriptContents: string;
  contract: {
    inputs: Record<string, string>;
    goal: { kind: string };
    verification: { kind: "node_text_matches"; matcher: string } | null;
  };
}): Promise<{ registryPath: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "androperator-inline-skill-"));
  const skillDir = join(root, "skills", options.skillId);
  const scriptsDir = join(skillDir, "scripts");
  await mkdir(scriptsDir, { recursive: true });

  const entry = {
    id: options.skillId,
    applicationId: "com.test",
    intent: "temp",
    summary: "Temporary test skill",
    path: `skills/${options.skillId}`,
    skillFile: `skills/${options.skillId}/SKILL.md`,
    scripts: [`skills/${options.skillId}/scripts/run.js`],
    artifacts: [],
    contract: options.contract,
  };

  await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(options.skillId), "utf8");
  await writeFile(join(scriptsDir, "run.js"), options.scriptContents, "utf8");
  await chmod(join(scriptsDir, "run.js"), 0o755);
  await writeFile(join(skillDir, "skill.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");

  const registryPath = join(root, "skills", "skills-registry.json");
  await writeFile(
    registryPath,
    `${JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-04-15T00:00:00Z", skills: [entry] }, null, 2)}\n`,
    "utf8"
  );

  return {
    registryPath,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

interface TempSearchSkillEntry {
  id: string;
  applicationId: string;
  intent: string;
  summary: string;
  keywords?: string[];
}

async function createTempRegistryWithEntries(
  entries: TempSearchSkillEntry[]
): Promise<{ registryPath: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "androperator-search-registry-"));
  const registryPath = join(root, "skills", "skills-registry.json");
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(
    registryPath,
    `${JSON.stringify({
      schemaVersion: "1.0",
      generatedAt: "2026-04-17T00:00:00Z",
      skills: entries.map((entry) => ({
        ...entry,
        path: `skills/${entry.id}`,
        skillFile: `skills/${entry.id}/SKILL.md`,
        scripts: [`skills/${entry.id}/scripts/run.js`],
        artifacts: [],
      })),
    }, null, 2)}\n`,
    "utf8"
  );

  return {
    registryPath,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

const GOOGLE_HOME_HVAC_KEYWORDS = [
  "google home",
  "climate",
  "hvac",
  "air conditioner",
  "aircon",
  "ac",
  "heater",
];

function makeGoogleHomeHvacEntries(): TempSearchSkillEntry[] {
  return [
    {
      id: "com.google.android.apps.chromecast.app.control-hvac-orchestrated",
      applicationId: "com.google.android.apps.chromecast.app",
      intent: "control-hvac",
      summary: "Agent-driven Google Home HVAC controller for one named climate action per run.",
      keywords: GOOGLE_HOME_HVAC_KEYWORDS,
    },
    {
      id: "com.google.android.apps.chromecast.app.get-climate-replay",
      applicationId: "com.google.android.apps.chromecast.app",
      intent: "get-climate",
      summary: "Replay baseline skill for reading a Google Home climate unit status.",
      keywords: GOOGLE_HOME_HVAC_KEYWORDS,
    },
    {
      id: "com.google.android.apps.chromecast.app.set-power-replay",
      applicationId: "com.google.android.apps.chromecast.app",
      intent: "set-power",
      summary: "Replay baseline skill for setting a Google Home climate unit power on or off.",
      keywords: GOOGLE_HOME_HVAC_KEYWORDS,
    },
    {
      id: "com.google.android.apps.chromecast.app.set-temperature-replay",
      applicationId: "com.google.android.apps.chromecast.app",
      intent: "set-temperature",
      summary: "Replay baseline skill for setting a Google Home climate unit temperature.",
      keywords: GOOGLE_HOME_HVAC_KEYWORDS,
    },
  ];
}

function getGoogleHomeHvacSkillIds(): string[] {
  return makeGoogleHomeHvacEntries().map((entry) => entry.id);
}

function getLogPathForDir(logDir: string): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return join(logDir, `androperator-${yyyy}-${mm}-${dd}.log`);
}

function parseLogEvents(contents: string): Array<{ event?: string; skillId?: string; skillRunId?: string; logPath?: string; tailCommand?: string; stream?: string; message?: string; level?: string; exitCode?: number }> {
  return contents.trimEnd().split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
    event?: string;
    skillId?: string;
    skillRunId?: string;
    logPath?: string;
    tailCommand?: string;
    stream?: string;
    message?: string;
    level?: string;
    exitCode?: number;
  });
}

async function createFakeAdb(options: {
  installed: boolean;
  operatorPackage: string;
  installedPackage?: string;
  packageListCode?: number;
  packageListStderr?: string;
  deviceSerial?: string;
  interactiveState?: {
    screenOn: boolean;
    deviceLocked: boolean;
    userUnlocked: boolean;
  };
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "androperator-fake-adb-"));
  const scriptPath = join(dir, "adb");
  const commandIdPath = join(dir, "doctor-command-id");
  const deviceSerial = options.deviceSerial ?? "device-123";
  const interactiveState = options.interactiveState ?? {
    screenOn: true,
    deviceLocked: false,
    userUnlocked: true,
  };
  const script = [
    "#!/bin/sh",
    "if [ \"$1\" = \"-s\" ]; then",
    "  shift 2",
    "fi",
    "if [ \"$1\" = \"devices\" ]; then",
    "  printf 'List of devices attached\\n'",
    `  printf '%s\\tdevice\\n' ${JSON.stringify(deviceSerial)}`,
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"shell\" ] && [ \"$2\" = \"pm\" ] && [ \"$3\" = \"list\" ] && [ \"$4\" = \"packages\" ]; then",
    `  if [ ${JSON.stringify(options.packageListCode ?? 0)} -ne 0 ]; then`,
    `    printf '%s\\n' ${JSON.stringify(options.packageListStderr ?? "package query failed")} 1>&2`,
    `    exit ${JSON.stringify(options.packageListCode ?? 1)}`,
    "  fi",
    `  if [ ${JSON.stringify(options.installed ? 0 : 1)} -eq 0 ]; then`,
    ...(options.installedPackage === undefined
      ? ["    printf 'package:%s\\n' \"$5\""]
      : [
          `    if [ \"$5\" = ${JSON.stringify(options.installedPackage)} ]; then`,
          "      printf 'package:%s\\n' \"$5\"",
          "    fi",
        ]),
    "  fi",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"logcat\" ] && [ \"$2\" = \"-c\" ]; then",
    `  rm -f ${JSON.stringify(commandIdPath)}`,
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"logcat\" ]; then",
    "  i=0",
    `  while [ ! -s ${JSON.stringify(commandIdPath)} ] && [ \"$i\" -lt 80 ]; do`,
    "    sleep 0.05",
    "    i=$((i + 1))",
    "  done",
    `  if [ -s ${JSON.stringify(commandIdPath)} ]; then`,
    `    command_id=$(cat ${JSON.stringify(commandIdPath)})`,
    `    printf '04-21 00:00:00.000 I TaskScopeDefault: [Androperator-Result] {\"commandId\":\"%s\",\"taskId\":\"doctor-handshake\",\"status\":\"success\",\"stepResults\":[{\"id\":\"h1\",\"actionType\":\"doctor_ping\",\"success\":true,\"data\":{\"developer_options_enabled\":\"true\",\"usb_debugging_enabled\":\"true\",\"screen_on\":${JSON.stringify(String(interactiveState.screenOn))},\"device_locked\":${JSON.stringify(String(interactiveState.deviceLocked))},\"user_unlocked\":${JSON.stringify(String(interactiveState.userUnlocked))}}}],\"error\":null}\\n' \"$command_id\"`,
    "  fi",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"shell\" ]; then",
    "  command=$2",
    "  command_id=$(printf '%s' \"$command\" | sed -n 's/.*\"commandId\":\"\\([^\"]*\\)\".*/\\1/p')",
    "  if [ -n \"$command_id\" ]; then",
    `    printf '%s' \"$command_id\" > ${JSON.stringify(commandIdPath)}`,
    "  fi",
    "  printf 'Broadcast completed: result=0\\n'",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"version\" ]; then",
    "  printf 'Android Debug Bridge version 1.0.41\\n'",
    "  exit 0",
    "fi",
    "exit 0",
  ].join("\n");
  await writeFile(scriptPath, script, "utf8");
  await chmod(scriptPath, 0o755);
  return dir;
}

describe("listSkills", () => {
  it("returns skills from registry when available", async () => {
    const result = await listSkills();
    if (!result.ok) {
      assert.fail(`Expected listSkills to succeed when registry present: ${result.message}`);
    }
    assert.ok(Array.isArray(result.skills));
    const chromecast = result.skills.find((s) => s.id === "com.google.android.apps.chromecast.app.get-climate");
    assert.ok(chromecast);
    assert.strictEqual(chromecast.artifacts.length, 1);
    assert.ok(chromecast.artifacts[0].endsWith("climate-status.recipe.json"));
  });
});

describe("loadRegistry", () => {
  it("rejects a blank ANDROPERATOR_SKILLS_REGISTRY in getRegistryPath", () => {
    const originalRegistry = process.env.ANDROPERATOR_SKILLS_REGISTRY;
    try {
      process.env.ANDROPERATOR_SKILLS_REGISTRY = "   ";
      assert.throws(
        () => getRegistryPath(),
        /ANDROPERATOR_SKILLS_REGISTRY is set but blank/
      );
    } finally {
      if (originalRegistry === undefined) {
        delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
      } else {
        process.env.ANDROPERATOR_SKILLS_REGISTRY = originalRegistry;
      }
    }
  });

  it("warns to stderr when ANDROPERATOR_SKILLS_REGISTRY is unset and the default path is missing", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-unset-"));
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-unset-"));
    const appNodeDir = join(tempRoot, "apps", "node");
    const installedHomeRegistryPath = join(
      tempHome,
      ".androperator",
      "skills",
      "skills",
      "skills-registry.json"
    );
    await mkdir(appNodeDir, { recursive: true });

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(appNodeDir)});
        delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
        try {
          await loadRegistry();
          console.log(JSON.stringify({ ok: true }));
        } catch (error) {
          console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        }
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { ok: boolean; message?: string };
      assert.strictEqual(parsed.ok, false);
      assert.match(parsed.message ?? "", /Registry not found\. Checked:/);
      assert.ok(
        parsed.message?.includes(installedHomeRegistryPath),
        `Expected message to include installed registry path, got: ${parsed.message}`
      );
      assert.ok(
        parsed.message?.includes("androperator skills list"),
        `Expected message to include next-step command, got: ${parsed.message}`
      );
      assert.ok(
        child.stderr.includes("ANDROPERATOR_SKILLS_REGISTRY"),
        `Expected stderr to mention ANDROPERATOR_SKILLS_REGISTRY, got: ${child.stderr}`
      );
      assert.ok(
        child.stderr.includes(installedHomeRegistryPath),
        `Expected stderr to include installed registry path, got: ${child.stderr}`
      );
      assert.ok(
        child.stderr.includes("androperator skills list"),
        `Expected stderr to include next-step command, got: ${child.stderr}`
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("writes the configured path to stderr when ANDROPERATOR_SKILLS_REGISTRY points to a missing file", async () => {
    const moduleUrl = pathToFileURL(
      join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
    ).href;
    const missingPath = "/tmp/does-not-exist/skills-registry.json";
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-fallback-configured-"));
    const installedHomeRegistryPath = join(
      tempHome,
      ".androperator",
      "skills",
      "skills",
      "skills-registry.json"
    );
    await mkdir(dirname(installedHomeRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, installedHomeRegistryPath);
    const script = `
      import { loadRegistry } from ${JSON.stringify(moduleUrl)};
      process.env.ANDROPERATOR_SKILLS_REGISTRY = ${JSON.stringify(missingPath)};
      try {
        await loadRegistry();
        console.log(JSON.stringify({ ok: true }));
      } catch (error) {
        console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
      }
    `;
    try {
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { ok: boolean; message?: string };
      assert.strictEqual(parsed.ok, false);
      assert.match(
        parsed.message ?? "",
        /Registry not found at configured path: \/tmp\/does-not-exist\/skills-registry\.json/
      );
      assert.ok(
        parsed.message?.includes(installedHomeRegistryPath),
        `Expected message to include installed registry path, got: ${parsed.message}`
      );
      assert.ok(
        parsed.message?.includes("androperator skills list"),
        `Expected message to include next-step command, got: ${parsed.message}`
      );
      assert.ok(
        child.stderr.includes(missingPath),
        `Expected stderr to include the missing path, got: ${child.stderr}`
      );
      assert.ok(
        child.stderr.includes(installedHomeRegistryPath),
        `Expected stderr to include installed registry path, got: ${child.stderr}`
      );
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("fails when ANDROPERATOR_SKILLS_REGISTRY is blank instead of falling back", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-blank-env-"));
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-blank-env-"));
    const appNodeDir = join(tempRoot, "apps", "node");
    const installedHomeRegistryPath = join(
      tempHome,
      ".androperator",
      "skills",
      "skills",
      "skills-registry.json"
    );

    await mkdir(appNodeDir, { recursive: true });
    await mkdir(dirname(installedHomeRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, installedHomeRegistryPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(appNodeDir)});
        process.env.ANDROPERATOR_SKILLS_REGISTRY = "   ";
        try {
          await loadRegistry();
          console.log(JSON.stringify({ ok: true }));
        } catch (error) {
          console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        }
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { ok: boolean; message?: string };
      assert.strictEqual(parsed.ok, false);
      assert.match(parsed.message ?? "", /ANDROPERATOR_SKILLS_REGISTRY is set but blank/);
      assert.match(child.stderr, /ANDROPERATOR_SKILLS_REGISTRY is set but blank/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("uses an explicit registry path even when ANDROPERATOR_SKILLS_REGISTRY is blank", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-explicit-wins-"));
    const explicitRegistryPath = join(tempRoot, "skills", "skills-registry.json");

    await mkdir(dirname(explicitRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, explicitRegistryPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.env.ANDROPERATOR_SKILLS_REGISTRY = "   ";
        const result = await loadRegistry(${JSON.stringify(explicitRegistryPath)});
        console.log(JSON.stringify({
          resolvedPath: result.resolvedPath,
          skillCount: result.registry.skills.length,
        }));
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { resolvedPath: string; skillCount: number };
      assert.strictEqual(
        normalizeMacTmpPath(parsed.resolvedPath),
        normalizeMacTmpPath(explicitRegistryPath)
      );
      assert.ok(parsed.skillCount > 0);
      assert.strictEqual(child.stderr, "");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("trims explicit registry paths before reading them", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-explicit-trim-"));
    const explicitRegistryPath = join(tempRoot, "skills", "skills-registry.json");

    await mkdir(dirname(explicitRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, explicitRegistryPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        const result = await loadRegistry(${JSON.stringify(`  ${explicitRegistryPath}  `)});
        console.log(JSON.stringify({
          resolvedPath: result.resolvedPath,
          skillCount: result.registry.skills.length,
        }));
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { resolvedPath: string; skillCount: number };
      assert.strictEqual(
        normalizeMacTmpPath(parsed.resolvedPath),
        normalizeMacTmpPath(explicitRegistryPath)
      );
      assert.ok(parsed.skillCount > 0);
      assert.strictEqual(child.stderr, "");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails when the caller passes an explicit default registry path that does not exist", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-"));
    const appNodeDir = join(tempRoot, "apps", "node");
    const fallbackDir = join(tempRoot, "skills");
    const fallbackPath = join(fallbackDir, "skills-registry.json");

    await mkdir(appNodeDir, { recursive: true });
    await mkdir(fallbackDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, fallbackPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry, getRegistryPath } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(appNodeDir)});
        delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
        try {
          await loadRegistry(getRegistryPath());
          console.log(JSON.stringify({ ok: true }));
        } catch (error) {
          console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        }
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { ok: boolean; message?: string };
      assert.strictEqual(parsed.ok, false);
      assert.match(parsed.message ?? "", /Registry not found at explicit path:/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the installed home registry without warning when repo-local paths are missing", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-home-"));
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-"));
    const appNodeDir = join(tempRoot, "apps", "node");
    const installedHomeRegistryPath = join(
      tempHome,
      ".androperator",
      "skills",
      "skills",
      "skills-registry.json"
    );

    await mkdir(appNodeDir, { recursive: true });
    await mkdir(dirname(installedHomeRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, installedHomeRegistryPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(appNodeDir)});
        delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
        const result = await loadRegistry();
        console.log(JSON.stringify({
          resolvedPath: result.resolvedPath,
          skillCount: result.registry.skills.length,
        }));
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { resolvedPath: string; skillCount: number };
      assert.strictEqual(
        normalizeMacTmpPath(parsed.resolvedPath),
        normalizeMacTmpPath(installedHomeRegistryPath)
      );
      assert.ok(parsed.skillCount > 0);
      assert.strictEqual(child.stderr, "");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("keeps the configured env registry ahead of repo and installed-home fallbacks", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-env-priority-"));
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-priority-"));
    const appNodeDir = join(tempRoot, "apps", "node");
    const repoFallbackPath = join(tempRoot, "skills", "skills-registry.json");
    const installedHomeRegistryPath = join(
      tempHome,
      ".androperator",
      "skills",
      "skills",
      "skills-registry.json"
    );

    await mkdir(appNodeDir, { recursive: true });
    await mkdir(dirname(repoFallbackPath), { recursive: true });
    await mkdir(dirname(installedHomeRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, repoFallbackPath);
    await copyFile(TEST_REGISTRY_PATH, installedHomeRegistryPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(appNodeDir)});
        process.env.ANDROPERATOR_SKILLS_REGISTRY = ${JSON.stringify(TEST_REGISTRY_PATH)};
        const result = await loadRegistry();
        console.log(JSON.stringify({
          resolvedPath: result.resolvedPath,
          skillCount: result.registry.skills.length,
        }));
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { resolvedPath: string; skillCount: number };
      assert.strictEqual(normalizeMacTmpPath(parsed.resolvedPath), normalizeMacTmpPath(TEST_REGISTRY_PATH));
      assert.ok(parsed.skillCount > 0);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("prefers the repo-relative fallback over the installed home registry when both exist", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-repo-priority-"));
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-repo-priority-"));
    const appNodeDir = join(tempRoot, "apps", "node");
    const repoFallbackPath = join(tempRoot, "skills", "skills-registry.json");
    const installedHomeRegistryPath = join(
      tempHome,
      ".androperator",
      "skills",
      "skills",
      "skills-registry.json"
    );

    await mkdir(appNodeDir, { recursive: true });
    await mkdir(dirname(repoFallbackPath), { recursive: true });
    await mkdir(dirname(installedHomeRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, repoFallbackPath);
    await copyFile(TEST_REGISTRY_PATH, installedHomeRegistryPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(appNodeDir)});
        delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
        const result = await loadRegistry();
        console.log(JSON.stringify({
          resolvedPath: result.resolvedPath,
          skillCount: result.registry.skills.length,
        }));
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { resolvedPath: string; skillCount: number };
      assert.strictEqual(normalizeMacTmpPath(parsed.resolvedPath), normalizeMacTmpPath(repoFallbackPath));
      assert.ok(parsed.skillCount > 0);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("does not probe ../../skills outside the checkout when running from repo root", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-root-cwd-"));
    const repoRootDir = join(tempRoot, "repo");
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-root-cwd-"));
    const ancestorRegistryPath = join(tempRoot, "skills", "skills-registry.json");
    const installedHomeRegistryPath = join(
      tempHome,
      ".androperator",
      "skills",
      "skills",
      "skills-registry.json"
    );

    await mkdir(repoRootDir, { recursive: true });
    await mkdir(dirname(ancestorRegistryPath), { recursive: true });
    await mkdir(dirname(installedHomeRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, ancestorRegistryPath);
    await copyFile(TEST_REGISTRY_PATH, installedHomeRegistryPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(repoRootDir)});
        delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
        const result = await loadRegistry();
        console.log(JSON.stringify({
          resolvedPath: result.resolvedPath,
          skillCount: result.registry.skills.length,
        }));
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { resolvedPath: string; skillCount: number };
      assert.strictEqual(
        normalizeMacTmpPath(parsed.resolvedPath),
        normalizeMacTmpPath(installedHomeRegistryPath)
      );
      assert.ok(parsed.skillCount > 0);
      assert.strictEqual(child.stderr, "");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("does not hide broken default registries behind fallback probing", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-broken-default-"));
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-broken-default-"));
    const appNodeDir = join(tempRoot, "apps", "node");
    const defaultRegistryPath = join(appNodeDir, "skills", "skills-registry.json");
    const installedHomeRegistryPath = join(
      tempHome,
      ".androperator",
      "skills",
      "skills",
      "skills-registry.json"
    );

    await mkdir(defaultRegistryPath, { recursive: true });
    await mkdir(dirname(installedHomeRegistryPath), { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, installedHomeRegistryPath);

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(appNodeDir)});
        delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
        try {
          await loadRegistry();
          console.log(JSON.stringify({ ok: true }));
        } catch (error) {
          console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        }
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { ok: boolean; message?: string };
      assert.strictEqual(parsed.ok, false);
      assert.match(parsed.message ?? "", /EISDIR|illegal operation on a directory/i);
      assert.strictEqual(child.stderr, "");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("fails cleanly when the caller passes an explicit missing registry path and no fallbacks resolve", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-registry-explicit-missing-"));
    const tempHome = await mkdtemp(join(tmpdir(), "androperator-home-explicit-missing-"));
    const appNodeDir = join(tempRoot, "apps", "node");
    const explicitMissingPath = join(tempRoot, "custom", "skills-registry.json");

    await mkdir(appNodeDir, { recursive: true });

    try {
      const moduleUrl = pathToFileURL(
        join(packageRoot, "dist", "adapters", "skills-repo", "localSkillsRegistry.js")
      ).href;
      const script = `
        import { loadRegistry } from ${JSON.stringify(moduleUrl)};
        process.chdir(${JSON.stringify(appNodeDir)});
        delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
        try {
          await loadRegistry(${JSON.stringify(explicitMissingPath)});
          console.log(JSON.stringify({ ok: true }));
        } catch (error) {
          console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        }
      `;
      const child = await runNodeSnippet(script, {
        env: { ...process.env, HOME: tempHome },
      });
      assert.strictEqual(child.code, 0, child.stderr);
      const parsed = JSON.parse(child.stdout) as { ok: boolean; message?: string };
      assert.strictEqual(parsed.ok, false);
      assert.match(
        parsed.message ?? "",
        new RegExp(`Registry not found at explicit path: ${explicitMissingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});

describe("getSkill", () => {
  it("returns skill for known id", async () => {
    const result = await getSkill("com.google.android.apps.chromecast.app.get-climate");
    if (!result.ok) assert.fail(result.message);
    assert.strictEqual(result.skill.id, "com.google.android.apps.chromecast.app.get-climate");
    assert.strictEqual(result.skill.applicationId, "com.google.android.apps.chromecast.app");
  });

  it("returns SKILL_NOT_FOUND for unknown id", async () => {
    const result = await getSkill("nonexistent.skill.id");
    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_NOT_FOUND);
  });
});

describe("validateSkill", () => {
  it("returns validation details for a known valid skill", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-valid-"));
    const skillsDir = join(tempRoot, "skills");
    const skillDir = join(skillsDir, "com.test.valid");
    const registryPath = join(skillsDir, "skills-registry.json");
    const entry = {
      id: "com.test.valid",
      applicationId: "com.test",
      intent: "valid",
      summary: "Valid skill",
      path: "skills/com.test.valid",
      skillFile: "skills/com.test.valid/SKILL.md",
      scripts: ["skills/com.test.valid/scripts/run.js"],
      artifacts: [],
    };

    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(skillDir, "scripts", "run.js")
    );
    await writeFile(registryPath, `${JSON.stringify({ skills: [entry] }, null, 2)}\n`, "utf8");
    await writeFile(join(skillDir, "skill.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown("com.test.valid"), "utf8");

    try {
      const result = await validateSkill("com.test.valid", registryPath);
      if (!result.ok) assert.fail(result.message);
      assert.ok(result.checks.skillJsonPath.endsWith("/skill.json"));
      assert.ok(result.checks.skillFilePath.endsWith("/SKILL.md"));
      assert.ok(result.checks.scriptPaths.some((file) => file.endsWith("/run.js")));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects skills that omit androperator-skill-type frontmatter", async () => {
    const temp = await createTempValidationSkillRepo({ skillId: "com.test.missing-skill-type" });

    try {
      await writeFile(join(temp.root, "skills", "com.test.missing-skill-type", "SKILL.md"), "# Missing frontmatter\n", "utf8");
      const result = await validateSkill("com.test.missing-skill-type", temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /missing required androperator-skill-type frontmatter/i);
      assert.deepStrictEqual(result.details?.missingFields, ["androperator-skill-type"]);
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects unrecognized androperator-skill-type values", async () => {
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.invalid-skill-type",
      skillType: "unknown",
    });

    try {
      const result = await validateSkill("com.test.invalid-skill-type", temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /unsupported androperator-skill-type/i);
      assert.match(result.details?.reason ?? "", /unknown/);
    } finally {
      await temp.cleanup();
    }
  });

  it("accepts a valid androperator-skill-type of replay", async () => {
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.replay-skill-type",
      skillType: "replay",
    });

    try {
      const result = await validateSkill("com.test.replay-skill-type", temp.registryPath);
      assert.ok(result.ok, result.ok ? "" : result.message);
    } finally {
      await temp.cleanup();
    }
  });

  it("accepts a valid androperator-skill-type of orchestrated", async () => {
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.orchestrated-skill-type",
      skillType: "orchestrated",
    });

    try {
      const result = await validateSkill("com.test.orchestrated-skill-type", temp.registryPath);
      assert.ok(result.ok, result.ok ? "" : result.message);
    } finally {
      await temp.cleanup();
    }
  });

  it("preserves the allowlisted script compatibility path for au.com.polyaire.airtouch5.set-zone-state", async () => {
    const temp = await createTempValidationSkillRepo({
      skillId: "au.com.polyaire.airtouch5.set-zone-state",
      skillType: "script",
    });

    try {
      const result = await validateSkill("au.com.polyaire.airtouch5.set-zone-state", temp.registryPath);
      assert.ok(result.ok, result.ok ? "" : result.message);
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects non-allowlisted skills that declare androperator-skill-type: script", async () => {
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.script-skill-type",
      skillType: "script",
    });

    try {
      const result = await validateSkill("com.test.script-skill-type", temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /unsupported androperator-skill-type/i);
      assert.match(result.details?.reason ?? "", /replay or orchestrated/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("allows single-skill validation before generated indexes are regenerated", async () => {
    const staleEntry = {
      id: "com.test.stale-generated-index",
      applicationId: "com.test",
      intent: "temp",
      summary: "Old summary",
      path: "skills/com.test.stale-generated-index",
      skillFile: "skills/com.test.stale-generated-index/SKILL.md",
      scripts: ["skills/com.test.stale-generated-index/scripts/run.js"],
      artifacts: [],
    };
    const currentEntry = {
      ...staleEntry,
      summary: "New summary",
    };
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.stale-generated-index",
      registrySkills: [currentEntry],
      generatedSkills: [staleEntry],
    });

    try {
      await writeFile(
        join(temp.root, "skills", "com.test.stale-generated-index", "skill.json"),
        `${JSON.stringify(currentEntry, null, 2)}\n`,
        "utf8"
      );
      const result = await validateSkill("com.test.stale-generated-index", temp.registryPath);
      assert.ok(result.ok, result.ok ? "" : result.message);

      const allSkillsResult = await validateAllSkills(temp.registryPath);
      assert.ok(!allSkillsResult.ok);
      assert.strictEqual(allSkillsResult.code, SKILL_VALIDATION_FAILED);
      assert.strictEqual(allSkillsResult.details?.invalidCount, 1);
      assert.strictEqual(allSkillsResult.details?.failures.length, 1);
      assert.match(allSkillsResult.message, /generate_skill_indexes\.sh/);
      assert.match(allSkillsResult.details?.failures[0]?.details?.reason ?? "", /sha256 does not match the current file contents/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("does not fail generated index freshness on generatedAt-only churn", async () => {
    const entry = {
      id: "com.test.generated-at-only",
      applicationId: "com.test",
      intent: "temp",
      summary: "Generated-at churn",
      path: "skills/com.test.generated-at-only",
      skillFile: "skills/com.test.generated-at-only/SKILL.md",
      scripts: ["skills/com.test.generated-at-only/scripts/run.js"],
      artifacts: [],
    };
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.generated-at-only",
      registrySkills: [entry],
      generatedSkills: [entry],
    });

    try {
      await writeFile(
        join(temp.root, "skills", "com.test.generated-at-only", "skill.json"),
        `${JSON.stringify(entry, null, 2)}\n`,
        "utf8"
      );
      const generatedRoot = join(temp.root, "skills", "generated");
      const minIndexContents = `${JSON.stringify({
        schemaVersion: "1.0",
        generatedAt: "2030-01-01T00:00:00Z",
        count: 1,
        skills: [{
          id: entry.id,
          applicationId: entry.applicationId,
          intent: entry.intent,
          summary: entry.summary,
          path: entry.path,
        }],
      }, null, 2)}\n`;
      const byAppContents = `${JSON.stringify({
        schemaVersion: "1.0",
        generatedAt: "2030-01-01T00:00:00Z",
        applicationId: "com.test",
        count: 1,
        skills: [entry],
      }, null, 2)}\n`;
      const byPrefixContents = `${JSON.stringify({
        schemaVersion: "1.0",
        generatedAt: "2030-01-01T00:00:00Z",
        prefix: getGeneratedPrefixShard(entry.id),
        count: 1,
        skills: [entry],
      }, null, 2)}\n`;
      await writeFile(
        join(generatedRoot, "skills-index.min.json"),
        minIndexContents,
        "utf8"
      );
      await writeFile(
        join(generatedRoot, "manifest.json"),
        `${JSON.stringify({
          schemaVersion: "1.0",
          generatedAt: "2030-01-01T00:00:00Z",
          totalSkills: 1,
          artifacts: {
            registry: {
              file: "skills/skills-registry.json",
              sha256: createHash("sha256").update(
                `${JSON.stringify({ $schema: "./skills-registry.schema.json", schemaVersion: "1.0", generatedAt: "2026-04-19T00:00:00Z", skills: [entry] }, null, 2)}\n`
              ).digest("hex"),
              count: 1,
            },
            minIndex: { file: "skills/generated/skills-index.min.json", sha256: createHash("sha256").update(minIndexContents).digest("hex"), count: 1 },
            jsonlIndex: {
              file: "skills/generated/skills-index.jsonl",
              sha256: createHash("sha256").update(`${JSON.stringify(entry)}\n`).digest("hex"),
              count: 1,
            },
          },
          shards: {
            byApp: [{
              applicationId: "com.test",
              file: "skills/generated/by-app/com.test.json",
              sha256: createHash("sha256").update(byAppContents).digest("hex"),
              count: 1,
            }],
            byPrefix: [{
              prefix: getGeneratedPrefixShard(entry.id),
              file: `skills/generated/by-prefix/${getGeneratedPrefixShard(entry.id)}.json`,
              sha256: createHash("sha256").update(byPrefixContents).digest("hex"),
              count: 1,
            }],
          },
        }, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        join(generatedRoot, "by-app", "com.test.json"),
        byAppContents,
        "utf8"
      );
      await writeFile(
        join(generatedRoot, "by-prefix", `${getGeneratedPrefixShard(entry.id)}.json`),
        byPrefixContents,
        "utf8"
      );

      const result = await validateSkill("com.test.generated-at-only", temp.registryPath);
      assert.ok(result.ok, result.ok ? "" : result.message);
    } finally {
      await temp.cleanup();
    }
  });

  it("fails generated index freshness when manifest sha256 values drift", async () => {
    const entry = {
      id: "com.test.manifest-sha-drift",
      applicationId: "com.test",
      intent: "temp",
      summary: "Manifest checksum drift",
      path: "skills/com.test.manifest-sha-drift",
      skillFile: "skills/com.test.manifest-sha-drift/SKILL.md",
      scripts: ["skills/com.test.manifest-sha-drift/scripts/run.js"],
      artifacts: [],
    };
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.manifest-sha-drift",
      registrySkills: [entry],
      generatedSkills: [entry],
    });

    try {
      const manifestPath = join(temp.root, "skills", "generated", "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        artifacts: { minIndex: { sha256: string } };
      };
      manifest.artifacts.minIndex.sha256 = "deadbeef";
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const result = await validateAllSkills(temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /generate_skill_indexes\.sh/i);
      assert.match(result.details?.failures[0]?.details?.reason ?? "", /sha256 does not match the current file contents/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects invalid manifest file paths instead of reading outside the repo", async () => {
    const entry = {
      id: "com.test.manifest-path-traversal",
      applicationId: "com.test",
      intent: "temp",
      summary: "Manifest path traversal",
      path: "skills/com.test.manifest-path-traversal",
      skillFile: "skills/com.test.manifest-path-traversal/SKILL.md",
      scripts: ["skills/com.test.manifest-path-traversal/scripts/run.js"],
      artifacts: [],
    };
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.manifest-path-traversal",
      registrySkills: [entry],
      generatedSkills: [entry],
    });

    try {
      const manifestPath = join(temp.root, "skills", "generated", "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        artifacts: { registry: { file: string } };
      };
      manifest.artifacts.registry.file = "/etc/passwd";
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const result = await validateAllSkills(temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /generate_skill_indexes\.sh/i);
      assert.match(result.details?.failures[0]?.details?.reason ?? "", /invalid file path/i);
      assert.match(result.details?.failures[0]?.details?.reason ?? "", /\/etc\/passwd/);
    } finally {
      await temp.cleanup();
    }
  });

  it("accepts regenerated indexes when registry content and generated outputs match", async () => {
    const entry = {
      id: "com.test.fresh-generated-index",
      applicationId: "com.test",
      intent: "temp",
      summary: "Fresh generated index",
      path: "skills/com.test.fresh-generated-index",
      skillFile: "skills/com.test.fresh-generated-index/SKILL.md",
      scripts: ["skills/com.test.fresh-generated-index/scripts/run.js"],
      artifacts: [],
    };
    const temp = await createTempValidationSkillRepo({
      skillId: "com.test.fresh-generated-index",
      registrySkills: [entry],
      generatedSkills: [entry],
    });

    try {
      await writeFile(
        join(temp.root, "skills", "com.test.fresh-generated-index", "skill.json"),
        `${JSON.stringify(entry, null, 2)}\n`,
        "utf8"
      );
      const result = await validateSkill("com.test.fresh-generated-index", temp.registryPath);
      assert.ok(result.ok, result.ok ? "" : result.message);
    } finally {
      await temp.cleanup();
    }
  });

  it("treats reordered equivalent keywords as matching metadata", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-keyword-parity-"));
    const skillsDir = join(tempRoot, "skills");
    const skillDir = join(skillsDir, "com.test.keyword-parity");
    const registryPath = join(skillsDir, "skills-registry.json");
    const entry = {
      id: "com.test.keyword-parity",
      applicationId: "com.test",
      intent: "keyword-parity",
      summary: "Keyword parity skill",
      keywords: ["google home", "hvac", "aircon"],
      path: "skills/com.test.keyword-parity",
      skillFile: "skills/com.test.keyword-parity/SKILL.md",
      scripts: ["skills/com.test.keyword-parity/scripts/run.js"],
      artifacts: [],
    };

    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(skillDir, "scripts", "run.js")
    );
    await writeFile(registryPath, `${JSON.stringify({ skills: [entry] }, null, 2)}\n`, "utf8");
    await writeFile(
      join(skillDir, "skill.json"),
      `${JSON.stringify({
        ...entry,
        keywords: ["aircon", "Google Home", "hvac"],
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown("com.test.keyword-parity"), "utf8");

    try {
      const result = await validateSkill("com.test.keyword-parity", registryPath);
      if (!result.ok) assert.fail(result.message);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("still passes invalid artifact payloads without dry-run", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-artifact-"));
    const skillsDir = join(tempRoot, "skills");
    const skillDir = join(skillsDir, "com.test.artifact");
    const registryPath = join(skillsDir, "skills-registry.json");
    const entry = {
      id: "com.test.artifact",
      applicationId: "com.test",
      intent: "artifact",
      summary: "Artifact-backed skill",
      path: "skills/com.test.artifact",
      skillFile: "skills/com.test.artifact/SKILL.md",
      scripts: ["skills/com.test.artifact/scripts/run.js"],
      artifacts: ["skills/com.test.artifact/artifacts/bad.json"],
    };

    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await mkdir(join(skillDir, "artifacts"), { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(skillDir, "scripts", "run.js")
    );
    await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown("com.test.artifact"), "utf8");
    await writeFile(
      join(skillDir, "artifacts", "bad.json"),
      `${JSON.stringify({
        commandId: "cmd",
        taskId: "task",
        source: "skill",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [
          { id: "snap", type: "snapshot_ui", params: { format: "ascii" } },
        ],
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(registryPath, `${JSON.stringify({ skills: [entry] }, null, 2)}\n`, "utf8");
    await writeFile(join(skillDir, "skill.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");

    try {
      const result = await validateSkill("com.test.artifact", registryPath);
      if (!result.ok) assert.fail(result.message);
      assert.ok(result.checks.artifactPaths.some((file) => file.endsWith("/bad.json")));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns SKILL_VALIDATION_FAILED when a referenced file is missing", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-"));
    const skillsDir = join(tempRoot, "skills");
    const skillDir = join(skillsDir, "com.test.invalid");
    const registryPath = join(skillsDir, "skills-registry.json");
    const entry = {
      id: "com.test.invalid",
      applicationId: "com.test",
      intent: "invalid",
      summary: "Broken skill",
      path: "skills/com.test.invalid",
      skillFile: "skills/com.test.invalid/SKILL.md",
      scripts: ["skills/com.test.invalid/scripts/run.js"],
      artifacts: [],
    };

    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(skillDir, "scripts", "run.js")
    );
    await writeFile(registryPath, `${JSON.stringify({ skills: [entry] }, null, 2)}\n`, "utf8");
    await writeFile(join(skillDir, "skill.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");

    try {
      const result = await validateSkill("com.test.invalid", registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.ok(result.details?.missingFiles?.some((file) => file.endsWith("/SKILL.md")));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects registry entries that omit the scripts array", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-missing-scripts-"));
    const skillsDir = join(tempRoot, "skills");
    const skillDir = join(skillsDir, "com.test.missing-scripts");
    const registryPath = join(skillsDir, "skills-registry.json");
    const entry = {
      id: "com.test.missing-scripts",
      applicationId: "com.test",
      intent: "missing-scripts",
      summary: "Broken skill",
      path: "skills/com.test.missing-scripts",
      skillFile: "skills/com.test.missing-scripts/SKILL.md",
      artifacts: [],
    };

    await mkdir(skillDir, { recursive: true });
    await writeFile(registryPath, `${JSON.stringify({ skills: [entry] }, null, 2)}\n`, "utf8");
    await writeFile(
      join(skillDir, "skill.json"),
      `${JSON.stringify({
        id: "com.test.missing-scripts",
        applicationId: "com.test",
        intent: "missing-scripts",
        summary: "Broken skill",
        path: "skills/com.test.missing-scripts",
        skillFile: "skills/com.test.missing-scripts/SKILL.md",
        artifacts: [],
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown("com.test.invalid"), "utf8");

    try {
      const result = await validateSkill("com.test.missing-scripts", registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.deepStrictEqual(result.details?.missingFields, ["scripts"]);
      assert.strictEqual(result.details?.mismatchFields, undefined);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects registry entries whose keywords are not a string array", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-bad-registry-keywords-"));
    const skillsDir = join(tempRoot, "skills");
    const skillDir = join(skillsDir, "com.test.bad-registry-keywords");
    const registryPath = join(skillsDir, "skills-registry.json");
    const entry = {
      id: "com.test.bad-registry-keywords",
      applicationId: "com.test",
      intent: "bad-registry-keywords",
      summary: "Broken skill",
      keywords: ["ok", 123],
      path: "skills/com.test.bad-registry-keywords",
      skillFile: "skills/com.test.bad-registry-keywords/SKILL.md",
      scripts: ["skills/com.test.bad-registry-keywords/scripts/run.js"],
      artifacts: [],
    };

    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(skillDir, "scripts", "run.js")
    );
    await writeFile(registryPath, `${JSON.stringify({ skills: [entry] }, null, 2)}\n`, "utf8");
    await writeFile(
      join(skillDir, "skill.json"),
      `${JSON.stringify({
        ...entry,
        keywords: ["ok"],
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown("com.test.bad-registry-keywords"), "utf8");

    try {
      const result = await validateSkill("com.test.bad-registry-keywords", registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /invalid keywords value/);
      assert.strictEqual(result.details?.reason, "keywords must be an array of strings when present");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects skill.json keywords that are not a string array", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-bad-manifest-keywords-"));
    const skillsDir = join(tempRoot, "skills");
    const skillDir = join(skillsDir, "com.test.bad-manifest-keywords");
    const registryPath = join(skillsDir, "skills-registry.json");
    const entry = {
      id: "com.test.bad-manifest-keywords",
      applicationId: "com.test",
      intent: "bad-manifest-keywords",
      summary: "Broken skill",
      keywords: ["ok"],
      path: "skills/com.test.bad-manifest-keywords",
      skillFile: "skills/com.test.bad-manifest-keywords/SKILL.md",
      scripts: ["skills/com.test.bad-manifest-keywords/scripts/run.js"],
      artifacts: [],
    };

    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(skillDir, "scripts", "run.js")
    );
    await writeFile(registryPath, `${JSON.stringify({ skills: [entry] }, null, 2)}\n`, "utf8");
    await writeFile(
      join(skillDir, "skill.json"),
      `${JSON.stringify({
        ...entry,
        keywords: ["ok", { bad: true }],
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown("com.test.bad-manifest-keywords"), "utf8");

    try {
      const result = await validateSkill("com.test.bad-manifest-keywords", registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /invalid skill\.json keywords value/);
      assert.strictEqual(result.details?.reason, "keywords must be an array of strings when present");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns SKILL_VALIDATION_FAILED when skill.json is malformed JSON", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-bad-json-"));
    const skillsDir = join(tempRoot, "skills");
    const skillId = "com.test.invalid-skill-json";
    const skillDir = join(skillsDir, skillId);
    const scriptsDir = join(skillDir, "scripts");
    const registryPath = join(skillsDir, "skills-registry.json");

    await mkdir(scriptsDir, { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(scriptsDir, "echo.js")
    );
    await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(skillId), "utf8");
    await writeFile(join(skillDir, "skill.json"), "{\n  \"id\": \"broken\"\n", "utf8");
    await writeFile(
      registryPath,
      `${JSON.stringify({
        skills: [
          {
            id: skillId,
            applicationId: "com.test",
            intent: "temp",
            summary: "Temporary test skill",
            path: `skills/${skillId}`,
            skillFile: `skills/${skillId}/SKILL.md`,
            scripts: [`skills/${skillId}/scripts/echo.js`],
            artifacts: [],
          },
        ],
      }, null, 2)}\n`,
      "utf8"
    );

    try {
      const result = await validateSkill(skillId, registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /invalid skill\.json payload/i);
      assert.strictEqual(result.details?.skillJsonPath, join(skillDir, "skill.json"));
      assert.match(result.details?.reason ?? "", /json/i);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects path traversal in registry-relative skill metadata", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-traversal-"));
    const skillsDir = join(tempRoot, "skills");
    const registryPath = join(skillsDir, "skills-registry.json");

    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      registryPath,
      `${JSON.stringify({
        skills: [
          {
            id: "com.test.path-traversal",
            applicationId: "com.test",
            intent: "temp",
            summary: "Temporary test skill",
            path: "../outside-skill",
            skillFile: "../outside-skill/SKILL.md",
            scripts: ["../outside-skill/scripts/echo.js"],
            artifacts: [],
          },
        ],
      }, null, 2)}\n`,
      "utf8"
    );

    try {
      const result = await validateSkill("com.test.path-traversal", registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, REGISTRY_READ_FAILED);
      assert.match(result.message, /parent directory traversal/i);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("skills validate dry-run", () => {
  it("passes a valid artifact-backed skill", async () => {
    const { stdout, stderr, code } = await runCli([
      "skills",
      "validate",
      TEST_SKILL_VALID_ARTIFACT,
      "--dry-run",
      "--output",
      "json",
    ]);
    assert.strictEqual(code, 0, stdout);
    assert.strictEqual(stderr, "");
    const parsed = JSON.parse(stdout) as { valid?: boolean; dryRun?: unknown };
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.dryRun, undefined);
  });

  it("fails an invalid artifact-backed skill with PRD-2 details", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "validate",
      TEST_SKILL_INVALID_ARTIFACT,
      "--dry-run",
      "--output",
      "json",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as {
      code?: string;
      message?: string;
      details?: {
        artifact?: string;
        actionId?: string;
        actionType?: string;
        invalidKeys?: string[];
        hint?: string;
      };
    };
    assert.strictEqual(parsed.code, SKILL_VALIDATION_FAILED);
    assert.match(parsed.message ?? "", /artifact payload schema violation/);
    assert.strictEqual(parsed.details?.artifact, "artifact.json");
    assert.strictEqual(parsed.details?.actionId, "snap");
    assert.strictEqual(parsed.details?.actionType, "snapshot_ui");
    assert.deepStrictEqual(parsed.details?.invalidKeys, ["format"]);
    assert.match(parsed.details?.hint ?? "", /removed from snapshot/);
  });

  it("skips payload validation for script-only skills and logs the reason in pretty mode", async () => {
    for (const skillId of [TEST_SKILL_SCRIPT_ONLY, TEST_SKILL_EMPTY_ARTIFACTS]) {
      const { stdout, stderr, code } = await runCli([
        "skills",
        "validate",
        skillId,
        "--dry-run",
        "--output",
        "pretty",
      ]);
      assert.strictEqual(code, 0, stdout);
      assert.match(stderr, /Payload validation skipped: no pre-compiled artifacts/);
      const parsed = JSON.parse(stdout) as {
        valid?: boolean;
        dryRun?: { payloadValidation?: string; reason?: string };
      };
      assert.strictEqual(parsed.valid, true);
      assert.strictEqual(parsed.dryRun?.payloadValidation, "skipped");
      assert.strictEqual(
        parsed.dryRun?.reason,
        "skill has no pre-compiled artifacts; payload is generated at runtime by the skill script"
      );
    }
  });

  it("emits cli.validation when pretty-mode payload validation is skipped", async () => {
    const tempLogDir = await mkdtemp(join(tmpdir(), "androperator-validation-logs-"));
    try {
      const { stdout, stderr, code } = await runCli([
        "skills",
        "validate",
        TEST_SKILL_SCRIPT_ONLY,
        "--dry-run",
        "--log-level",
        "debug",
        "--output",
        "pretty",
      ], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
          ANDROPERATOR_LOG_DIR: tempLogDir,
        },
      });

      assert.strictEqual(code, 0, stdout);
      assert.match(stderr, /Payload validation skipped: no pre-compiled artifacts/);
      const contents = await readFile(getLogPathForDir(tempLogDir), "utf8");
      const events = parseLogEvents(contents);
      const validationEvent = events.find((event) => event.event === "cli.validation");
      assert.ok(validationEvent, "Expected cli.validation to be logged");
      assert.strictEqual(validationEvent?.skillId, TEST_SKILL_SCRIPT_ONLY);
      assert.strictEqual(validationEvent?.level, "debug");
    } finally {
      await rm(tempLogDir, { recursive: true, force: true });
    }
  });

  it("emits cli.validation in JSON mode when payload validation is skipped", async () => {
    const tempLogDir = await mkdtemp(join(tmpdir(), "androperator-validation-json-logs-"));
    try {
      const { stdout, stderr, code } = await runCli([
        "skills",
        "validate",
        TEST_SKILL_SCRIPT_ONLY,
        "--dry-run",
        "--log-level",
        "debug",
        "--output",
        "json",
      ], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
          ANDROPERATOR_LOG_DIR: tempLogDir,
        },
      });

      assert.strictEqual(code, 0, stdout);
      assert.ok(!stderr.includes("Payload validation skipped"), stderr);
      const contents = await readFile(getLogPathForDir(tempLogDir), "utf8");
      const events = parseLogEvents(contents);
      const validationEvent = events.find((event) => event.event === "cli.validation");
      assert.ok(validationEvent, "Expected cli.validation to be logged");
      assert.strictEqual(validationEvent?.skillId, TEST_SKILL_SCRIPT_ONLY);
      assert.strictEqual(validationEvent?.level, "debug");
    } finally {
      await rm(tempLogDir, { recursive: true, force: true });
    }
  });

  it("emits cli.validation for script-only skills in bulk dry-run validation", async () => {
    const tempLogDir = await mkdtemp(join(tmpdir(), "androperator-validate-all-json-logs-"));
    const tempRegistryRoot = await mkdtemp(join(tmpdir(), "androperator-validate-all-registry-"));
    try {
      const tempRegistryDir = join(tempRegistryRoot, "skills");
      const tempSkillDir = join(tempRegistryDir, TEST_SKILL_SCRIPT_ONLY);
      await mkdir(join(tempSkillDir, "scripts"), { recursive: true });
      await copyFile(
        join(packageRoot, "src", "test", "fixtures", "skills", TEST_SKILL_SCRIPT_ONLY, "scripts", "run.js"),
        join(tempSkillDir, "scripts", "run.js")
      );
      await copyFile(
        join(packageRoot, "src", "test", "fixtures", "skills", TEST_SKILL_SCRIPT_ONLY, "SKILL.md"),
        join(tempSkillDir, "SKILL.md")
      );
      const skillJsonRaw = await readFile(
        join(packageRoot, "src", "test", "fixtures", "skills", TEST_SKILL_SCRIPT_ONLY, "skill.json"),
        "utf8"
      );
      const skillJson = JSON.parse(skillJsonRaw) as { artifacts?: unknown[] };
      const registrySkillJson = { ...skillJson, artifacts: [] };
      await writeFile(
        join(tempSkillDir, "skill.json"),
        `${JSON.stringify(registrySkillJson, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        join(tempRegistryDir, "skills-registry.json"),
        `${JSON.stringify({ schemaVersion: "1", skills: [registrySkillJson] }, null, 2)}\n`,
        "utf8"
      );

      const { stdout, stderr, code } = await runCli([
        "skills",
        "validate",
        "--all",
        "--dry-run",
        "--log-level",
        "debug",
        "--output",
        "json",
      ], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: join(tempRegistryDir, "skills-registry.json"),
          ANDROPERATOR_LOG_DIR: tempLogDir,
        },
      });

      assert.strictEqual(code, 0, stdout);
      assert.ok(!stderr.includes("Payload validation skipped"), stderr);
      const contents = await readFile(getLogPathForDir(tempLogDir), "utf8");
      const events = parseLogEvents(contents);
      const validationEvent = events.find((event) => event.event === "cli.validation" && event.skillId === TEST_SKILL_SCRIPT_ONLY);
      assert.ok(validationEvent, "Expected cli.validation for script-only skills");
      assert.strictEqual(validationEvent?.level, "debug");
    } finally {
      await rm(tempRegistryRoot, { recursive: true, force: true });
      await rm(tempLogDir, { recursive: true, force: true });
    }
  });

  it("emits JSON-parseable output for dry-run success and failure", async () => {
    const success = await runCli([
      "skills",
      "validate",
      TEST_SKILL_VALID_ARTIFACT,
      "--dry-run",
      "--output",
      "json",
    ]);
    const failure = await runCli([
      "skills",
      "validate",
      TEST_SKILL_INVALID_ARTIFACT,
      "--dry-run",
      "--output",
      "json",
    ]);

    assert.doesNotThrow(() => JSON.parse(success.stdout));
    assert.doesNotThrow(() => JSON.parse(failure.stdout));
  });

  it("passes dry-run for a real bundled artifact-backed skill without a device", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "validate",
      "com.google.android.apps.chromecast.app.get-climate",
      "--dry-run",
      "--output",
      "json",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { valid?: boolean; skill?: { id?: string } };
    assert.strictEqual(parsed.valid, true);
    assert.strictEqual(parsed.skill?.id, "com.google.android.apps.chromecast.app.get-climate");
  });
});

describe("validateAllSkills", () => {
  it("returns a full success summary when every registry skill is valid", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-validate-all-valid-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    const alphaDir = join(registryDir, "com.example.alpha.capture");
    const betaDir = join(registryDir, "com.example.beta.capture");
    const alphaEntry = {
      id: "com.example.alpha.capture",
      applicationId: "com.example.alpha",
      intent: "capture",
      summary: "Capture alpha",
      path: "skills/com.example.alpha.capture",
      skillFile: "skills/com.example.alpha.capture/SKILL.md",
      scripts: ["skills/com.example.alpha.capture/scripts/run.js"],
      artifacts: [],
    };
    const betaEntry = {
      id: "com.example.beta.capture",
      applicationId: "com.example.beta",
      intent: "capture",
      summary: "Capture beta",
      path: "skills/com.example.beta.capture",
      skillFile: "skills/com.example.beta.capture/SKILL.md",
      scripts: ["skills/com.example.beta.capture/scripts/run.js"],
      artifacts: [],
    };

    await mkdir(join(alphaDir, "scripts"), { recursive: true });
    await mkdir(join(betaDir, "scripts"), { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(alphaDir, "scripts", "run.js")
    );
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(betaDir, "scripts", "run.js")
    );
    await writeFile(join(alphaDir, "SKILL.md"), makeSkillMarkdown("com.example.alpha.capture"), "utf8");
    await writeFile(join(betaDir, "SKILL.md"), makeSkillMarkdown("com.example.beta.capture"), "utf8");
    await writeFile(join(alphaDir, "skill.json"), `${JSON.stringify(alphaEntry, null, 2)}\n`, "utf8");
    await writeFile(join(betaDir, "skill.json"), `${JSON.stringify(betaEntry, null, 2)}\n`, "utf8");
    await writeFile(
      registryPath,
      `${JSON.stringify({ schemaVersion: "1", skills: [alphaEntry, betaEntry] }, null, 2)}\n`,
      "utf8"
    );

    try {
      const result = await validateAllSkills(registryPath);
      if (!result.ok) assert.fail(result.message);
      assert.strictEqual(result.totalSkills, 2);
      assert.strictEqual(result.validSkills.length, 2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns a summary of broken entries when one registry skill is invalid", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-validate-all-invalid-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    const validDir = join(registryDir, "com.example.valid.capture");
    const invalidDir = join(registryDir, "com.example.invalid.capture");
    const validEntry = {
      id: "com.example.valid.capture",
      applicationId: "com.example.valid",
      intent: "capture",
      summary: "Valid skill",
      path: "skills/com.example.valid.capture",
      skillFile: "skills/com.example.valid.capture/SKILL.md",
      scripts: ["skills/com.example.valid.capture/scripts/run.js"],
      artifacts: [],
    };
    const invalidEntry = {
      id: "com.example.invalid.capture",
      applicationId: "com.example.invalid",
      intent: "capture",
      summary: "Invalid skill",
      path: "skills/com.example.invalid.capture",
      skillFile: "skills/com.example.invalid.capture/SKILL.md",
      scripts: ["skills/com.example.invalid.capture/scripts/run.js"],
      artifacts: [],
    };

    await mkdir(join(validDir, "scripts"), { recursive: true });
    await mkdir(join(invalidDir, "scripts"), { recursive: true });
    await copyFile(
      join(packageRoot, "src", "test", "fixtures", "skills", "com.test.echo", "scripts", "echo.js"),
      join(validDir, "scripts", "run.js")
    );
    await writeFile(join(validDir, "SKILL.md"), makeSkillMarkdown("com.example.valid.capture"), "utf8");
    await writeFile(join(validDir, "skill.json"), `${JSON.stringify(validEntry, null, 2)}\n`, "utf8");
    await writeFile(join(invalidDir, "skill.json"), `${JSON.stringify(invalidEntry, null, 2)}\n`, "utf8");
    await writeFile(
      registryPath,
      `${JSON.stringify({ schemaVersion: "1", skills: [validEntry, invalidEntry] }, null, 2)}\n`,
      "utf8"
    );

    try {
      const result = await validateAllSkills(registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.strictEqual(result.details?.totalSkills, 2);
      assert.strictEqual(result.details?.validCount, 1);
      assert.strictEqual(result.details?.invalidCount, 1);
      assert.strictEqual(result.details?.failures[0]?.skillId, invalidEntry.id);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("compileArtifact", () => {
  it("returns COMPILE_VAR_MISSING when required placeholder missing", async () => {
    const result = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      "{}"
    );
    assert.ok(!result.ok);
    assert.strictEqual(result.code, COMPILE_VAR_MISSING);
    assert.ok(result.details && result.details.placeholder === "CLIMATE_TILE_NAME");
  });

  it("returns valid execution when vars include required placeholder", async () => {
    const result = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      '{"CLIMATE_TILE_NAME":"Master"}'
    );
    if (!result.ok) assert.fail(result.message);
    assert.strictEqual(result.execution.mode, "artifact_compiled");
    assert.ok(result.execution.commandId);
    assert.ok(result.execution.actions.length > 0);
  });

  it("escapes vars safely so quoted values keep compiled JSON valid", async () => {
    const result = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      "{\"CLIMATE_TILE_NAME\":\"Master \\\"Quoted\\\"\"}"
    );
    if (!result.ok) assert.fail(result.message);
    const openController = result.execution.actions.find((a) => a.id === "openController");
    assert.ok(openController);
    assert.strictEqual(openController.params?.matcher?.textContains, 'Master "Quoted"');
  });

  it("returns ARTIFACT_NOT_FOUND for wrong artifact name", async () => {
    const result = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "nonexistent-artifact",
      "{}"
    );
    assert.ok(!result.ok);
    assert.strictEqual(result.code, ARTIFACT_NOT_FOUND);
  });

  it("compile failure returns nested details (not flattened top-level)", async () => {
    const result = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      "{}"
    );
    assert.ok(!result.ok);
    assert.strictEqual(result.code, COMPILE_VAR_MISSING);
    assert.strictEqual(typeof result.message, "string");
    assert.ok(result.details && typeof result.details === "object");
    assert.strictEqual(result.details.placeholder, "CLIMATE_TILE_NAME");
    assert.ok("skillId" in result.details);
    assert.ok("artifactName" in result.details);
    const topLevelKeys = Object.keys(result as object).filter((k) => k !== "ok" && k !== "code" && k !== "message" && k !== "details");
    assert.strictEqual(topLevelKeys.length, 0, "diagnostic fields must be under details, not top-level");
  });

  it("accepts artifact name with .recipe.json suffix (same as bare name)", async () => {
    const r1 = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      '{"CLIMATE_TILE_NAME":"Master"}'
    );
    const r2 = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status.recipe.json",
      '{"CLIMATE_TILE_NAME":"Master"}'
    );
    if (!r1.ok || !r2.ok) assert.fail("Expected both to succeed");
    assert.strictEqual(JSON.stringify(r1.execution), JSON.stringify(r2.execution));
  });

  it("produces deterministic execution for identical inputs", async () => {
    const varsJson = '{"CLIMATE_TILE_NAME":"Master"}';
    const r1 = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      varsJson
    );
    const r2 = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      varsJson
    );

    if (!r1.ok || !r2.ok) {
      assert.fail(`Expected both compileArtifact calls to succeed (codes: ${!r1.ok ? r1.code : ""}, ${!r2.ok ? r2.code : ""})`);
    }

    const e1 = JSON.stringify(r1.execution);
    const e2 = JSON.stringify(r2.execution);
    assert.strictEqual(e1, e2);
  });

  it("preserves user-provided COMMAND_ID and TASK_ID", async () => {
    const varsJson = '{"CLIMATE_TILE_NAME":"Master","COMMAND_ID":"cmd-user-1","TASK_ID":"task-user-1"}';
    const result = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      varsJson
    );
    if (!result.ok) assert.fail(result.message);
    assert.strictEqual(result.execution.commandId, "cmd-user-1");
    assert.strictEqual(result.execution.taskId, "task-user-1");
    assert.strictEqual(result.execution.mode, "artifact_compiled");
  });

  it("is insensitive to vars key order", async () => {
    const v1 = '{"CLIMATE_TILE_NAME":"Master","EXTRA":"1"}';
    const v2 = '{"EXTRA":"1","CLIMATE_TILE_NAME":"Master"}';
    const r1 = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      v1
    );
    const r2 = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      v2
    );
    if (!r1.ok || !r2.ok) assert.fail("Expected both compileArtifact calls to succeed");
    const e1 = JSON.stringify(r1.execution);
    const e2 = JSON.stringify(r2.execution);
    assert.strictEqual(e1, e2);
  });

  it("CLI compile-artifact accepts --skill-id (same result as positional skill_id)", async () => {
    const skillId = "com.google.android.apps.chromecast.app.get-climate";
    const varsJson = '{"CLIMATE_TILE_NAME":"Master"}';
    const { stdout, code } = await runCli([
      "skills", "compile-artifact", "--skill-id", skillId, "--artifact", "climate-status", "--vars", varsJson, "--output", "json",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { execution?: { mode?: string; commandId?: string }; code?: string };
    assert.ok(parsed.execution, "CLI with --skill-id should return execution");
    assert.strictEqual(parsed.execution!.mode, "artifact_compiled");
    assert.ok(parsed.execution!.commandId);
    assert.strictEqual(parsed.code, undefined, "should not be an error response");
  });

  it("CLI compile-artifact returns USAGE when both skill_id and --artifact missing", async () => {
    const { stdout } = await runCli(["skills", "compile-artifact", "--output", "json"]);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "USAGE");
    assert.ok(parsed.message?.includes("skill_id") || parsed.message?.includes("--skill-id") || parsed.message?.includes("--artifact"));
  });

  it("CLI compile-artifact returns USAGE when --artifact missing", async () => {
    const { stdout } = await runCli([
      "skills", "compile-artifact", "com.google.android.apps.chromecast.app.get-climate", "--output", "json",
    ]);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "USAGE");
    assert.ok(parsed.message?.includes("--artifact"));
  });

  it("compile-artifact output is valid execution input (e2e: compile → execute contract)", async () => {
    const result = await compileArtifact(
      "com.google.android.apps.chromecast.app.get-climate",
      "climate-status",
      '{"CLIMATE_TILE_NAME":"Master"}',
      undefined
    );
    assert.ok(result.ok, result.ok ? "" : (result as { message?: string }).message);
    const execution = result.execution!;
    const validated = validateExecution(execution);
    assert.strictEqual(validated.commandId, execution.commandId);
    assert.ok(Array.isArray(validated.actions) && validated.actions.length > 0);
    validatePayloadSize(JSON.stringify(execution));
  });
});

describe("scaffoldSkill", () => {
  it("generated scripts preserve child streams and failure status", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-scaffold-status-"));
    try {
      const registryPath = join(tempRoot, "skills", "skills-registry.json");
      await mkdir(dirname(registryPath), { recursive: true });
      await copyFile(TEST_REGISTRY_PATH, registryPath);
      const result = await scaffoldSkill("com.example.demo.child-status", registryPath);
      if (!result.ok) assert.fail(result.message);
      const runJsPath = join(result.skillPath, "scripts", "run.js");
      const fakeCliPath = join(tempRoot, "fake child.js");
      const preloadPath = join(tempRoot, "preload.cjs");
      // Inject only the child runner for bounded timeout and impossible-status
      // cases; every case still executes the real generated script.
      await writeFile(preloadPath, `
const childProcess = require("node:child_process");
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  require("node:assert").strictEqual(options.timeout, 120000);
  if (process.env.SCAFFOLD_CASE === "unusable") {
    return { status: null, signal: null, stdout: Buffer.from("partial"), stderr: Buffer.from("diagnostic") };
  }
  return original(command, args, {
    ...options,
    ...(process.env.SCAFFOLD_CASE === "timeout" ? { timeout: 500 } : {}),
  });
};
`);
      const cases = [
        { name: "success", source: 'process.stdout.write(" unchanged\\n"); process.stderr.write("warning\\n");', code: 0, stdout: " unchanged\n", stderr: "warning\n" },
        { name: "json failure", source: 'process.stdout.write(\'{"ok":false}\\n\'); process.stderr.write("failure\\n"); process.exitCode = 7;', code: 7, stdout: '{"ok":false}\n', stderr: "failure\n" },
        { name: "text failure", source: 'process.stdout.write("not JSON"); process.stderr.write("diagnostic"); process.exitCode = 3;', code: 3, stdout: "not JSON", stderr: "diagnostic" },
        { name: "empty stdout", source: 'process.stderr.write("failure"); process.exitCode = 9;', code: 9, stdout: "", stderr: "failure" },
        { name: "signal", source: 'require("node:fs").writeSync(1, "partial"); require("node:fs").writeSync(2, "diagnostic"); process.kill(process.pid, "SIGTERM");', code: 1, stdout: "partial", stderr: /diagnosticandroperator execution failed: terminated by signal SIGTERM\n$/ },
        { name: "timeout", source: 'require("node:fs").writeSync(1, "partial"); require("node:fs").writeSync(2, "diagnostic"); setInterval(() => {}, 1000);', code: 1, stdout: "partial", stderr: /diagnosticandroperator execution failed: .*ETIMEDOUT\n$/ },
        { name: "missing", source: "", code: 1, stdout: "", stderr: /androperator execution failed: .*ENOENT\n$/ },
        { name: "unusable", source: "", code: 1, stdout: "partial", stderr: "diagnosticandroperator execution failed: unusable child exit status\n" },
      ];
      for (const scenario of cases) {
        await writeFile(fakeCliPath, scenario.source);
        const executionResult = await runNodeFile(runJsPath, ["test-device", "com.androperator.operator.dev"], {
          env: {
            ...process.env,
            NODE_OPTIONS: `--require="${preloadPath}"`,
            SCAFFOLD_CASE: scenario.name,
            ANDROPERATOR_BIN: scenario.name === "missing" ? join(tempRoot, "missing") : fakeCliPath,
          },
        });
        assert.strictEqual(executionResult.code, scenario.code, scenario.name + executionResult.stderr);
        assert.strictEqual(executionResult.stdout, scenario.stdout, scenario.name);
        if (typeof scenario.stderr === "string") {
          assert.strictEqual(executionResult.stderr, scenario.stderr, scenario.name);
        } else {
          assert.match(executionResult.stderr, scenario.stderr, scenario.name);
        }
      }
      const missingDevice = await runNodeFile(runJsPath, [], {
        env: { ...process.env, ANDROPERATOR_BIN: fakeCliPath },
      });
      assert.strictEqual(missingDevice.code, 1);
      assert.strictEqual(missingDevice.stdout, "");
      assert.match(missingDevice.stderr, /Usage: node run.js/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates a new skill folder and registry entry", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.demo.capture-state";
      const result = await scaffoldSkill(skillId, registryPath);
      if (!result.ok) assert.fail(result.message);

      assert.strictEqual(result.skillId, skillId);
      assert.ok(result.files.some((file) => file.endsWith("/skill.json")));
      assert.ok(result.files.some((file) => file.endsWith("/SKILL.md")));
      assert.ok(result.files.some((file) => file.endsWith("/scripts/run.js")));
      assert.ok(result.files.some((file) => file.endsWith("/scripts/run.sh")));

      const registryRaw = await readFile(registryPath, "utf8");
      const registry = JSON.parse(registryRaw);
      const entry = registry.skills.find((skill: { id: string }) => skill.id === skillId);
      assert.ok(entry);
      assert.strictEqual(entry.applicationId, "com.example.demo");
      assert.strictEqual(entry.intent, "capture-state");
      assert.deepStrictEqual(entry.scripts, [
        `skills/${skillId}/scripts/run.js`,
        `skills/${skillId}/scripts/run.sh`,
      ]);
      assert.deepStrictEqual(entry.artifacts, []);
      assert.deepStrictEqual(entry.contract, {
        inputs: {},
        goal: null,
        verification: null,
      });

      const runShPath = join(tempRoot, "skills", skillId, "scripts", "run.sh");
      const runJsPath = join(tempRoot, "skills", skillId, "scripts", "run.js");
      const runShContent = await readFile(runShPath, "utf8");
      const runJsContent = await readFile(runJsPath, "utf8");
      const skillMarkdown = await readFile(join(tempRoot, "skills", skillId, "SKILL.md"), "utf8");
      const runShStats = await stat(runShPath);
      assert.match(runShContent, /node "\$DIR\/run\.js" "\$@"/);
      assert.match(runJsContent, /resolveAndroperatorBin/);
      assert.match(runJsContent, /resolveOperatorPackage/);
      assert.match(runJsContent, /getLocalAndroperatorCliPath/);
      assert.doesNotMatch(runJsContent, /\.\.\/\.\.\/utils\/common\.js/);
      assert.doesNotMatch(runJsContent, /execFileSync\(\s*"androperator"/);
      assert.match(skillMarkdown, /androperator-skill-type: replay/);
      assert.ok((runShStats.mode & 0o111) !== 0, `Expected run.sh to be executable, mode=${runShStats.mode.toString(8)}`);

      const skillJson = JSON.parse(await readFile(join(tempRoot, "skills", skillId, "skill.json"), "utf8"));
      assert.deepStrictEqual(skillJson.contract, {
        inputs: {},
        goal: null,
        verification: null,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scaffolded run.js preserves backslashes in quoted ANDROPERATOR_BIN command specs", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-windows-bin-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.demo.capture-windows-bin";
      const result = await scaffoldSkill(skillId, registryPath);
      if (!result.ok) assert.fail(result.message);

      const runJsPath = join(tempRoot, "skills", skillId, "scripts", "run.js");
      const fakeNodePath = join(tempRoot, "C:\\Program Files\\nodejs\\node.exe");
      const fakeCliPath = join(tempRoot, "C:\\androperator apps\\node\\dist\\cli\\index.js");

      await writeFile(fakeNodePath, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, "utf8");
      await chmod(fakeNodePath, 0o755);
      await writeFile(
        fakeCliPath,
        "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));\n",
        "utf8"
      );

      const executionResult = await runNodeFile(runJsPath, ["device-123"], {
        env: {
          ...process.env,
          ANDROPERATOR_BIN: `"${fakeNodePath}" "${fakeCliPath}"`,
        },
      });

      assert.strictEqual(executionResult.code, 0, executionResult.stderr);
      const parsed = JSON.parse(executionResult.stdout) as { argv?: string[] };
      assert.deepStrictEqual(parsed.argv?.slice(0, 4), ["exec", "--device", "device-123", "--operator-package"]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scaffolded run.js prefers a local build over the global androperator binary when ANDROPERATOR_BIN is unset", async () => {
    const outerRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-local-cli-"));
    const tempRoot = join(outerRoot, "repo");
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.demo.capture-local-cli";
      const result = await scaffoldSkill(skillId, registryPath);
      if (!result.ok) assert.fail(result.message);

      const runJsPath = join(tempRoot, "skills", skillId, "scripts", "run.js");
      const fakeCliPath = join(tempRoot, "apps", "node", "dist", "cli", "index.js");
      await mkdir(dirname(fakeCliPath), { recursive: true });
      await writeFile(
        fakeCliPath,
        "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));\n",
        "utf8"
      );

      const executionResult = await runNodeFile(runJsPath, ["device-456"], {
        env: {
          ...process.env,
          ANDROPERATOR_BIN: "",
        },
      });

      assert.strictEqual(executionResult.code, 0, executionResult.stderr);
      const parsed = JSON.parse(executionResult.stdout) as { argv?: string[] };
      assert.deepStrictEqual(parsed.argv?.slice(0, 4), ["exec", "--device", "device-456", "--operator-package"]);
    } finally {
      await rm(outerRoot, { recursive: true, force: true });
    }
  });

  it("uses a provided summary in skill.json and SKILL.md", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-summary-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.notes.capture-summary";
      const summary = "Capture the current Notes screen summary";
      const result = await scaffoldSkill(skillId, { registryPath, summary });
      if (!result.ok) assert.fail(result.message);

      const skillJson = JSON.parse(await readFile(join(tempRoot, "skills", skillId, "skill.json"), "utf8"));
      const skillMarkdown = await readFile(join(tempRoot, "skills", skillId, "SKILL.md"), "utf8");

      assert.strictEqual(skillJson.summary, summary);
      assert.match(skillMarkdown, /description: \|-\n/);
      assert.match(
        skillMarkdown,
        new RegExp(`\\n  ${summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n---\\n`)
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses the default summary when one is not provided", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-default-summary-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.camera.capture-default";
      const expectedSummary = `TODO: describe ${skillId}`;
      const result = await scaffoldSkill(skillId, { registryPath });
      if (!result.ok) assert.fail(result.message);

      const skillJson = JSON.parse(await readFile(join(tempRoot, "skills", skillId, "skill.json"), "utf8"));
      const skillMarkdown = await readFile(join(tempRoot, "skills", skillId, "SKILL.md"), "utf8");

      assert.strictEqual(skillJson.summary, expectedSummary);
      assert.match(skillMarkdown, /description: \|-\n/);
      assert.match(
        skillMarkdown,
        new RegExp(`\\n  ${expectedSummary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n---\\n`)
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("copies recording context verbatim when provided", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-recording-context-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    const recordingContextPath = join(tempRoot, "recording-context.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);
    await writeFile(recordingContextPath, VALID_RECORDING_EXPORT_JSON, "utf8");

    try {
      const skillId = "com.example.notes.capture-recording-context";
      const result = await scaffoldSkill(skillId, { registryPath, recordingContextPath });
      if (!result.ok) assert.fail(result.message);

      assert.strictEqual(result.recordingContextPath, join(tempRoot, "skills", skillId, "recording-context.json"));
      assert.ok(result.files.some((file) => file.endsWith("/recording-context.json")));

      const copied = await readFile(join(tempRoot, "skills", skillId, "recording-context.json"), "utf8");
      assert.strictEqual(copied, await readFile(recordingContextPath, "utf8"));

      const skillMarkdown = await readFile(join(tempRoot, "skills", skillId, "SKILL.md"), "utf8");
      assert.match(skillMarkdown, /## Recording Context/);
      assert.match(skillMarkdown, /This skill was scaffolded with recording context/);
      assert.match(skillMarkdown, /Usage:/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects blank recording context paths", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-recording-context-blank-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const result = await scaffoldSkill("com.example.notes.capture-blank", { registryPath, recordingContextPath: "   " });
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILLS_SCAFFOLD_FAILED);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects recording context files that are not recording export artifacts", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-recording-context-invalid-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    const recordingContextPath = join(tempRoot, "not-a-recording-export.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);
    await writeFile(recordingContextPath, "{\"not\":\"a recording export\"}\n", "utf8");

    try {
      const result = await scaffoldSkill("com.example.notes.capture-invalid", { registryPath, recordingContextPath });
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILLS_SCAFFOLD_FAILED);
      assert.match(result.message, /recording export artifact schema/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("removes a partial scaffold when recording context copy fails", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-recording-context-missing-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.notes.capture-missing-recording-context";
      const result = await scaffoldSkill(skillId, {
        registryPath,
        recordingContextPath: join(tempRoot, "does-not-exist.json"),
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILLS_SCAFFOLD_FAILED);
      await assert.rejects(
        () => stat(join(tempRoot, "skills", skillId)),
        /ENOENT/
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("supports multi-line summaries without breaking YAML frontmatter", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-multiline-summary-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.multiline.capture";
      const summary = "Line1\nLine2: has colon\n- list-looking line\n# looks like a comment";
      const result = await scaffoldSkill(skillId, { registryPath, summary });
      if (!result.ok) assert.fail(result.message);

      const skillMarkdown = await readFile(join(tempRoot, "skills", skillId, "SKILL.md"), "utf8");

      // Ensure YAML uses a block scalar and preserves lines with indentation.
      assert.match(skillMarkdown, /description: \|-\n/);
      assert.match(skillMarkdown, /\n  Line1\n  Line2: has colon\n  - list-looking line\n  # looks like a comment\n---\n/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not indent empty lines in YAML block scalars", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-empty-lines-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.empty-lines.capture";
      const summary = "Line1\n\nLine3";
      const result = await scaffoldSkill(skillId, { registryPath, summary });
      if (!result.ok) assert.fail(result.message);

      const skillMarkdown = await readFile(join(tempRoot, "skills", skillId, "SKILL.md"), "utf8");

      // Empty line should remain empty, not contain indentation spaces.
      assert.ok(skillMarkdown.includes("description: |-\n  Line1\n\n  Line3\n---\n"), skillMarkdown);
      assert.ok(!skillMarkdown.includes("\n  \n"), "Expected no trailing spaces on empty lines");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats null summary like an omitted summary", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-scaffold-null-summary-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.null-summary.capture";
      const expectedSummary = `TODO: describe ${skillId}`;
      const result = await scaffoldSkill(skillId, { registryPath, summary: null as unknown as string });
      if (!result.ok) assert.fail(result.message);

      const skillJson = JSON.parse(await readFile(join(tempRoot, "skills", skillId, "skill.json"), "utf8"));
      const skillMarkdown = await readFile(join(tempRoot, "skills", skillId, "SKILL.md"), "utf8");

      assert.strictEqual(skillJson.summary, expectedSummary);
      assert.match(skillMarkdown, /description: \|-\n/);
      assert.match(
        skillMarkdown,
        new RegExp(`\\n  ${expectedSummary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n---\\n`)
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid skill ids", async () => {
    const result = await scaffoldSkill("invalid-skill-id", TEST_REGISTRY_PATH);
    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_ID_INVALID);
  });

  it("rejects duplicate skill ids", async () => {
    const result = await scaffoldSkill("com.android.settings.capture-overview", TEST_REGISTRY_PATH);
    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_ALREADY_EXISTS);
  });

  it("CLI skills new scaffolds a local skill into the configured registry", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-cli-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.weather.read-summary";
      const { stdout, code } = await runCli(
        ["skills", "new", skillId, "--summary", "Read the current weather summary", "--output", "json"],
        {
          env: {
            ...process.env,
            ANDROPERATOR_SKILLS_REGISTRY: registryPath,
          },
        }
      );

      assert.strictEqual(code, 0, stdout);
      const parsed = JSON.parse(stdout) as { created?: boolean; skillId?: string; skillPath?: string; next?: string; files?: string[] };
      assert.strictEqual(parsed.created, true);
      assert.strictEqual(parsed.skillId, skillId);
      assert.ok(parsed.skillPath?.endsWith(`/skills/${skillId}`));
      assert.ok(parsed.files?.some((file) => file.endsWith("/scripts/run.sh")));
      assert.strictEqual(
        parsed.next,
        "Edit `SKILL.md` and `scripts/run.js`, then run `androperator skills validate <skill_id>`; if this repo uses generated indexes, rerun `scripts/generate_skill_indexes.sh` and `androperator skills validate --all`"
      );

      const registryRaw = await readFile(registryPath, "utf8");
      const registry = JSON.parse(registryRaw);
      const entry = registry.skills.find((skill: { id: string }) => skill.id === skillId);
      assert.ok(entry);
      assert.strictEqual(entry.summary, "Read the current weather summary");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CLI skills new copies recording context into the scaffolded skill", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-cli-recording-context-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    const recordingContextPath = join(tempRoot, "recording-context.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);
    await writeFile(recordingContextPath, VALID_RECORDING_EXPORT_JSON, "utf8");

    try {
      const skillId = "com.example.weather.read-recording-context";
      const { stdout, code } = await runCli(
        [
          "skills",
          "new",
          skillId,
          "--summary",
          "Read the current weather summary",
          "--recording-context",
          recordingContextPath,
          "--output",
          "json",
        ],
        {
          env: {
            ...process.env,
            ANDROPERATOR_SKILLS_REGISTRY: registryPath,
          },
        }
      );

      assert.strictEqual(code, 0, stdout);
      const parsed = JSON.parse(stdout) as { created?: boolean; recordingContextPath?: string; files?: string[] };
      assert.strictEqual(parsed.created, true);
      assert.strictEqual(parsed.recordingContextPath, join(tempRoot, "skills", skillId, "recording-context.json"));
      assert.ok(parsed.files?.some((file) => file.endsWith("/recording-context.json")));
      assert.strictEqual(
        await readFile(join(tempRoot, "skills", skillId, "recording-context.json"), "utf8"),
        await readFile(recordingContextPath, "utf8")
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CLI skills new rejects --recording-context when the value is another flag", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-cli-recording-context-missing-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);

    try {
      const skillId = "com.example.weather.reject-missing-recording-context";
      const { stdout, code } = await runCli(
        ["skills", "new", skillId, "--recording-context", "--summary", "demo", "--output", "json"],
        {
          env: {
            ...process.env,
            ANDROPERATOR_SKILLS_REGISTRY: registryPath,
          },
        }
      );

      assert.notStrictEqual(code, 0);
      const parsed = JSON.parse(stdout) as { code?: string; message?: string };
      assert.strictEqual(parsed.code, "USAGE");
      assert.match(parsed.message ?? "", /--recording-context requires a value/);
      await assert.rejects(
        () => stat(join(tempRoot, "skills", skillId)),
        /ENOENT/
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CLI skills new rejects non-export recording context files", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-cli-recording-context-invalid-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    const recordingContextPath = join(tempRoot, "not-a-recording-export.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);
    await writeFile(recordingContextPath, "{\"not\":\"a recording export\"}\n", "utf8");

    try {
      const skillId = "com.example.weather.reject-invalid-recording-context";
      const { stdout, code } = await runCli(
        [
          "skills",
          "new",
          skillId,
          "--recording-context",
          recordingContextPath,
          "--output",
          "json",
        ],
        {
          env: {
            ...process.env,
            ANDROPERATOR_SKILLS_REGISTRY: registryPath,
          },
        }
      );

      assert.notStrictEqual(code, 0);
      const parsed = JSON.parse(stdout) as { code?: string; message?: string };
      assert.strictEqual(parsed.code, SKILLS_SCAFFOLD_FAILED);
      assert.match(parsed.message ?? "", /recording export artifact schema/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CLI skills new accepts an escaped double-dash recording context path", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-cli-recording-context-double-dash-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    const recordingContextPath = join(tempRoot, "--recording-context.export.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);
    await writeFile(recordingContextPath, VALID_RECORDING_EXPORT_JSON, "utf8");

    try {
      const skillId = "com.example.weather.accept-double-dash-recording-context";
      const { stdout, code } = await runCli(
        [
          "skills",
          "new",
          skillId,
          "--recording-context",
          "--",
          recordingContextPath,
          "--output",
          "json",
        ],
        {
          env: {
            ...process.env,
            ANDROPERATOR_SKILLS_REGISTRY: registryPath,
          },
        }
      );

      assert.strictEqual(code, 0, stdout);
      const parsed = JSON.parse(stdout) as { recordingContextPath?: string };
      assert.strictEqual(parsed.recordingContextPath, join(tempRoot, "skills", skillId, "recording-context.json"));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CLI skills new accepts a dash-prefixed recording context path", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-cli-recording-context-dash-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    const recordingContextPath = join(tempRoot, "-recording-context.json");
    await mkdir(registryDir, { recursive: true });
    await copyFile(TEST_REGISTRY_PATH, registryPath);
    await writeFile(recordingContextPath, VALID_RECORDING_EXPORT_JSON, "utf8");

    try {
      const skillId = "com.example.weather.accept-dash-recording-context";
      const { stdout, code } = await runCli(
        [
          "skills",
          "new",
          skillId,
          "--summary",
          "Read the current weather summary",
          "--recording-context",
          recordingContextPath,
          "--output",
          "json",
        ],
        {
          env: {
            ...process.env,
            ANDROPERATOR_SKILLS_REGISTRY: registryPath,
          },
        }
      );

      assert.strictEqual(code, 0, stdout);
      const parsed = JSON.parse(stdout) as { created?: boolean; recordingContextPath?: string; files?: string[] };
      assert.strictEqual(parsed.created, true);
      assert.strictEqual(parsed.recordingContextPath, join(tempRoot, "skills", skillId, "recording-context.json"));
      assert.ok(parsed.files?.some((file) => file.endsWith("/recording-context.json")));
      assert.strictEqual(
        await readFile(join(tempRoot, "skills", skillId, "recording-context.json"), "utf8"),
        await readFile(recordingContextPath, "utf8")
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CLI skills validate reports a valid scaffolded skill", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-cli-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await writeFile(registryPath, `${JSON.stringify({ schemaVersion: "1", skills: [] }, null, 2)}\n`, "utf8");

    try {
      const skillId = "com.example.capture-overview";
      const createResult = await runCli(["skills", "new", skillId, "--output", "json"], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: registryPath,
        },
      });
      assert.strictEqual(createResult.code, 0, createResult.stderr);

      const validateResult = await runCli(["skills", "validate", skillId, "--output", "json"], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: registryPath,
        },
      });
      assert.strictEqual(validateResult.code, 0, validateResult.stderr);

      const parsed = JSON.parse(validateResult.stdout) as {
        valid?: boolean;
        skill?: { id?: string };
      };
      assert.strictEqual(parsed.valid, true);
      assert.strictEqual(parsed.skill?.id, skillId);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CLI skills validate --all reports registry-wide success for scaffolded skills", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-all-cli-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await writeFile(registryPath, `${JSON.stringify({ schemaVersion: "1", skills: [] }, null, 2)}\n`, "utf8");

    try {
      const firstSkillId = "com.example.capture-one";
      const secondSkillId = "com.example.capture-two";
      const createFirst = await runCli(["skills", "new", firstSkillId, "--output", "json"], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: registryPath,
        },
      });
      assert.strictEqual(createFirst.code, 0, createFirst.stderr);

      const createSecond = await runCli(["skills", "new", secondSkillId, "--output", "json"], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: registryPath,
        },
      });
      assert.strictEqual(createSecond.code, 0, createSecond.stderr);

      const validateResult = await runCli(["skills", "validate", "--all", "--output", "json"], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: registryPath,
        },
      });
      assert.strictEqual(validateResult.code, 0, validateResult.stderr);

      const parsed = JSON.parse(validateResult.stdout) as {
        valid?: boolean;
        totalSkills?: number;
        validSkills?: Array<{ skill?: { id?: string } }>;
      };
      assert.strictEqual(parsed.valid, true);
      assert.strictEqual(parsed.totalSkills, 2);
      assert.strictEqual(parsed.validSkills?.length, 2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("CLI skills validate --all returns structured registry errors", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-all-registry-error-"));
    const registryDir = join(tempRoot, "skills");
    const registryPath = join(registryDir, "skills-registry.json");
    await mkdir(registryDir, { recursive: true });
    await writeFile(registryPath, "{ not valid json", "utf8");

    try {
      const validateResult = await runCli(["skills", "validate", "--all", "--output", "json"], {
        env: {
          ...process.env,
          ANDROPERATOR_SKILLS_REGISTRY: registryPath,
        },
      });
      assert.strictEqual(validateResult.code, 1, validateResult.stderr);
      const parsed = JSON.parse(validateResult.stdout) as { code?: string; message?: string };
      assert.strictEqual(parsed.code, REGISTRY_READ_FAILED);
      assert.ok(parsed.message);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("searchSkills", () => {
  it("filters by applicationId", async () => {
    const result = await searchSkills({ app: "com.android.settings" });
    assert.ok(result.ok);
    assert.strictEqual(result.skills.length, 1);
    assert.strictEqual(result.skills[0].id, "com.android.settings.capture-overview");
  });

  it("filters by intent", async () => {
    const result = await searchSkills({ intent: "get-climate" });
    assert.ok(result.ok);
    assert.strictEqual(result.skills.length, 1);
    assert.strictEqual(result.skills[0].id, "com.google.android.apps.chromecast.app.get-climate");
  });

  it("filters by keyword in summary", async () => {
    const result = await searchSkills({ keyword: "screenshot" });
    assert.ok(result.ok);
    assert.strictEqual(result.skills.length, 1);
    assert.strictEqual(result.skills[0].id, "com.android.settings.capture-overview");
  });

  it("returns empty array for no matches", async () => {
    const result = await searchSkills({ app: "com.nonexistent.app" });
    assert.ok(result.ok);
    assert.strictEqual(result.skills.length, 0);
  });

  it("combines app and intent filters", async () => {
    const result = await searchSkills({ app: "com.android.settings", intent: "get-climate" });
    assert.ok(result.ok);
    assert.strictEqual(result.skills.length, 0);
  });

  it("returns the four Google Home HVAC skills for the google home query", async () => {
    const temp = await createTempRegistryWithEntries([
      ...makeGoogleHomeHvacEntries(),
      {
        id: "com.example.notes.capture",
        applicationId: "com.example.notes",
        intent: "capture",
        summary: "Capture the current notes screen.",
      },
    ]);

    try {
      const result = await searchSkills({ keyword: "google home" }, temp.registryPath);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.skills.map((skill) => skill.id), getGoogleHomeHvacSkillIds());
    } finally {
      await temp.cleanup();
    }
  });

  it("returns the four Google Home HVAC skills for a tokenized google-home query", async () => {
    const temp = await createTempRegistryWithEntries(makeGoogleHomeHvacEntries());

    try {
      const result = await searchSkills({ keyword: "google-home" }, temp.registryPath);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.skills.map((skill) => skill.id), getGoogleHomeHvacSkillIds());
    } finally {
      await temp.cleanup();
    }
  });

  it("returns the four Google Home HVAC skills for the air conditioner query", async () => {
    const temp = await createTempRegistryWithEntries(makeGoogleHomeHvacEntries());

    try {
      const result = await searchSkills({ keyword: "air conditioner" }, temp.registryPath);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.skills.map((skill) => skill.id), getGoogleHomeHvacSkillIds());
    } finally {
      await temp.cleanup();
    }
  });

  it("returns the four Google Home HVAC skills for the aircon query", async () => {
    const temp = await createTempRegistryWithEntries(makeGoogleHomeHvacEntries());

    try {
      const result = await searchSkills({ keyword: "aircon" }, temp.registryPath);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.skills.map((skill) => skill.id), getGoogleHomeHvacSkillIds());
    } finally {
      await temp.cleanup();
    }
  });

  it("ranks HVAC skills ahead of known ac false positives", async () => {
    const temp = await createTempRegistryWithEntries([
      {
        id: "com.coles.search-products",
        applicationId: "com.coles",
        intent: "search-products",
        summary: "Search Coles products and extract current price plus original price for sale items.",
      },
      {
        id: "com.globird.energy.get-yesterday-usage-cost-replay",
        applicationId: "com.globird.energy",
        intent: "get-yesterday-usage-cost",
        summary: "Open GloBird and extract the signed dollar amount for Yesterday usage cost.",
      },
      {
        id: "com.woolworths.search-products",
        applicationId: "com.woolworths",
        intent: "search-products",
        summary: "Search Woolworths products and extract current price plus original price for sale items.",
      },
      ...makeGoogleHomeHvacEntries(),
    ]);

    try {
      const result = await searchSkills({ keyword: "ac" }, temp.registryPath);
      assert.ok(result.ok);
      assert.deepStrictEqual(
        result.skills.slice(0, 4).map((skill) => skill.id),
        getGoogleHomeHvacSkillIds()
      );
      const irrelevantSkillIds = [
        "com.coles.search-products",
        "com.globird.energy.get-yesterday-usage-cost-replay",
        "com.woolworths.search-products",
      ];
      for (const irrelevantSkillId of irrelevantSkillIds) {
        const irrelevantIndex = result.skills.findIndex((skill) => skill.id === irrelevantSkillId);
        assert.ok(irrelevantIndex >= 4, `Expected ${irrelevantSkillId} to rank after the HVAC skills`);
      }
    } finally {
      await temp.cleanup();
    }
  });

  it("ranks explicit keyword hits ahead of summary substring hits", async () => {
    const temp = await createTempRegistryWithEntries([
      {
        id: "com.example.summary-match",
        applicationId: "com.example.summary",
        intent: "summary-match",
        summary: "Inspect HVAC status for the current device.",
      },
      {
        id: "com.example.keyword-match",
        applicationId: "com.example.keyword",
        intent: "keyword-match",
        summary: "Inspect the current climate unit.",
        keywords: ["hvac"],
      },
    ]);

    try {
      const result = await searchSkills({ keyword: "hvac" }, temp.registryPath);
      assert.ok(result.ok);
      assert.deepStrictEqual(
        result.skills.map((skill) => skill.id),
        ["com.example.keyword-match", "com.example.summary-match"]
      );
    } finally {
      await temp.cleanup();
    }
  });

  it("treats whitespace-only keyword queries like no keyword filter", async () => {
    const temp = await createTempRegistryWithEntries([
      {
        id: "com.example.first",
        applicationId: "com.example.first",
        intent: "first",
        summary: "First skill.",
      },
      {
        id: "com.example.second",
        applicationId: "com.example.second",
        intent: "second",
        summary: "Second skill.",
      },
    ]);

    try {
      const result = await searchSkills({ keyword: "   " }, temp.registryPath);
      assert.ok(result.ok);
      assert.deepStrictEqual(
        result.skills.map((skill) => skill.id),
        ["com.example.first", "com.example.second"]
      );
    } finally {
      await temp.cleanup();
    }
  });
});

describe("skills for-app CLI", () => {
  it("returns the four Google Home HVAC skills and nothing else", async () => {
    const temp = await createTempRegistryWithEntries([
      ...makeGoogleHomeHvacEntries(),
      {
        id: "com.example.other-app.capture",
        applicationId: "com.example.other-app",
        intent: "capture",
        summary: "Capture another app state.",
      },
    ]);

    try {
      const { stdout, code } = await runCli(
        ["skills", "for-app", "com.google.android.apps.chromecast.app", "--output", "json"],
        {
          env: {
            ...process.env,
            ANDROPERATOR_SKILLS_REGISTRY: temp.registryPath,
          },
        }
      );

      assert.strictEqual(code, 0, stdout);
      const parsed = JSON.parse(stdout) as { count?: number; skills?: Array<{ id: string }> };
      assert.strictEqual(parsed.count, 4);
      assert.deepStrictEqual(parsed.skills?.map((skill) => skill.id), getGoogleHomeHvacSkillIds());
    } finally {
      await temp.cleanup();
    }
  });
});

describe("runSkill", () => {
  it("accumulates chunked stdout without callbacks", async () => {
    const result = await runSkill(TEST_FIXTURE_CHUNKED_OUTPUT, []);
    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.output, "chunk1\nchunk2\n");
    assert.strictEqual(result.skillResult, null);
  });

  it("streams each stdout chunk to onOutput before resolution", async () => {
    const chunks: Array<{ chunk: string; stream: "stdout" | "stderr" }> = [];
    let resolved = false;
    const resultPromise = runSkill(TEST_FIXTURE_CHUNKED_OUTPUT, [], undefined, undefined, undefined, {
      onOutput: (chunk, stream) => {
        chunks.push({ chunk, stream });
        assert.strictEqual(resolved, false, "callback should fire before the promise resolves");
      },
    });

    const result = await resultPromise.then((value) => {
      resolved = true;
      return value;
    });

    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.deepStrictEqual(chunks, [
      { chunk: "chunk1\n", stream: "stdout" },
      { chunk: "chunk2\n", stream: "stdout" },
    ]);
  });

  it("keeps result.output as the full accumulated stdout when onOutput is provided", async () => {
    const result = await runSkill(TEST_FIXTURE_CHUNKED_OUTPUT, [], undefined, undefined, undefined, {
      onOutput: () => undefined,
    });

    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.output, "chunk1\nchunk2\n");
  });

  it("tags stderr chunks as stderr", async () => {
    const chunks: Array<{ chunk: string; stream: "stdout" | "stderr" }> = [];
    const result = await runSkill(TEST_FIXTURE_MIXED_STREAMS, [], undefined, undefined, undefined, {
      onOutput: (chunk, stream) => {
        chunks.push({ chunk, stream });
      },
    });

    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.deepStrictEqual(chunks, [
      { chunk: "stdout-line\n", stream: "stdout" },
      { chunk: "stderr-line\n", stream: "stderr" },
    ]);
  });

  it("returns SKILL_NOT_FOUND for unknown skill", async () => {
    const result = await runSkill("nonexistent.skill", []);
    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_NOT_FOUND);
  });

  it("returns SKILL_SCRIPT_NOT_FOUND when script file missing", async () => {
    // The fixture registry entry points at a skill folder that is not present on disk.
    const result = await runSkill("com.android.settings.capture-overview", []);
    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_SCRIPT_NOT_FOUND);
    assert.match(result.message, /Script not found/i);
  });

  it("runs script and captures output on success", async () => {
    const result = await runSkill("com.test.echo", ["hello"]);
    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.skillId, "com.test.echo");
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output.includes("TEST_OUTPUT:hello"));
    assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0);
    assert.strictEqual(result.skillResult, null);
  });

  it("runs script with no args", async () => {
    const result = await runSkill("com.test.echo", []);
    assert.ok(result.ok);
    assert.ok(result.output.includes("TEST_OUTPUT:no-args"));
    assert.strictEqual(result.skillResult, null);
  });

  it("parses a valid framed SkillResult for scripted skills", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["valid", "40"]);
    assert.ok(result.ok, `Expected framed SkillResult to succeed: ${"message" in result ? result.message : ""}`);
    assert.ok(result.output.includes("progress:before-frame"));
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.source.kind, "script");
    assert.strictEqual(result.skillResult.skillId, TEST_SKILL_RESULT);
    assert.deepStrictEqual(result.skillResult.result, null);
    assert.strictEqual(result.skillResult.status, "success");
    assert.strictEqual(result.skillResult.checkpoints.length, 3);
    assert.deepStrictEqual(result.skillResult.checkpoints.map((checkpoint) => checkpoint.evidence?.kind), [
      "text",
      "json",
      "result_envelope_ref",
    ]);
    assert.strictEqual(result.skillResult.diagnostics?.runtimeState, "healthy");
  });

  it("accepts evidence-shaped root result and surfaces skillResult.result", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["result-valid", "40"]);
    assert.ok(result.ok, `Expected framed SkillResult to succeed: ${"message" in result ? result.message : ""}`);
    assert.ok(result.skillResult);
    assert.deepStrictEqual(result.skillResult.result, { kind: "json", value: { amount: "-$3.10" } });
    assert.strictEqual(result.skillResult.status, "success");
  });

  it("rejects a plain-object root result that is not SkillCheckpointEvidence (schema validation)", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["result-plain-object", "40"]);
    assert.ok(!result.ok, "Expected runSkill to fail when result is not evidence-shaped");
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(
      result.message,
      /SkillResult frame failed validation|result|Invalid discriminator|discriminator/i
    );
  });

  it("rejects framed SkillResult objects that omit the required result field", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["missing-result", "40"]);
    assert.ok(!result.ok, "Expected runSkill to fail when result is missing");
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /SkillResult frame failed validation|result/);
  });

  it("keeps framed scripted SkillResult parsing permissive when skill.json is unreadable", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: TEST_SKILL_RESULT,
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.skill-result",
        "scripts",
        "emit_skill_result.js"
      ),
      skillJsonContents: "{\n  \"id\": \"broken\"\n",
      scriptRelativePath: "scripts/skill-result.js",
    });

    try {
      const result = await runSkill(TEST_SKILL_RESULT, ["valid", "40"], temp.registryPath);
      assert.ok(result.ok, `Expected framed scripted run to stay permissive: ${"message" in result ? result.message : ""}`);
      assert.ok(result.skillResult);
      assert.strictEqual(result.skillResult.source.kind, "script");
      assert.strictEqual(result.skillResult.status, "success");
    } finally {
      await temp.cleanup();
    }
  });

  it("parses a valid framed SkillResult for agent-driven skills and injects agent source metadata", async () => {
    const result = await runSkill(TEST_AGENT_SKILL_RESULT, ["valid", "40"]);

    assert.ok(result.ok, `Expected agent SkillResult to succeed: ${"message" in result ? result.message : ""}`);
    assert.ok(result.skillResult);
    assert.deepStrictEqual(result.skillResult.source, {
      kind: "agent",
      agentCli: "codex",
    });
    assert.strictEqual(result.skillResult.skillId, TEST_AGENT_SKILL_RESULT);
    assert.ok(result.output.includes("[Androperator-Skill-Result]"));
  });

  it("keeps agent source provenance pinned to skill.json even when ANDROPERATOR_SKILL_AGENT_CLI overrides execution", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.agent-source-trust",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.agent-source-trust",
        applicationId: "com.test",
        intent: "agent-source-trust",
        summary: "Temporary test skill",
        path: "skills/com.test.agent-source-trust",
        skillFile: "skills/com.test.agent-source-trust/SKILL.md",
        scripts: ["skills/com.test.agent-source-trust/scripts/run.js"],
        artifacts: [],
        agent: {
          cli: "codex",
          cliPath: "scripts/fake_codex.js",
        },
      }),
      extraScriptSourcePaths: [
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "fake_codex.js"
        ),
      ],
    });

    const fakeAgentDir = await mkdtemp(join(tmpdir(), "androperator-agent-source-trust-"));
    const fakeAgentPath = join(fakeAgentDir, "override-agent");
    const fakeAgentSourcePath = join(
      packageRoot,
      "src",
      "test",
      "fixtures",
      "skills",
      "com.test.agent-skill-result",
      "scripts",
      "fake_codex.js"
    );

    try {
      await writeFile(
        fakeAgentPath,
        `#!/bin/sh\nexec "${process.execPath}" "${fakeAgentSourcePath}" "$@"\n`,
        "utf8"
      );
      await chmod(fakeAgentPath, 0o755);

      const result = await runSkill(
        "com.test.agent-source-trust",
        ["valid"],
        temp.registryPath,
        undefined,
        {
          ANDROPERATOR_SKILL_AGENT_CLI: "override-agent",
          PATH: fakeAgentDir,
        }
      );

      assert.ok(result.ok, `Expected trusted source result to succeed: ${"message" in result ? result.message : ""}`);
      assert.ok(result.skillResult);
      assert.deepStrictEqual(result.skillResult.source, {
        kind: "agent",
        agentCli: "codex",
      });
    } finally {
      await rm(fakeAgentDir, { recursive: true, force: true });
      await temp.cleanup();
    }
  });

  it("fails before spawn when an orchestrated skill's configured agent CLI is unavailable", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.missing-agent-cli",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.missing-agent-cli",
        applicationId: "com.test",
        intent: "missing-agent-cli",
        summary: "Temporary test skill",
        path: "skills/com.test.missing-agent-cli",
        skillFile: "skills/com.test.missing-agent-cli/SKILL.md",
        scripts: ["skills/com.test.missing-agent-cli/scripts/run.js"],
        artifacts: [],
        agent: {
          cli: "missing-agent-cli-for-tests",
        },
      }),
    });

    try {
      const result = await runSkill("com.test.missing-agent-cli", ["valid"], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_AGENT_CLI_UNAVAILABLE);
      assert.match(result.message, /missing-agent-cli-for-tests/);
      assert.strictEqual(result.skillResult, null);
    } finally {
      await temp.cleanup();
    }
  });

  it("fails before spawn when an orchestrated skill's configured cliPath exists but is not executable", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.non-executable-agent-cli",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.non-executable-agent-cli",
        applicationId: "com.test",
        intent: "non-executable-agent-cli",
        summary: "Temporary test skill",
        path: "skills/com.test.non-executable-agent-cli",
        skillFile: "skills/com.test.non-executable-agent-cli/SKILL.md",
        scripts: ["skills/com.test.non-executable-agent-cli/scripts/run.js"],
        artifacts: [],
        agent: {
          cli: "fake-agent",
          cliPath: "scripts/not-executable.sh",
        },
      }),
    });

    const nonExecutablePath = join(dirname(temp.registryPath), "com.test.non-executable-agent-cli", "scripts", "not-executable.sh");
    await writeFile(nonExecutablePath, "#!/bin/sh\nexit 0\n", "utf8");

    try {
      const result = await runSkill("com.test.non-executable-agent-cli", ["valid"], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_AGENT_CLI_UNAVAILABLE);
      assert.match(result.message, /not found or is not executable/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("returns a typed execution failure when the orchestrated harness forwards a non-zero agent exit", async () => {
    const result = await runSkill(TEST_AGENT_SKILL_RESULT, ["agent-fail"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_FAILED);
    assert.strictEqual(result.exitCode, 17);
    assert.match(result.stderr ?? "", /agent failed intentionally/);
    assert.strictEqual(result.skillResult, null);
  });

  it("fails cleanly when an agent-driven skill is missing SKILL.md", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.missing-skill-program",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.missing-skill-program",
        applicationId: "com.test",
        intent: "missing-skill-program",
        summary: "Temporary test skill",
        path: "skills/com.test.missing-skill-program",
        skillFile: "skills/com.test.missing-skill-program/SKILL.md",
        scripts: ["skills/com.test.missing-skill-program/scripts/run.js"],
        artifacts: [],
        agent: {
          cli: "fake-agent",
          cliPath: "scripts/fake-agent.sh",
        },
      }),
      omitSkillFile: true,
    });
    const fakeAgentPath = join(dirname(temp.registryPath), "com.test.missing-skill-program", "scripts", "fake-agent.sh");
    await writeFile(fakeAgentPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    try {
      const result = await runSkill("com.test.missing-skill-program", ["valid"], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_SCRIPT_NOT_FOUND);
      assert.match(result.message, /Skill program not found/);
      assert.strictEqual(result.skillResult, null);
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects malformed framed SkillResult output from an orchestrated harness", async () => {
    const result = await runSkill(TEST_AGENT_SKILL_RESULT, ["malformed-json"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /invalid JSON/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("rejects agent-driven exit-0 runs that omit the required terminal SkillResult frame", async () => {
    const result = await runSkill(TEST_AGENT_SKILL_RESULT, ["no-frame-success"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /must emit a terminal SkillResult frame/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("preserves indeterminate SkillResult status for orchestrated skills", async () => {
    const result = await runSkill(TEST_AGENT_SKILL_RESULT, ["indeterminate"]);

    assert.strictEqual(result.status, "indeterminate");
    assert.strictEqual(result.ok, null);
    assert.strictEqual(result.code, "SKILL_VERIFICATION_INDETERMINATE");
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.source.kind, "agent");
    assert.strictEqual(result.skillResult.status, "indeterminate");
    assert.strictEqual(result.skillResult.terminalVerification?.status, "not_run");
  });

  it("treats declared verification as proved even when the emitted SkillResult status is indeterminate", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["proved-indeterminate-status", "40"]);

    assert.ok(result.ok, `Expected proved declared verification to return wrapper success: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.status, "success");
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.status, "indeterminate");
    assert.strictEqual(result.skillResult.terminalVerification?.status, "verified");
  });

  it("reports success for orchestrated skills that take a recovery path but still reach terminal verification", async () => {
    const result = await runSkill(TEST_AGENT_SKILL_RESULT, ["recovery-success", "40"]);

    assert.ok(result.ok, `Expected orchestrated recovery-path success to parse: ${"message" in result ? result.message : ""}`);
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.status, "success");
    assert.deepStrictEqual(
      result.skillResult.checkpoints.map((checkpoint) => checkpoint.status),
      ["ok", "ok", "ok", "ok", "ok"]
    );
    assert.match(result.skillResult.checkpoints[0].note ?? "", /reopened once/i);
    assert.match(result.skillResult.terminalVerification?.note ?? "", /recovery branch/i);
  });

  it("forwards the resolved registry path and timeout env to the orchestrated harness", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.agent-env-check",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.agent-env-check",
        applicationId: "com.test",
        intent: "agent-env-check",
        summary: "Temporary test skill",
        path: "skills/com.test.agent-env-check",
        skillFile: "skills/com.test.agent-env-check/SKILL.md",
        scripts: ["skills/com.test.agent-env-check/scripts/run.js"],
        artifacts: [],
        agent: {
          cli: "fake_codex.js",
          cliPath: "scripts/fake_codex.js",
          timeoutMs: 4321,
        },
      }),
      extraScriptSourcePaths: [
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "fake_codex.js"
        ),
      ],
    });

    try {
      const result = await runSkill(
        "com.test.agent-env-check",
        ["env-check", "40"],
        temp.registryPath,
        undefined,
        {
          EXPECTED_SKILLS_REGISTRY: temp.registryPath,
          EXPECTED_SKILL_TIMEOUT_MS: "4321",
        }
      );

      assert.ok(result.ok, `Expected env-check agent skill to succeed: ${"message" in result ? result.message : ""}`);
      assert.ok(result.skillResult);
      assert.strictEqual(result.skillResult.source.kind, "agent");
    } finally {
      await temp.cleanup();
    }
  });

  it("uses the registry skillFile path for agent-driven skill programs", async () => {
    const skillFileRelativePath = "skills/com.test.custom-skill-file/RUNTIME.md";
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.custom-skill-file",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.custom-skill-file",
        applicationId: "com.test",
        intent: "custom-skill-file",
        summary: "Temporary test skill",
        path: "skills/com.test.custom-skill-file",
        skillFile: skillFileRelativePath,
        scripts: ["skills/com.test.custom-skill-file/scripts/run.js"],
        artifacts: [],
        agent: {
          cli: "fake_codex.js",
          cliPath: "scripts/fake_codex.js",
        },
      }),
      extraScriptSourcePaths: [
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "fake_codex.js"
        ),
      ],
      skillFileRelativePath,
    });

    try {
      const expectedSkillProgramPath = join(getRepoRoot(temp.registryPath), skillFileRelativePath);
      const result = await runSkill(
        "com.test.custom-skill-file",
        ["env-check", "40"],
        temp.registryPath,
        undefined,
        {
          EXPECTED_SKILL_PROGRAM_PATH: expectedSkillProgramPath,
        }
      );

      assert.ok(result.ok, `Expected custom skillFile agent skill to succeed: ${"message" in result ? result.message : ""}`);
      assert.ok(result.skillResult);
      assert.strictEqual(result.skillResult.source.kind, "agent");
    } finally {
      await temp.cleanup();
    }
  });

  it("requires agent-driven skills to execute scripts/run.js even when other scripts are listed first", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.agent-run-harness",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.agent-run-harness",
        applicationId: "com.test",
        intent: "agent-run-harness",
        summary: "Temporary test skill",
        path: "skills/com.test.agent-run-harness",
        skillFile: "skills/com.test.agent-run-harness/SKILL.md",
        scripts: [
          "skills/com.test.agent-run-harness/scripts/other.sh",
          "skills/com.test.agent-run-harness/scripts/run.js",
        ],
        artifacts: [],
        agent: {
          cli: "fake_codex.js",
          cliPath: "scripts/fake_codex.js",
        },
      }),
      extraScriptSourcePaths: [
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "fake_codex.js"
        ),
      ],
    });

    const skillRoot = join(getRepoRoot(temp.registryPath), "skills", "com.test.agent-run-harness");
    const registryPath = temp.registryPath;
    const otherScriptPath = join(skillRoot, "scripts", "other.sh");

    try {
      await writeFile(otherScriptPath, "#!/bin/sh\necho WRONG_SCRIPT\nexit 42\n", "utf8");
      await chmod(otherScriptPath, 0o755);

      const registry = JSON.parse(await readFile(registryPath, "utf8")) as { skills: Array<Record<string, unknown>> };
      registry.skills[0].scripts = [
        "skills/com.test.agent-run-harness/scripts/other.sh",
        "skills/com.test.agent-run-harness/scripts/run.js",
      ];
      await writeFile(registryPath, JSON.stringify(registry), "utf8");

      const result = await runSkill("com.test.agent-run-harness", ["valid"], registryPath);

      assert.ok(result.ok, `Expected agent harness selection to succeed: ${"message" in result ? result.message : ""}`);
      assert.ok(result.skillResult);
      assert.strictEqual(result.skillResult.source.kind, "agent");
      assert.ok(!result.output.includes("WRONG_SCRIPT"));
    } finally {
      await temp.cleanup();
    }
  });

  it("fails validation when an agent-driven skill does not declare scripts/run.js", async () => {
    const root = await mkdtemp(join(tmpdir(), "androperator-agent-missing-run-harness-"));
    const skillId = "com.test.agent-missing-run-harness";
    const skillPath = `skills/${skillId}`;
    const skillDir = join(root, skillPath);
    const scriptsDir = join(skillDir, "scripts");
    const invalidScripts = [`${skillPath}/scripts/not-run.js`];
    const skillManifest = {
      id: skillId,
      applicationId: "com.test",
      intent: "agent-missing-run-harness",
      summary: "Temporary test skill",
      path: skillPath,
      skillFile: `${skillPath}/SKILL.md`,
      scripts: invalidScripts,
      artifacts: [],
      agent: {
        cli: "codex",
      },
    };

    try {
      await mkdir(scriptsDir, { recursive: true });
      await copyFile(
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "run.js"
        ),
        join(scriptsDir, "not-run.js")
      );
      await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(skillId, "orchestrated"), "utf8");
      await writeFile(join(skillDir, "skill.json"), JSON.stringify(skillManifest), "utf8");
      const registryPath = join(root, "skills", "skills-registry.json");
      await writeFile(
        registryPath,
        JSON.stringify({
          schemaVersion: "1.0",
          generatedAt: "2026-04-12T00:00:00Z",
          skills: [skillManifest],
        }),
        "utf8"
      );

      const result = await validateSkill(skillId, registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, "SKILL_VALIDATION_FAILED");
      assert.match(result.message, /required orchestrated harness/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats skill.json.agent as runtime metadata rather than a registry parity field", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.agent-validation-source-of-truth",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.agent-validation-source-of-truth",
        applicationId: "com.test",
        intent: "temp",
        summary: "Temporary test skill",
        path: "skills/com.test.agent-validation-source-of-truth",
        skillFile: "skills/com.test.agent-validation-source-of-truth/SKILL.md",
        scripts: ["skills/com.test.agent-validation-source-of-truth/scripts/run.js"],
        artifacts: [],
        agent: {
          cli: "codex",
          cliPath: "scripts/fake_codex.js",
        },
      }),
      extraScriptSourcePaths: [
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "fake_codex.js"
        ),
      ],
    });

    try {
      const result = await validateSkill("com.test.agent-validation-source-of-truth", temp.registryPath);
      assert.ok(result.ok, `Expected validation to ignore registry parity for agent metadata: ${!result.ok ? result.message : ""}`);
    } finally {
      await temp.cleanup();
    }
  });

  it("treats semantically identical contract objects as matching even when key order differs", async () => {
    const root = await mkdtemp(join(tmpdir(), "androperator-contract-order-"));
    const skillId = "com.test.contract-order";
    const skillDir = join(root, "skills", skillId);
    const scriptsDir = join(skillDir, "scripts");
    const registryPath = join(root, "skills", "skills-registry.json");

    try {
      await mkdir(scriptsDir, { recursive: true });
      await copyFile(
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.echo",
          "scripts",
          "echo.js"
        ),
        join(scriptsDir, "run.js")
      );
      await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(skillId, "orchestrated"), "utf8");
      await writeFile(
        join(skillDir, "skill.json"),
        JSON.stringify({
          id: skillId,
          applicationId: "com.test",
          intent: "contract-order",
          summary: "Temporary test skill",
          path: `skills/${skillId}`,
          skillFile: `skills/${skillId}/SKILL.md`,
          scripts: [`skills/${skillId}/scripts/run.js`],
          artifacts: [],
          contract: {
            inputs: {
              percent: "integer[0,100]",
            },
            goal: {
              kind: "set_discharge_limit",
              zeta: "last",
              alpha: "first",
            },
            verification: {
              kind: "node_text_matches",
              matcher: "Discharge to {percent}%",
            },
          },
        }),
        "utf8"
      );
      await writeFile(
        registryPath,
        JSON.stringify({
          schemaVersion: "1.0",
          generatedAt: "2026-04-13T00:00:00Z",
          skills: [
            {
              id: skillId,
              applicationId: "com.test",
              intent: "contract-order",
              summary: "Temporary test skill",
              path: `skills/${skillId}`,
              skillFile: `skills/${skillId}/SKILL.md`,
              scripts: [`skills/${skillId}/scripts/run.js`],
              artifacts: [],
              contract: {
                inputs: {
                  percent: "integer[0,100]",
                },
                goal: {
                  alpha: "first",
                  kind: "set_discharge_limit",
                  zeta: "last",
                },
                verification: {
                  matcher: "Discharge to {percent}%",
                  kind: "node_text_matches",
                },
              },
            },
          ],
        }),
        "utf8"
      );

      const result = await validateSkill(skillId, registryPath);
      assert.ok(result.ok, `Expected contract parity to ignore JSON key order: ${!result.ok ? result.message : ""}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts backslash-separated orchestrated harness paths in registry metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "androperator-agent-windows-paths-"));
    const skillId = "com.test.agent-windows-paths";
    const skillDir = join(root, "skills", skillId);
    const scriptsDir = join(skillDir, "scripts");
    const registryPath = join(root, "skills", "skills-registry.json");

    try {
      await mkdir(scriptsDir, { recursive: true });
      await copyFile(
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "run.js"
        ),
        join(scriptsDir, "run.js")
      );
      await copyFile(
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "fake_codex.js"
        ),
        join(scriptsDir, "fake_codex.js")
      );
      await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(skillId, "orchestrated"), "utf8");
      await writeFile(
        join(skillDir, "skill.json"),
        JSON.stringify({
          id: skillId,
          applicationId: "com.test",
          intent: "temp",
          summary: "Temporary test skill",
          path: "skills\\com.test.agent-windows-paths",
          skillFile: "skills\\com.test.agent-windows-paths\\SKILL.md",
          scripts: ["skills\\com.test.agent-windows-paths\\scripts\\run.js"],
          artifacts: [],
          agent: {
            cli: "codex",
            cliPath: "scripts/fake_codex.js",
          },
        }),
        "utf8"
      );
      await writeFile(
        registryPath,
        JSON.stringify({
          schemaVersion: "1.0",
          generatedAt: "2026-04-13T00:00:00Z",
          skills: [
            {
              id: skillId,
              applicationId: "com.test",
              intent: "temp",
              summary: "Temporary test skill",
              path: "skills\\com.test.agent-windows-paths",
              skillFile: "skills\\com.test.agent-windows-paths\\SKILL.md",
              scripts: ["skills\\com.test.agent-windows-paths\\scripts\\run.js"],
              artifacts: [],
            },
          ],
        }),
        "utf8"
      );

      const valid = await validateSkill(skillId, registryPath);
      assert.ok(valid.ok, `Expected backslash-separated registry paths to validate: ${!valid.ok ? valid.message : ""}`);

      const result = await runSkill(skillId, ["valid"], registryPath);
      assert.ok(result.ok, `Expected backslash-separated registry paths to run: ${"message" in result ? result.message : ""}`);
      assert.ok(result.skillResult);
      assert.strictEqual(result.skillResult.source.kind, "agent");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts mixed-separator parity between registry metadata and skill.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "androperator-agent-mixed-paths-"));
    const skillId = "com.test.agent-mixed-paths";
    const skillDir = join(root, "skills", skillId);
    const scriptsDir = join(skillDir, "scripts");
    const registryPath = join(root, "skills", "skills-registry.json");

    try {
      await mkdir(scriptsDir, { recursive: true });
      await copyFile(
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "run.js"
        ),
        join(scriptsDir, "run.js")
      );
      await copyFile(
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "fake_codex.js"
        ),
        join(scriptsDir, "fake_codex.js")
      );
      await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(skillId, "orchestrated"), "utf8");
      await writeFile(
        join(skillDir, "skill.json"),
        JSON.stringify({
          id: skillId,
          applicationId: "com.test",
          intent: "temp",
          summary: "Temporary test skill",
          path: "skills\\com.test.agent-mixed-paths",
          skillFile: "skills\\com.test.agent-mixed-paths/SKILL.md",
          scripts: ["skills/com.test.agent-mixed-paths\\scripts/run.js"],
          artifacts: [],
          agent: {
            cli: "codex",
            cliPath: "scripts/fake_codex.js",
          },
        }),
        "utf8"
      );
      await writeFile(
        registryPath,
        JSON.stringify({
          schemaVersion: "1.0",
          generatedAt: "2026-04-13T00:00:00Z",
          skills: [
            {
              id: skillId,
              applicationId: "com.test",
              intent: "temp",
              summary: "Temporary test skill",
              path: "skills/com.test.agent-mixed-paths",
              skillFile: "skills/com.test.agent-mixed-paths/SKILL.md",
              scripts: ["skills/com.test.agent-mixed-paths/scripts/run.js"],
              artifacts: [],
            },
          ],
        }),
        "utf8"
      );

      const result = await validateSkill(skillId, registryPath);
      assert.ok(result.ok, `Expected mixed-separator metadata to validate: ${!result.ok ? result.message : ""}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves the agent CLI from the caller-provided PATH override", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.agent-path-override",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.agent-skill-result",
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.agent-path-override",
        applicationId: "com.test",
        intent: "agent-path-override",
        summary: "Temporary test skill",
        path: "skills/com.test.agent-path-override",
        skillFile: "skills/com.test.agent-path-override/SKILL.md",
        scripts: ["skills/com.test.agent-path-override/scripts/run.js"],
        artifacts: [],
        agent: {
          cli: "my-agent",
          timeoutMs: 4321,
        },
      }),
    });

    const fakeAgentDir = await mkdtemp(join(tmpdir(), "androperator-agent-path-override-"));
    const fakeAgentPath = join(fakeAgentDir, "my-agent");
    const fakeAgentSourcePath = join(
      packageRoot,
      "src",
      "test",
      "fixtures",
      "skills",
      "com.test.agent-skill-result",
      "scripts",
      "fake_codex.js"
    );

    try {
      await writeFile(
        fakeAgentPath,
        `#!/bin/sh\nexec "${process.execPath}" "${fakeAgentSourcePath}" "$@"\n`,
        "utf8"
      );
      await chmod(fakeAgentPath, 0o755);

      const originalPath = process.env.PATH;
      process.env.PATH = "";
      try {
        const result = await runSkill(
          "com.test.agent-path-override",
          ["env-check", "40"],
          temp.registryPath,
          undefined,
          {
            PATH: fakeAgentDir,
            ANDROPERATOR_SKILL_AGENT_CLI: "my-agent",
            EXPECTED_SKILLS_REGISTRY: temp.registryPath,
            EXPECTED_SKILL_TIMEOUT_MS: "4321",
          }
        );

        assert.ok(result.ok, `Expected PATH override agent skill to succeed: ${"message" in result ? result.message : ""}`);
        assert.ok(result.skillResult);
        assert.strictEqual(result.skillResult.source.kind, "agent");
      } finally {
        process.env.PATH = originalPath;
      }
    } finally {
      await rm(fakeAgentDir, { recursive: true, force: true });
      await temp.cleanup();
    }
  });

  it("returns SKILL_OUTPUT_ASSERTION_FAILED when expectContains is missing from output", async () => {
    const result = await runSkill(
      "com.test.echo",
      ["hello"],
      undefined,
      undefined,
      undefined,
      undefined,
      "missing-value"
    );
    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_OUTPUT_ASSERTION_FAILED);
    assert.strictEqual(result.expectedSubstring, "missing-value");
    assert.ok(result.output?.includes("TEST_OUTPUT:hello"));
    assert.strictEqual(result.skillResult, null);
  });

  it("succeeds when output includes expectContains", async () => {
    const result = await runSkill(
      "com.test.echo",
      ["hello"],
      undefined,
      undefined,
      undefined,
      undefined,
      "TEST_OUTPUT:hello"
    );
    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.skillId, "com.test.echo");
  });

  it("expectContains matches substrings across stdout chunk boundaries", async () => {
    const result = await runSkill(
      TEST_FIXTURE_SPLIT_WORD,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      "hello"
    );
    assert.ok(result.ok, `Expected split-word fixture with expectContains: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.skillId, TEST_FIXTURE_SPLIT_WORD);
    assert.strictEqual(result.output, "hello\n");
  });

  it("preserves stdout and stderr when a skill exits non-zero after emitting output", async () => {
    const result = await runSkill("com.test.fail", []);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_FAILED);
    assert.strictEqual(result.exitCode, 2);
    assert.strictEqual(result.stdout, "{\"partial\":true,\"stage\":\"before-failure\"}\n");
    assert.strictEqual(result.stderr, "FAIL_OUTPUT:intentional\n");
    assert.strictEqual(result.skillResult, null);
  });

  it("surfaces a parsed SkillResult on the error path when a framed skill exits non-zero", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["fail"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_FAILED);
    assert.strictEqual(result.exitCode, 9);
    assert.ok(result.stdout?.includes("[Androperator-Skill-Result]"));
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.status, "failed");
    assert.strictEqual(result.skillResult.source.kind, "script");
    assert.strictEqual(result.skillResult.diagnostics?.runtimeState, "poisoned");
  });

  it("keeps legacy stdout behavior when no SkillResult frame is present", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["legacy"]);

    assert.strictEqual(result.status, "indeterminate");
    assert.strictEqual(result.ok, null);
    assert.strictEqual(result.output, "legacy-output-only\n");
    assert.strictEqual(result.skillResult, null);
    assert.strictEqual(result.code, "SKILL_VERIFICATION_INDETERMINATE");
  });

  it("returns indeterminate when declared verification disagrees with a framed success result", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["mismatched-success", "40"]);

    assert.strictEqual(result.status, "indeterminate");
    assert.strictEqual(result.ok, null);
    assert.strictEqual(result.code, "SKILL_VERIFICATION_INDETERMINATE");
    assert.match(result.message ?? "", /did not match declared matcher|expected 'Discharge to 40%'/i);
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.status, "success");
    assert.strictEqual(result.skillResult.terminalVerification?.status, "verified");
  });

  it("accepts decorative terminal-verification suffixes for declared text matches", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["decorated-success", "40"]);

    assert.ok(result.ok, `Expected decorated terminal verification to count as a match: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.status, "success");
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.status, "success");
    assert.strictEqual(result.skillResult.terminalVerification?.status, "verified");
  });

  it("returns indeterminate when SkillResult inputs do not match trusted invocation inputs", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["40"], undefined, undefined, {
      TEST_SKILL_MODE: "valid",
    });

    assert.ok(result.ok, `Expected trusted invocation inputs to match declared inputs: ${"message" in result ? result.message : ""}`);

    const spoofed = await runSkill(TEST_SKILL_RESULT, ["40"], undefined, undefined, {
      TEST_SKILL_MODE: "spoofed-inputs",
    });

    assert.strictEqual(spoofed.status, "indeterminate");
    assert.strictEqual(spoofed.ok, null);
    assert.strictEqual(spoofed.code, "SKILL_VERIFICATION_INDETERMINATE");
    assert.match(spoofed.message, /trusted invocation inputs/i);
    assert.ok(spoofed.skillResult);
    assert.strictEqual(spoofed.skillResult.status, "success");
  });

  it("accepts extra undeclared SkillResult inputs when declared inputs still match trusted invocation inputs", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["40"], undefined, undefined, {
      TEST_SKILL_MODE: "extra-inputs",
    });

    assert.ok(result.ok, `Expected extra undeclared inputs to be allowed: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.status, "success");
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.status, "success");
    assert.strictEqual(result.skillResult.inputs?.targetPercent, 40);
    assert.strictEqual(result.skillResult.inputs?.diagnosticNote, "kept-for-debugging");
  });

  it("fails a declared-verification run when a zero-exit SkillResult reports failed status", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["failed-zero-exit", "40"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.status, "failed");
    assert.strictEqual(result.code, SKILL_EXECUTION_FAILED);
    assert.match(result.message, /reported failed status while executing a declared verification contract/i);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.status, "failed");
    assert.strictEqual(result.skillResult.terminalVerification?.status, "failed");
  });

  it("rejects earlier marker mentions when they are not part of the trailing frame suffix", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["marker-progress-only"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /terminal non-empty stdout suffix|followed by a JSON object line/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("rejects earlier marker mentions even when a later trailing frame looks valid", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["marker-progress-before-valid-frame"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /multiple SkillResult frames|non-terminal SkillResult marker/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("rejects malformed SkillResult JSON instead of silently falling back to legacy parsing", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["malformed-json"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /invalid JSON/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("rejects multiple SkillResult frames", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["multiple"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /multiple SkillResult frames|non-terminal SkillResult marker/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("rejects framed output when any non-whitespace stdout appears after the frame", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["frame-with-trailing-output"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /terminal non-empty stdout suffix/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("treats whitespace-padded marker lines as legacy stdout instead of a framed SkillResult", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["whitespace-padded-frame-marker"]);

    assert.strictEqual(result.status, "indeterminate");
    assert.strictEqual(result.ok, null);
    assert.ok(result.output.includes(` ${"[Androperator-Skill-Result]"} `));
    assert.strictEqual(result.skillResult, null);
    assert.strictEqual(result.code, "SKILL_VERIFICATION_INDETERMINATE");
  });

  it("rejects framed SkillResults that try to self-report source", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["with-source"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /must not include source/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("rejects framed SkillResults whose skillId does not match the invoked skill", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["mismatch-skill-id"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /did not match invoked skill/i);
    assert.strictEqual(result.skillResult, null);
  });

  it("rejects framed SkillResults when trusted source metadata cannot be read", async () => {
    const fixtureScript = join(
      packageRoot,
      "src",
      "test",
      "fixtures",
      "skills",
      "com.test.skill-result",
      "scripts",
      "emit_skill_result.js"
    );
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.invalid-source-skill",
      scriptSourcePath: fixtureScript,
      skillJsonContents: "{invalid-json",
    });

    try {
      const framedResult = await runSkill("com.test.invalid-source-skill", ["valid"], temp.registryPath);
      assert.ok(!framedResult.ok);
      assert.strictEqual(framedResult.code, SKILL_VALIDATION_FAILED);
      assert.match(framedResult.message, /trusted skill result source metadata/i);
      assert.strictEqual(framedResult.skillResult, null);

      const legacyResult = await runSkill("com.test.invalid-source-skill", ["legacy"], temp.registryPath);
      assert.ok(!legacyResult.ok);
      assert.strictEqual(legacyResult.code, SKILL_VALIDATION_FAILED);
      assert.match(legacyResult.message, /trusted skill result source metadata/i);
      assert.strictEqual(legacyResult.skillResult, null);
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects framed SkillResults when skill.json is valid JSON but not an object", async () => {
    const fixtureScript = join(
      packageRoot,
      "src",
      "test",
      "fixtures",
      "skills",
      "com.test.skill-result",
      "scripts",
      "emit_skill_result.js"
    );
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.non-object-source-skill",
      scriptSourcePath: fixtureScript,
      skillJsonContents: JSON.stringify(true),
    });

    try {
      const result = await runSkill("com.test.non-object-source-skill", ["valid"], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /skill\.json must contain a JSON object/i);
      assert.strictEqual(result.skillResult, null);
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects framed SkillResults when skill.json has a malformed agent block", async () => {
    const fixtureScript = join(
      packageRoot,
      "src",
      "test",
      "fixtures",
      "skills",
      "com.test.skill-result",
      "scripts",
      "emit_skill_result.js"
    );
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.invalid-agent-source-skill",
      scriptSourcePath: fixtureScript,
      skillJsonContents: JSON.stringify({
        agent: {
          cli: "",
        },
      }),
    });

    try {
      const framedResult = await runSkill("com.test.invalid-agent-source-skill", ["valid"], temp.registryPath);
      assert.ok(!framedResult.ok);
      assert.strictEqual(framedResult.code, SKILL_VALIDATION_FAILED);
      assert.match(framedResult.message, /agent\.cli must be a non-empty string/i);
      assert.strictEqual(framedResult.skillResult, null);

      const legacyResult = await runSkill("com.test.invalid-agent-source-skill", ["legacy"], temp.registryPath);
      assert.ok(!legacyResult.ok);
      assert.strictEqual(legacyResult.code, SKILL_VALIDATION_FAILED);
      assert.match(legacyResult.message, /agent\.cli must be a non-empty string/i);
      assert.strictEqual(legacyResult.skillResult, null);
    } finally {
      await temp.cleanup();
    }
  });

  it("keeps the legacy path permissive when skill.json has no agent block", async () => {
    const fixtureScript = join(
      packageRoot,
      "src",
      "test",
      "fixtures",
      "skills",
      "com.test.skill-result",
      "scripts",
      "emit_skill_result.js"
    );
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.absent-agent-source-skill",
      scriptSourcePath: fixtureScript,
      skillJsonContents: JSON.stringify({}),
    });

    try {
      const legacyResult = await runSkill("com.test.absent-agent-source-skill", ["legacy"], temp.registryPath);
      assert.ok(legacyResult.ok, `Expected legacy path to stay permissive: ${"message" in legacyResult ? legacyResult.message : ""}`);
      assert.strictEqual(legacyResult.skillResult, null);
      assert.strictEqual(legacyResult.output, "legacy-output-only\n");
    } finally {
      await temp.cleanup();
    }
  });

  it("keeps the legacy path permissive for script-only skills when skill.json is malformed", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.legacy-malformed-skill-json",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        TEST_SKILL_SCRIPT_ONLY,
        "scripts",
        "run.js"
      ),
      skillJsonContents: "{not-json",
      scriptRelativePath: "scripts/main.js",
    });

    try {
      const result = await runSkill("com.test.legacy-malformed-skill-json", [], temp.registryPath);
      assert.ok(result.ok, `Expected legacy script skill to run despite malformed skill.json: ${"message" in result ? result.message : ""}`);
      assert.match(result.output, /fixture run/);
      assert.strictEqual(result.skillResult, null);
    } finally {
      await temp.cleanup();
    }
  });

  it("fails closed for malformed orchestrated manifests using the runnable harness script", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.malformed-agent-manifest",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        TEST_SKILL_SCRIPT_ONLY,
        "scripts",
        "run.js"
      ),
      skillJsonContents: "{not-json",
      extraScriptSourcePaths: [
        join(
          packageRoot,
          "src",
          "test",
          "fixtures",
          "skills",
          "com.test.agent-skill-result",
          "scripts",
          "fake_codex.js"
        ),
      ],
    });

    const root = dirname(dirname(temp.registryPath));
    const skillDir = join(root, "skills", "com.test.malformed-agent-manifest");
    const harnessPath = join(skillDir, "scripts", "run.js");

    try {
      await writeFile(harnessPath, "#!/usr/bin/env node\nprocess.env.ANDROPERATOR_SKILL_AGENT_CLI_PATH ??= 'missing';\nconsole.log('legacy-looking harness');\n", "utf8");

      const result = await runSkill("com.test.malformed-agent-manifest", [], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /trusted skill result source metadata/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("fails closed for scripted skills when a declared contract is present but the manifest contract is malformed", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.malformed-script-contract",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        TEST_SKILL_SCRIPT_ONLY,
        "scripts",
        "run.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.malformed-script-contract",
        applicationId: "com.test",
        intent: "temp",
        summary: "Temporary test skill",
        path: "skills/com.test.malformed-script-contract",
        skillFile: "skills/com.test.malformed-script-contract/SKILL.md",
        scripts: [
          "skills/com.test.malformed-script-contract/scripts/run.js",
        ],
        artifacts: [],
        contract: {
          inputs: [],
          goal: null,
          verification: null,
        },
      }),
    });

    try {
      await writeFile(
        temp.registryPath,
        JSON.stringify({
          schemaVersion: "1.0",
          generatedAt: "2026-04-11T00:00:00Z",
          skills: [
            {
              id: "com.test.malformed-script-contract",
              applicationId: "com.test",
              intent: "temp",
              summary: "Temporary test skill",
              path: "skills/com.test.malformed-script-contract",
              skillFile: "skills/com.test.malformed-script-contract/SKILL.md",
              scripts: [
                "skills/com.test.malformed-script-contract/scripts/run.js",
              ],
              artifacts: [],
              contract: {
                inputs: {
                  targetPercent: "integer[0,100]",
                },
                goal: {
                  kind: "set",
                },
                verification: {
                  kind: "node_text_matches",
                  matcher: "Discharge to {targetPercent}%",
                },
              },
            },
          ],
        }),
        "utf8"
      );

      const result = await runSkill("com.test.malformed-script-contract", [], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /skill\.json contract is invalid|trusted skill result source metadata/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects malformed agent blocks when parsing skill manifest metadata", () => {
    const result = parseSkillManifestMetadata("/tmp/test-skill.json", {
      agent: {
        cli: "",
      },
    });

    assert.ok(!result.ok);
    assert.match(result.message, /agent\.cli must be a non-empty string/i);
  });

  it("rejects malformed contract blocks when parsing skill manifest metadata", () => {
    const result = parseSkillManifestMetadata("/tmp/test-skill.json", {
      contract: {
        inputs: [],
        goal: null,
        verification: null,
      },
    });

    assert.ok(!result.ok);
    assert.match(result.message, /skill\.json contract is invalid/i);
  });

  it("rejects unsupported contract input schemas when parsing skill manifest metadata", () => {
    const result = parseSkillManifestMetadata("/tmp/test-skill.json", {
      contract: {
        inputs: {
          percent: "float",
        },
        goal: {
          kind: "set_discharge_limit",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Discharge to {percent}%",
        },
      },
    });

    assert.ok(!result.ok);
    assert.match(result.message, /unsupported contract input schema/i);
  });

  it("rejects reversed integer contract ranges when parsing skill manifest metadata", () => {
    const result = parseSkillManifestMetadata("/tmp/test-skill.json", {
      contract: {
        inputs: {
          percent: "integer[100,0]",
        },
        goal: {
          kind: "set_discharge_limit",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Discharge to {percent}%",
        },
      },
    });

    assert.ok(!result.ok);
    assert.match(result.message, /unsupported contract input schema/i);
  });

  it("accepts bare integer contract schemas at runtime", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.bare-integer-contract",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        TEST_SKILL_RESULT,
        "scripts",
        "emit_skill_result.js"
      ),
      skillJsonContents: JSON.stringify({
        id: "com.test.bare-integer-contract",
        applicationId: "com.test",
        intent: "temp",
        summary: "Temporary test skill",
        path: "skills/com.test.bare-integer-contract",
        skillFile: "skills/com.test.bare-integer-contract/SKILL.md",
        scripts: [
          "skills/com.test.bare-integer-contract/scripts/run.js",
        ],
        artifacts: [],
        contract: {
          inputs: {
            targetPercent: "integer",
          },
          goal: {
            kind: "set",
          },
          verification: {
            kind: "node_text_matches",
            matcher: "Discharge to {targetPercent}%",
          },
        },
      }),
    });

    try {
      const result = await runSkill(
        "com.test.bare-integer-contract",
        ["--skill-id", "com.test.bare-integer-contract", "valid", "40"],
        temp.registryPath
      );
      assert.ok(result.ok, `Expected bare integer schema to run successfully: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.strictEqual(result.skillResult?.inputs?.targetPercent, 40);
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects contract input names that cannot be rendered in matcher placeholders", () => {
    const result = parseSkillManifestMetadata("/tmp/test-skill.json", {
      contract: {
        inputs: {
          "target-percent": "integer[0,100]",
        },
        goal: {
          kind: "set_discharge_limit",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Discharge to {target-percent}%",
        },
      },
    });

    assert.ok(!result.ok);
    assert.match(result.message, /contract input names must contain only letters, numbers, and underscores/i);
  });

  it("rejects reserved contract input names", () => {
    const result = parseSkillManifestMetadata("/tmp/test-skill.json", {
      contract: {
        inputs: {
          constructor: "string",
        },
        goal: {
          kind: "set_discharge_limit",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Value {constructor}",
        },
      },
    });

    assert.ok(!result.ok);
    assert.match(result.message, /reserved object property names/i);
  });

  it("rejects matcher placeholders that do not correspond to declared inputs", () => {
    const result = parseSkillManifestMetadata("/tmp/test-skill.json", {
      contract: {
        inputs: {
          percent: "integer[0,100]",
        },
        goal: {
          kind: "set_discharge_limit",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Discharge to {percnt}%",
        },
      },
    });

    assert.ok(!result.ok);
    assert.match(result.message, /undeclared inputs: percnt/i);
  });

  it("validateSkill rejects unsupported declared contract input schemas before execution", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-validate-unsupported-contract-schema-"));
    const skillsDir = join(tempRoot, "skills");
    const skillId = "com.test.unsupported-contract-schema";
    const skillDir = join(skillsDir, skillId);
    const registryPath = join(skillsDir, "skills-registry.json");
    await mkdir(join(skillDir, "scripts"), { recursive: true });

    const entry = {
      id: skillId,
      applicationId: "com.test",
      intent: "temp",
      summary: "Skill with unsupported declared contract schema",
      path: `skills/${skillId}`,
      skillFile: `skills/${skillId}/SKILL.md`,
      scripts: [`skills/${skillId}/scripts/run.js`],
      artifacts: [],
      contract: {
        inputs: {
          percent: "float",
        },
        goal: {
          kind: "set_discharge_limit",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Discharge to {percent}%",
        },
      },
    };

    try {
      await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(skillId), "utf8");
      await writeFile(join(skillDir, "scripts", "run.js"), "#!/usr/bin/env node\nconsole.log('fixture run');\n", "utf8");
      await writeFile(join(skillDir, "skill.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
      await writeFile(registryPath, `${JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-04-11T00:00:00Z", skills: [entry] }, null, 2)}\n`, "utf8");

      const result = await validateSkill(skillId, registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /invalid agent manifest|unsupported contract input schemas/i);
      assert.match(result.details?.reason ?? "", /unsupported contract input schema|supports only 'string' and 'integer/i);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for scripted skills when skill.json appears to declare a malformed contract but the registry is stale", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.stale-registry-contract",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        TEST_SKILL_SCRIPT_ONLY,
        "scripts",
        "run.js"
      ),
      skillJsonContents: "{\"id\":\"com.test.stale-registry-contract\",\"contract\": {",
    });

    try {
      await writeFile(
        temp.registryPath,
        JSON.stringify({
          schemaVersion: "1.0",
          generatedAt: "2026-04-11T00:00:00Z",
          skills: [
            {
              id: "com.test.stale-registry-contract",
              applicationId: "com.test",
              intent: "temp",
              summary: "Temporary test skill",
              path: "skills/com.test.stale-registry-contract",
              skillFile: "skills/com.test.stale-registry-contract/SKILL.md",
              scripts: [
                "skills/com.test.stale-registry-contract/scripts/run.js",
              ],
              artifacts: [],
            },
          ],
        }),
        "utf8"
      );

      const result = await runSkill("com.test.stale-registry-contract", [], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, SKILL_VALIDATION_FAILED);
      assert.match(result.message, /trusted skill result source metadata/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("keeps the legacy path for malformed scripted manifests when only an empty scaffold contract is present", async () => {
    const temp = await createTempRegistryWithSkill({
      skillId: "com.test.empty-contract-legacy",
      scriptSourcePath: join(
        packageRoot,
        "src",
        "test",
        "fixtures",
        "skills",
        "com.test.echo",
        "scripts",
        "echo.js"
      ),
      skillJsonContents: "{\"id\":\"com.test.empty-contract-legacy\",\"contract\":{\"inputs\":{},\"goal\":null,\"verification\":null},\"summary\":",
      scriptRelativePath: "scripts/echo.js",
    });

    try {
      await writeFile(
        temp.registryPath,
        JSON.stringify({
          schemaVersion: "1.0",
          generatedAt: "2026-04-11T00:00:00Z",
          skills: [
            {
              id: "com.test.empty-contract-legacy",
              applicationId: "com.test",
              intent: "temp",
              summary: "Temporary test skill",
              path: "skills/com.test.empty-contract-legacy",
              skillFile: "skills/com.test.empty-contract-legacy/SKILL.md",
              scripts: [
                "skills/com.test.empty-contract-legacy/scripts/echo.js",
              ],
              artifacts: [],
              contract: {
                inputs: {},
                goal: null,
                verification: null,
              },
            },
          ],
        }),
        "utf8"
      );

      const result = await runSkill("com.test.empty-contract-legacy", ["hello"], temp.registryPath);
      assert.ok(result.ok, `Expected empty scaffold contract to preserve legacy execution: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.match(result.output, /TEST_OUTPUT:hello/);
    } finally {
      await temp.cleanup();
    }
  });

  it("redacts raw argv values from declared contract parse failures", async () => {
    const secretValue = "super-secret-argv-value";
    const result = await runSkill(TEST_SKILL_RESULT, ["valid", secretValue]);

    assert.ok(!result.ok);
    assert.strictEqual(result.status, "indeterminate");
    assert.match(result.message, /Could not trust declared input 'targetPercent'/);
    assert.doesNotMatch(result.message, new RegExp(secretValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("binds trusted contract inputs in deterministic key order instead of object insertion order", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-contract-order-runtime-"));
    const skillsDir = join(tempRoot, "skills");
    const skillId = "com.test.runtime-contract-order";
    const skillDir = join(skillsDir, skillId);
    const registryPath = join(skillsDir, "skills-registry.json");
    await mkdir(join(skillDir, "scripts"), { recursive: true });

    const scriptContents = `#!/usr/bin/env node
const [alpha = "", beta = ""] = process.argv.slice(2);
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: { alpha, beta },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: \`Alpha \${alpha} Beta \${beta}\` },
    observed: { kind: "text", text: \`Alpha \${alpha} Beta \${beta}\` }
  },
  execEnvelopes: [],
  diagnostics: { runtimeState: "healthy" }
}));
`;

    const entry = {
      id: skillId,
      applicationId: "com.test",
      intent: "temp",
      summary: "Temporary test skill",
      path: `skills/${skillId}`,
      skillFile: `skills/${skillId}/SKILL.md`,
      scripts: [`skills/${skillId}/scripts/run.js`],
      artifacts: [],
      contract: {
        inputs: {
          beta: "string",
          alpha: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Alpha {alpha} Beta {beta}",
        },
      },
    };

    try {
      await writeFile(join(skillDir, "SKILL.md"), makeSkillMarkdown(skillId), "utf8");
      await writeFile(join(skillDir, "scripts", "run.js"), scriptContents, "utf8");
      await writeFile(join(skillDir, "skill.json"), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
      await writeFile(
        registryPath,
        `${JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-04-13T00:00:00Z", skills: [entry] }, null, 2)}\n`,
        "utf8"
      );

      const result = await runSkill(skillId, ["first", "second"], registryPath);
      assert.ok(result.ok, `Expected deterministic key-order binding to prove the contract: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { alpha: "first", beta: "second" });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("trusts declared contract inputs passed entirely through named flags", async () => {
    const skillId = "com.test.named-contract-inputs";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
const args = process.argv.slice(2);
let temperature = "";
let unitName = "";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index] ?? "";
  if (arg === "--temperature") {
    temperature = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg.startsWith("--temperature=")) {
    temperature = arg.slice("--temperature=".length);
    continue;
  }
  if (arg === "--unit-name") {
    unitName = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg.startsWith("--unit-name=")) {
    unitName = arg.slice("--unit-name=".length);
  }
}
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: Number.parseInt(temperature, 10),
    unit_name: unitName,
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
    observed: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["--temperature", "23", "--unit-name", "Panasonic"], temp.registryPath);
      assert.ok(result.ok, `Expected named declared inputs to verify successfully: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { temperature: 23, unit_name: "Panasonic" });
    } finally {
      await temp.cleanup();
    }
  });

  it("mixes named and positional declared contract inputs without treating named values as fallback positional args", async () => {
    const skillId = "com.test.mixed-contract-inputs";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
const args = process.argv.slice(2);
let temperature = "";
let unitName = "";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index] ?? "";
  if (arg === "--unit-name") {
    unitName = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg.startsWith("--unit-name=")) {
    unitName = arg.slice("--unit-name=".length);
    continue;
  }
  if (!arg.startsWith("--") && !temperature) {
    temperature = arg;
  }
}
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: Number.parseInt(temperature, 10),
    unit_name: unitName,
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
    observed: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["23", "--unit-name", "Panasonic"], temp.registryPath);
      assert.ok(result.ok, `Expected mixed named and positional declared inputs to verify successfully: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { temperature: 23, unit_name: "Panasonic" });
    } finally {
      await temp.cleanup();
    }
  });

  it("supports equals-style named flags for declared contract inputs", async () => {
    const skillId = "com.test.equals-style-contract-inputs";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
const args = process.argv.slice(2);
let temperature = "";
let unitName = "";
for (const arg of args) {
  if (arg.startsWith("--temperature=")) {
    temperature = arg.slice("--temperature=".length);
    continue;
  }
  if (arg.startsWith("--unit-name=")) {
    unitName = arg.slice("--unit-name=".length);
  }
}
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: Number.parseInt(temperature, 10),
    unit_name: unitName,
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
    observed: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["--temperature=23", "--unit-name=Panasonic"], temp.registryPath);
      assert.ok(result.ok, `Expected equals-style named declared inputs to verify successfully: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { temperature: 23, unit_name: "Panasonic" });
    } finally {
      await temp.cleanup();
    }
  });

  it("fails closed when a declared named input is missing instead of stealing another flag's value as positional fallback", async () => {
    const skillId = "com.test.missing-named-contract-input";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: 23,
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: "Unit missing Temp 23" },
    observed: { kind: "text", text: "Unit missing Temp 23" },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["--temperature", "23"], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.status, "indeterminate");
      assert.match(result.message, /only 1 named input and 0 positional args were available/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("fails closed when a declared named flag is followed by another flag token instead of a real value", async () => {
    const skillId = "com.test.named-flag-followed-by-flag-token";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: 23,
    unit_name: "--temperature",
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: "Unit --temperature Temp 23" },
    observed: { kind: "text", text: "Unit --temperature Temp 23" },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["--unit-name", "--temperature", "23"], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.status, "indeterminate");
      assert.match(result.message, /only 1 named input and 0 positional args were available/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("fails closed when an unknown flag value would otherwise leak into positional fallback", async () => {
    const skillId = "com.test.unknown-flag-positional-leak";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: 23,
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: "Unit kitchen Temp 23" },
    observed: { kind: "text", text: "Unit kitchen Temp 23" },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["--temperature", "23", "--foo", "kitchen"], temp.registryPath);
      assert.ok(!result.ok);
      assert.strictEqual(result.status, "indeterminate");
      assert.match(result.message, /only 1 named input and 0 positional args were available/i);
    } finally {
      await temp.cleanup();
    }
  });

  it("keeps legitimate positional fallback args after unknown equals-style flags", async () => {
    const skillId = "com.test.unknown-equals-flag-preserves-positional";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: 23,
    unit_name: "kitchen",
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: "Unit kitchen Temp 23" },
    observed: { kind: "text", text: "Unit kitchen Temp 23" },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["--temperature", "23", "--foo=bar", "kitchen"], temp.registryPath);
      assert.ok(result.ok, `Expected unknown equals-style flags to preserve positional fallback args: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { temperature: 23, unit_name: "kitchen" });
    } finally {
      await temp.cleanup();
    }
  });

  it("preserves standalone flag-shaped positional literals for declared string inputs", async () => {
    const skillId = "com.test.positional-flag-shaped-literal";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "echo" },
  inputs: {
    phrase: "--help",
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: "Phrase --help" },
    observed: { kind: "text", text: "Phrase --help" },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          phrase: "string",
        },
        goal: {
          kind: "echo",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Phrase {phrase}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["--help"], temp.registryPath);
      assert.ok(result.ok);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { phrase: "--help" });
    } finally {
      await temp.cleanup();
    }
  });

  it("preserves equals-style positional literals for declared string inputs", async () => {
    const skillId = "com.test.positional-equals-shaped-literal";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "echo" },
  inputs: {
    phrase: "--foo=bar",
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: "Phrase --foo=bar" },
    observed: { kind: "text", text: "Phrase --foo=bar" },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          phrase: "string",
        },
        goal: {
          kind: "echo",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Phrase {phrase}",
        },
      },
    });

    try {
      const result = await runSkill(skillId, ["--foo=bar"], temp.registryPath);
      assert.ok(result.ok);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { phrase: "--foo=bar" });
    } finally {
      await temp.cleanup();
    }
  });

  it("uses the last duplicate named flag value when trusting declared contract inputs", async () => {
    const skillId = "com.test.duplicate-named-contract-inputs";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
const args = process.argv.slice(2);
let temperature = "";
let unitName = "";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index] ?? "";
  if (arg === "--temperature") {
    temperature = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg.startsWith("--temperature=")) {
    temperature = arg.slice("--temperature=".length);
    continue;
  }
  if (arg === "--unit-name") {
    unitName = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg.startsWith("--unit-name=")) {
    unitName = arg.slice("--unit-name=".length);
  }
}
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: Number.parseInt(temperature, 10),
    unit_name: unitName,
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
    observed: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      const result = await runSkill(
        skillId,
        ["--temperature", "22", "--unit-name", "Bedroom", "--temperature", "23", "--unit-name", "Panasonic"],
        temp.registryPath
      );
      assert.ok(result.ok, `Expected duplicate named declared inputs to verify successfully: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { temperature: 23, unit_name: "Panasonic" });
    } finally {
      await temp.cleanup();
    }
  });

  it("resolves a consecutive duplicate named flag when the first occurrence lacks a value", async () => {
    const skillId = "com.test.consecutive-duplicate-no-value-first";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
const args = process.argv.slice(2);
let temperature = "";
let unitName = "";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index] ?? "";
  if (arg === "--temperature") {
    const next = args[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      temperature = next;
      index += 1;
    }
    continue;
  }
  if (arg === "--unit-name") {
    const next = args[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      unitName = next;
      index += 1;
    }
    continue;
  }
}
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: Number.parseInt(temperature, 10),
    unit_name: unitName,
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
    observed: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      // --unit-name appears twice; the first occurrence is immediately followed by another flag
      // (no value consumed), so the second occurrence must be the one that resolves the input.
      const result = await runSkill(
        skillId,
        ["--unit-name", "--unit-name", "Panasonic", "--temperature", "23"],
        temp.registryPath
      );
      assert.ok(result.ok, `Expected consecutive duplicate named flag to resolve via second occurrence: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { temperature: 23, unit_name: "Panasonic" });
    } finally {
      await temp.cleanup();
    }
  });

  it("keeps the previously resolved value when the last duplicate named flag occurrence lacks a value", async () => {
    const skillId = "com.test.duplicate-last-occurrence-no-value";
    const temp = await createTempRegistryWithInlineScript({
      skillId,
      scriptContents: `#!/usr/bin/env node
const args = process.argv.slice(2);
let temperature = "";
let unitName = "";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index] ?? "";
  if (arg === "--temperature") {
    const next = args[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      temperature = next;
      index += 1;
    }
    continue;
  }
  if (arg === "--unit-name") {
    const next = args[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      unitName = next;
      index += 1;
    }
    continue;
  }
}
console.log("[Androperator-Skill-Result]");
console.log(JSON.stringify({
  contractVersion: "1.0.0",
  result: null,
  skillId: "${skillId}",
  goal: { kind: "set" },
  inputs: {
    temperature: Number.parseInt(temperature, 10),
    unit_name: unitName,
  },
  status: "success",
  checkpoints: [],
  terminalVerification: {
    status: "verified",
    expected: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
    observed: { kind: "text", text: \`Unit \${unitName} Temp \${temperature}\` },
  },
  diagnostics: { runtimeState: "healthy" },
}));`,
      contract: {
        inputs: {
          temperature: "integer",
          unit_name: "string",
        },
        goal: {
          kind: "set",
        },
        verification: {
          kind: "node_text_matches",
          matcher: "Unit {unit_name} Temp {temperature}",
        },
      },
    });

    try {
      // The trailing --temperature has no following value; the resolver treats it as a no-op
      // and keeps the previously resolved value of 22.
      const result = await runSkill(
        skillId,
        ["--temperature", "22", "--unit-name", "Panasonic", "--temperature"],
        temp.registryPath
      );
      assert.ok(result.ok, `Expected valueless trailing duplicate flag to be a no-op: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.status, "success");
      assert.deepStrictEqual(result.skillResult?.inputs, { temperature: 22, unit_name: "Panasonic" });
    } finally {
      await temp.cleanup();
    }
  });

  it("rejects unsupported SkillResult contract major versions", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["unsupported-major"]);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_RESULT_PARSE_FAILED);
    assert.match(result.message, /Unsupported SkillResult contract major version 2/);
    assert.strictEqual(result.skillResult, null);
  });

  it("accepts newer SkillResult minor versions on the same major", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["newer-minor", "40"]);

    assert.ok(result.ok, `Expected newer minor version to succeed: ${"message" in result ? result.message : ""}`);
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.contractVersion, "1.2.0");
    assert.ok(!("extraField" in result.skillResult));
  });

  it("accepts raw ResultEnvelope data values in execEnvelopes and normalizes them to strings", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["raw-envelope-data", "40"]);

    assert.ok(result.ok, `Expected raw execEnvelopes to parse successfully: ${"message" in result ? result.message : ""}`);
    assert.ok(result.skillResult);
    assert.ok(result.skillResult.execEnvelopes);
    assert.strictEqual(result.skillResult.execEnvelopes.length, 1);
    assert.strictEqual(result.skillResult.execEnvelopes[0].stepResults.length, 1);
    assert.deepStrictEqual(result.skillResult.execEnvelopes[0].stepResults[0].data, {
      duration_ms: "1000",
      ok: "true",
      retries: "0",
      note: "kept",
    });
  });

  it("keeps progress lines before the result line in result.output", async () => {
    const result = await runSkill(TEST_SKILL_PROGRESS, []);
    assert.ok(result.ok, `Expected progress fixture to succeed: ${"message" in result ? result.message : ""}`);

    const lines = result.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const resultIndex = lines.findIndex((line) => line.startsWith("✅"));
    const progressLines = lines.filter((line) => line.startsWith("[skill:"));

    assert.ok(progressLines.length > 0, "expected at least one progress line");
    assert.ok(resultIndex >= 0, "expected a canonical result line");
    assert.strictEqual(lines[lines.length - 1].startsWith("✅"), true, "✅ line must be last");
    assert.ok(progressLines.every((line) => lines.indexOf(line) < resultIndex), "progress must precede result");
    assert.ok(!lines.slice(resultIndex + 1).some((line) => line.startsWith("[skill:")), "no progress after result");
  });

  it("preserves progress lines in JSON mode result.output", async () => {
    const { stdout, stderr, code } = await runCli([
      "skills",
      "run",
      TEST_SKILL_PROGRESS,
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 0, stderr);
    const parsed = JSON.parse(stdout) as { output?: string };
    assert.ok(typeof parsed.output === "string");

    const outputLines = parsed.output!.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    assert.ok(outputLines.some((line) => line.startsWith("[skill:")), "expected progress lines in result.output");
    const resultLines = outputLines.filter((line) => line.startsWith("✅"));
    assert.strictEqual(resultLines.length, 1, "expected exactly one canonical result line");
    assert.ok(resultLines[0].includes("Progress fixture complete"));
  });

  it("CLI skills run includes skillResult in JSON output when present", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      TEST_SKILL_RESULT,
      "--output",
      "json",
      "--",
      "40",
    ], {
      env: {
        ...process.env,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
        TEST_SKILL_MODE: "valid",
      },
    });

    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as {
      status?: string;
      skillId?: string;
      output?: string;
      exitCode?: number;
      skillResult?: {
        skillId?: string;
        source?: { kind?: string };
      } | null;
    };

    assert.strictEqual(parsed.skillResult?.skillId, TEST_SKILL_RESULT);
    assert.strictEqual(parsed.skillResult?.source?.kind, "script");
    assert.strictEqual(parsed.status, "success");
    assert.strictEqual(parsed.skillId, undefined);
    assert.strictEqual(parsed.exitCode, undefined);
    assert.strictEqual(parsed.output, undefined);
  });

  it("CLI skills run surfaces indeterminate for declared-but-unproved verification", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      TEST_SKILL_RESULT,
      "--output",
      "json",
      "--",
      "40",
    ], {
      env: {
        ...process.env,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
        TEST_SKILL_MODE: "legacy",
      },
    });

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as {
      status?: string;
      code?: string;
      message?: string;
      skillResult?: unknown;
    };
    assert.strictEqual(parsed.status, "indeterminate");
    assert.strictEqual(parsed.code, "SKILL_VERIFICATION_INDETERMINATE");
    assert.match(parsed.message ?? "", /did not emit a SkillResult|did not prove/i);
    assert.strictEqual(parsed.skillResult, null);
  });

  it("returns partial stdout when a skill times out", async () => {
    const result = await runSkill("com.test.partial-timeout", [], undefined, 150);
    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_TIMEOUT);
    assert.ok(result.stdout?.includes('"stage":"before-timeout"'));
  });

  it("returns timeout for orchestrated skills and preserves timeout precedence over any later frame", async () => {
    const result = await runSkill(TEST_AGENT_SKILL_RESULT, ["timeout", "40"], undefined, 300);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_TIMEOUT);
    assert.ok(result.stdout?.includes('"stage":"before-timeout"'));
    assert.strictEqual(result.skillResult, null);
  });

  it("reports timeout instead of parse failure when a framed result is cut off by timeout", async () => {
    const result = await runSkill(TEST_SKILL_RESULT, ["partial-frame-timeout"], undefined, 300);

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_TIMEOUT);
    assert.ok(result.stdout?.includes("[Androperator-Skill-Result]"));
    assert.strictEqual(result.skillResult, null);
  });

  it("CLI skills run includes partial stdout on failure", async () => {
    const { stdout, code } = await runCli(["skills", "run", "com.test.fail", "--output", "json"]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; stdout?: string; stderr?: string };
    assert.strictEqual(parsed.code, SKILL_EXECUTION_FAILED);
    assert.ok(parsed.stdout?.includes('"stage":"before-failure"'));
    assert.ok(parsed.stderr?.includes("FAIL_OUTPUT:intentional"));
  });

  it("CLI skills run accepts --timeout-ms and returns it in the success payload", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.echo", "--timeout-ms", "3210", "--output", "json", "--", "hello", "world",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { skillId?: string; output?: string; timeoutMs?: number };
    assert.strictEqual(parsed.skillId, "com.test.echo");
    assert.strictEqual(parsed.timeoutMs, 3210);
    assert.ok(parsed.output?.includes("TEST_OUTPUT:hello"));
  });

  it("CLI skills run prefers local --timeout-ms over the global flag", async () => {
    const { stdout, code } = await runCli([
      "--timeout-ms", "9000",
      "skills", "run", "com.test.echo", "--timeout-ms", "3210", "--output", "json", "--", "hello",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { skillId?: string; timeoutMs?: number };
    assert.strictEqual(parsed.skillId, "com.test.echo");
    assert.strictEqual(parsed.timeoutMs, 3210);
  });

  it("CLI skills run accepts --timeout as a local timeout flag", async () => {
    // Verifies that --timeout is recognised in the command-local segment.
    // Note: getGlobalOpts scans argv for globals only before the first bare `--`; the local
    // `--timeout` (3210) wins over the global (9000) for execution budget.
    const { stdout, code } = await runCli([
      "--timeout", "9000",
      "skills", "run", "com.test.echo", "--timeout", "3210", "--output", "json", "--", "hello",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { skillId?: string; timeoutMs?: number };
    assert.strictEqual(parsed.skillId, "com.test.echo");
    assert.strictEqual(parsed.timeoutMs, 3210);
  });

  it("CLI skills run forwards flag-like tokens after -- without getGlobalOpts consuming them", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.echo",
      "--output",
      "json",
      "--",
      "--timeout",
      "not-a-global-timeout",
      "--device",
      "not-a-global-device",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string; timeoutMs?: number | undefined };
    assert.ok(parsed.output?.includes("TEST_OUTPUT:--timeout"));
    assert.strictEqual(parsed.timeoutMs, undefined);
  });

  it("CLI skills run forwards unknown named flags without requiring --", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.echo-all",
      "--output",
      "json",
      "--limit",
      "40",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string; timeoutMs?: number | undefined };
    assert.ok(parsed.output?.includes("TEST_OUTPUT:--limit"));
    assert.ok(parsed.output?.includes("TEST_OUTPUT:40"));
    assert.strictEqual(parsed.timeoutMs, undefined);
  });

  it("CLI skills run forwards --device exactly once on the real CLI path", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.echo-all",
      "--device",
      "device-123",
      "--operator-package",
      "com.androperator.operator.dev",
      "--output",
      "json",
      "--",
      "--limit",
      "40",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
      },
    });
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string };
    const outputLines = (parsed.output ?? "").trim().split(/\r?\n/);
    assert.deepStrictEqual(outputLines, [
      "TEST_OUTPUT:device-123",
      "TEST_OUTPUT:--limit",
      "TEST_OUTPUT:40",
    ]);
  });

  it("CLI skills run keeps --device out of ANDROPERATOR_SKILL_INPUTS for agent-driven skills", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.agent-skill-result",
      "--device",
      "device-123",
      "--operator-package",
      "com.androperator.operator.dev",
      "--output",
      "json",
      "--",
      "env-check",
      "40",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
        EXPECTED_DEVICE_ID: "device-123",
      },
    });
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { skillResult?: { source?: { kind?: string } } | null };
    assert.strictEqual(parsed.skillResult?.source?.kind, "agent");
  });

  it("CLI skills run rejects a typo in a known wrapper flag after the skill id", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.echo-all",
      "--skip-validtae",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "USAGE");
    assert.strictEqual(parsed.message, "unrecognized flag '--skip-validtae'. Did you mean '--skip-validate'?");
  });

  it("CLI skills run rejects a typo in a known value-taking wrapper flag after the skill id", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.echo-all",
      "--expect-contians",
      "needle",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "USAGE");
    assert.strictEqual(parsed.message, "unrecognized flag '--expect-contians'. Did you mean '--expect-contains'?");
  });

  it("CLI skills run preserves alias-like tokens after -- without rewriting", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.echo",
      "--output",
      "json",
      "--",
      "--timeout-ms",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string };
    assert.ok(parsed.output?.includes("TEST_OUTPUT:--timeout-ms"));
    assert.doesNotMatch(parsed.output ?? "", /TEST_OUTPUT:--timeout$/m);
  });

  it("CLI skills run forwards --help after -- without triggering top-level help", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.echo",
      "--output",
      "json",
      "--",
      "--help",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string };
    assert.ok(parsed.output?.includes("TEST_OUTPUT:--help"));
    assert.doesNotMatch(stdout, /androperator skills install/);
  });

  it("CLI skills run forwards --version after -- without triggering CLI version output", async () => {
    const { stdout, code } = await runCli([
      "skills",
      "run",
      "com.test.echo",
      "--output",
      "json",
      "--",
      "--version",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string };
    assert.ok(parsed.output?.includes("TEST_OUTPUT:--version"));
    assert.doesNotMatch(stdout, /^\d+\.\d+\.\d+$/m);
  });

  it("CLI skills run still applies global flags that appear before the first --", async () => {
    const { stdout, code } = await runCli([
      "--timeout-ms",
      "4500",
      "skills",
      "run",
      "com.test.echo",
      "--output",
      "json",
      "--",
      "--timeout",
      "script-arg",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string; timeoutMs?: number };
    assert.strictEqual(parsed.timeoutMs, 4500);
    assert.ok(parsed.output?.includes("TEST_OUTPUT:--timeout"));
  });

  it("CLI skills run rejects a non-numeric local --timeout-ms", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.echo", "--timeout-ms", "abc", "--output", "json", "--", "hello",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.equal(JSON.parse(stdout).status, "failed");
    assert.strictEqual(parsed.code, "EXECUTION_VALIDATION_FAILED");
    assert.strictEqual(parsed.message, "timeoutMs must be a finite number");
  });

  it("CLI skills run rejects a non-numeric global --timeout-ms", async () => {
    const { stdout, code } = await runCli([
      "--timeout-ms", "abc",
      "skills", "run", "com.test.echo", "--output", "json", "--", "hello",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.equal(JSON.parse(stdout).status, "failed");
    assert.strictEqual(parsed.code, "EXECUTION_VALIDATION_FAILED");
    assert.strictEqual(parsed.message, "timeoutMs must be a finite number");
  });

  it("CLI skills run returns USAGE when local --timeout-ms is missing a value", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.echo", "--timeout-ms",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.equal(JSON.parse(stdout).status, "failed");
    assert.strictEqual(parsed.code, "USAGE");
    assert.strictEqual(parsed.message, "--timeout requires a value");
  });

  it("CLI skills run returns USAGE when --expect-contains is missing a value", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.echo", "--expect-contains",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.equal(JSON.parse(stdout).status, "failed");
    assert.strictEqual(parsed.code, "USAGE");
    assert.strictEqual(parsed.message, "--expect-contains requires a value");
  });

  it("CLI skills run returns USAGE when --expect-contains is followed by another flag", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.echo", "--expect-contains", "--timeout", "5000",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.equal(JSON.parse(stdout).status, "failed");
    assert.strictEqual(parsed.code, "USAGE");
    assert.strictEqual(parsed.message, "--expect-contains requires a value");
  });

  it("CLI skills run accepts an escaped double-dash literal for --expect-contains", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.echo", "--output", "json", "--expect-contains", "--", "TEST_OUTPUT:--help", "--", "--help",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { expectedSubstring?: string; output?: string };
    assert.strictEqual(parsed.expectedSubstring, "TEST_OUTPUT:--help");
    assert.ok(parsed.output?.includes("TEST_OUTPUT:--help"));
  });

  it("CLI skills run returns usage when skill_id is missing even with --timeout", async () => {
    const { stdout } = await runCli(["skills", "run", "--timeout", "5000", "--output", "json"]);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.equal(JSON.parse(stdout).status, "failed");
    assert.strictEqual(parsed.code, "USAGE");
    assert.ok(parsed.message?.includes("--timeout"));
  });

  it("CLI skills run can assert output content", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.echo", "--expect-contains", "TEST_OUTPUT:hello", "--output", "json", "--", "hello",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { expectedSubstring?: string; output?: string };
    assert.strictEqual(parsed.expectedSubstring, "TEST_OUTPUT:hello");
    assert.ok(parsed.output?.includes("TEST_OUTPUT:hello"));
  });

  it("CLI skills run returns assertion failure when expected text is missing", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.echo", "--expect-contains", "missing-value", "--output", "json", "--", "hello",
    ]);
    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; expectedSubstring?: string; output?: string };
    assert.strictEqual(parsed.code, SKILL_OUTPUT_ASSERTION_FAILED);
    assert.strictEqual(parsed.expectedSubstring, "missing-value");
    assert.ok(parsed.output?.includes("TEST_OUTPUT:hello"));
  });

  it("CLI skills run expects substrings across chunk boundaries", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", TEST_FIXTURE_SPLIT_WORD, "--expect-contains", "hello", "--output", "json",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { skillId?: string; expectedSubstring?: string; output?: string };
    assert.strictEqual(parsed.skillId, TEST_FIXTURE_SPLIT_WORD);
    assert.strictEqual(parsed.expectedSubstring, "hello");
    assert.strictEqual(parsed.output, "hello\n");
  });

  it("CLI skills run keeps json output parseable without live skill output", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const { stdout, code } = await runCli([
      "skills", "run", TEST_FIXTURE_CHUNKED_OUTPUT, "--operator-package", "com.androperator.operator.dev", "--output", "json",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
      },
    });
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string; skillId?: string };
    assert.strictEqual(parsed.skillId, TEST_FIXTURE_CHUNKED_OUTPUT);
    assert.ok(parsed.output?.includes("chunk1"));
    assert.ok(parsed.output?.includes("chunk2"));
    assert.ok(!stdout.includes("[Androperator]"));
  });

  it("CLI skills run routes the banner through the logger in pretty mode", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const tempLogDir = await mkdtemp(join(tmpdir(), "androperator-banner-logs-"));
    const logPath = getLogPathForDir(tempLogDir);
    const { stdout, stderr, code } = await runCli([
      "skills", "run", TEST_FIXTURE_CHUNKED_OUTPUT, "--operator-package", "com.androperator.operator.dev", "--log-level", "debug", "--output", "pretty",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
        ANDROPERATOR_LOG_DIR: tempLogDir,
      },
    });
    assert.strictEqual(code, 0, stdout);
    const version = await getPackageVersion();
    assert.ok(stdout.includes("chunk1"), stdout);
    assert.ok(stdout.includes("chunk2"), stdout);
    const stderrLines = stderr.split(/\r?\n/).filter((line) => line.length > 0);
    assert.ok(stderrLines[0]?.startsWith(`[Androperator] v${version}  APK: OK (com.androperator.operator.dev)`), stderrLines[0]);
    assert.ok(stderrLines[0]?.includes(`Logs: ${logPath}`), stderrLines[0]);
    assert.ok(stderrLines[0]?.includes(`Hint: tail -f '${logPath}'`), stderrLines[0]);
    assert.ok(stderrLines[0]?.includes("Docs: https://docs.androperator.com/llms.txt"), stderrLines[0]);
    const contents = await readFile(logPath, "utf8");
    const events = parseLogEvents(contents);
    const bannerEvent = events.find((event) => event.event === "cli.banner");
    assert.ok(bannerEvent, `Expected cli.banner in ${logPath}`);
    assert.strictEqual(bannerEvent?.skillId, TEST_FIXTURE_CHUNKED_OUTPUT);
    assert.strictEqual(bannerEvent?.level, "debug");
  });

  it("CLI skills run emits cli.banner in JSON mode", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const tempLogDir = await mkdtemp(join(tmpdir(), "androperator-banner-json-logs-"));
    try {
      const { stdout, stderr, code } = await runCli([
        "skills",
        "run",
        TEST_FIXTURE_CHUNKED_OUTPUT,
        "--operator-package",
        "com.androperator.operator.dev",
        "--log-level",
        "debug",
        "--output",
        "json",
      ], {
        env: {
          ...process.env,
          PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
          ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
          ANDROPERATOR_LOG_DIR: tempLogDir,
        },
      });
      assert.strictEqual(code, 0, stdout);
      assert.ok(!stderr.includes("[Androperator]"), stderr);
      const contents = await readFile(getLogPathForDir(tempLogDir), "utf8");
      const events = parseLogEvents(contents);
      const bannerEvent = events.find((event) => event.event === "cli.banner");
      assert.ok(bannerEvent, `Expected cli.banner in ${tempLogDir}`);
      assert.strictEqual(bannerEvent?.skillId, TEST_FIXTURE_CHUNKED_OUTPUT);
      assert.strictEqual(bannerEvent?.level, "debug");
    } finally {
      await rm(tempLogDir, { recursive: true, force: true });
    }
  });

  it("CLI skills run banner reflects ANDROPERATOR_LOG_DIR overrides", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const tempLogDir = await mkdtemp(join(tmpdir(), "androperator-logs-"));
    try {
      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const expectedLogPath = join(tempLogDir, `androperator-${yyyy}-${mm}-${dd}.log`);
      const { stdout, stderr, code } = await runCli([
        "skills", "run", TEST_FIXTURE_CHUNKED_OUTPUT, "--operator-package", "com.androperator.operator.dev", "--output", "pretty",
      ], {
        env: {
          ...process.env,
          PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
          ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
          ANDROPERATOR_LOG_DIR: tempLogDir,
        },
      });
      assert.strictEqual(code, 0, stdout);
      const lines = stderr.split(/\r?\n/).filter((line) => line.length > 0);
      assert.ok(lines[0]?.includes(`Logs: ${expectedLogPath}`), lines[0]);
      assert.ok(lines[0]?.includes(`Hint: tail -f '${expectedLogPath}'`), lines[0]);
    } finally {
      await rm(tempLogDir, { recursive: true, force: true });
    }
  });

  it("CLI skills run preserves variant mismatch details in the pretty banner", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator",
      installedPackage: "com.androperator.operator.dev",
    });
    const { stdout, stderr, code } = await runCli([
      "skills", "run", TEST_FIXTURE_CHUNKED_OUTPUT, "--operator-package", "com.androperator.operator", "--output", "pretty",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
      },
    });
    assert.strictEqual(code, 0, stdout);
    const firstLine = stderr.split(/\r?\n/, 1)[0] ?? "";
    assert.match(firstLine, /Wrong Operator variant installed/);
    assert.match(firstLine, /Expected com\.androperator\.operator but found com\.androperator\.operator\.dev/);
    assert.match(firstLine, /APK: FAIL/);
  });

  it("CLI skills run preserves adb failure details in the pretty banner", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: false,
      operatorPackage: "com.androperator.operator",
      packageListCode: 1,
      packageListStderr: "adb: device offline",
    });
    const { stdout, stderr, code } = await runCli([
      "skills", "run", TEST_FIXTURE_CHUNKED_OUTPUT, "--operator-package", "com.androperator.operator", "--output", "pretty",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
      },
    });
    assert.strictEqual(code, 0, stdout);
    const firstLine = stderr.split(/\r?\n/, 1)[0] ?? "";
    assert.match(firstLine, /Could not query installed packages on the device/);
    assert.match(firstLine, /adb: device offline/);
    assert.ok(!firstLine.includes("MISSING - run `androperator operator setup --apk <path>`"));
  });

  it("CLI skills run suppresses the banner in json mode", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const { stdout, stderr, code } = await runCli([
      "skills", "run", TEST_FIXTURE_CHUNKED_OUTPUT, "--operator-package", "com.androperator.operator.dev", "--output", "json",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
      },
    });
    assert.strictEqual(code, 0, stdout);
    assert.doesNotThrow(() => JSON.parse(stdout));
    assert.ok(!stdout.includes("[Androperator]"));
    assert.ok(!stderr.includes("[Androperator]"));
  });
});

describe("cmdSkillsRun preflight gate", () => {
  const passingApkPresence = {
    id: "readiness.apk.presence",
    status: "pass",
    summary: "Operator APK (com.androperator.operator.dev) is installed.",
  } as const;
  const allowInteractiveTarget = async () => ({
    ok: true,
    deviceId: "resolved-device-123",
    apkPresence: passingApkPresence,
  } as const);

  it("skips the interactive probe when operator readiness is not pass", async () => {
    let probeCalls = 0;

    const result = await resolveInteractiveSkillTarget("com.androperator.operator.dev", {
      deviceId: "resolved-device-123",
      resolveDeviceImpl: async () => ({ deviceId: "resolved-device-123", serial: "resolved-device-123" }),
      checkApkPresenceImpl: async () => ({
        id: "readiness.apk.presence",
        status: "fail",
        code: ERROR_CODES.OPERATOR_NOT_INSTALLED,
        summary: "Operator APK not installed.",
        detail: "Package com.androperator.operator.dev was not found on the device.",
        fix: {
          title: "Install Operator APK",
          platform: "any",
          steps: [{ kind: "shell", value: "androperator operator setup --apk /tmp/operator-debug.apk --device resolved-device-123 --operator-package com.androperator.operator.dev" }],
        },
      }),
      probeInteractiveStateImpl: async () => {
        probeCalls += 1;
        return {
          ok: true,
          state: {
            screenOn: true,
            interactive: true,
            deviceLocked: false,
            userUnlocked: true,
          },
        };
      },
    });

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.deviceId, "resolved-device-123");
      assert.strictEqual(result.apkPresence.status, "fail");
      assert.strictEqual(result.apkPresence.code, ERROR_CODES.OPERATOR_NOT_INSTALLED);
    }
    assert.strictEqual(probeCalls, 0);
  });

  it("treats an awake but locked target as not interactive", async () => {
    const result = await resolveInteractiveSkillTarget("com.androperator.operator.dev", {
      deviceId: "resolved-device-123",
      resolveDeviceImpl: async () => ({ deviceId: "resolved-device-123", serial: "resolved-device-123" }),
      checkApkPresenceImpl: async () => passingApkPresence,
      probeInteractiveStateImpl: async () => ({
        ok: true,
        state: {
          screenOn: true,
          interactive: true,
          deviceLocked: true,
          userUnlocked: true,
        },
      }),
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.DEVICE_NOT_INTERACTIVE);
      assert.deepStrictEqual(result.error.details, {
        phase: "readiness", dispatchState: "not_dispatched", wakeAttempts: [],
      });
      assert.strictEqual(result.error.message, "Device is not interactive. Interactive automation requires an awake, usable device state.");
    }
  });

  it("normalizes thrown readiness preflight errors into a structured command error", async () => {
    const result = await resolveInteractiveSkillTarget("com.androperator.operator.dev", {
      deviceId: "resolved-device-123",
      resolveDeviceImpl: async () => ({ deviceId: "resolved-device-123", serial: "resolved-device-123" }),
      checkApkPresenceImpl: async () => {
        throw Object.assign(new Error("adb shell broke"), {
          code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
          details: { command: "pm list packages" },
        });
      },
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.DEVICE_SHELL_UNAVAILABLE);
      assert.strictEqual(result.error.message, "adb shell broke");
      assert.deepStrictEqual(result.error.details, { command: "pm list packages" });
    }
  });

  it("preserves non-interactive-preflight diagnostics from the shared readiness helper", async () => {
    const result = await resolveInteractiveSkillTarget("com.androperator.operator.dev", {
      deviceId: "resolved-device-123",
      resolveDeviceImpl: async () => ({ deviceId: "resolved-device-123", serial: "resolved-device-123" }),
      checkApkPresenceImpl: async () => passingApkPresence,
      ensureInteractiveAutomationReadyImpl: async () => ({
        ok: false,
        error: {
          code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
          message: "adb shell broke",
          details: {
            screenOn: false,
            deviceLocked: false,
            userUnlocked: true,
          },
        },
      }),
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.DEVICE_SHELL_UNAVAILABLE);
      assert.strictEqual(result.error.message, "adb shell broke");
      assert.deepStrictEqual(result.error.details, {
        screenOn: false,
        deviceLocked: false,
        userUnlocked: true,
      });
      assert.strictEqual(result.error.deviceId, "resolved-device-123");
    }
  });

  it("accepts a target when the shared readiness helper wakes the device", async () => {
    let readinessCalls = 0;

    const result = await resolveInteractiveSkillTarget("com.androperator.operator.dev", {
      deviceId: "resolved-device-123",
      resolveDeviceImpl: async () => ({ deviceId: "resolved-device-123", serial: "resolved-device-123" }),
      checkApkPresenceImpl: async () => passingApkPresence,
      ensureInteractiveAutomationReadyImpl: async () => {
        readinessCalls += 1;
        return {
          ok: true,
          state: {
            screenOn: true,
            interactive: true,
            deviceLocked: false,
            userUnlocked: true,
          },
        };
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(readinessCalls, 1);
  });

  it("uses the configured adb path for wrapper preflight", async () => {
    const observedAdbPaths: string[] = [];

    const result = await resolveInteractiveSkillTarget("com.androperator.operator.dev", {
      adbPath: "/custom/platform-tools/adb",
      deviceId: "resolved-device-123",
      resolveDeviceImpl: async (config) => {
        observedAdbPaths.push(config.adbPath);
        return { deviceId: "resolved-device-123", serial: "resolved-device-123" };
      },
      checkApkPresenceImpl: async (config) => {
        observedAdbPaths.push(config.adbPath);
        return passingApkPresence;
      },
      probeInteractiveStateImpl: async (config) => {
        observedAdbPaths.push(config.adbPath);
        return {
          ok: true,
          state: {
            screenOn: true,
            interactive: true,
            deviceLocked: false,
            userUnlocked: true,
          },
        };
      },
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(observedAdbPaths, [
      "/custom/platform-tools/adb",
      "/custom/platform-tools/adb",
      "/custom/platform-tools/adb",
    ]);
  });

  it("aborts invalid artifact skills before runSkill is called", async () => {
    let runCalls = 0;
    const logDir = await mkdtemp(join(tmpdir(), "androperator-pre-run-log-"));
    const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });
    const fakeRunSkill = async () => {
      runCalls += 1;
      return {
        ok: true,
        status: "success",
        skillId: TEST_SKILL_INVALID_ARTIFACT,
        skillRunId: "skillrun_test",
        output: "should-not-run",
        exitCode: 0,
        durationMs: 1,
        skillResult: null,
      } as const;
    };

    try {
      const stdout = await cmdSkillsRun(
        TEST_SKILL_INVALID_ARTIFACT,
        [],
        undefined,
        undefined,
        undefined,
        { format: "json", runSkillImpl: fakeRunSkill as typeof runSkill, logger }
      );
      const parsed = JSON.parse(stdout) as {
        code?: string;
        details?: { artifact?: string };
        logs?: { skillRunId?: string; path?: string; tailCommand?: string };
      };
      assert.strictEqual(runCalls, 0);
      assert.strictEqual(parsed.code, SKILL_VALIDATION_FAILED);
      assert.strictEqual(parsed.details?.artifact, "artifact.json");
      assert.match(parsed.logs?.skillRunId ?? "", /^skillrun_/);
      assert.strictEqual(parsed.logs?.path, logger.logPath());
      assert.strictEqual(parsed.logs?.tailCommand, `tail -f '${logger.logPath()}'`);

      const contents = await readFile(logger.logPath()!, "utf8");
      const lines = parseLogEvents(contents);
      const logLocationLine = lines.find((line) => line.event === "skills.run.log_location");
      assert.strictEqual(logLocationLine?.skillRunId, parsed.logs?.skillRunId);
      assert.strictEqual(logLocationLine?.logPath, undefined);
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it("proceeds for valid artifact skills and calls runSkill", async () => {
    let runCalls = 0;
    let observedSkillRunId: string | undefined;
    let observedLogLocationEmitted: boolean | undefined;
    const fakeRunSkill: typeof runSkill = async (_skillId, _args, _registryPath, _timeoutMs, _env, callbacks) => {
      runCalls += 1;
      observedSkillRunId = callbacks?.skillRunId;
      observedLogLocationEmitted = callbacks?.logLocationEmitted;
      return {
        ok: true,
        status: "success",
        skillId: TEST_SKILL_VALID_ARTIFACT,
        skillRunId: callbacks?.skillRunId ?? "skillrun_test",
        output: "RUN_OK",
        exitCode: 0,
        durationMs: 1,
        skillResult: null,
      } as const;
    };

    const stdout = await cmdSkillsRun(
      TEST_SKILL_VALID_ARTIFACT,
      [],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        runSkillImpl: fakeRunSkill,
        resolveInteractiveSkillTargetImpl: allowInteractiveTarget,
      }
    );
    const parsed = JSON.parse(stdout) as { skillId?: string; output?: string; logs?: { skillRunId?: string } };
    assert.strictEqual(runCalls, 1);
    assert.match(observedSkillRunId ?? "", /^skillrun_/);
    assert.strictEqual(observedLogLocationEmitted, true);
    assert.strictEqual(parsed.skillId, TEST_SKILL_VALID_ARTIFACT);
    assert.strictEqual(parsed.output, "RUN_OK");
    assert.strictEqual(parsed.logs?.skillRunId, observedSkillRunId);
  });

  it("reuses ambient skillRunId for nested CLI skill runs", async () => {
    const parentSkillRunId = "skillrun_parent_cli_run";
    const originalEnvValue = process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
    process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = parentSkillRunId;
    let observedSkillRunId: string | undefined;
    const fakeRunSkill: typeof runSkill = async (_skillId, _args, _registryPath, _timeoutMs, _env, callbacks) => {
      observedSkillRunId = callbacks?.skillRunId;
      return {
        ok: true,
        status: "success",
        skillId: TEST_SKILL_VALID_ARTIFACT,
        skillRunId: callbacks?.skillRunId ?? "missing",
        output: "RUN_OK",
        exitCode: 0,
        durationMs: 1,
        skillResult: null,
      } as const;
    };

    try {
      const stdout = await cmdSkillsRun(
        TEST_SKILL_VALID_ARTIFACT,
        [],
        undefined,
        undefined,
        undefined,
        {
          format: "json",
          runSkillImpl: fakeRunSkill,
          resolveInteractiveSkillTargetImpl: allowInteractiveTarget,
        }
      );
      const parsed = JSON.parse(stdout) as { logs?: { skillRunId?: string } };
      assert.strictEqual(observedSkillRunId, parentSkillRunId);
      assert.strictEqual(parsed.logs?.skillRunId, parentSkillRunId);
    } finally {
      if (originalEnvValue === undefined) {
        delete process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
      } else {
        process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = originalEnvValue;
      }
    }
  });

  it("JSON mode omits duplicate top-level wrapper fields when skillResult is present", async () => {
    const frameMarker = "[Androperator-Skill-Result]";
    const fakeRunSkill: typeof runSkill = async () => ({
      ok: true,
      status: "success",
      skillId: "com.test.framed-cli-json",
      skillRunId: "skillrun_test_json",
      logPath: "/tmp/androperator-test.log",
      output: `progress\n${frameMarker}\n{}\n`,
      exitCode: 0,
      durationMs: 1,
      skillResult: {
        contractVersion: "1.0.0",
        skillId: "com.test.framed-cli-json",
        source: { kind: "script" },
        result: null,
        status: "success",
        checkpoints: [],
      } satisfies SkillResult,
    });

    const stdout = await cmdSkillsRun(
      "com.test.framed-cli-json",
      [],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        skipValidate: true,
        runSkillImpl: fakeRunSkill,
        resolveInteractiveSkillTargetImpl: allowInteractiveTarget,
      }
    );
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    assert.ok(parsed.skillResult);
    assert.strictEqual(parsed.status, "success");
    assert.strictEqual(parsed.skillId, undefined);
    assert.strictEqual(parsed.exitCode, undefined);
    assert.strictEqual(parsed.output, undefined);
    assert.deepStrictEqual(parsed.logs, {
      skillRunId: "skillrun_test_json",
      path: "/tmp/androperator-test.log",
      tailCommand: "tail -f '/tmp/androperator-test.log'",
    });
  });

  it("JSON mode keeps legacy wrapper fields when skillResult is null", async () => {
    const fakeRunSkill: typeof runSkill = async () => ({
      ok: true,
      status: "success",
      skillId: "com.test.legacy-cli-json",
      skillRunId: "skillrun_test",
      output: "plain\n",
      exitCode: 0,
      durationMs: 1,
      skillResult: null,
    });

    const stdout = await cmdSkillsRun(
      "com.test.legacy-cli-json",
      [],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        skipValidate: true,
        runSkillImpl: fakeRunSkill,
        resolveInteractiveSkillTargetImpl: allowInteractiveTarget,
      }
    );
    const parsed = JSON.parse(stdout) as {
      status?: string;
      skillId?: string;
      output?: string;
      exitCode?: number;
      skillResult?: null;
    };
    assert.strictEqual(parsed.status, "success");
    assert.strictEqual(parsed.skillId, "com.test.legacy-cli-json");
    assert.strictEqual(parsed.output, "plain\n");
    assert.strictEqual(parsed.exitCode, 0);
    assert.strictEqual(parsed.skillResult, null);
  });

  it("JSON mode omits skillId, exitCode, and output for indeterminate with parsed skillResult", async () => {
    const fakeRunSkill: typeof runSkill = async () => ({
      ok: null,
      status: "indeterminate",
      code: "SKILL_VERIFICATION_INDETERMINATE",
      message: "Declared verification was not proved.",
      skillId: "com.test.indeterminate-cli",
      skillRunId: "skillrun_test",
      output: "stdout with frame\n",
      exitCode: 0,
      durationMs: 2,
      skillResult: {
        contractVersion: "1.0.0",
        skillId: "com.test.indeterminate-cli",
        source: { kind: "script" },
        result: null,
        status: "success",
        checkpoints: [],
      } satisfies SkillResult,
    });

    const stdout = await cmdSkillsRun(
      "com.test.indeterminate-cli",
      [],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        skipValidate: true,
        runSkillImpl: fakeRunSkill,
        resolveInteractiveSkillTargetImpl: allowInteractiveTarget,
      }
    );
    const parsed = JSON.parse(stdout) as {
      status?: string;
      code?: string;
      skillId?: string;
      output?: string;
      exitCode?: number;
      skillResult?: { skillId?: string };
    };
    assert.strictEqual(parsed.status, "indeterminate");
    assert.strictEqual(parsed.code, "SKILL_VERIFICATION_INDETERMINATE");
    assert.strictEqual(parsed.skillId, undefined);
    assert.strictEqual(parsed.output, undefined);
    assert.strictEqual(parsed.exitCode, undefined);
    assert.ok(parsed.skillResult);
    assert.strictEqual(parsed.skillResult?.skillId, "com.test.indeterminate-cli");
  });

  it("validates before querying APK state in cmdSkillsRun", async () => {
    let runCalls = 0;
    const fakeRunSkill = async () => {
      runCalls += 1;
      return {
        ok: true,
        status: "success",
        skillId: TEST_SKILL_VALID_ARTIFACT,
        skillRunId: "skillrun_test",
        output: "RUN_OK",
        exitCode: 0,
        durationMs: 1,
        skillResult: null,
      } as const;
    };

    const stdout = await cmdSkillsRun(
      TEST_SKILL_INVALID_ARTIFACT,
      [],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        runSkillImpl: fakeRunSkill as typeof runSkill,
        validateSkillImpl: async () => ({
          ok: false,
          code: SKILL_VALIDATION_FAILED,
          message: "Skill not found: com.test.invalid",
        }),
      }
    );
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(runCalls, 0);
    assert.strictEqual(parsed.code, SKILL_VALIDATION_FAILED);
    assert.match(parsed.message ?? "", /Skill not found/);
  });

  it("fails before skill spawn when the resolved target is not interactive", async () => {
    let runCalls = 0;

    const stdout = await cmdSkillsRun(
      TEST_SKILL_VALID_ARTIFACT,
      [],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        skipValidate: true,
        runSkillImpl: async () => {
          runCalls += 1;
          return {
            ok: true,
            status: "success",
            skillId: TEST_SKILL_VALID_ARTIFACT,
            skillRunId: "skillrun_test",
            output: "RUN_OK",
            exitCode: 0,
            durationMs: 1,
            skillResult: null,
          } as const;
        },
        resolveInteractiveSkillTargetImpl: async () => ({
          ok: false,
          error: {
            code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
            message: "Device is not interactive. screenOn=false",
            deviceId: "resolved-device-123",
          },
        }),
      }
    );

    const parsed = JSON.parse(stdout) as {
      code?: string;
      deviceId?: string;
      details?: { screenOn?: boolean; deviceLocked?: boolean; userUnlocked?: boolean };
      message?: string;
    };
    assert.strictEqual(runCalls, 0);
    assert.strictEqual(parsed.code, ERROR_CODES.DEVICE_NOT_INTERACTIVE);
    assert.strictEqual(parsed.deviceId, "resolved-device-123");
    assert.strictEqual(parsed.details, undefined);
    assert.strictEqual(parsed.message, "Device is not interactive. Interactive automation requires an awake, usable device state.");
  });

  it("preserves non-interactive-preflight diagnostics when wrapper readiness fails for another reason", async () => {
    let runCalls = 0;

    const stdout = await cmdSkillsRun(
      TEST_SKILL_VALID_ARTIFACT,
      [],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        skipValidate: true,
        runSkillImpl: async () => {
          runCalls += 1;
          return {
            ok: true,
            status: "success",
            skillId: TEST_SKILL_VALID_ARTIFACT,
            skillRunId: "skillrun_test",
            output: "RUN_OK",
            exitCode: 0,
            durationMs: 1,
            skillResult: null,
          } as const;
        },
        resolveInteractiveSkillTargetImpl: async () => ({
          ok: false,
          error: {
            code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
            message: "adb shell broke",
            details: { command: "cmd power wakeup", probeCommandId: "doctor-handshake-separate", probeDispatchState: "unknown", phase: "readiness", dispatchState: "not_dispatched" },
            deviceId: "resolved-device-123",
          },
        }),
      }
    );

    const parsed = JSON.parse(stdout) as {
      code?: string;
      details?: { command?: string };
      deviceId?: string;
      message?: string;
    };
    assert.strictEqual(runCalls, 0);
    assert.strictEqual(parsed.code, ERROR_CODES.DEVICE_SHELL_UNAVAILABLE);
    assert.deepStrictEqual(parsed.details, { command: "cmd power wakeup", probeCommandId: "doctor-handshake-separate", probeDispatchState: "unknown", phase: "readiness", dispatchState: "not_dispatched" });
    assert.equal(JSON.parse(stdout).status, "failed");
    assert.strictEqual(parsed.deviceId, "resolved-device-123");
    assert.strictEqual(parsed.message, "adb shell broke");
  });

  it("uses the resolved device for wrapper preflight without injecting implicit device selection into skill env", async () => {
    let observedEnv: Record<string, string | undefined> | undefined;

    const stdout = await cmdSkillsRun(
      TEST_SKILL_VALID_ARTIFACT,
      ["--limit", "40"],
      undefined,
      undefined,
      "com.androperator.operator.dev",
      {
        format: "json",
        skipValidate: true,
        runSkillImpl: async (_skillId, _args, _registryPath, _timeoutMs, env) => {
          observedEnv = env;
          return {
            ok: true,
            status: "success",
            skillId: TEST_SKILL_VALID_ARTIFACT,
            skillRunId: "skillrun_test",
            output: "RUN_OK",
            exitCode: 0,
            durationMs: 1,
            skillResult: null,
          } as const;
        },
        resolveInteractiveSkillTargetImpl: async () => ({
          ok: true,
          deviceId: "resolved-device-123",
          apkPresence: passingApkPresence,
        }),
      }
    );

    const parsed = JSON.parse(stdout) as { skillId?: string };
    assert.strictEqual(parsed.skillId, TEST_SKILL_VALID_ARTIFACT);
    assert.strictEqual(observedEnv?.ANDROPERATOR_DEVICE_ID, undefined);
    assert.strictEqual(observedEnv?.ANDROPERATOR_OPERATOR_PACKAGE, "com.androperator.operator.dev");
  });

  it("passes forwarded skill args through unchanged in cmdSkillsRun", async () => {
    let observedArgs: string[] | null = null;
    const fakeRunSkill = async (_skillId: string, args: string[]) => {
      observedArgs = args;
      return {
        ok: true,
        status: "success",
        skillId: TEST_SKILL_VALID_ARTIFACT,
        skillRunId: "skillrun_test",
        output: "RUN_OK",
        exitCode: 0,
        durationMs: 1,
        skillResult: null,
      } as const;
    };

    const stdout = await cmdSkillsRun(
      TEST_SKILL_VALID_ARTIFACT,
      ["--limit", "40"],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        skipValidate: true,
        deviceId: "device-123",
        runSkillImpl: fakeRunSkill as typeof runSkill,
        resolveInteractiveSkillTargetImpl: allowInteractiveTarget,
      }
    );

    const parsed = JSON.parse(stdout) as { skillId?: string; output?: string };
    assert.strictEqual(parsed.skillId, TEST_SKILL_VALID_ARTIFACT);
    assert.strictEqual(parsed.output, "RUN_OK");
    assert.deepStrictEqual(observedArgs, ["--limit", "40"]);
  });

  it("keeps cmdSkillsRun silent in JSON mode without a logger", async () => {
    const cmdModulePath = join(packageRoot, "dist", "cli", "commands", "skills.js");
    const script = `
      import { cmdSkillsRun } from ${JSON.stringify(cmdModulePath)};
      const writes = [];
      process.stdout.write = ((chunk) => {
        writes.push(String(chunk));
        return true;
      });
      const result = await cmdSkillsRun(
        ${JSON.stringify(TEST_SKILL_VALID_ARTIFACT)},
        [],
        undefined,
        undefined,
        undefined,
        {
          format: "json",
          skipValidate: true,
          resolveInteractiveSkillTargetImpl: async () => ({
            ok: true,
            deviceId: "resolved-device-123",
            apkPresence: ${JSON.stringify(passingApkPresence)},
          }),
          runSkillImpl: async () => ({
            ok: true,
            status: "success",
            skillId: ${JSON.stringify(TEST_SKILL_VALID_ARTIFACT)},
            skillRunId: "skillrun_test",
            output: "RUN_OK",
            exitCode: 0,
            durationMs: 1,
            skillResult: null,
          }),
        }
      );
      process.stderr.write(JSON.stringify({ writes, result }));
    `;

    const child = await runNodeSnippet(script, {
      env: {
        ...process.env,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
      },
    });
    assert.strictEqual(child.code, 0, child.stderr);
    const jsonLine = child.stderr.trim().split(/\r?\n/).reverse().find((line) => line.startsWith("{") && line.includes("\"result\""));
    assert.ok(jsonLine, child.stdout);
    const parsed = JSON.parse(jsonLine) as { writes?: string[]; result?: string };
    const rendered = JSON.parse(parsed.result ?? "{}") as { skillId?: string; output?: string };
    assert.deepStrictEqual(parsed.writes, []);
    assert.strictEqual(rendered.skillId, TEST_SKILL_VALID_ARTIFACT);
    assert.strictEqual(rendered.output, "RUN_OK");
  });

  it("ignores pipe errors from live pretty-mode streaming", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const cmdModulePath = join(packageRoot, "dist", "cli", "commands", "skills.js");
    const script = `
      import { cmdSkillsRun } from ${JSON.stringify(cmdModulePath)};
      const originalWrite = process.stdout.write.bind(process.stdout);
      let writes = 0;
      process.stdout.write = ((chunk) => {
        writes += 1;
        if (writes > 1) {
          const error = new Error("broken pipe");
          error.code = "EPIPE";
          throw error;
        }
        return originalWrite(String(chunk));
      });
      const result = await cmdSkillsRun(
        ${JSON.stringify(TEST_FIXTURE_CHUNKED_OUTPUT)},
        [],
        undefined,
        undefined,
        ${JSON.stringify("com.androperator.operator.dev")},
        {
          format: "pretty",
          skipValidate: true,
          runSkillImpl: async (_skillId, _args, _registryPath, _timeoutMs, _env, callbacks, _expectContains) => {
            callbacks?.onOutput?.("chunk1\\n", "stdout");
            callbacks?.onOutput?.("chunk2\\n", "stdout");
            return {
              ok: true,
              status: "success",
              skillId: ${JSON.stringify(TEST_FIXTURE_CHUNKED_OUTPUT)},
              skillRunId: "skillrun_test",
              output: "chunk1\\nchunk2\\n",
              exitCode: 0,
              durationMs: 1,
              skillResult: null,
            };
          }
        }
      );
      process.stderr.write(JSON.stringify({ result }));
    `;

    const child = await runNodeSnippet(script, {
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
      },
    });
    assert.strictEqual(child.code, 0, child.stderr);
    const jsonLine = child.stderr.trim().split(/\r?\n/).reverse().find((line) => line.startsWith("{") && line.includes("\"result\""));
    assert.ok(jsonLine, child.stdout);
    const parsed = JSON.parse(jsonLine) as { result?: string };
    const rendered = JSON.parse(parsed.result ?? "{}") as { skillId?: string; output?: string };
    assert.strictEqual(rendered.skillId, TEST_FIXTURE_CHUNKED_OUTPUT);
    assert.strictEqual(rendered.output, "chunk1\nchunk2\n");
  });

  it("bypasses validation when --skip-validate is set", async () => {
    let runCalls = 0;
    const fakeRunSkill = async () => {
      runCalls += 1;
      return {
        ok: true,
        status: "success",
        skillId: TEST_SKILL_INVALID_ARTIFACT,
        skillRunId: "skillrun_test",
        output: "RUN_OK",
        exitCode: 0,
        durationMs: 1,
        skillResult: null,
      } as const;
    };

    const stdout = await cmdSkillsRun(
      TEST_SKILL_INVALID_ARTIFACT,
      [],
      undefined,
      undefined,
      undefined,
      {
        format: "json",
        skipValidate: true,
        runSkillImpl: fakeRunSkill as typeof runSkill,
        resolveInteractiveSkillTargetImpl: allowInteractiveTarget,
      }
    );
    const parsed = JSON.parse(stdout) as { skillId?: string; output?: string };
    assert.strictEqual(runCalls, 1);
    assert.strictEqual(parsed.skillId, TEST_SKILL_INVALID_ARTIFACT);
    assert.strictEqual(parsed.output, "RUN_OK");
  });
});


describe("resolveSkillBin", () => {
  const ORIGINAL_ANDROPERATOR_BIN = process.env[ANDROPERATOR_BIN_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL_ANDROPERATOR_BIN === undefined) {
      delete process.env[ANDROPERATOR_BIN_ENV_VAR];
    } else {
      process.env[ANDROPERATOR_BIN_ENV_VAR] = ORIGINAL_ANDROPERATOR_BIN;
    }
  });

  it("returns explicit ANDROPERATOR_BIN when set", () => {
    process.env[ANDROPERATOR_BIN_ENV_VAR] = "/custom/path/to/androperator";
    const result = resolveSkillBin();
    assert.strictEqual(result.cmd, "/custom/path/to/androperator");
    assert.deepStrictEqual(result.args, []);
  });

  it("prefers explicit ANDROPERATOR_BIN over sibling build", () => {
    process.env[ANDROPERATOR_BIN_ENV_VAR] = "/explicit/androperator";
    const result = resolveSkillBin();
    assert.strictEqual(result.cmd, "/explicit/androperator");
    assert.deepStrictEqual(result.args, []);
  });

  it("falls back to global androperator when no env var and no sibling build", () => {
    delete process.env[ANDROPERATOR_BIN_ENV_VAR];
    const result = resolveSkillBin();
    // When running in test environment, the sibling build may or may not exist
    // The function should return either the sibling build or global binary
    assert.ok(result.cmd === "androperator" || result.args.length === 1);
  });
});

describe("resolveSkillBinCommand", () => {
  const ORIGINAL_ANDROPERATOR_BIN = process.env[ANDROPERATOR_BIN_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL_ANDROPERATOR_BIN === undefined) {
      delete process.env[ANDROPERATOR_BIN_ENV_VAR];
    } else {
      process.env[ANDROPERATOR_BIN_ENV_VAR] = ORIGINAL_ANDROPERATOR_BIN;
    }
  });

  it("returns explicit ANDROPERATOR_BIN when set", () => {
    process.env[ANDROPERATOR_BIN_ENV_VAR] = "/custom/path/to/androperator";
    const result = resolveSkillBinCommand();
    assert.strictEqual(result, "/custom/path/to/androperator");
  });

  it("returns full command with args for sibling build", () => {
    delete process.env[ANDROPERATOR_BIN_ENV_VAR];
    const result = resolveSkillBinCommand();
    // When sibling build exists, should return "node "/path/to/cli/index.js""
    // When it doesn't exist, should return "androperator"
    if (result !== "androperator") {
      assert.ok(result.includes(" "), "Expected command with args for sibling build");
      assert.ok(result.startsWith(process.execPath), "Expected command to start with node executable");
    }
  });

  it("quotes command parts that contain spaces", () => {
    assert.strictEqual(
      formatSkillBinCommand({
        cmd: "C:\\Program Files\\nodejs\\node.exe",
        args: ["C:\\androperator apps\\node\\dist\\cli\\index.js"],
      }),
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\androperator apps\\node\\dist\\cli\\index.js"'
    );
  });
});

describe("resolveOperatorPackage", () => {
  const ORIGINAL_OPERATOR_PACKAGE = process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL_OPERATOR_PACKAGE === undefined) {
      delete process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR];
    } else {
      process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR] = ORIGINAL_OPERATOR_PACKAGE;
    }
  });

  it("returns ANDROPERATOR_OPERATOR_PACKAGE env var when set", () => {
    process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR] = "com.androperator.operator.dev";
    const result = resolveOperatorPackage();
    assert.strictEqual(result, "com.androperator.operator.dev");
  });

  it("returns default release package when env var is not set", () => {
    delete process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR];
    const result = resolveOperatorPackage();
    assert.strictEqual(result, DEFAULT_OPERATOR_PACKAGE);
  });

  it("returns default when env var is empty string", () => {
    process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR] = "";
    const result = resolveOperatorPackage();
    assert.strictEqual(result, DEFAULT_OPERATOR_PACKAGE);
  });
});

describe("runSkill env vars", () => {
  const ORIGINAL_BIN = process.env[ANDROPERATOR_BIN_ENV_VAR];
  const ORIGINAL_OPERATOR_PACKAGE = process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL_BIN === undefined) {
      delete process.env[ANDROPERATOR_BIN_ENV_VAR];
    } else {
      process.env[ANDROPERATOR_BIN_ENV_VAR] = ORIGINAL_BIN;
    }
    if (ORIGINAL_OPERATOR_PACKAGE === undefined) {
      delete process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR];
    } else {
      process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR] = ORIGINAL_OPERATOR_PACKAGE;
    }
  });

  it("injects ANDROPERATOR_BIN and ANDROPERATOR_OPERATOR_PACKAGE into skill env", async () => {
    // Test that runSkill accepts and passes the env parameter correctly
    const customEnv = {
      [ANDROPERATOR_BIN_ENV_VAR]: "/custom/bin/androperator",
      [ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR]: "com.test.package",
    };
    const result = await runSkill("com.test.env-echo", [], undefined, undefined, customEnv);
    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.ok(result.output.includes("ANDROPERATOR_BIN:/custom/bin/androperator"), `Expected ANDROPERATOR_BIN in output, got: ${result.output}`);
    assert.ok(result.output.includes("ANDROPERATOR_OPERATOR_PACKAGE:com.test.package"), `Expected ANDROPERATOR_OPERATOR_PACKAGE in output, got: ${result.output}`);
  });

  it("uses default values when env parameter is not provided", async () => {
    // When no env is passed, the skill script won't receive the env vars
    // because runSkill no longer sets defaults internally (CLI layer does)
    const result = await runSkill("com.test.env-echo", []);
    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    // Without env parameter, these should be undefined (not injected by runSkill)
    assert.ok(result.output.includes("ANDROPERATOR_BIN:undefined"), `Expected ANDROPERATOR_BIN to be undefined when not passed, got: ${result.output}`);
    assert.ok(result.output.includes("ANDROPERATOR_OPERATOR_PACKAGE:undefined"), `Expected ANDROPERATOR_OPERATOR_PACKAGE to be undefined when not passed, got: ${result.output}`);
  });

  it("clears inherited ANDROPERATOR_DEVICE_ID when env explicitly omits device selection", async () => {
    const originalDeviceId = process.env.ANDROPERATOR_DEVICE_ID;
    process.env.ANDROPERATOR_DEVICE_ID = "ambient-device-123";

    try {
      const result = await runSkill("com.test.env-echo", [], undefined, undefined, {
        ANDROPERATOR_BIN: "/custom/bin/androperator",
        ANDROPERATOR_OPERATOR_PACKAGE: "com.test.package",
        ANDROPERATOR_DEVICE_ID: undefined,
      });
      assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
      assert.ok(result.output.includes("ANDROPERATOR_DEVICE_ID:undefined"), `Expected inherited device id to be cleared, got: ${result.output}`);
    } finally {
      if (originalDeviceId === undefined) {
        delete process.env.ANDROPERATOR_DEVICE_ID;
      } else {
        process.env.ANDROPERATOR_DEVICE_ID = originalDeviceId;
      }
    }
  });

  it("keeps device selection in env for agent-driven skills instead of polluting forwarded inputs", async () => {
    const result = await runSkill(
      TEST_AGENT_SKILL_RESULT,
      ["env-check", "40"],
      undefined,
      undefined,
      {
        ANDROPERATOR_DEVICE_ID: "device-123",
        EXPECTED_DEVICE_ID: "device-123",
      }
    );

    assert.ok(result.ok, `Expected device env split to succeed: ${"message" in result ? result.message : ""}`);
    assert.ok(result.skillResult);
    assert.strictEqual(result.skillResult.source.kind, "agent");
  });
});

describe("CLI skills run env vars", () => {
  const ORIGINAL_BIN = process.env[ANDROPERATOR_BIN_ENV_VAR];
  const ORIGINAL_OPERATOR_PACKAGE = process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL_BIN === undefined) {
      delete process.env[ANDROPERATOR_BIN_ENV_VAR];
    } else {
      process.env[ANDROPERATOR_BIN_ENV_VAR] = ORIGINAL_BIN;
    }
    if (ORIGINAL_OPERATOR_PACKAGE === undefined) {
      delete process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR];
    } else {
      process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR] = ORIGINAL_OPERATOR_PACKAGE;
    }
  });

  it("CLI skills run passes ANDROPERATOR_OPERATOR_PACKAGE via --operator-package flag", async () => {
    const { stdout, code } = await runCli([
      "skills", "run", "com.test.env-echo", "--operator-package", "com.androperator.operator.dev", "--output", "json",
    ]);
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string };
    assert.ok(parsed.output?.includes("ANDROPERATOR_OPERATOR_PACKAGE:com.androperator.operator.dev"), `Expected dev package in output, got: ${parsed.output}`);
  });

  it("CLI skills run uses ANDROPERATOR_OPERATOR_PACKAGE env var when flag is not provided", async () => {
    const { stdout, code } = await runCli(
      ["skills", "run", "com.test.env-echo", "--output", "json"],
      {
        env: {
          ...process.env,
          ANDROPERATOR_OPERATOR_PACKAGE: "com.custom.operator.package",
        },
      }
    );
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string };
    assert.ok(parsed.output?.includes("ANDROPERATOR_OPERATOR_PACKAGE:com.custom.operator.package"), `Expected custom package in output, got: ${parsed.output}`);
  });

  it("CLI skills run --operator-package flag takes precedence over env var", async () => {
    const { stdout, code } = await runCli(
      ["skills", "run", "com.test.env-echo", "--operator-package", "flag.package.value", "--output", "json"],
      {
        env: {
          ...process.env,
          ANDROPERATOR_OPERATOR_PACKAGE: "env.package.value",
        },
      }
    );
    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { output?: string };
    assert.ok(parsed.output?.includes("ANDROPERATOR_OPERATOR_PACKAGE:flag.package.value"), `Expected flag value in output, got: ${parsed.output}`);
    assert.ok(!parsed.output?.includes("env.package.value"), `Should not contain env value, got: ${parsed.output}`);
  });
});

describe("CLI skills run streaming", () => {
  it("prints the banner first and then streams incremental skill output in pretty mode", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const cliPath = join(packageRoot, "dist", "cli", "index.js");
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const proc = spawn(process.execPath, [
      cliPath,
      "skills",
      "run",
      TEST_FIXTURE_CHUNKED_OUTPUT,
      "--operator-package",
      "com.androperator.operator.dev",
      "--output",
      "pretty",
    ], {
      cwd: packageRoot,
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk.toString());
    });
    proc.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    const code = await new Promise<number>((resolve) => {
      proc.on("close", (exitCode) => resolve(exitCode ?? -1));
    });

    assert.strictEqual(code, 0, `stderr: ${stderrChunks.join("")}`);
    assert.ok(stderrChunks[0]?.startsWith("[Androperator]"), stderrChunks[0]);
    assert.ok(
      stdoutChunks.some((chunk, index) =>
        chunk.includes("chunk1")
        && !chunk.includes("chunk2")
        && stdoutChunks.slice(index + 1).some((later) => later.includes("chunk2"))
      ),
      stdoutChunks.join("")
    );
  });

  it("hides terminal SkillResult frames from pretty-mode stdout while keeping human output", async () => {
    const fakeAdbDir = await createFakeAdb({
      installed: true,
      operatorPackage: "com.androperator.operator.dev",
    });
    const cliPath = join(packageRoot, "dist", "cli", "index.js");
    let stdout = "";
    let stderr = "";

    const proc = spawn(process.execPath, [
      cliPath,
      "skills",
      "run",
      TEST_SKILL_RESULT,
      "--operator-package",
      "com.androperator.operator.dev",
      "--output",
      "pretty",
      "--",
      "40",
    ], {
      cwd: packageRoot,
      env: {
        ...process.env,
        PATH: `${fakeAdbDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
        ANDROPERATOR_SKILLS_REGISTRY: TEST_REGISTRY_PATH,
        TEST_SKILL_MODE: "valid",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const code = await new Promise<number>((resolve) => {
      proc.on("close", (exitCode) => resolve(exitCode ?? -1));
    });

    assert.strictEqual(code, 0, `stderr: ${stderr}`);
    assert.ok(stderr.startsWith("[Androperator]"), stderr);
    assert.ok(stdout.includes("progress:before-frame"), stdout);
    assert.ok(stdout.indexOf("progress:before-frame") < stdout.indexOf("\"skillResult\""), stdout);
    assert.ok(stdout.includes("\"skillResult\""), stdout);
    assert.ok(!stdout.includes("[Androperator-Skill-Result]"), stdout);
  });
});

describe("runSkill logging", () => {
  let tempRoot: string;
  const originalProcessKill = process.kill;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "androperator-skill-log-"));
  });

  afterEach(async () => {
    process.kill = originalProcessKill;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("logs stdout and stderr chunks with skillId while preserving onOutput", async () => {
    const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "debug" });
    const chunks: Array<{ chunk: string; stream: "stdout" | "stderr" }> = [];

    const result = await runSkill(TEST_FIXTURE_MIXED_STREAMS, [], undefined, undefined, undefined, {
      logger,
      onOutput: (chunk, stream) => {
        chunks.push({ chunk, stream });
      },
    });

    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.deepStrictEqual(chunks, [
      { chunk: "stdout-line\n", stream: "stdout" },
      { chunk: "stderr-line\n", stream: "stderr" },
    ]);

    const contents = await readFile(logger.logPath()!, "utf8");
    const lines = parseLogEvents(contents);
    const outputLines = lines.filter((line) => line.event === "skills.run.output");
    assert.deepStrictEqual(
      outputLines.map((line) => ({ skillId: line.skillId, stream: line.stream, message: line.message })),
      [
        { skillId: TEST_FIXTURE_MIXED_STREAMS, stream: "stdout", message: "stdout-line\n" },
        { skillId: TEST_FIXTURE_MIXED_STREAMS, stream: "stderr", message: "stderr-line\n" },
      ]
    );
    const startLine = lines.find((line) => line.event === "skills.run.start");
    const completeLine = lines.find((line) => line.event === "skills.run.complete");
    const logLocationLine = lines.find((line) => line.event === "skills.run.log_location");
    assert.strictEqual(startLine?.skillId, TEST_FIXTURE_MIXED_STREAMS);
    assert.strictEqual(completeLine?.skillId, TEST_FIXTURE_MIXED_STREAMS);
    assert.strictEqual(logLocationLine?.skillId, TEST_FIXTURE_MIXED_STREAMS);
    assert.match(logLocationLine?.skillRunId ?? "", /^skillrun_/);
    assert.strictEqual(startLine?.skillRunId, logLocationLine?.skillRunId);
    assert.strictEqual(outputLines[0]?.skillRunId, logLocationLine?.skillRunId);
    assert.strictEqual(completeLine?.skillRunId, logLocationLine?.skillRunId);
    assert.strictEqual(logLocationLine?.logPath, undefined);
    assert.strictEqual(logLocationLine?.tailCommand, undefined);
    assert.strictEqual(result.skillRunId, logLocationLine?.skillRunId);
    assert.strictEqual(result.logPath, logger.logPath());
  });

  it("shell-quotes log paths in the advisory tail command", () => {
    const logs = buildSkillRunLogs({
      ok: false,
      status: "failed",
      code: "TEST",
      message: "failed",
      skillId: "com.test",
      skillResult: null,
      skillRunId: "skillrun_test",
      logPath: `/tmp/androperator logs/owner's "daily".log`,
    });

    assert.strictEqual(logs.tailCommand, `tail -f '/tmp/androperator logs/owner'"'"'s "daily".log'`);
  });

  it("omits logPath metadata when file logging disables on the first write", async () => {
    const blockedLogDir = join(tempRoot, "not-a-directory");
    await writeFile(blockedLogDir, "not a directory", "utf8");
    const logger = createAndroperatorLogger({ logDir: blockedLogDir, logLevel: "debug" });

    const result = await runSkill(TEST_FIXTURE_MIXED_STREAMS, [], undefined, undefined, undefined, {
      logger,
    });

    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.logPath, undefined);
    assert.strictEqual(logger.logPath(), undefined);
  });

  it("omits logPath metadata when file logging disables after the location event", async () => {
    let disabled = false;
    const logger = {
      emit(event: { event?: string }) {
        if (event.event === "skills.run.start") {
          disabled = true;
        }
      },
      child() {
        return this;
      },
      status(): import("../../contracts/logging.js").LoggingStatus {
        return disabled ? { status: "write_failed", code: "LOGGING_WRITE_FAILED" }
          : { status: "available", logPath: "/tmp/androperator-later-disabled.log" };
      },
      logPath() {
        return disabled ? undefined : "/tmp/androperator-later-disabled.log";
      },
    };

    const result = await runSkill(TEST_FIXTURE_MIXED_STREAMS, [], undefined, undefined, undefined, {
      logger,
    });

    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    assert.strictEqual(result.logPath, undefined);
  });

  it("logs start and complete without leaking sentinel args", async () => {
    const sentinel = "ANDROPERATOR_TEST_SENTINEL_X9Z";
    const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "debug" });

    const result = await runSkill("com.test.env-echo", [sentinel], undefined, undefined, undefined, {
      logger,
    });

    assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
    const contents = await readFile(logger.logPath()!, "utf8");
    const lines = parseLogEvents(contents);
    const startLine = lines.find((line) => line.event === "skills.run.start");
    const completeLine = lines.find((line) => line.event === "skills.run.complete");
    assert.strictEqual(startLine?.skillId, "com.test.env-echo");
    assert.strictEqual(completeLine?.skillId, "com.test.env-echo");
    assert.ok(lines.some((line) => line.event === "skills.run.output"));
    for (const line of lines) {
      assert.strictEqual(line.message?.includes(sentinel), false, `sentinel leaked into log line: ${JSON.stringify(line)}`);
      assert.strictEqual(JSON.stringify(line).includes(sentinel), false, `sentinel leaked into log payload: ${JSON.stringify(line)}`);
    }
  });

  it("logs start and timeout but not complete when the skill times out", async () => {
    const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "info" });

    const result = await runSkill("com.test.partial-timeout", [], undefined, 150, undefined, {
      logger,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_TIMEOUT);
    const contents = await readFile(logger.logPath()!, "utf8");
    const lines = parseLogEvents(contents);
    const startLine = lines.find((line) => line.event === "skills.run.start");
    const timeoutLine = lines.find((line) => line.event === "skills.run.timeout");
    assert.strictEqual(startLine?.skillId, "com.test.partial-timeout");
    assert.strictEqual(timeoutLine?.skillId, "com.test.partial-timeout");
    assert.ok(lines.some((line) => line.event === "skills.run.start"));
    assert.ok(lines.some((line) => line.event === "skills.run.timeout"));
    assert.ok(!lines.some((line) => line.event === "skills.run.complete"));
  });

  it("logs a failure event when the skill exits non-zero", async () => {
    const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "info" });

    const result = await runSkill("com.test.fail", [], undefined, undefined, undefined, {
      logger,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_FAILED);
    const contents = await readFile(logger.logPath()!, "utf8");
    const lines = parseLogEvents(contents);
    const startLine = lines.find((line) => line.event === "skills.run.start");
    const failedLine = lines.find((line) => line.event === "skills.run.failed");
    const completeLine = lines.find((line) => line.event === "skills.run.complete");
    assert.strictEqual(startLine?.skillId, "com.test.fail");
    assert.strictEqual(failedLine?.skillId, "com.test.fail");
    assert.strictEqual(completeLine?.skillId, "com.test.fail");
    assert.ok(lines.some((line) => line.event === "skills.run.start"));
    assert.ok(lines.some((line) => line.event === "skills.run.failed"));
    assert.ok(lines.some((line) => line.event === "skills.run.complete"));
  });

  it("logs when detached process-group signaling falls back to direct child termination", async () => {
    const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "debug" });
    process.kill = ((pid: number | bigint, signal?: number | NodeJS.Signals) => {
      if (typeof pid === "number" && pid < 0) {
        throw new Error("process-group kill unavailable");
      }
      return typeof pid === "bigint"
        ? originalProcessKill(Number(pid), signal)
        : originalProcessKill(pid, signal);
    }) as typeof process.kill;

    const result = await runSkill("com.test.partial-timeout", [], undefined, 150, undefined, {
      logger,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.code, SKILL_EXECUTION_TIMEOUT);
    const contents = await readFile(logger.logPath()!, "utf8");
    const lines = parseLogEvents(contents);
    const fallbackLine = lines.find((line) => line.event === "skills.run.signal_fallback");
    assert.strictEqual(fallbackLine?.skillId, "com.test.partial-timeout");
    assert.match(fallbackLine?.message ?? "", /falling back to direct child termination/i);
  });

  it("inherits skillRunId from process.env for nested CLI invocations", async () => {
    const parentSkillRunId = "skillrun_parent_test_inherited";
    const originalEnvValue = process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
    process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = parentSkillRunId;
    try {
      const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "debug" });
      const result = await runSkill(TEST_FIXTURE_MIXED_STREAMS, [], undefined, undefined, undefined, { logger });

      assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
      assert.strictEqual(result.skillRunId, parentSkillRunId);

      const contents = await readFile(logger.logPath()!, "utf8");
      const lines = parseLogEvents(contents);
      const logLocationLine = lines.find((line) => line.event === "skills.run.log_location");
      assert.strictEqual(logLocationLine?.skillRunId, parentSkillRunId);
      const startLine = lines.find((line) => line.event === "skills.run.start");
      assert.strictEqual(startLine?.skillRunId, parentSkillRunId);
      const completeLine = lines.find((line) => line.event === "skills.run.complete");
      assert.strictEqual(completeLine?.skillRunId, parentSkillRunId);
    } finally {
      if (originalEnvValue === undefined) {
        delete process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
      } else {
        process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = originalEnvValue;
      }
    }
  });

  it("generates a fresh skillRunId when inherited environment value is blank", async () => {
    const originalEnvValue = process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
    process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = "   ";
    try {
      const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "debug" });
      const result = await runSkill(TEST_FIXTURE_MIXED_STREAMS, [], undefined, undefined, undefined, { logger });

      assert.ok(result.ok, `Expected runSkill to succeed: ${"message" in result ? result.message : ""}`);
      assert.match(result.skillRunId, /^skillrun_/);
      assert.notStrictEqual(result.skillRunId, "");

      const contents = await readFile(logger.logPath()!, "utf8");
      const lines = parseLogEvents(contents);
      const logLocationLine = lines.find((line) => line.event === "skills.run.log_location");
      assert.strictEqual(logLocationLine?.skillRunId, result.skillRunId);
    } finally {
      if (originalEnvValue === undefined) {
        delete process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
      } else {
        process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = originalEnvValue;
      }
    }
  });
});
