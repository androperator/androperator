import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import type { SkillsRegistry, SkillEntry } from "../../contracts/skills.js";

export function getSkillsDirectory(): string {
  const configured = process.env.ANDROPERATOR_SKILLS_DIR;
  if (configured !== undefined) {
    if (configured.trim().length === 0) throw new Error("ANDROPERATOR_SKILLS_DIR must not be blank.");
    return resolve(configured.trim());
  }
  return join(process.cwd(), "skills");
}

// Retained for Node callers that explicitly supply an index file.
export function getRegistryPath(): string {
  return join(getSkillsDirectory(), "skills-registry.json");
}

export function getRepoRoot(registryPath: string): string {
  return dirname(dirname(registryPath));
}

export interface LoadRegistryResult {
  registry: SkillsRegistry;
  // The collection's index location anchors relative paths, even when no file exists.
  resolvedPath: string;
  indexed?: boolean;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function readIndex(path: string): Promise<SkillsRegistry> {
  const data = JSON.parse(await readFile(path, "utf8")) as SkillsRegistry;
  if (!Array.isArray(data.skills)) throw new Error("Invalid registry: skills array required");
  return data;
}

export async function loadCollection(directory: string, allowMissing = false): Promise<LoadRegistryResult> {
  const indexPath = join(directory, "skills-registry.json");
  const registry: SkillsRegistry = { skills: [] };
  const indexed = false;
  try {
    const index = await readIndex(indexPath);
    return { registry: index, resolvedPath: indexPath, indexed: true };
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!isMissing(error) || !allowMissing) throw error;
    return { registry, resolvedPath: indexPath, indexed };
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillPath = join(basename(directory), entry.name);
    const manifestPath = join(directory, entry.name, "skill.json");
    let manifest: SkillEntry;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      if (isMissing(error)) continue;
      throw new Error(`Unable to read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)
        || typeof manifest.id !== "string" || manifest.id.trim().length === 0
        || typeof manifest.applicationId !== "string" || manifest.applicationId.trim().length === 0
        || typeof manifest.intent !== "string" || manifest.intent.trim().length === 0
        || typeof manifest.summary !== "string" || !Array.isArray(manifest.scripts)
        || !Array.isArray(manifest.artifacts)
        || !manifest.scripts.every((path) => typeof path === "string" && path.trim().length > 0)
        || !manifest.artifacts.every((path) => typeof path === "string" && path.trim().length > 0)) {
      throw new Error(`Invalid skill manifest: ${manifestPath}`);
    }
    if (registry.skills.some((skill) => skill.id === manifest.id)) {
      throw new Error(`Duplicate local skill id: ${manifest.id}`);
    }
    registry.skills.push({ ...manifest, path: skillPath, skillFile: join(skillPath, "SKILL.md") });
  }
  return { registry, resolvedPath: indexPath, indexed };
}

export async function loadRegistry(registryPath?: string): Promise<LoadRegistryResult> {
  if (registryPath !== undefined) {
    if (registryPath.trim().length === 0) throw new Error("Registry path is blank. Pass a valid skills-registry.json path.");
    const path = resolve(registryPath.trim());
    try {
      return { registry: await readIndex(path), resolvedPath: path, indexed: true };
    } catch (error) {
      if (!isMissing(error)) throw error;
      throw new Error(`Registry not found at explicit path: ${path}. Fix the path or omit the explicit registry path.`);
    }
  }
  const directory = getSkillsDirectory();
  if (process.env.ANDROPERATOR_SKILLS_DIR !== undefined) return loadCollection(directory);
  // A project collection, including an empty one, deliberately shadows home skills.
  try {
    if ((await stat(directory)).isDirectory()) return loadCollection(directory);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const homeDirectory = join(homedir(), ".androperator", "skills", "skills");
  return loadCollection(homeDirectory, true);
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
