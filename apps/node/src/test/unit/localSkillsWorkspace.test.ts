import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncSkills } from "../../domain/skills/syncSkills.js";

test("local skill setup creates an empty registry, preserves user entries, and rejects Git refs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "androperator-local-skills-"));
  try {
    const result = await syncSkills("main", dir);
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "skills", "skills-registry.json"), "utf8")), { skills: [] });
    const userRegistry = JSON.stringify({ skills: [{ id: "com.test.own-workflow" }] });
    await writeFile(join(dir, "skills", "skills-registry.json"), userRegistry);
    assert.equal((await syncSkills("main", dir)).ok, true);
    assert.equal(await readFile(join(dir, "skills", "skills-registry.json"), "utf8"), userRegistry);
    assert.equal((await syncSkills("v0.12.5", dir)).ok, false);
    assert.equal(await readFile(join(dir, "skills", "skills-registry.json"), "utf8"), userRegistry);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("local skill setup reports a malformed registry without replacing it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "androperator-local-skills-"));
  try {
    await mkdir(join(dir, "skills"));
    const path = join(dir, "skills", "skills-registry.json");
    await writeFile(path, "invalid registry");
    const result = await syncSkills("main", dir);
    assert.equal(result.ok, false);
    assert.equal(await readFile(path, "utf8"), "invalid registry");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
