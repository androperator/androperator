import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BUNDLED_SKILLS_DIR = join(homedir(), ".androperator", "bundled-skills");
