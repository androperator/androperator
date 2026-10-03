import { access, cp, lstat, mkdir, mkdtemp, realpath, readdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { isKnownLegacyBundledSkill, moveLegacyBundledSkillToBackup } from "./legacyBundledSkills.js";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getCliVersion } from "../version/compatibility.js";
import { DEFAULT_BUNDLED_SKILLS_DIR } from "./config.js";

const BUNDLED_SKILLS_SOURCE_ENV_VAR = "ANDROPERATOR_BUNDLED_SKILLS";
const VERSION_FILENAME = "version.txt";
export const MANAGED_BUNDLED_SKILL_COPY_MARKER = ".androperator-managed";
export const MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT = "managed-by=androperator\nkind=bundled-skill-copy\n";

export interface BundledSkillDiscoveryDirEntry {
  label: string;
  dir: string;
}

export interface CopyBundledSkillsSuccess {
  ok: true;
  skills: string[];
  installedDir: string;
  agentDiscoveryDirs: BundledSkillDiscoveryDirEntry[];
  discoveryGroups: BundledSkillDiscoveryGroup[];
  migrations: Array<{ originalPath: string; backupPath: string }>;
}

export interface CopyBundledSkillsError {
  ok: false;
  code: string;
  message: string;
}

export interface CopyBundledSkillsOptions {
  sourceDir?: string;
  installedDir?: string;
  claudeSkillsDir?: string;
  /** Former discovery directory, used only to remove redundant managed links. */
  codexSkillsDir?: string;
  agentsSkillsDir?: string;
  codexHome?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  cliVersion?: string;
}

function resolveBundledSkillsSourceDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../bundled-skills");
}

export function resolvePackagedBundledSkillsSourceDir(
  options: Pick<CopyBundledSkillsOptions, "sourceDir" | "env"> = {}
): string {
  const env = options.env ?? process.env;
  return options.sourceDir
    ?? (env[BUNDLED_SKILLS_SOURCE_ENV_VAR] !== undefined && env[BUNDLED_SKILLS_SOURCE_ENV_VAR] !== ""
      ? env[BUNDLED_SKILLS_SOURCE_ENV_VAR]
      : resolveBundledSkillsSourceDir());
}

function resolveHomeDir(options: CopyBundledSkillsOptions): string {
  return resolve(options.homeDir ?? homedir());
}

export function resolveBundledSkillsInstalledDir(options: Pick<CopyBundledSkillsOptions, "installedDir" | "homeDir"> = {}): string {
  if (options.installedDir) {
    return resolve(options.installedDir);
  }
  if (options.homeDir) {
    return join(resolveHomeDir(options), ".androperator", "bundled-skills");
  }
  return DEFAULT_BUNDLED_SKILLS_DIR;
}

export function resolveClaudeSkillsDir(options: CopyBundledSkillsOptions): string {
  if (options.claudeSkillsDir) {
    return resolve(options.claudeSkillsDir);
  }
  return join(resolveHomeDir(options), ".claude", "skills");
}

export function resolveCodexSkillsDir(options: CopyBundledSkillsOptions): string {
  if (options.codexSkillsDir) {
    return resolve(options.codexSkillsDir);
  }
  const env = options.env ?? process.env;
  const codexHome = options.codexHome ?? env.CODEX_HOME;
  if (codexHome !== undefined && codexHome !== "") {
    return join(resolve(codexHome), "skills");
  }
  return join(resolveHomeDir(options), ".codex", "skills");
}

export function resolveAgentsSkillsDir(options: CopyBundledSkillsOptions): string {
  if (options.agentsSkillsDir) {
    return resolve(options.agentsSkillsDir);
  }
  return join(resolveHomeDir(options), ".agents", "skills");
}

function resolveAgentDiscoveryDirs(options: CopyBundledSkillsOptions): BundledSkillDiscoveryDirEntry[] {
  return [
    { label: "claude", dir: resolveClaudeSkillsDir(options) },
    { label: "agents", dir: resolveAgentsSkillsDir(options) },
  ];
}

export interface BundledSkillDiscoveryGroup {
  dir: string;
  aliases: BundledSkillDiscoveryDirEntry[];
  representation: "symlink" | "copy";
}

// Resolve existing ancestors too, so Doctor can plan missing discovery directories
// without creating them. Resolve dangling directory aliases through their targets.
async function resolvePhysicalPath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  let current = parse(absolutePath).root;
  let pending = absolutePath.slice(current.length).split(sep);
  let followedLinks = 0;
  while (pending.length > 0) {
    const component = pending.shift()!;
    if (component === "" || component === ".") continue;
    if (component === "..") {
      // The filesystem must enter the preceding directory before it can leave
      // it. Collapsing an absent directory here would hide a dangling alias.
      if (!(await stat(current)).isDirectory()) {
        throw new Error(`Discovery directory traverses a non-directory: ${current}`);
      }
      current = dirname(current);
      continue;
    }
    const candidate = join(current, component);
    const entry = await lstat(candidate).catch(error => {
      if (!isMissingPathError(error)) throw error;
      return undefined;
    });
    if (entry?.isSymbolicLink()) {
      if (++followedLinks > 40) throw new Error(`Discovery directory has a symlink cycle or too many links: ${path}`);
      const target = await readlink(candidate);
      const root = isAbsolute(target) ? parse(target).root : "";
      if (root !== "") current = root;
      // Expand links before processing '..', matching filesystem traversal even
      // when a link target or a child directory does not exist yet.
      pending = [...target.slice(root.length).split(sep), ...pending];
    } else {
      current = entry === undefined ? candidate : await realpath(candidate);
    }
  }
  return current;
}

export async function resolveBundledSkillDiscoveryGroups(options: CopyBundledSkillsOptions): Promise<BundledSkillDiscoveryGroup[]> {
  const groups = new Map<string, BundledSkillDiscoveryGroup>();
  for (const alias of resolveAgentDiscoveryDirs(options)) {
    const dir = await resolvePhysicalPath(alias.dir);
    let group = groups.get(dir);
    if (!group) {
      group = { dir, aliases: [], representation: "symlink" };
      groups.set(dir, group);
    }
    group.aliases.push(alias);
    if (alias.label === "agents") group.representation = "copy";
  }
  return [...groups.values()];
}

async function assertDiscoveryStorageSeparation(
  groups: BundledSkillDiscoveryGroup[], installedDir: string, sourceDir: string
): Promise<void> {
  const storageDirs = [await resolvePhysicalPath(installedDir), await resolvePhysicalPath(sourceDir)];
  for (const group of groups) {
    if (storageDirs.some(path => path === group.dir || path.startsWith(group.dir + "/") || group.dir.startsWith(path + "/"))) {
      throw new Error(`Discovery directory overlaps bundled skill storage: ${group.dir}`);
    }
  }
}

export async function inspectBundledSkillDiscoveryEntry(group: BundledSkillDiscoveryGroup, installedDir: string, skillName: string) {
  return group.representation === "copy"
    ? inspectManagedBundledSkillDirectory(join(group.dir, skillName), installedDir, skillName)
    : inspectManagedBundledSkillLink(join(group.dir, skillName), installedDir, skillName);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathExistsNoFollow(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function discoverBundledSkills(sourceDir: string): Promise<string[]> {
  const entries = await readdir(sourceDir);
  const skills: string[] = [];

  for (const entry of entries) {
    const entryPath = join(sourceDir, entry);
    let entryStat;
    try {
      entryStat = await stat(entryPath);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) {
      continue;
    }
    if (await pathExists(join(entryPath, "SKILL.md"))) {
      skills.push(entry);
    }
  }

  skills.sort((a, b) => a.localeCompare(b));
  return skills;
}

export async function listPackagedBundledSkills(sourceDir = resolveBundledSkillsSourceDir()): Promise<string[]> {
  return discoverBundledSkills(sourceDir);
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export function normalizeOwnedSkillTarget(installedDir: string, skillName: string): string {
  return resolve(installedDir, skillName);
}

function normalizeLegacyOwnedSkillTarget(installedDir: string, skillName: string): string {
  return resolve(dirname(installedDir), "agent-skills", skillName);
}

function legacyOwnedSkillTargets(installedDir: string, skillName: string): string[] {
  const target = normalizeLegacyOwnedSkillTarget(installedDir, skillName);
  return target === normalizeOwnedSkillTarget(installedDir, skillName) ? [] : [target];
}

async function resolveSymlinkTarget(path: string): Promise<string | undefined> {
  try {
    const target = await readlink(path);
    return resolve(dirname(path), target);
  } catch {
    return undefined;
  }
}

export interface ManagedBundledSkillLinkInspection {
  ok: boolean;
  status: "missing" | "conflict" | "broken" | "wrong-target" | "ok";
  actualTarget?: string;
  expectedTarget: string;
}

export async function inspectManagedBundledSkillLink(
  linkPath: string,
  installedDir: string,
  skillName: string
): Promise<ManagedBundledSkillLinkInspection> {
  const expectedTarget = normalizeOwnedSkillTarget(installedDir, skillName);

  let entryStat;
  try {
    entryStat = await lstat(linkPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        ok: false,
        status: "missing",
        expectedTarget,
      };
    }
    throw error;
  }

  if (!entryStat.isSymbolicLink()) {
    return {
      ok: false,
      status: "conflict",
      expectedTarget,
    };
  }

  const resolvedTarget = await resolveSymlinkTarget(linkPath);
  if (resolvedTarget === undefined) {
    return {
      ok: false,
      status: "broken",
      expectedTarget,
    };
  }

  try {
    await stat(resolvedTarget);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        ok: false,
        status: "broken",
        actualTarget: resolvedTarget,
        expectedTarget,
      };
    }
    throw error;
  }

  if (resolvedTarget !== expectedTarget) {
    return {
      ok: false,
      status: "wrong-target",
      actualTarget: resolvedTarget,
      expectedTarget,
    };
  }

  return {
    ok: true,
    status: "ok",
    actualTarget: resolvedTarget,
    expectedTarget,
  };
}

export interface ManagedBundledSkillDirectoryInspection {
  ok: boolean;
  status: "missing" | "conflict" | "legacy-symlink" | "unmarked" | "stale" | "ok";
  actualTarget?: string;
  expectedTarget: string;
}

async function isManagedBundledSkillSymlink(linkPath: string, installedDir: string, skillName: string): Promise<boolean> {
  const inspection = await inspectManagedBundledSkillLink(linkPath, installedDir, skillName);
  const legacyTargets = new Set(legacyOwnedSkillTargets(installedDir, skillName));
  // A dangling symlink that points at the correct expected target is still considered managed:
  // it means Androperator previously installed the link but the install dir was subsequently
  // removed. The install/update flow is allowed to recreate it.
  if (!inspection.ok && inspection.status === "broken" && inspection.actualTarget === inspection.expectedTarget) {
    return true;
  }
  // The public rename is a clean break, but rerunning the new install flow
  // should still be able to replace discovery links that Androperator itself
  // previously managed when they still point at the pre-rename install store.
  if (!inspection.ok && inspection.actualTarget !== undefined && legacyTargets.has(inspection.actualTarget)) {
    return true;
  }
  return inspection.ok;
}

function isManagedBundledSkillCopyMarkerContent(content: string): boolean {
  return content === MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT;
}

export async function inspectManagedBundledSkillDirectory(
  directoryPath: string,
  installedDir: string,
  skillName: string
): Promise<ManagedBundledSkillDirectoryInspection> {
  const expectedTarget = normalizeOwnedSkillTarget(installedDir, skillName);

  let entryStat;
  try {
    entryStat = await lstat(directoryPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        ok: false,
        status: "missing",
        expectedTarget,
      };
    }
    throw error;
  }

  if (entryStat.isSymbolicLink()) {
    const actualTarget = await resolveSymlinkTarget(directoryPath);
    if (await isManagedBundledSkillSymlink(directoryPath, installedDir, skillName)) {
      return {
        ok: false,
        status: "legacy-symlink",
        actualTarget,
        expectedTarget,
      };
    }
    return {
      ok: false,
      status: "conflict",
      actualTarget,
      expectedTarget,
    };
  }

  if (!entryStat.isDirectory()) {
    return {
      ok: false,
      status: "conflict",
      expectedTarget,
    };
  }

  const markerPath = join(directoryPath, MANAGED_BUNDLED_SKILL_COPY_MARKER);
  try {
    const markerStat = await lstat(markerPath);
    if (markerStat.isFile()) {
      const markerContent = await readFile(markerPath, "utf8");
      if (!isManagedBundledSkillCopyMarkerContent(markerContent)) {
        return {
          ok: false,
          status: "unmarked",
          expectedTarget,
        };
      }
      try {
        const skillFileStat = await stat(join(directoryPath, "SKILL.md"));
        if (!skillFileStat.isFile()) {
          return {
            ok: false,
            status: "stale",
            expectedTarget,
          };
        }
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
        return {
          ok: false,
          status: "stale",
          expectedTarget,
        };
      }
      return {
        ok: true,
        status: "ok",
        expectedTarget,
      };
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  return {
    ok: false,
    status: "unmarked",
    expectedTarget,
  };
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function ensureManagedSymlink(targetPath: string, linkPath: string, installedDir: string, skillName: string): Promise<void> {
  const exists = await pathExistsNoFollow(linkPath);
  if (exists) {
    const managed = await isManagedBundledSkillSymlink(linkPath, installedDir, skillName);
    if (!managed) {
      throw new Error(`Refusing to overwrite non-Androperator skill entry: ${linkPath}`);
    }
    await rm(linkPath, { recursive: true, force: true });
  }

  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function assertManagedSymlinkWritable(linkPath: string, installedDir: string, skillName: string): Promise<void> {
  const exists = await pathExistsNoFollow(linkPath);
  if (!exists) {
    return;
  }

  const managed = await isManagedBundledSkillSymlink(linkPath, installedDir, skillName);
  if (!managed) {
    throw new Error(`Refusing to overwrite non-Androperator skill entry: ${linkPath}`);
  }
}

async function ensureManagedDirectoryCopy(sourcePath: string, directoryPath: string, installedDir: string, skillName: string): Promise<void> {
  const exists = await pathExistsNoFollow(directoryPath);
  if (exists) {
    const inspection = await inspectManagedBundledSkillDirectory(directoryPath, installedDir, skillName);
    if (inspection.status !== "ok" && inspection.status !== "legacy-symlink" && inspection.status !== "stale") {
      throw new Error(`Refusing to overwrite non-Androperator skill entry: ${directoryPath}`);
    }
    await rm(directoryPath, { recursive: true, force: true });
  }

  await mkdir(dirname(directoryPath), { recursive: true });
  await cp(sourcePath, directoryPath, { recursive: true, force: true, dereference: true });
  await writeFile(join(directoryPath, MANAGED_BUNDLED_SKILL_COPY_MARKER), MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT, "utf8");
}

async function assertManagedDirectoryCopyWritable(directoryPath: string, installedDir: string, skillName: string): Promise<void> {
  const exists = await pathExistsNoFollow(directoryPath);
  if (!exists) {
    return;
  }

  const inspection = await inspectManagedBundledSkillDirectory(directoryPath, installedDir, skillName);
  if (inspection.status !== "ok" && inspection.status !== "legacy-symlink" && inspection.status !== "stale") {
    throw new Error(`Refusing to overwrite non-Androperator skill entry: ${directoryPath}`);
  }
}

async function removeStaleBundledSkillSymlinks(agentDir: string, activeSkills: Set<string>, installedDir: string): Promise<void> {
  const entries = await readdir(agentDir);
  for (const entry of entries) {
    if (activeSkills.has(entry)) {
      continue;
    }
    const entryPath = join(agentDir, entry);
    let entryStat;
    try {
      entryStat = await lstat(entryPath);
    } catch {
      // Agent discovery directories are shared user space. If an entry disappears
      // mid-scan or is unreadable, skip it rather than failing the whole install.
      // We only clean up links we can positively identify as Androperator-owned.
      continue;
    }
    if (!entryStat.isSymbolicLink()) {
      continue;
    }

    const resolvedTarget = await resolveSymlinkTarget(entryPath);
    if (
      resolvedTarget === normalizeOwnedSkillTarget(installedDir, entry)
      || legacyOwnedSkillTargets(installedDir, entry).includes(resolvedTarget ?? "")
    ) {
      await rm(entryPath, { recursive: true, force: true });
    }
  }
}

// Codex discovers ~/.agents/skills itself. Retire only links owned by this
// installer, after the active discovery entries have passed verification.
async function removeRedundantCodexLinks(
  options: CopyBundledSkillsOptions,
  groups: BundledSkillDiscoveryGroup[],
  installedDir: string,
  sourceDir: string,
): Promise<void> {
  const codexDir = await resolvePhysicalPath(resolveCodexSkillsDir(options));
  const protectedDirs = [
    ...groups.map(group => group.dir),
    await resolvePhysicalPath(installedDir),
    await resolvePhysicalPath(sourceDir),
  ];
  // A user may alias discovery roots to each other or to storage. Never clean
  // through an alias that would remove a retained entry or packaged content.
  if (protectedDirs.some(path => path === codexDir || path.startsWith(codexDir + sep) || codexDir.startsWith(path + sep))) {
    return;
  }
  try {
    await removeStaleBundledSkillSymlinks(codexDir, new Set(), installedDir);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

async function removeStaleBundledSkillCopies(agentDir: string, activeSkills: Set<string>, installedDir: string): Promise<void> {
  const entries = await readdir(agentDir);
  for (const entry of entries) {
    if (activeSkills.has(entry)) {
      continue;
    }
    const entryPath = join(agentDir, entry);
    let inspection;
    try {
      inspection = await inspectManagedBundledSkillDirectory(entryPath, installedDir, entry);
    } catch {
      // Shared discovery directories can change while being scanned. Only remove
      // entries that can be positively identified as Androperator-managed.
      continue;
    }
    if (inspection.status === "ok" || inspection.status === "legacy-symlink" || inspection.status === "stale") {
      await rm(entryPath, { recursive: true, force: true });
    }
  }
}

async function removeStaleInstalledSkills(installedDir: string, activeSkills: Set<string>): Promise<void> {
  const entries = await readdir(installedDir);

  for (const entry of entries) {
    if (entry === VERSION_FILENAME || activeSkills.has(entry)) {
      continue;
    }

    const entryPath = join(installedDir, entry);

    let entryStat;
    try {
      entryStat = await stat(entryPath);
    } catch {
      continue;
    }

    if (!entryStat.isDirectory()) {
      continue;
    }

    if (!(await pathExists(join(entryPath, "SKILL.md")))) {
      continue;
    }

    await rm(entryPath, { recursive: true, force: true });
  }
}

export async function copyBundledSkills(
  options: CopyBundledSkillsOptions = {}
): Promise<CopyBundledSkillsSuccess | CopyBundledSkillsError> {
  const sourceDir = resolvePackagedBundledSkillsSourceDir(options);
  const installedDir = resolveBundledSkillsInstalledDir(options);
  const agentDiscoveryDirs = resolveAgentDiscoveryDirs(options);
  const migrations: Array<{ originalPath: string; backupPath: string }> = [];

  let sourceStat;
  try {
    sourceStat = await stat(sourceDir);
  } catch {
    return {
      ok: false,
      code: "BUNDLED_SKILLS_SOURCE_NOT_FOUND",
      message: `Bundled-skills source directory not found: ${sourceDir}`,
    };
  }

  if (!sourceStat.isDirectory()) {
    return {
      ok: false,
      code: "BUNDLED_SKILLS_SOURCE_NOT_FOUND",
      message: `Bundled-skills source path is not a directory: ${sourceDir}`,
    };
  }

  try {
    const skills = await discoverBundledSkills(sourceDir);
    if (skills.length === 0) {
      return {
        ok: false,
        code: "BUNDLED_SKILLS_SOURCE_EMPTY",
        message: `No packaged bundled-skills with SKILL.md were found in ${sourceDir}`,
      };
    }
    const plannedDiscoveryGroups = await resolveBundledSkillDiscoveryGroups(options);
    await assertDiscoveryStorageSeparation(plannedDiscoveryGroups, installedDir, sourceDir);
    await ensureDirectory(installedDir);
    for (const { dir } of plannedDiscoveryGroups) {
      await ensureDirectory(dir);
    }
    // On case-insensitive filesystems, absent paths with different spellings can
    // become the same directory. Choose ownership only after all roots exist.
    const discoveryGroups = await resolveBundledSkillDiscoveryGroups(options);
    await assertDiscoveryStorageSeparation(discoveryGroups, installedDir, sourceDir);
    const symlinkDiscoveryDirs = discoveryGroups.filter(group => group.representation === "symlink");
    const managedCopyDiscoveryDirs = discoveryGroups.filter(group => group.representation === "copy");

    const legacyEntries: string[] = [];
    for (const skillName of skills) {
      for (const group of discoveryGroups) {
        const path = join(group.dir, skillName);
        if (await isKnownLegacyBundledSkill(path, skillName)) legacyEntries.push(path);
      }
      for (const { dir } of symlinkDiscoveryDirs) {
        if (legacyEntries.includes(join(dir, skillName))) continue;
        await assertManagedSymlinkWritable(join(dir, skillName), installedDir, skillName);
      }
      for (const { dir } of managedCopyDiscoveryDirs) {
        if (legacyEntries.includes(join(dir, skillName))) continue;
        await assertManagedDirectoryCopyWritable(join(dir, skillName), installedDir, skillName);
      }
    }

    for (const originalPath of legacyEntries) {
      const backupRoot = join(dirname(installedDir), "bundled-skills-backups");
      await mkdir(backupRoot, { recursive: true });
      const backupDir = await mkdtemp(join(backupRoot, new Date().toISOString().replace(/[:.]/g, "-") + "-"));
      const backupPath = join(backupDir, basename(originalPath));
      await moveLegacyBundledSkillToBackup(originalPath, backupPath, basename(originalPath));
      migrations.push({ originalPath, backupPath });
    }

    for (const skillName of skills) {
      const sourceSkillDir = join(sourceDir, skillName);
      const targetSkillDir = join(installedDir, skillName);
      await rm(targetSkillDir, { recursive: true, force: true });
      await cp(sourceSkillDir, targetSkillDir, { recursive: true, force: true, dereference: true });
      for (const { dir } of symlinkDiscoveryDirs) {
        await ensureManagedSymlink(targetSkillDir, join(dir, skillName), installedDir, skillName);
      }
      for (const { dir } of managedCopyDiscoveryDirs) {
        await ensureManagedDirectoryCopy(targetSkillDir, join(dir, skillName), installedDir, skillName);
      }
    }

    const activeSkills = new Set(skills);
    await removeStaleInstalledSkills(installedDir, activeSkills);
    for (const { dir } of symlinkDiscoveryDirs) {
      await removeStaleBundledSkillSymlinks(dir, activeSkills, installedDir);
    }
    for (const { dir } of managedCopyDiscoveryDirs) {
      await removeStaleBundledSkillCopies(dir, activeSkills, installedDir);
    }
    for (const group of discoveryGroups) {
      for (const skillName of skills) {
        const inspection = await inspectBundledSkillDiscoveryEntry(group, installedDir, skillName);
        if (!inspection.ok) throw new Error(`Post-install verification failed: ${join(group.dir, skillName)} (${group.representation}, ${inspection.status})`);
      }
    }
    await removeRedundantCodexLinks(options, discoveryGroups, installedDir, sourceDir);
    await writeFile(join(installedDir, VERSION_FILENAME), `${options.cliVersion ?? getCliVersion()}\n`, "utf8");

    return {
      ok: true,
      skills,
      installedDir,
      agentDiscoveryDirs,
      discoveryGroups,
      migrations,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "BUNDLED_SKILLS_INSTALL_FAILED",
      message: migrations.length ? `${message}; completed migrations: ${JSON.stringify(migrations)}` : message,
    };
  }
}

export async function listInstalledBundledSkills(installDir = DEFAULT_BUNDLED_SKILLS_DIR): Promise<Array<{ name: string; skillPath: string }>> {
  const entries = await readdir(installDir);
  const skills: Array<{ name: string; skillPath: string }> = [];

  for (const entry of entries) {
    const skillPath = join(installDir, entry, "SKILL.md");
    if (await pathExists(skillPath)) {
      skills.push({ name: entry, skillPath });
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export async function readBundledSkillSymlinkTarget(path: string): Promise<string | undefined> {
  return resolveSymlinkTarget(path);
}
