import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { chmod, cp, lstat, mkdtemp, realpath, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getCliVersion } from "../../domain/version/compatibility.js";
import { cmdBundledSkillsInstall, cmdBundledSkillsList } from "../../cli/commands/bundledSkills.js";
import {
  copyBundledSkills,
  listPackagedBundledSkills,
  resolvePackagedBundledSkillsSourceDir,
  resolveBundledSkillDiscoveryGroups,
  MANAGED_BUNDLED_SKILL_COPY_MARKER,
  MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT,
} from "../../domain/bundledSkills/copyBundledSkills.js";

import { checkBundledSkillsStaleness } from "../../domain/doctor/checks/hostChecks.js";

import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";

import { moveLegacyBundledSkillToBackup } from "../../domain/bundledSkills/legacyBundledSkills.js";

const tempRoots: string[] = [];
const directorySymlinkType = process.platform === "win32" ? "junction" : "dir";

async function makeTempRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "androperator-bundled-skills-")));
  tempRoots.push(root);
  return root;
}

async function createSourceSkill(root: string, skillName: string): Promise<string> {
  return createSourceSkills(root, [skillName]);
}

async function createSourceSkills(root: string, skillNames: string[]): Promise<string> {
  const sourceDir = join(root, "source");
  for (const skillName of skillNames) {
    const skillDir = join(sourceDir, skillName);
    await mkdir(skillDir, { recursive: true });
    await mkdir(join(skillDir, "agents"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `# ${skillName}\n`, "utf8");
    await writeFile(join(skillDir, "agents", "openai.yaml"), "name: demo\n", "utf8");
  }
  return sourceDir;
}

async function createLegacySkillFixture(skillName = "androperator-upgrade", consumer = ".claude") {
  const root = await makeTempRoot();
  const homeDir = join(root, "home");
  const sourceDir = resolvePackagedBundledSkillsSourceDir({ env: {} });
  const legacyPath = join(homeDir, consumer, "skills", skillName);
  await cp(join(dirname(fileURLToPath(import.meta.url)), "../../../src/test/fixtures/bundled-guidance", skillName), legacyPath, { recursive: true });
  return { root, homeDir, sourceDir, skillName, legacyPath };
}

async function assertManagedAgentsCopy(agentsSkillsDir: string, skillName: string, expectedSkillMarkdown: string): Promise<void> {
  const copyPath = join(agentsSkillsDir, skillName);
  assert.equal((await lstat(copyPath)).isDirectory(), true);
  assert.equal(await readFile(join(copyPath, "SKILL.md"), "utf8"), expectedSkillMarkdown);
  assert.equal(await readFile(join(copyPath, MANAGED_BUNDLED_SKILL_COPY_MARKER), "utf8"), MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("copyBundledSkills", () => {
  it("discovers multiple skills by finding subdirectories with SKILL.md and copies them to the install target", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkills(root, [
      "androperator-agent-orientation",
      "androperator-upgrade",
      "androperator-skill-author-by-agent-discovery",
      "androperator-skill-author-by-recording",
    ]);
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir,
      codexSkillsDir,
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      assert.fail("expected successful copyBundledSkills result");
    }
    assert.deepEqual(result.skills, [
      "androperator-agent-orientation",
      "androperator-skill-author-by-agent-discovery",
      "androperator-skill-author-by-recording",
      "androperator-upgrade",
    ]);
    assert.equal(await readFile(join(installedDir, "androperator-agent-orientation", "SKILL.md"), "utf8"), "# androperator-agent-orientation\n");
    assert.equal(await readFile(join(installedDir, "androperator-upgrade", "SKILL.md"), "utf8"), "# androperator-upgrade\n");
    assert.equal(await readFile(join(installedDir, "androperator-skill-author-by-agent-discovery", "SKILL.md"), "utf8"), "# androperator-skill-author-by-agent-discovery\n");
    assert.equal(await readFile(join(installedDir, "androperator-skill-author-by-recording", "SKILL.md"), "utf8"), "# androperator-skill-author-by-recording\n");
    assert.equal(await readFile(join(installedDir, "androperator-agent-orientation", "agents", "openai.yaml"), "utf8"), "name: demo\n");
    assert.equal(await readFile(join(installedDir, "androperator-upgrade", "agents", "openai.yaml"), "utf8"), "name: demo\n");
    assert.equal(await readFile(join(installedDir, "androperator-skill-author-by-agent-discovery", "agents", "openai.yaml"), "utf8"), "name: demo\n");
    assert.equal(await readFile(join(installedDir, "androperator-skill-author-by-recording", "agents", "openai.yaml"), "utf8"), "name: demo\n");
    assert.equal(await readlink(join(claudeSkillsDir, "androperator-agent-orientation")), join(installedDir, "androperator-agent-orientation"));
    assert.equal(await readlink(join(claudeSkillsDir, "androperator-upgrade")), join(installedDir, "androperator-upgrade"));
    assert.equal(await readlink(join(claudeSkillsDir, "androperator-skill-author-by-agent-discovery")), join(installedDir, "androperator-skill-author-by-agent-discovery"));
    assert.equal(await readlink(join(claudeSkillsDir, "androperator-skill-author-by-recording")), join(installedDir, "androperator-skill-author-by-recording"));
    assert.equal(await readlink(join(codexSkillsDir, "androperator-agent-orientation")), join(installedDir, "androperator-agent-orientation"));
    assert.equal(await readlink(join(codexSkillsDir, "androperator-upgrade")), join(installedDir, "androperator-upgrade"));
    assert.equal(await readlink(join(codexSkillsDir, "androperator-skill-author-by-agent-discovery")), join(installedDir, "androperator-skill-author-by-agent-discovery"));
    assert.equal(await readlink(join(codexSkillsDir, "androperator-skill-author-by-recording")), join(installedDir, "androperator-skill-author-by-recording"));
    await assertManagedAgentsCopy(agentsSkillsDir, "androperator-agent-orientation", "# androperator-agent-orientation\n");
    await assertManagedAgentsCopy(agentsSkillsDir, "androperator-upgrade", "# androperator-upgrade\n");
    await assertManagedAgentsCopy(agentsSkillsDir, "androperator-skill-author-by-agent-discovery", "# androperator-skill-author-by-agent-discovery\n");
    await assertManagedAgentsCopy(agentsSkillsDir, "androperator-skill-author-by-recording", "# androperator-skill-author-by-recording\n");
  });

  it("ignores subdirectories without SKILL.md", async () => {
    const root = await makeTempRoot();
    const sourceDir = join(root, "source");
    await mkdir(join(sourceDir, "missing-skill-file"), { recursive: true });
    await mkdir(join(sourceDir, "real-skill"), { recursive: true });
    await writeFile(join(sourceDir, "real-skill", "SKILL.md"), "# real-skill\n", "utf8");
    const installedDir = join(root, "home", ".androperator", "bundled-skills");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      assert.fail("expected successful copyBundledSkills result");
    }
    assert.deepEqual(result.skills, ["real-skill"]);
    await assert.rejects(() => stat(join(installedDir, "missing-skill-file")));
  });

  it("writes version.txt with the current CLI version", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const installedDir = join(root, "home", ".androperator", "bundled-skills");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
    });

    assert.equal(result.ok, true);
    assert.equal(await readFile(join(installedDir, "version.txt"), "utf8"), `${getCliVersion()}\n`);
  });

  it("creates ~/.claude/skills even when it does not exist", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir,
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    assert.equal((await stat(claudeSkillsDir)).isDirectory(), true);
  });

  it("creates the Codex skills dir at the default path when it does not exist", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const homeDir = join(root, "home");

    const result = await copyBundledSkills({
      sourceDir,
      homeDir,
      installedDir: join(homeDir, ".androperator", "bundled-skills"),
      claudeSkillsDir: join(homeDir, ".claude", "skills"),
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    assert.equal((await stat(join(homeDir, ".codex", "skills"))).isDirectory(), true);
  });

  it("creates the Codex skills dir when CODEX_HOME is set", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const codexHome = join(root, "custom-codex-home");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      env: { ...process.env, CODEX_HOME: codexHome },
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    assert.equal((await stat(join(codexHome, "skills"))).isDirectory(), true);
  });

  it("places a symlink in ~/.claude/skills/<skill-name> pointing to the installed skill dir", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir,
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    assert.equal(
      await readlink(join(claudeSkillsDir, "androperator-skill-author-by-recording")),
      join(installedDir, "androperator-skill-author-by-recording")
    );
  });

  it("is idempotent - running twice does not error and result is the same as running once", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const options = {
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      cliVersion: "1.2.3",
    };

    const first = await copyBundledSkills(options);
    const second = await copyBundledSkills(options);

    assert.deepEqual(second, first);
    assert.equal(await readFile(join(options.installedDir, "androperator-skill-author-by-recording", "SKILL.md"), "utf8"), "# androperator-skill-author-by-recording\n");
    await assertManagedAgentsCopy(options.agentsSkillsDir, "androperator-skill-author-by-recording", "# androperator-skill-author-by-recording\n");
  });

  it("normalizes relative directory overrides so managed symlinks remain idempotent", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const options = {
      sourceDir: relative(process.cwd(), sourceDir),
      installedDir: relative(process.cwd(), installedDir),
      claudeSkillsDir: relative(process.cwd(), claudeSkillsDir),
      codexSkillsDir: relative(process.cwd(), codexSkillsDir),
      agentsSkillsDir: relative(process.cwd(), agentsSkillsDir),
      cliVersion: "1.2.3",
    };

    const first = await copyBundledSkills(options);
    const second = await copyBundledSkills(options);

    assert.equal(first.ok, true);
    assert.deepEqual(second, first);
    assert.equal(await readlink(join(claudeSkillsDir, "androperator-skill-author-by-recording")), resolve(installedDir, "androperator-skill-author-by-recording"));
  });

  it("returns an error result when the npm package source dir does not exist", async () => {
    const root = await makeTempRoot();

    const result = await copyBundledSkills({
      sourceDir: join(root, "missing-source"),
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      cliVersion: "1.2.3",
    });

    assert.deepEqual(result, {
      ok: false,
      code: "BUNDLED_SKILLS_SOURCE_NOT_FOUND",
      message: `Bundled-skills source directory not found: ${join(root, "missing-source")}`,
    });
  });

  it("returns an error when the packaged bundled-skills tree is empty", async () => {
    const root = await makeTempRoot();
    const sourceDir = join(root, "source");
    await mkdir(sourceDir, { recursive: true });

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      cliVersion: "1.2.3",
    });

    assert.deepEqual(result, {
      ok: false,
      code: "BUNDLED_SKILLS_SOURCE_EMPTY",
      message: `No packaged bundled-skills with SKILL.md were found in ${sourceDir}`,
    });
  });

  it("removes stale installed skills that are no longer present in the packaged source", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const staleSkillDir = join(installedDir, "old-skill");
    await mkdir(staleSkillDir, { recursive: true });
    await writeFile(join(staleSkillDir, "SKILL.md"), "# old-skill\n", "utf8");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    await assert.rejects(() => stat(staleSkillDir));
  });

  it("removes stale pre-rename skill installs and managed discovery symlinks", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkills(root, [
      "androperator-agent-orientation",
      "androperator-upgrade",
      "androperator-skill-author-by-agent-discovery",
      "androperator-skill-author-by-recording",
    ]);
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const oldDiscoveryDir = join(installedDir, "skill-author-by-agent-discovery");
    const oldRecordingDir = join(installedDir, "skill-author-by-recording");

    await mkdir(oldDiscoveryDir, { recursive: true });
    await mkdir(oldRecordingDir, { recursive: true });
    await writeFile(join(oldDiscoveryDir, "SKILL.md"), "# skill-author-by-agent-discovery\n", "utf8");
    await writeFile(join(oldRecordingDir, "SKILL.md"), "# skill-author-by-recording\n", "utf8");

    for (const dir of [claudeSkillsDir, codexSkillsDir]) {
      await mkdir(dir, { recursive: true });
      await symlink(oldDiscoveryDir, join(dir, "skill-author-by-agent-discovery"), directorySymlinkType);
      await symlink(oldRecordingDir, join(dir, "skill-author-by-recording"), directorySymlinkType);
    }
    await mkdir(agentsSkillsDir, { recursive: true });
    await symlink(oldDiscoveryDir, join(agentsSkillsDir, "skill-author-by-agent-discovery"), directorySymlinkType);
    await symlink(oldRecordingDir, join(agentsSkillsDir, "skill-author-by-recording"), directorySymlinkType);

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir,
      codexSkillsDir,
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    await assert.rejects(() => stat(oldDiscoveryDir));
    await assert.rejects(() => stat(oldRecordingDir));

    for (const dir of [claudeSkillsDir, codexSkillsDir]) {
      await assert.rejects(() => stat(join(dir, "skill-author-by-agent-discovery")));
      await assert.rejects(() => stat(join(dir, "skill-author-by-recording")));
      assert.equal(
        await readlink(join(dir, "androperator-skill-author-by-agent-discovery")),
        join(installedDir, "androperator-skill-author-by-agent-discovery")
      );
      assert.equal(
        await readlink(join(dir, "androperator-skill-author-by-recording")),
        join(installedDir, "androperator-skill-author-by-recording")
      );
    }
    await assert.rejects(() => stat(join(agentsSkillsDir, "skill-author-by-agent-discovery")));
    await assert.rejects(() => stat(join(agentsSkillsDir, "skill-author-by-recording")));
    await assertManagedAgentsCopy(agentsSkillsDir, "androperator-skill-author-by-agent-discovery", "# androperator-skill-author-by-agent-discovery\n");
    await assertManagedAgentsCopy(agentsSkillsDir, "androperator-skill-author-by-recording", "# androperator-skill-author-by-recording\n");
  });

  it("does not delete unrelated user-managed symlinks from shared agent skill directories", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const unrelatedTarget = join(root, "user-skills", "other-skill");
    await mkdir(unrelatedTarget, { recursive: true });
    await mkdir(claudeSkillsDir, { recursive: true });
    await mkdir(codexSkillsDir, { recursive: true });
    await mkdir(agentsSkillsDir, { recursive: true });
    await symlink(unrelatedTarget, join(claudeSkillsDir, "other-skill"), directorySymlinkType);
    await symlink(unrelatedTarget, join(codexSkillsDir, "other-skill"), directorySymlinkType);
    await symlink(unrelatedTarget, join(agentsSkillsDir, "other-skill"), directorySymlinkType);

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir,
      codexSkillsDir,
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    assert.equal(await readlink(join(claudeSkillsDir, "other-skill")), unrelatedTarget);
    assert.equal(await readlink(join(codexSkillsDir, "other-skill")), unrelatedTarget);
    assert.equal(await readlink(join(agentsSkillsDir, "other-skill")), unrelatedTarget);
  });

  it("refuses to overwrite an existing non-Androperator generic agents entry with the same basename", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const userSkillDir = join(agentsSkillsDir, "androperator-skill-author-by-recording");
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(join(userSkillDir, "SKILL.md"), "# user-owned\n", "utf8");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.deepEqual(result, {
      ok: false,
      code: "BUNDLED_SKILLS_INSTALL_FAILED",
      message: `Refusing to overwrite non-Androperator skill entry: ${userSkillDir}`,
    });
    assert.equal(await readFile(join(userSkillDir, "SKILL.md"), "utf8"), "# user-owned\n");
  });

  it("refuses to overwrite a generic agents entry with an invalid managed marker", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const userSkillDir = join(agentsSkillsDir, "androperator-skill-author-by-recording");
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(join(userSkillDir, "SKILL.md"), "# user-owned\n", "utf8");
    await writeFile(join(userSkillDir, MANAGED_BUNDLED_SKILL_COPY_MARKER), "managed-by=someone-else\n", "utf8");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.deepEqual(result, {
      ok: false,
      code: "BUNDLED_SKILLS_INSTALL_FAILED",
      message: `Refusing to overwrite non-Androperator skill entry: ${userSkillDir}`,
    });
    assert.equal(await readFile(join(userSkillDir, "SKILL.md"), "utf8"), "# user-owned\n");
  });

  it("refuses to overwrite a generic agents entry with a symlinked managed marker", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const userSkillDir = join(agentsSkillsDir, "androperator-skill-author-by-recording");
    const markerTarget = join(root, "marker-target");
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(join(userSkillDir, "SKILL.md"), "# user-owned\n", "utf8");
    await writeFile(markerTarget, MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT, "utf8");
    await symlink(markerTarget, join(userSkillDir, MANAGED_BUNDLED_SKILL_COPY_MARKER));

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.deepEqual(result, {
      ok: false,
      code: "BUNDLED_SKILLS_INSTALL_FAILED",
      message: `Refusing to overwrite non-Androperator skill entry: ${userSkillDir}`,
    });
    assert.equal(await readFile(join(userSkillDir, "SKILL.md"), "utf8"), "# user-owned\n");
  });

  it("refuses to overwrite an existing non-Androperator skill entry with the same basename", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    await mkdir(join(claudeSkillsDir, "androperator-skill-author-by-recording"), { recursive: true });
    await mkdir(codexSkillsDir, { recursive: true });
    await mkdir(agentsSkillsDir, { recursive: true });

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir,
      codexSkillsDir,
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result, {
      ok: false,
      code: "BUNDLED_SKILLS_INSTALL_FAILED",
      message: `Refusing to overwrite non-Androperator skill entry: ${join(claudeSkillsDir, "androperator-skill-author-by-recording")}`,
    });
    assert.equal((await stat(join(claudeSkillsDir, "androperator-skill-author-by-recording"))).isDirectory(), true);
  });

  it("replaces a broken managed symlink instead of failing with EEXIST", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const targetSkillDir = join(installedDir, "androperator-skill-author-by-recording");

    await mkdir(claudeSkillsDir, { recursive: true });
    await mkdir(codexSkillsDir, { recursive: true });
    await mkdir(agentsSkillsDir, { recursive: true });
    await symlink(targetSkillDir, join(claudeSkillsDir, "androperator-skill-author-by-recording"), directorySymlinkType);
    await symlink(targetSkillDir, join(codexSkillsDir, "androperator-skill-author-by-recording"), directorySymlinkType);
    await symlink(targetSkillDir, join(agentsSkillsDir, "androperator-skill-author-by-recording"), directorySymlinkType);

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir,
      codexSkillsDir,
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    assert.equal(await readlink(join(claudeSkillsDir, "androperator-skill-author-by-recording")), targetSkillDir);
    assert.equal(await readlink(join(codexSkillsDir, "androperator-skill-author-by-recording")), targetSkillDir);
    await assertManagedAgentsCopy(agentsSkillsDir, "androperator-skill-author-by-recording", "# androperator-skill-author-by-recording\n");
    assert.equal(await readFile(join(targetSkillDir, "SKILL.md"), "utf8"), "# androperator-skill-author-by-recording\n");
  });

  it("replaces legacy managed symlinks that still point at the old install dir", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const legacyInstalledDir = join(root, "home", ".androperator", "agent-skills");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const legacyTargetSkillDir = join(legacyInstalledDir, "androperator-skill-author-by-recording");
    const targetSkillDir = join(installedDir, "androperator-skill-author-by-recording");

    await mkdir(legacyTargetSkillDir, { recursive: true });
    await writeFile(join(legacyTargetSkillDir, "SKILL.md"), "# old-androperator-skill-author-by-recording\n", "utf8");
    await mkdir(claudeSkillsDir, { recursive: true });
    await mkdir(codexSkillsDir, { recursive: true });
    await mkdir(agentsSkillsDir, { recursive: true });
    await symlink(legacyTargetSkillDir, join(claudeSkillsDir, "androperator-skill-author-by-recording"), directorySymlinkType);
    await symlink(legacyTargetSkillDir, join(codexSkillsDir, "androperator-skill-author-by-recording"), directorySymlinkType);
    await symlink(legacyTargetSkillDir, join(agentsSkillsDir, "androperator-skill-author-by-recording"), directorySymlinkType);

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir,
      codexSkillsDir,
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    assert.equal(await readlink(join(claudeSkillsDir, "androperator-skill-author-by-recording")), targetSkillDir);
    assert.equal(await readlink(join(codexSkillsDir, "androperator-skill-author-by-recording")), targetSkillDir);
    await assertManagedAgentsCopy(agentsSkillsDir, "androperator-skill-author-by-recording", "# androperator-skill-author-by-recording\n");
    assert.equal(await readFile(join(targetSkillDir, "SKILL.md"), "utf8"), "# androperator-skill-author-by-recording\n");
    assert.equal(await readFile(join(legacyTargetSkillDir, "SKILL.md"), "utf8"), "# old-androperator-skill-author-by-recording\n");
  });

  it("removes stale managed generic agents copies that are no longer packaged", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");
    const staleSkillDir = join(agentsSkillsDir, "old-skill");
    await mkdir(staleSkillDir, { recursive: true });
    await writeFile(join(staleSkillDir, "SKILL.md"), "# old-skill\n", "utf8");
    await writeFile(join(staleSkillDir, MANAGED_BUNDLED_SKILL_COPY_MARKER), MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT, "utf8");

    const result = await copyBundledSkills({
      sourceDir,
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
    await assert.rejects(() => stat(staleSkillDir));
  });

  it("preflights discovery conflicts before replacing an already installed skill", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-skill-author-by-recording");
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const targetSkillDir = join(installedDir, "androperator-skill-author-by-recording");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");

    await mkdir(targetSkillDir, { recursive: true });
    await writeFile(join(targetSkillDir, "SKILL.md"), "# existing-installed-version\n", "utf8");
    await mkdir(claudeSkillsDir, { recursive: true });
    await mkdir(codexSkillsDir, { recursive: true });
    await mkdir(agentsSkillsDir, { recursive: true });
    await mkdir(join(codexSkillsDir, "androperator-skill-author-by-recording"), { recursive: true });

    const result = await copyBundledSkills({
      sourceDir,
      installedDir,
      claudeSkillsDir,
      codexSkillsDir,
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    assert.deepEqual(result, {
      ok: false,
      code: "BUNDLED_SKILLS_INSTALL_FAILED",
      message: `Refusing to overwrite non-Androperator skill entry: ${join(codexSkillsDir, "androperator-skill-author-by-recording")}`,
    });
    assert.equal(await readFile(join(targetSkillDir, "SKILL.md"), "utf8"), "# existing-installed-version\n");
  });
  it("honors ANDROPERATOR_BUNDLED_SKILLS when deriving the packaged source dir", async () => {
    const root = await makeTempRoot();
    const customSourceDir = await createSourceSkill(root, "custom-bundled-skill");

    const result = await copyBundledSkills({
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      env: { ...process.env, ANDROPERATOR_BUNDLED_SKILLS: customSourceDir },
      cliVersion: "1.2.3",
    });

    assert.deepEqual(result, {
      ok: true,
      discoveryGroups: await resolveBundledSkillDiscoveryGroups({ homeDir: join(root, "home"), env: {} }),
      migrations: [],
      skills: ["custom-bundled-skill"],
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      agentDiscoveryDirs: [
        { label: "claude", dir: join(root, "home", ".claude", "skills") },
        { label: "codex", dir: join(root, "home", ".codex", "skills") },
        { label: "agents", dir: join(root, "home", ".agents", "skills") },
      ],
    });
  });

  it("does not honor ANDROPERATOR_AGENT_SKILLS as a packaged source override", async () => {
    const root = await makeTempRoot();

    const result = await copyBundledSkills({
      installedDir: join(root, "home", ".androperator", "bundled-skills"),
      claudeSkillsDir: join(root, "home", ".claude", "skills"),
      codexSkillsDir: join(root, "home", ".codex", "skills"),
      agentsSkillsDir: join(root, "home", ".agents", "skills"),
      env: { ...process.env, ANDROPERATOR_AGENT_SKILLS: join(root, "missing-source") },
      cliVersion: "1.2.3",
    });

    assert.equal(result.ok, true);
  });
});

describe("cmdBundledSkillsInstall", () => {
  it("preserves legacy top-level discovery dirs alongside agentDiscoveryDirs in json output", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkills(root, [
      "androperator-agent-orientation",
      "androperator-upgrade",
      "androperator-skill-author-by-agent-discovery",
      "androperator-skill-author-by-recording",
    ]);
    const installedDir = join(root, "home", ".androperator", "bundled-skills");
    const claudeSkillsDir = join(root, "home", ".claude", "skills");
    const codexSkillsDir = join(root, "home", ".codex", "skills");
    const agentsSkillsDir = join(root, "home", ".agents", "skills");

    const rendered = await cmdBundledSkillsInstall({
      format: "json",
      sourceDir,
      installedDir,
      claudeSkillsDir,
      codexSkillsDir,
      agentsSkillsDir,
      cliVersion: "1.2.3",
    });

    const parsed = JSON.parse(rendered) as {
      skills: string[];
      installedDir: string;
      claudeSkillsDir: string;
      codexSkillsDir: string;
      agentDiscoveryDirs: Array<{ label: string; dir: string }>;
    };

    assert.deepEqual(parsed.skills, [
      "androperator-agent-orientation",
      "androperator-skill-author-by-agent-discovery",
      "androperator-skill-author-by-recording",
      "androperator-upgrade",
    ]);
    assert.equal(parsed.installedDir, installedDir);
    assert.equal(parsed.claudeSkillsDir, claudeSkillsDir);
    assert.equal(parsed.codexSkillsDir, codexSkillsDir);
    assert.deepEqual(parsed.agentDiscoveryDirs, [
      { label: "claude", dir: claudeSkillsDir },
      { label: "codex", dir: codexSkillsDir },
      { label: "agents", dir: agentsSkillsDir },
    ]);
  });
});

describe("cmdBundledSkillsList", () => {
  it("returns a helpful message when install dir does not exist", async () => {
    const root = await makeTempRoot();
    const output = await cmdBundledSkillsList({
      format: "json",
      installDir: join(root, "missing-install-dir"),
    });

    assert.deepEqual(JSON.parse(output), {
      skills: [],
      count: 0,
      installedDir: join(root, "missing-install-dir"),
      message: "No installed bundled-skills found. Run androperator bundled-skills install to get androperator-agent-orientation, androperator-agent-control-loop, androperator-upgrade, androperator-skill-author-by-agent-discovery, and androperator-skill-author-by-recording.",
    });
  });

  it("returns the documented json shape for installed bundled-skills", async () => {
    const root = await makeTempRoot();
    const installDir = join(root, "home", ".androperator", "bundled-skills");
    const orientationDir = join(installDir, "androperator-agent-orientation");
    const upgradeDir = join(installDir, "androperator-upgrade");
    const discoveryDir = join(installDir, "androperator-skill-author-by-agent-discovery");
    const skillDir = join(installDir, "androperator-skill-author-by-recording");
    await mkdir(orientationDir, { recursive: true });
    await mkdir(upgradeDir, { recursive: true });
    await mkdir(discoveryDir, { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(orientationDir, "SKILL.md"), "# androperator-agent-orientation\n", "utf8");
    await writeFile(join(upgradeDir, "SKILL.md"), "# androperator-upgrade\n", "utf8");
    await writeFile(join(discoveryDir, "SKILL.md"), "# androperator-skill-author-by-agent-discovery\n", "utf8");
    await writeFile(join(skillDir, "SKILL.md"), "# androperator-skill-author-by-recording\n", "utf8");

    const output = await cmdBundledSkillsList({
      format: "json",
      installDir,
    });

    assert.deepEqual(JSON.parse(output), {
      skills: [
        {
          name: "androperator-agent-orientation",
          skillPath: join(orientationDir, "SKILL.md"),
        },
        {
          name: "androperator-skill-author-by-agent-discovery",
          skillPath: join(discoveryDir, "SKILL.md"),
        },
        {
          name: "androperator-skill-author-by-recording",
          skillPath: join(skillDir, "SKILL.md"),
        },
        {
          name: "androperator-upgrade",
          skillPath: join(upgradeDir, "SKILL.md"),
        },
      ],
      count: 4,
      installedDir: installDir,
    });
  });

  it("surfaces filesystem errors instead of reporting an empty install", async () => {
    const root = await makeTempRoot();
    const installDir = join(root, "unreadable-install-dir");
    await mkdir(installDir, { recursive: true });
    await chmod(installDir, 0o000);

    try {
      const output = await cmdBundledSkillsList({
        format: "json",
        installDir,
      });
      const parsed = JSON.parse(output);
      assert.equal(parsed.code, "BUNDLED_SKILLS_LIST_FAILED");
    } finally {
      await chmod(installDir, 0o755);
    }
  });
});

describe("listPackagedBundledSkills", () => {
  it("lists all packaged first-party bundled skills from the repo tree", async () => {
    const skills = await listPackagedBundledSkills();
    assert.deepEqual(skills, [
      "androperator-agent-control-loop",
      "androperator-agent-orientation",
      "androperator-skill-author-by-agent-discovery",
      "androperator-skill-author-by-recording",
      "androperator-upgrade",
    ]);
  });
});


describe("bundled discovery directory aliases", () => {
  for (const reverse of [false, true]) {
    it(`updates shared Claude, Codex and agents directories repeatedly (reverse=${reverse})`, async () => {
      const root = await makeTempRoot();
      const sourceDir = await createSourceSkill(root, "androperator-upgrade");
      const homeDir = join(root, "home");
      const options = { sourceDir, homeDir, env: {}, cliVersion: "1.2.3" };
      const physicalDir = join(homeDir, reverse ? ".claude" : ".agents", "skills");
      const aliasDir = join(homeDir, reverse ? ".agents" : ".claude", "skills");
      await mkdir(physicalDir, { recursive: true });
      await mkdir(join(aliasDir, ".."), { recursive: true });
      await symlink(relative(join(aliasDir, ".."), physicalDir), aliasDir, directorySymlinkType);
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      await symlink(aliasDir, join(homeDir, ".codex", "skills"), directorySymlinkType);
      for (let iteration = 0; iteration < 2; iteration++) {
        const result = await copyBundledSkills(options);
        assert.ok(result.ok, JSON.stringify(result));
        assert.equal(result.discoveryGroups.length, 1);
        assert.equal(result.discoveryGroups[0].representation, "copy");
        assert.equal(result.discoveryGroups[0].aliases.length, 3);
        await assertManagedAgentsCopy(physicalDir, "androperator-upgrade", "# androperator-upgrade\n");
        assert.equal((await checkBundledSkillsStaleness(getDefaultRuntimeConfig(), options)).status, "pass");
      }
    });
  }

  it("regroups newly created case-variant discovery directories before choosing ownership", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-upgrade");
    const options = {
      sourceDir, homeDir: join(root, "home"), env: {},
      claudeSkillsDir: join(root, "Shared"), agentsSkillsDir: join(root, "shared"),
    };
    const first = await copyBundledSkills(options);
    assert.ok(first.ok, JSON.stringify(first));
    const claudePhysicalDir = await realpath(options.claudeSkillsDir);
    const agentsPhysicalDir = await realpath(options.agentsSkillsDir);
    const sharedFilesystemEntry = claudePhysicalDir === agentsPhysicalDir;
    assert.equal(first.discoveryGroups.length, sharedFilesystemEntry ? 2 : 3);
    assert.equal(first.discoveryGroups[0].representation, sharedFilesystemEntry ? "copy" : "symlink");
    assert.equal((await lstat(join(options.claudeSkillsDir, "androperator-upgrade"))).isDirectory(), sharedFilesystemEntry);
    assert.equal((await checkBundledSkillsStaleness(getDefaultRuntimeConfig(), options)).status, "pass");
    assert.deepEqual(await copyBundledSkills(options), first);
  });

  it("keeps symlinks when only Claude and Codex alias one directory", async () => {
    const root = await makeTempRoot();
    const sourceDir = await createSourceSkill(root, "androperator-upgrade");
    const sharedDir = join(root, "shared");
    const result = await copyBundledSkills({ sourceDir, homeDir: join(root, "home"), claudeSkillsDir: sharedDir, codexSkillsDir: sharedDir, env: {} });
    assert.ok(result.ok);
    assert.equal(result.discoveryGroups[0].representation, "symlink");
    assert.equal((await lstat(join(sharedDir, "androperator-upgrade"))).isSymbolicLink(), true);
  });

  it("creates the missing target of a dangling discovery directory alias", async () => {
    const root = await makeTempRoot();
    const homeDir = join(root, "home");
    const sourceDir = await createSourceSkill(root, "androperator-upgrade");
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    await symlink("../.agents/skills", join(homeDir, ".claude", "skills"), directorySymlinkType);
    const options = { homeDir, sourceDir, env: {} };
    const result = await copyBundledSkills(options);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal((await checkBundledSkillsStaleness(getDefaultRuntimeConfig(), options)).status, "pass");
  });

  it("resolves a dangling relative alias from its physical parent before writing", async () => {
    const root = await makeTempRoot();
    const homeDir = join(root, "home");
    const externalDir = join(root, "external");
    const sourceDir = await createSourceSkill(root, "androperator-upgrade");
    await mkdir(homeDir);
    await mkdir(join(externalDir, "claude"), { recursive: true });
    await symlink(join(externalDir, "claude"), join(homeDir, ".claude"), directorySymlinkType);
    await symlink("../shared", join(externalDir, "claude", "skills"), directorySymlinkType);
    const options = { homeDir, sourceDir, agentsSkillsDir: join(externalDir, "shared"), env: {} };
    const result = await copyBundledSkills(options);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.discoveryGroups[0].dir, join(externalDir, "shared"));
    assert.equal(result.discoveryGroups[0].representation, "copy");
    await assertManagedAgentsCopy(join(homeDir, ".claude", "skills"), "androperator-upgrade", "# androperator-upgrade\n");
    assert.equal((await checkBundledSkillsStaleness(getDefaultRuntimeConfig(), options)).status, "pass");
    await assert.rejects(stat(join(homeDir, "shared")));
  });

  it("expands intermediate symlinks before parent traversal in dangling link targets", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "physical", "child"), { recursive: true });
    await symlink(join(root, "physical", "child"), join(root, "middle"), directorySymlinkType);
    await symlink("middle/../missing", join(root, "alias"), directorySymlinkType);
    const groups = await resolveBundledSkillDiscoveryGroups({
      claudeSkillsDir: join(root, "alias"),
      agentsSkillsDir: join(root, "physical", "missing"),
      codexSkillsDir: join(root, "codex"),
    });
    assert.equal(groups.length, 2);
    assert.equal(groups[0].dir, join(root, "physical", "missing"));
    assert.equal(groups[0].representation, "copy");
  });

  for (const intermediate of ["missing", "file"]) {
    it(`rejects parent traversal through an ${intermediate} component in an alias target`, async () => {
      const root = await makeTempRoot();
      const homeDir = join(root, "home");
      const sourceDir = await createSourceSkill(root, "androperator-upgrade");
      await mkdir(homeDir);
      if (intermediate === "file") await writeFile(join(homeDir, "intermediate"), "user file");
      await symlink("intermediate/../shared", join(homeDir, "alias"), directorySymlinkType);
      const options = {
        homeDir, sourceDir, env: {},
        claudeSkillsDir: join(homeDir, "alias"),
        agentsSkillsDir: join(homeDir, "shared"),
      };
      const result = await copyBundledSkills(options);
      assert.ok(!result.ok);
      assert.match(result.message, /ENOENT|non-directory/);
      await assert.rejects(stat(join(homeDir, ".androperator", "bundled-skills")));
      // Give Doctor a current canonical install so it reaches discovery checks.
      await cp(sourceDir, join(homeDir, ".androperator", "bundled-skills"), { recursive: true });
      await writeFile(join(homeDir, ".androperator", "bundled-skills", "version.txt"), getCliVersion());
      assert.equal((await checkBundledSkillsStaleness(getDefaultRuntimeConfig(), options)).status, "warn");
    });
  }

  it("rejects directory symlink cycles without writing skills", async () => {
    const root = await makeTempRoot();
    await symlink("second", join(root, "first"), directorySymlinkType);
    await symlink("first", join(root, "second"), directorySymlinkType);
    await assert.rejects(resolveBundledSkillDiscoveryGroups({
      homeDir: root, claudeSkillsDir: join(root, "first"), env: {},
    }), /symlink cycle/);
  });

  it("resolves a missing child below a symlinked ancestor without creating it", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "physical"));
    await symlink(join(root, "physical"), join(root, "alias"), directorySymlinkType);
    const groups = await resolveBundledSkillDiscoveryGroups({
      claudeSkillsDir: join(root, "alias", "skills"),
      agentsSkillsDir: join(root, "physical", "skills"),
      codexSkillsDir: join(root, "codex"),
    });
    assert.equal(groups.length, 2);
    assert.equal(groups[0].representation, "copy");
    await assert.rejects(stat(join(root, "physical", "skills")));
  });

  it("backs up exact unmarked first-party copies once and leaves Doctor clean", async () => {
    const { homeDir, sourceDir, legacyPath } = await createLegacySkillFixture("androperator-upgrade", ".agents");
    const oldMarkdown = await readFile(join(legacyPath, "SKILL.md"), "utf8");
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    await symlink(join(homeDir, ".agents", "skills"), join(homeDir, ".claude", "skills"), directorySymlinkType);
    const options = { homeDir, sourceDir, env: {}, cliVersion: "1.2.3" };
    const result = await copyBundledSkills(options);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.migrations.length, 1);
    assert.equal(await readFile(join(result.migrations[0].backupPath, "SKILL.md"), "utf8"), oldMarkdown);
    assert.equal((await checkBundledSkillsStaleness(getDefaultRuntimeConfig(), options)).status, "pass");
    const repeated = await copyBundledSkills(options);
    assert.ok(repeated.ok);
    assert.deepEqual(repeated.migrations, []);
  });

  it("migrates a historical first-party version whose content differs from the package", async () => {
    const { root, homeDir, sourceDir: packagedSource, legacyPath } = await createLegacySkillFixture("androperator-upgrade");
    const sourceDir = join(root, "updated-package");
    await cp(packagedSource, sourceDir, { recursive: true });
    const oldMarkdown = await readFile(join(legacyPath, "SKILL.md"), "utf8");
    // Change the proposed package, keeping the recognized historical copy exact.
    // Deriving a historical fixture by editing current guidance breaks on updates.
    await writeFile(join(sourceDir, "androperator-upgrade", "SKILL.md"), oldMarkdown + "\nUpdated package guidance.\n");
    const result = await copyBundledSkills({ homeDir, sourceDir, env: {} });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.migrations.length, 1);
    assert.equal(await readFile(join(result.migrations[0].backupPath, "SKILL.md"), "utf8"), oldMarkdown);
    assert.equal((await lstat(legacyPath)).isSymbolicLink(), true);
  });

  it("preflights all conflicts before backing up a recognized legacy copy", async () => {
    const { homeDir, sourceDir, legacyPath } = await createLegacySkillFixture();
    await mkdir(join(homeDir, ".codex", "skills", "androperator-upgrade"), { recursive: true });
    const result = await copyBundledSkills({ homeDir, sourceDir, env: {} });
    assert.equal(result.ok, false);
    assert.equal((await lstat(legacyPath)).isDirectory(), true);
    await assert.rejects(stat(join(homeDir, ".androperator", "bundled-skills-backups")));
  });

  for (const modification of ["edited", "extra", "symlink"]) {
    it(`preserves a legacy-looking skill with ${modification} content`, async () => {
      const { homeDir, sourceDir, legacyPath } = await createLegacySkillFixture();
      if (modification === "edited") await writeFile(join(legacyPath, "SKILL.md"), "user edits");
      if (modification === "extra") await writeFile(join(legacyPath, "notes.txt"), "user notes");
      if (modification === "symlink") {
        await rm(join(legacyPath, "SKILL.md"));
        await symlink(join(sourceDir, "androperator-upgrade", "SKILL.md"), join(legacyPath, "SKILL.md"));
      }
      const result = await copyBundledSkills({ homeDir, sourceDir, env: {} });
      assert.equal(result.ok, false);
      assert.equal((await lstat(legacyPath)).isDirectory(), true);
    });
  }

  it("fails the post-install invariant instead of reporting success for an invalid copy", async () => {
    const root = await makeTempRoot();
    const sourceDir = join(root, "source");
    await mkdir(join(sourceDir, "invalid-skill", "SKILL.md"), { recursive: true });
    const result = await copyBundledSkills({ sourceDir, homeDir: join(root, "home"), env: {} });
    assert.ok(!result.ok);
    assert.match(result.message, /Post-install verification failed:.*invalid-skill.*stale/);
    await assert.rejects(stat(join(root, "home", ".androperator", "bundled-skills", "version.txt")));
  });
});


describe("legacy bundled skill backups across filesystems", () => {
  const crossDeviceError = () => Object.assign(new Error("Cross-device link"), { code: "EXDEV" });

  it("verifies the backup before removing the original when rename returns EXDEV", async () => {
    const { root, skillName, legacyPath: originalPath } = await createLegacySkillFixture();
    const backupPath = join(root, "backup");
    const markdown = await readFile(join(originalPath, "SKILL.md"), "utf8");
    await moveLegacyBundledSkillToBackup(originalPath, backupPath, skillName, async () => { throw crossDeviceError(); });
    assert.equal(await readFile(join(backupPath, "SKILL.md"), "utf8"), markdown);
    await assert.rejects(lstat(originalPath));
  });

  it("preserves the original when the cross-filesystem backup cannot be written", async () => {
    const { root, legacyPath: originalPath } = await createLegacySkillFixture();
    const backupPath = join(root, "backup");
    await writeFile(backupPath, "existing backup");
    await assert.rejects(moveLegacyBundledSkillToBackup(originalPath, backupPath, "androperator-upgrade", async () => { throw crossDeviceError(); }), /original preserved/);
    assert.equal((await lstat(originalPath)).isDirectory(), true);
    assert.equal(await readFile(backupPath, "utf8"), "existing backup");
  });

  it("preserves source changes detected during the cross-filesystem fallback", async () => {
    const { root, legacyPath: originalPath } = await createLegacySkillFixture();
    const backupPath = join(root, "backup");
    await assert.rejects(moveLegacyBundledSkillToBackup(originalPath, backupPath, "androperator-upgrade", async () => {
      await writeFile(join(originalPath, "SKILL.md"), "user edits during migration");
      throw crossDeviceError();
    }), /original preserved/);
    assert.equal(await readFile(join(originalPath, "SKILL.md"), "utf8"), "user edits during migration");
  });
});
