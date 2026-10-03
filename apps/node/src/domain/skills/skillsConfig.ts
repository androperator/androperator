import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_SKILLS_DIR = join(homedir(), ".androperator", "skills");
export const DEFAULT_BUNDLED_SKILLS_DIR = join(homedir(), ".androperator", "bundled-skills");
export const DEFAULT_SKILLS_REGISTRY_SUBPATH = join("skills", "skills-registry.json");

export const ANDROPERATOR_BIN_ENV_VAR = "ANDROPERATOR_BIN";
export const ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR = "ANDROPERATOR_OPERATOR_PACKAGE";
export const ANDROPERATOR_DEVICE_ID_ENV_VAR = "ANDROPERATOR_DEVICE_ID";
export const DEFAULT_OPERATOR_PACKAGE = "com.androperator.operator";

export function getDefaultSkillsRegistryPath(): string {
  return join(DEFAULT_SKILLS_DIR, DEFAULT_SKILLS_REGISTRY_SUBPATH);
}

export interface ResolvedSkillBin {
  cmd: string;
  args: string[];
}

function quoteCommandPart(part: string): string {
  if (part === "") {
    return '""';
  }
  if (/\s/.test(part)) {
    return `"${part}"`;
  }
  return part;
}

/**
 * Get the absolute path to the local sibling build.
 * This is resolved relative to this module's location, not process.cwd().
 */
function getSiblingBuildPath(): string | undefined {
  // Compiled: apps/node/dist/domain/skills/skillsConfig.js -> dist/cli/index.js (two levels up)
  // Source (rare): apps/node/src/domain/skills -> apps/node/dist/cli/index.js
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const fromDist = resolve(moduleDir, "..", "..", "cli", "index.js");
  if (existsSync(fromDist)) {
    return fromDist;
  }
  const fromSrc = resolve(moduleDir, "..", "..", "..", "dist", "cli", "index.js");
  if (existsSync(fromSrc)) {
    return fromSrc;
  }
  return undefined;
}

/**
 * Resolve the Androperator binary path for skill execution.
 *
 * Resolution order (highest priority first):
 * 1. Explicit ANDROPERATOR_BIN env var
 * 2. Local sibling build at known path (if present)
 * 3. Global "androperator" binary (fallback)
 *
 * The sibling build is preferred over the global binary so that users with a
 * local checkout automatically get the correct compiled output, which is always
 * in sync with the Android Operator APK. The global binary may lag behind due
 * to npm publish delays.
 */
export function resolveSkillBin(): ResolvedSkillBin {
  // 1. Explicit override via ANDROPERATOR_BIN
  const explicitBin = process.env[ANDROPERATOR_BIN_ENV_VAR];
  if (explicitBin !== undefined && explicitBin !== "") {
    return { cmd: explicitBin, args: [] };
  }

  // 2. Local sibling build (preferred over global when present)
  const siblingCli = getSiblingBuildPath();
  if (siblingCli) {
    return { cmd: process.execPath, args: [siblingCli] };
  }

  // 3. Global androperator binary
  return { cmd: "androperator", args: [] };
}

/**
 * Resolve the full command string for ANDROPERATOR_BIN env var.
 * This combines cmd and args into a single executable string.
 */
export function formatSkillBinCommand(resolved: ResolvedSkillBin): string {
  return [resolved.cmd, ...resolved.args].map(quoteCommandPart).join(" ");
}

export function resolveSkillBinCommand(): string {
  return formatSkillBinCommand(resolveSkillBin());
}

/**
 * Resolve the receiver package for skill execution.
 *
 * Returns the value from ANDROPERATOR_OPERATOR_PACKAGE env var, or the default
 * release package if not set.
 */
export function resolveOperatorPackage(): string {
  const envPackage = process.env[ANDROPERATOR_OPERATOR_PACKAGE_ENV_VAR];
  if (envPackage !== undefined && envPackage !== "") {
    return envPackage;
  }
  return DEFAULT_OPERATOR_PACKAGE;
}
