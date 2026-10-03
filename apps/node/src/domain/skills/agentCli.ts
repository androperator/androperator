import { constants as fsConstants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, extname, join, resolve, relative, isAbsolute } from "node:path";
import type { SkillAgentConfig } from "../../contracts/skills.js";

export const SKILL_AGENT_CLI_ENV_VAR = "ANDROPERATOR_SKILL_AGENT_CLI";
export const EXECUTABLE_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;

export interface AgentCliResolutionSuccess {
  ok: true;
  executablePath: string;
}

export interface AgentCliResolutionFailure {
  ok: false;
  message: string;
}

export type AgentCliResolution = AgentCliResolutionSuccess | AgentCliResolutionFailure;

export interface EffectiveAgentConfigSuccess {
  ok: true;
  agent: SkillAgentConfig;
}

export type EffectiveAgentConfigResolution = EffectiveAgentConfigSuccess | AgentCliResolutionFailure;

export async function canResolveAgentTarget(path: string): Promise<boolean> {
  return canResolveAgentTargetForPlatform(path, process.platform);
}

async function canResolveAgentTargetForPlatform(path: string, platform: NodeJS.Platform): Promise<boolean> {
  const requiredMode = platform === "win32" || extname(path) === ".js" ? fsConstants.F_OK : fsConstants.X_OK;
  try {
    await access(path, requiredMode);
    return true;
  } catch {
    return false;
  }
}

export function resolveConfiguredAgentCli(
  agent: SkillAgentConfig,
  resolvedEnv: NodeJS.ProcessEnv
): EffectiveAgentConfigResolution {
  if (agent.cliPath && agent.cliPath.trim().length > 0) {
    return { ok: true, agent };
  }
  const overriddenCli = resolvedEnv[SKILL_AGENT_CLI_ENV_VAR]?.trim();
  if (!overriddenCli) {
    return { ok: true, agent };
  }
  if (!EXECUTABLE_NAME_PATTERN.test(overriddenCli)) {
    return {
      ok: false,
      message: `Configured ${SKILL_AGENT_CLI_ENV_VAR} value '${overriddenCli}' is not a plain executable name`,
    };
  }
  return {
    ok: true,
    agent: {
      ...agent,
      cli: overriddenCli,
      cliPath: undefined,
    },
  };
}

export async function resolveExecutableOnPath(
  executableName: string,
  pathValue: string | undefined
): Promise<string | null> {
  return resolveExecutableOnPathForPlatform(executableName, pathValue, process.platform, process.env.PATHEXT);
}

export async function resolveExecutableOnPathForPlatform(
  executableName: string,
  pathValue: string | undefined,
  platform: NodeJS.Platform,
  pathExtValue?: string
): Promise<string | null> {
  const pathDelimiter = platform === "win32" ? ";" : delimiter;
  const pathEntries = (pathValue ?? "").split(pathDelimiter).filter((entry) => entry.length > 0);
  const candidates = getExecutableCandidatesForPlatform(executableName, platform, pathExtValue);
  for (const entry of pathEntries) {
    for (const candidateName of candidates) {
      const candidate = join(entry, candidateName);
      if (await canResolveAgentTargetForPlatform(candidate, platform)) {
        return candidate;
      }
    }
  }
  return null;
}

function getExecutableCandidatesForPlatform(
  executableName: string,
  platform: NodeJS.Platform,
  pathExtValue?: string
): string[] {
  if (platform !== "win32" || extname(executableName).length > 0) {
    return [executableName];
  }

  const extensions = (pathExtValue ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0)
    .map((extension) => extension.startsWith(".") ? extension : `.${extension}`);

  return Array.from(new Set([
    executableName,
    ...extensions.flatMap((extension) => {
      const lower = extension.toLowerCase();
      const upper = extension.toUpperCase();
      return lower === upper
        ? [`${executableName}${extension}`]
        : [`${executableName}${extension}`, `${executableName}${lower}`, `${executableName}${upper}`];
    }),
  ]));
}

export async function resolveAgentCliExecutable(
  agent: SkillAgentConfig,
  skillDir: string,
  resolvedEnv: NodeJS.ProcessEnv
): Promise<AgentCliResolution> {
  if (agent.cliPath && agent.cliPath.length > 0) {
    if (isAbsolute(agent.cliPath)) {
      return {
        ok: false,
        message: "Configured agent cliPath must be relative to the skill directory",
      };
    }
    const resolvedCliPath = resolve(skillDir, agent.cliPath);
    const relativeCliPath = relative(skillDir, resolvedCliPath);
    if (relativeCliPath.startsWith("..") || isAbsolute(relativeCliPath)) {
      return {
        ok: false,
        message: "Configured agent cliPath must stay within the skill directory",
      };
    }
    if (await canResolveAgentTarget(resolvedCliPath)) {
      try {
        const canonicalSkillDir = await realpath(skillDir);
        const canonicalCliPath = await realpath(resolvedCliPath);
        const canonicalRelativePath = relative(canonicalSkillDir, canonicalCliPath);
        if (canonicalRelativePath.startsWith("..") || isAbsolute(canonicalRelativePath)) {
          return {
            ok: false,
            message: "Configured agent cliPath must resolve within the skill directory",
          };
        }
      } catch {
        return {
          ok: false,
          message: `Configured agent CLI was not found or is not executable at ${resolvedCliPath}`,
        };
      }
      return { ok: true, executablePath: resolvedCliPath };
    }
    return {
      ok: false,
      message: `Configured agent CLI was not found or is not executable at ${resolvedCliPath}`,
    };
  }

  const resolvedPath = await resolveExecutableOnPath(agent.cli, resolvedEnv.PATH);
  if (resolvedPath !== null) {
    return { ok: true, executablePath: resolvedPath };
  }

  return {
    ok: false,
    message: `Configured agent CLI '${agent.cli}' was not found on PATH`,
  };
}
