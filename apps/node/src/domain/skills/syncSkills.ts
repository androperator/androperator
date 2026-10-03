import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { DEFAULT_SKILLS_DIR, DEFAULT_SKILLS_REGISTRY_SUBPATH } from "./skillsConfig.js";
import { SKILLS_SYNC_FAILED } from "../../contracts/skills.js";

export interface SyncSkillsResult {
  ok: true;
  synced: true;
  skillsDir: string;
  registryPath: string;
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
    try {
      // Exclusive creation preserves existing skills, even during concurrent installs.
      await writeFile(registryPath, JSON.stringify({ skills: [] }, null, 2) + "\n", { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const data = JSON.parse(await readFile(registryPath, "utf8"));
    if (!Array.isArray(data.skills)) throw new Error("skills array required");
    return { ok: true, synced: true, skillsDir: dir, registryPath,
      message: `Local skill workspace ready at ${dir}. Create skills with androperator skills new; no catalog was downloaded.` };
  } catch (error) {
    return { ok: false, code: SKILLS_SYNC_FAILED,
      message: `Local skill workspace setup failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
