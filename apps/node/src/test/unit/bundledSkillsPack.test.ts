import { describe, it } from "node:test";
import assert from "node:assert";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("bundled skill packaging", () => {
  it("ships bundled-skills directly from package.json without prepack or postpack shims", async () => {
    const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
      files?: string[];
      scripts?: Record<string, string>;
    };

    assert.deepEqual(packageJson.files, [
      "dist/",
      "!dist/test/**",
      "!dist/**/*.map",
      "README.md",
      "LICENSE",
      "bundled-skills/",
      "capture-helper/",
    ]);
    assert.equal(packageJson.scripts?.prepack, undefined);
    assert.equal(packageJson.scripts?.postpack, undefined);
  });

  it("keeps the packaged bundled-skills tree as real directories with SKILL.md files", async () => {
    const bundledSkillsDir = join(packageRoot, "bundled-skills");
    const entries = (await readdir(bundledSkillsDir))
      .filter(entry => entry !== ".DS_Store")
      .sort((left, right) => left.localeCompare(right));

    assert.deepEqual(entries, [
      "androperator-agent-control-loop",
      "androperator-agent-orientation",
      "androperator-learn-from-recording",
      "androperator-skill-author-by-agent-discovery",
      "androperator-upgrade",
    ]);

    for (const entry of entries) {
      const entryPath = join(bundledSkillsDir, entry);
      const entryStat = await lstat(entryPath);
      assert.equal(entryStat.isDirectory(), true);
      assert.equal(entryStat.isSymbolicLink(), false);

      const skillFileStat = await lstat(join(entryPath, "SKILL.md"));
      assert.equal(skillFileStat.isFile(), true);

      const promptMetadataStat = await lstat(join(entryPath, "agents", "openai.yaml"));
      assert.equal(promptMetadataStat.isFile(), true);
    }
  });

  it("keeps the bundled discovery skill aligned with the current bundled-skills CLI surface", async () => {
    const discoverySkill = await readFile(
      join(packageRoot, "bundled-skills", "androperator-skill-author-by-agent-discovery", "SKILL.md"),
      "utf8"
    );

    assert.match(discoverySkill, /current agent/);
    assert.match(discoverySkill, /demonstration is never required/);
    assert.doesNotMatch(discoverySkill, /androperator skills (?:run|new|search)/);
    assert.doesNotMatch(discoverySkill, /androperator agent-skills list --json/);
  });
  it("ships control-loop conditional references and agent metadata", async () => {
    const skillDir = join(packageRoot, "bundled-skills", "androperator-agent-control-loop");
    const entry = await readFile(join(skillDir, "SKILL.md"), "utf8");
    assert.match(entry, /^---\nname: androperator-agent-control-loop\n/);
    for (const match of entry.matchAll(/\]\((references\/[^)]+)\)/g)) {
      assert.ok((await readFile(join(skillDir, match[1]), "utf8")).trim().length > 0);
    }
    for (const name of ["observation.md", "recovery.md", "delegation.md"]) {
      assert.ok(entry.includes(`references/${name}`));
    }
    assert.match(await readFile(join(skillDir, "agents", "openai.yaml"), "utf8"), /\$androperator-agent-control-loop/);
  });

});
