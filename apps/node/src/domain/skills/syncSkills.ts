import { loadCollection } from "../../adapters/skills-repo/localSkillsRegistry.js";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { DEFAULT_SKILLS_DIR, DEFAULT_SKILLS_REGISTRY_SUBPATH } from "./skillsConfig.js";
import { SKILLS_SYNC_FAILED } from "../../contracts/skills.js";

export interface SyncSkillsResult {
  ok: true;
  synced: true;
  skillsDir: string;
  registryPath: string | null;
  message: string;
}

export interface SyncSkillsError {
  ok: false;
  code: string;
  message: string;
}

/** Initialize a local skill workspace without downloading an app-skill catalog. */
export async function syncSkills(
  ref: string,
  skillsDir?: string
): Promise<SyncSkillsResult | SyncSkillsError> {
  const dir = skillsDir ?? DEFAULT_SKILLS_DIR;
  const registryPath = join(dir, DEFAULT_SKILLS_REGISTRY_SUBPATH);
  if (ref !== "main") {
    return { ok: false, code: SKILLS_SYNC_FAILED,
      message: "Skills are local in Androperator 1.0. Git refs are no longer supported; use skills new in your own workspace." };
  }
  try {
    await mkdir(dirname(registryPath), { recursive: true });
    const loaded = await loadCollection(dirname(registryPath));
    return { ok: true, synced: true, skillsDir: dir, registryPath: loaded.indexed ? registryPath : null,
      message: `Local skill workspace ready at ${dir}. Create skills with androperator skills new; no catalog was downloaded.` };
  } catch (error) {
    return { ok: false, code: SKILLS_SYNC_FAILED,
      message: `Local skill workspace setup failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
