import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import type { SkillsRegistry, SkillEntry } from "../../contracts/skills.js";

/**
 * Default registry path. When running from repo root (e.g. node apps/node/dist/cli/index.js), cwd is repo root.
 * When running from apps/node, cwd is apps/node so we try parent parent (repo root).
 */
function getDefaultRegistryPath(): string {
  const cwd = process.cwd();
  return join(cwd, "skills", "skills-registry.json");
}

function getInstalledHomeRegistryPath(): string {
  return join(homedir(), ".androperator", "skills", "skills", "skills-registry.json");
}

function getRepoRelativeFallbackPath(): string | undefined {
  const cwd = process.cwd();
  if (basename(cwd) !== "node" || basename(dirname(cwd)) !== "apps") {
    return undefined;
  }
  return join(cwd, "..", "..", "skills", "skills-registry.json");
}

function isMissingRegistryFileError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

function getConfiguredRegistryPathFromEnv(): string | undefined {
  const configuredPath = process.env.ANDROPERATOR_SKILLS_REGISTRY;
  if (configuredPath === undefined) {
    return undefined;
  }

  const trimmedPath = configuredPath.trim();
  if (trimmedPath.length === 0) {
    throw new Error(
      "ANDROPERATOR_SKILLS_REGISTRY is set but blank. Unset it or set it to a valid skills-registry.json path."
    );
  }

  return trimmedPath;
}

export function getRegistryPath(): string {
  return getConfiguredRegistryPathFromEnv() ?? getDefaultRegistryPath();
}

/**
 * Repo root: directory containing the skills/ folder (parent of skills/).
 */
export function getRepoRoot(registryPath: string): string {
  return dirname(dirname(registryPath));
}

export interface LoadRegistryResult {
  registry: SkillsRegistry;
  resolvedPath: string;
}

function normalizeExplicitRegistryPath(registryPath: string | undefined): string | undefined {
  if (registryPath === undefined) {
    return undefined;
  }

  const trimmedPath = registryPath.trim();
  if (trimmedPath.length === 0) {
    throw new Error("Registry path is blank. Pass a valid skills-registry.json path.");
  }

  return trimmedPath;
}

export async function loadRegistry(registryPath?: string): Promise<LoadRegistryResult> {
  const explicitRegistryPath = normalizeExplicitRegistryPath(registryPath);
  const installedHomeRegistryPath = getInstalledHomeRegistryPath();

  let configuredPath: string | undefined;
  if (explicitRegistryPath === undefined) {
    try {
      configuredPath = getConfiguredRegistryPathFromEnv();
    } catch (error) {
      process.stderr.write(
        "Error: ANDROPERATOR_SKILLS_REGISTRY is set but blank. " +
        "Unset it or set it to a valid skills-registry.json path.\n"
      );
      throw error;
    }
  }

  const defaultPath = getDefaultRegistryPath();
  let path = explicitRegistryPath ?? configuredPath ?? defaultPath;
  let raw: string | undefined;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if (explicitRegistryPath) {
      if (!isMissingRegistryFileError(error)) {
        throw error;
      }
      throw new Error(
        `Registry not found at explicit path: ${path}. ` +
        "Fix the path or omit the explicit registry path."
      );
    }

    if (!explicitRegistryPath && configuredPath) {
      if (!isMissingRegistryFileError(error)) {
        throw error;
      }
      process.stderr.write(
        `Error: Registry file not found at ${path} (from ANDROPERATOR_SKILLS_REGISTRY). ` +
        `The installed registry normally lives at ${installedHomeRegistryPath}. ` +
        "Check that the path is correct.\n"
      );
      throw new Error(
        `Registry not found at configured path: ${path}. ` +
        `The installed registry normally lives at ${installedHomeRegistryPath}. ` +
        "Fix ANDROPERATOR_SKILLS_REGISTRY, unset it to use the installed copy, then rerun androperator skills list, or run androperator skills install."
      );
    }

    if (!isMissingRegistryFileError(error)) {
      throw error;
    }

    const candidates = [
      getRepoRelativeFallbackPath(),
      getInstalledHomeRegistryPath(),
    ].filter((candidate, index, all): candidate is string => (
      candidate !== undefined
      && candidate !== path
      && all.indexOf(candidate) === index
    ));

    for (const candidate of candidates) {
      try {
        raw = await readFile(candidate, "utf-8");
        path = candidate;
        break;
      } catch (candidateError) {
        if (!isMissingRegistryFileError(candidateError)) {
          throw candidateError;
        }
      }
    }

    if (raw === undefined) {
      if (!explicitRegistryPath && !configuredPath) {
        process.stderr.write(
          "Warning: ANDROPERATOR_SKILLS_REGISTRY is not set. " +
          `Androperator also checked the installed registry at ${installedHomeRegistryPath}. ` +
          "Verify that file, then rerun 'androperator skills list', or run 'androperator skills install'.\n"
        );
        throw new Error(
          `Registry not found. Checked: ${[path, ...candidates].join(", ")}. ` +
          `The installed registry normally lives at ${installedHomeRegistryPath}. ` +
          "Verify that path, then rerun androperator skills list, or run androperator skills install."
        );
      }

      if (candidates.length > 0) {
        throw new Error(
          `Registry not found. Checked: ${[path, ...candidates].join(", ")}. ` +
          `The installed registry normally lives at ${installedHomeRegistryPath}. ` +
          "Verify that path, then rerun androperator skills list, or run androperator skills install."
        );
      }

      throw new Error(
        `Registry not found: ${path}. ` +
        `The installed registry normally lives at ${installedHomeRegistryPath}. ` +
        "Verify that path, then rerun androperator skills list, or run androperator skills install."
      );
    }
  }
  const data = JSON.parse(raw) as SkillsRegistry;
  if (!Array.isArray(data.skills)) {
    throw new Error("Invalid registry: skills array required");
  }
  return { registry: data, resolvedPath: path };
}

export function findSkillById(registry: SkillsRegistry, skillId: string): SkillEntry | undefined {
  return registry.skills.find((s) => s.id === skillId);
}

/**
 * Resolve artifact path to absolute. Registry artifact entries are like "skills/.../artifacts/climate-status.recipe.json".
 */
export function resolveArtifactPath(registryPath: string, artifactRelativePath: string): string {
  const repoRoot = getRepoRoot(registryPath);
  return join(repoRoot, artifactRelativePath);
}

/**
 * Get artifact path (relative to repo root) from skill by name (e.g. "climate-status" -> skills/.../artifacts/climate-status.recipe.json).
 */
export function getArtifactPathFromSkill(skill: SkillEntry, artifactName: string): string | undefined {
  const base = artifactName.replace(/\.recipe\.json$/i, "");
  const candidate = `${base}.recipe.json`;
  return skill.artifacts.find((a) => a.endsWith("/" + candidate) || a === candidate) ?? undefined;
}
