import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  loadRegistry,
  findSkillById,
  getRepoRoot,
  type LoadRegistryResult,
} from "../../adapters/skills-repo/localSkillsRegistry.js";
import type { SkillEntry, SkillsRegistry } from "../../contracts/skills.js";
import {
  REGISTRY_READ_FAILED,
  SKILL_ALREADY_EXISTS,
  SKILL_ID_INVALID,
  SKILLS_SCAFFOLD_FAILED,
} from "../../contracts/skills.js";
import { parseRecordingExportArtifactJson } from "../recording/exportRecording.js";

export interface ScaffoldSkillSuccess {
  ok: true;
  skillId: string;
  registryPath: string;
  skillPath: string;
  files: string[];
  recordingContextPath?: string;
}

export interface ScaffoldSkillError {
  ok: false;
  code: string;
  message: string;
}

export interface ScaffoldSkillOptions {
  registryPath?: string;
  summary?: string;
  recordingContextPath?: string;
}

function deriveSkillMetadata(skillId: string): {
  applicationId: string;
  intent: string;
} | null {
  const trimmed = skillId.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return null;
  }
  return {
    applicationId: trimmed.slice(0, lastDot),
    intent: trimmed.slice(lastDot + 1),
  };
}

function indentYamlBlockScalar(value: string, indentSpaces: number): string {
  const indent = " ".repeat(indentSpaces);
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.includes("\0")) {
    throw new Error("summary contains a null byte");
  }
  return normalized
    .split("\n")
    .map((line) => (line.length === 0 ? "" : `${indent}${line}`))
    .join("\n");
}

function buildSkillMarkdown(
  skillId: string,
  summary: string,
  scriptPath: string,
  includeRecordingContext: boolean,
): string {
  const recordingContextSection = includeRecordingContext
    ? `## Recording Context

This skill was scaffolded with recording context at \`recording-context.json\`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.

`
    : "";

  return `---
name: ${skillId}
androperator-skill-type: replay
description: |-
${indentYamlBlockScalar(summary, 2)}
---

Starter scaffold for \`${skillId}\`.

Update this file with:

1. what the skill does
2. required arguments and environment
3. expected outputs
4. known caveats

${recordingContextSection}Usage:

\`\`\`bash
node ${scriptPath} <device_id> [operator_package]
\`\`\`
`;
}

function buildRunShTemplate(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/run.js" "$@"
`;
}

function buildScriptTemplate(skillId: string, applicationId: string): string {
  return `#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { extname, resolve } = require("node:path");

function parseCommandSpec(commandSpec) {
  const parts = [];
  let current = "";
  let quote = null;

  // The generated run.js compares literal runtime characters here; the
  // backslashes in this template string only escape the embedded source.
  for (let index = 0; index < commandSpec.length; index += 1) {
    const char = commandSpec[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (
        char === "\\\\"
        && quote === '"'
        && index + 1 < commandSpec.length
        && (commandSpec[index + 1] === '"' || commandSpec[index + 1] === "\\\\")
      ) {
        index += 1;
        current += commandSpec[index];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\\s/.test(char)) {
      if (current !== "") {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return null;
  }

  if (current !== "") {
    parts.push(current);
  }

  if (parts.length === 0) {
    return null;
  }

  return { cmd: parts[0], args: parts.slice(1) };
}

function getLocalAndroperatorCliPath() {
  const configuredCliPath = process.env.ANDROPERATOR_CLI_PATH;
  const candidates = [
    configuredCliPath,
    resolve(__dirname, "..", "..", "..", "apps", "node", "dist", "cli", "index.js"),
    resolve(__dirname, "..", "..", "..", "..", "androperator", "apps", "node", "dist", "cli", "index.js"),
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveAndroperatorBin() {
  const explicitBin = process.env.ANDROPERATOR_BIN;
  if (explicitBin) {
    if (existsSync(explicitBin)) {
      if (extname(explicitBin) === ".js") {
        return { cmd: process.execPath, args: [explicitBin] };
      }
      return { cmd: explicitBin, args: [] };
    }

    const parsed = parseCommandSpec(explicitBin);
    if (parsed !== null) {
      return parsed;
    }

    return { cmd: explicitBin, args: [] };
  }

  const localCliPath = getLocalAndroperatorCliPath();
  if (localCliPath !== null) {
    return { cmd: process.execPath, args: [localCliPath] };
  }

  return { cmd: "androperator", args: [] };
}

function resolveOperatorPackage(explicitPkg) {
  if (explicitPkg !== undefined && explicitPkg !== null && explicitPkg !== "") {
    return explicitPkg;
  }

  const envPkg = process.env.ANDROPERATOR_OPERATOR_PACKAGE;
  if (envPkg !== undefined && envPkg !== "") {
    return envPkg;
  }

  return "com.androperator.operator";
}

const [, , deviceId, operatorPackageArg] = process.argv;

if (!deviceId) {
  console.error("Usage: node run.js <device_id> [operator_package]");
  process.exit(1);
}

const operatorPackage = resolveOperatorPackage(operatorPackageArg);
const resolvedAndroperatorBin = resolveAndroperatorBin();

const execution = {
  commandId: "${skillId}-" + Date.now(),
  taskId: "${skillId}",
  source: "${skillId}",
  expectedFormat: "android-ui-automator",
  timeoutMs: 30000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "${applicationId}" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "${applicationId}" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 3000 } },
    { id: "snap", type: "snapshot" }
  ]
};

const child = spawnSync(
  resolvedAndroperatorBin.cmd,
  [
    ...resolvedAndroperatorBin.args,
    "exec",
    "--device",
    deviceId,
    "--operator-package",
    operatorPackage,
    "--execution",
    JSON.stringify(execution),
  ],
  {
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  }
);

if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);

if (child.error || child.signal || !Number.isInteger(child.status) || child.status < 0) {
  const reason = child.error?.message
    ?? (child.signal ? "terminated by signal " + child.signal : "unusable child exit status");
  console.error("androperator execution failed: " + reason);
  process.exitCode = 1;
} else {
  process.exitCode = child.status;
}

`;
}

async function writeRegistry(
  registryPath: string,
  registry: SkillsRegistry,
): Promise<void> {
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadCurrentRegistry(registryPath?: string): Promise<LoadRegistryResult> {
  return loadRegistry(registryPath);
}

export async function scaffoldSkill(
  skillId: string,
  options: string | ScaffoldSkillOptions = {},
): Promise<ScaffoldSkillSuccess | ScaffoldSkillError> {
  const normalizedOptions = typeof options === "string" ? { registryPath: options } : options;
  const rawSummary = (normalizedOptions as { summary?: unknown }).summary;
  const rawRecordingContextPath = (normalizedOptions as { recordingContextPath?: unknown }).recordingContextPath;
  const summaryCandidate =
    typeof rawSummary === "string" ? rawSummary.trim() : undefined;
  const summary = summaryCandidate && summaryCandidate.length > 0 ? summaryCandidate : `TODO: describe ${skillId}`;
  const recordingContextPath =
    typeof rawRecordingContextPath === "string"
      ? rawRecordingContextPath.trim()
      : undefined;
  if (recordingContextPath !== undefined && recordingContextPath.length === 0) {
    return {
      ok: false,
      code: SKILLS_SCAFFOLD_FAILED,
      message: "recordingContextPath must not be blank",
    };
  }
  const derived = deriveSkillMetadata(skillId);
  if (!derived) {
    return {
      ok: false,
      code: SKILL_ID_INVALID,
      message: "skill_id must contain at least one dot so applicationId and intent can be derived",
    };
  }

  let loaded: LoadRegistryResult;
  try {
    loaded = await loadCurrentRegistry(normalizedOptions.registryPath);
  } catch (error) {
    return {
      ok: false,
      code: REGISTRY_READ_FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (findSkillById(loaded.registry, skillId)) {
    return {
      ok: false,
      code: SKILL_ALREADY_EXISTS,
      message: `Skill already exists: ${skillId}`,
    };
  }

  const repoRoot = getRepoRoot(loaded.resolvedPath);
  const skillPathRelative = join("skills", skillId);
  const skillRoot = join(repoRoot, skillPathRelative);
  const scriptPathRelative = join(skillPathRelative, "scripts", "run.js");
  const shellScriptPathRelative = join(skillPathRelative, "scripts", "run.sh");
  const skillFileRelative = join(skillPathRelative, "SKILL.md");
  if (await fileExists(skillRoot)) {
    return {
      ok: false,
      code: SKILL_ALREADY_EXISTS,
      message: `Skill directory already exists: ${skillRoot}`,
    };
  }

  const skillEntry: SkillEntry = {
    id: skillId,
    applicationId: derived.applicationId,
    intent: derived.intent,
    summary,
    path: skillPathRelative,
    skillFile: skillFileRelative,
    scripts: [scriptPathRelative, shellScriptPathRelative],
    artifacts: [],
    contract: {
      inputs: {},
      goal: null,
      verification: null,
    },
  };

  const stagingRoot = await mkdtemp(join(dirname(skillRoot), ".scaffold-"));
  let movedIntoPlace = false;
  try {
    await mkdir(join(stagingRoot, "scripts"), { recursive: true });
    const skillMarkdown = buildSkillMarkdown(
      skillId,
      skillEntry.summary,
      scriptPathRelative,
      recordingContextPath !== undefined,
    );
    await writeFile(join(stagingRoot, "SKILL.md"), skillMarkdown, "utf8");
    await writeFile(join(stagingRoot, "skill.json"), `${JSON.stringify(skillEntry, null, 2)}\n`, "utf8");
    await writeFile(join(stagingRoot, "scripts", "run.js"), buildScriptTemplate(skillId, derived.applicationId), "utf8");
    const runShPath = join(stagingRoot, "scripts", "run.sh");
    await writeFile(runShPath, buildRunShTemplate(), "utf8");
    await chmod(runShPath, 0o755);

    if (recordingContextPath !== undefined) {
      try {
        const recordingContextContents = await readFile(recordingContextPath, "utf8");
        parseRecordingExportArtifactJson(recordingContextContents);
        await copyFile(recordingContextPath, join(stagingRoot, "recording-context.json"));
      } catch (error) {
        await rm(stagingRoot, { recursive: true, force: true });
        return {
          ok: false,
          code: SKILLS_SCAFFOLD_FAILED,
          message: `Failed to copy recording context from ${recordingContextPath}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    await rename(stagingRoot, skillRoot);
    movedIntoPlace = true;
    const updatedRegistry: SkillsRegistry = {
      ...loaded.registry,
      skills: [...loaded.registry.skills, skillEntry].sort((a, b) => a.id.localeCompare(b.id)),
    };
    await mkdir(dirname(loaded.resolvedPath), { recursive: true });
    await writeRegistry(loaded.resolvedPath, updatedRegistry);
  } catch (error) {
    await rm(movedIntoPlace ? skillRoot : stagingRoot, { recursive: true, force: true });
    return {
      ok: false,
      code: SKILLS_SCAFFOLD_FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    skillId,
    registryPath: loaded.resolvedPath,
    skillPath: skillRoot,
    ...(recordingContextPath !== undefined ? { recordingContextPath: join(skillRoot, "recording-context.json") } : {}),
    files: recordingContextPath !== undefined
      ? [
          join(skillRoot, "SKILL.md"),
          join(skillRoot, "skill.json"),
          join(skillRoot, "scripts", "run.js"),
          join(skillRoot, "scripts", "run.sh"),
          join(skillRoot, "recording-context.json"),
        ]
      : [
          join(skillRoot, "SKILL.md"),
          join(skillRoot, "skill.json"),
          join(skillRoot, "scripts", "run.js"),
          join(skillRoot, "scripts", "run.sh"),
        ],
  };
}
