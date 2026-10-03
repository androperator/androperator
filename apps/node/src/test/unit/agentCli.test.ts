import { describe, it } from "node:test";
import assert from "node:assert";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveAgentCliExecutable,
  resolveConfiguredAgentCli,
  resolveExecutableOnPathForPlatform,
} from "../../domain/skills/agentCli.js";

describe("resolveExecutableOnPathForPlatform", () => {
  it("resolves Windows launcher extensions via PATHEXT", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "androperator-agent-cli-win-"));
    const launcherPath = join(tempDir, "codex.cmd");

    try {
      await writeFile(launcherPath, "@echo off\r\n", "utf8");

      const resolved = await resolveExecutableOnPathForPlatform(
        "codex",
        tempDir,
        "win32",
        ".CMD;.EXE"
      );

      assert.ok(resolved);
      assert.strictEqual(resolved.toLowerCase(), launcherPath.toLowerCase());
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("resolveAgentCliExecutable", () => {
  it("rejects absolute cliPath values", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "androperator-agent-cli-abs-"));

    try {
      const result = await resolveAgentCliExecutable(
        { cli: "codex", cliPath: "/tmp/fake-agent" },
        tempDir,
        process.env
      );
      assert.ok(!result.ok);
      assert.match(result.message, /must be relative to the skill directory/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects relative cliPath values that escape the skill directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "androperator-agent-cli-escape-"));
    const skillDir = join(tempDir, "skill");

    try {
      await mkdir(skillDir, { recursive: true });
      const result = await resolveAgentCliExecutable(
        { cli: "codex", cliPath: "../outside-agent" },
        skillDir,
        process.env
      );
      assert.ok(!result.ok);
      assert.match(result.message, /must stay within the skill directory/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects cliPath symlinks that resolve outside the skill directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "androperator-agent-cli-symlink-"));
    const skillDir = join(tempDir, "skill");
    const externalDir = join(tempDir, "external");

    try {
      await mkdir(join(skillDir, "scripts"), { recursive: true });
      await mkdir(externalDir, { recursive: true });
      await writeFile(join(externalDir, "outside-agent"), "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(join(externalDir, "outside-agent"), 0o755);
      await symlink(join(externalDir, "outside-agent"), join(skillDir, "scripts", "agent-link"));

      const result = await resolveAgentCliExecutable(
        { cli: "codex", cliPath: "scripts/agent-link" },
        skillDir,
        process.env
      );
      assert.ok(!result.ok);
      assert.match(result.message, /must resolve within the skill directory/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("resolveConfiguredAgentCli", () => {
  it("does not override a manifest-pinned cliPath with ANDROPERATOR_SKILL_AGENT_CLI", () => {
    const result = resolveConfiguredAgentCli(
      { cli: "codex", cliPath: "scripts/fake-agent" },
      { ...process.env, ANDROPERATOR_SKILL_AGENT_CLI: "override-agent" }
    );

    assert.ok(result.ok);
    assert.deepStrictEqual(result.agent, {
      cli: "codex",
      cliPath: "scripts/fake-agent",
    });
  });
});
