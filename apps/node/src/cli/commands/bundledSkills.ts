import { stat } from "node:fs/promises";
import { DEFAULT_BUNDLED_SKILLS_DIR } from "../../domain/bundledSkills/config.js";
import {
  copyBundledSkills,
  listInstalledBundledSkills,
  resolveClaudeSkillsDir,
  resolveCodexSkillsDir,
  type CopyBundledSkillsOptions,
} from "../../domain/bundledSkills/copyBundledSkills.js";
import type { OutputOptions } from "../output.js";
import { formatError, formatSuccess } from "../output.js";

export interface BundledSkillCommandOptions extends CopyBundledSkillsOptions {
  format: OutputOptions["format"];
}

async function isMissingDir(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

function getBundledSkillsEnvHint(env: NodeJS.ProcessEnv | undefined): string | undefined {
  const sourceDir = env?.ANDROPERATOR_BUNDLED_SKILLS;
  if (sourceDir === undefined || sourceDir === "") {
    return undefined;
  }
  return `Using ANDROPERATOR_BUNDLED_SKILLS=${sourceDir}`;
}

async function runBundledSkillsInstall(
  action: "install" | "update",
  options: BundledSkillCommandOptions
): Promise<string> {
  const result = await copyBundledSkills(options);
  if (!result.ok) {
    return formatError({ code: result.code, message: result.message }, options);
  }

  return formatSuccess({
    skills: result.skills,
    count: result.skills.length,
    installedDir: result.installedDir,
    claudeSkillsDir: resolveClaudeSkillsDir(options),
    codexSkillsDir: resolveCodexSkillsDir(options),
    agentDiscoveryDirs: result.agentDiscoveryDirs,
    discoveryGroups: result.discoveryGroups,
    migrations: result.migrations,
    message: `Bundled-skills ${action === "install" ? "installed" : "updated"}.`,
    envHint: getBundledSkillsEnvHint(options.env),
  }, options);
}

export async function cmdBundledSkillsInstall(options: BundledSkillCommandOptions): Promise<string> {
  return runBundledSkillsInstall("install", options);
}

export async function cmdBundledSkillsUpdate(options: BundledSkillCommandOptions): Promise<string> {
  return runBundledSkillsInstall("update", options);
}

export async function cmdBundledSkillsList(
  options: { format: OutputOptions["format"]; installDir?: string }
): Promise<string> {
  const installDir = options.installDir ?? DEFAULT_BUNDLED_SKILLS_DIR;
  try {
    if (await isMissingDir(installDir)) {
      return formatSuccess({
        skills: [],
        count: 0,
        installedDir: installDir,
        message: "No installed bundled-skills found. Run androperator bundled-skills install to get androperator-agent-orientation, androperator-agent-control-loop, androperator-upgrade, androperator-skill-author-by-agent-discovery, and androperator-skill-author-by-recording.",
      }, options);
    }

    const skills = await listInstalledBundledSkills(installDir);
    return formatSuccess({
      skills,
      count: skills.length,
      installedDir: installDir,
    }, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatError({ code: "BUNDLED_SKILLS_LIST_FAILED", message }, options);
  }
}
