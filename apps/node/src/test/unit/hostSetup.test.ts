import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cmdHostSetup } from "../../cli/commands/host.js";
import { setupHost } from "../../domain/host/hostSetup.js";

const ENV_KEYS = [
  "HOME",
  "CODEX_HOME",
  "ADB_PATH",
  "ANDROPERATOR_SKILLS_DIR",
  "SKILLS_REGISTRY_PATH",
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(async () => {
  process.exitCode = undefined;
  for (const [key, value] of ORIGINAL_ENV.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function makeTempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "androperator-host-setup-"));
}

async function writeRuntimeRegistry(homeDir: string): Promise<string> {
  const registryPath = join(homeDir, ".androperator", "skills", "skills", "skills-registry.json");
  await mkdir(join(homeDir, ".androperator", "skills", "skills"), { recursive: true });
  await writeFile(
    registryPath,
    `${JSON.stringify({
      schemaVersion: "1.0",
      generatedAt: "2026-04-23T00:00:00Z",
      skills: [
        {
          id: "com.example.weather.check-status",
          applicationId: "com.example.weather",
          intent: "check_status",
          summary: "Checks the current weather status",
          contract: {
            inputs: {
              city_name: {
                type: "string",
              },
            },
          },
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  return registryPath;
}

async function writeBundledSkill(homeDir: string, skillName: string): Promise<void> {
  const skillDir = join(homeDir, ".androperator", "bundled-skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), `# ${skillName}\n`, "utf8");
}

describe("setupHost", () => {
  it("writes install-state JSON with the expected required and nullable fields", async () => {
    const homeDir = await makeTempHome();

    try {
      await setupHost({
        env: { HOME: homeDir },
        installedAt: "2026-04-23T10:11:12Z",
        cliVersion: "1.2.3",
        cliJsPath: "/opt/androperator/dist/cli/index.js",
        processExecPath: "/usr/local/bin/node",
      });

      const installStatePath = join(homeDir, ".androperator", "install-state.json");
      const parsed = JSON.parse(await readFile(installStatePath, "utf8"));

      assert.deepStrictEqual(parsed, {
        schemaVersion: 1,
        installedAt: "2026-04-23T10:11:12Z",
        cliVersion: "1.2.3",
        registryPath: null,
        apkVersion: null,
        lastDeviceSerial: null,
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reports invalid directory overrides without falling back to home skills", async () => {
    const homeDir = await makeTempHome();
    try {
      await writeRuntimeRegistry(homeDir);
      for (const directory of [" ", join(homeDir, "missing")]) {
        await setupHost({ env: { HOME: homeDir, ANDROPERATOR_SKILLS_DIR: directory } });
        const guide = await readFile(join(homeDir, ".androperator", "AGENTS.md"), "utf8");
        assert.match(guide, /Local skill metadata could not be read/);
        assert.doesNotMatch(guide, /### Application/);
      }
    } finally { await rm(homeDir, { recursive: true, force: true }); }
  });

  it("writes MCP snippet JSON with the expected top-level sections", async () => {
    const homeDir = await makeTempHome();

    try {
      await setupHost({
        env: { HOME: homeDir, CODEX_HOME: join(homeDir, ".codex") },
        installedAt: "2026-04-23T10:11:12Z",
        adbPath: "/opt/android/platform-tools/adb",
        cliJsPath: "/opt/androperator/dist/cli/index.js",
        processExecPath: "/usr/local/bin/node",
      });

      const snippetPath = join(homeDir, ".androperator", "mcp-config-snippet.json");
      const parsed = JSON.parse(await readFile(snippetPath, "utf8"));

      assert.deepStrictEqual(Object.keys(parsed), [
        "notes",
        "claudeDesktop",
        "codex",
        "genericStdioConsumer",
      ]);
      assert.strictEqual(parsed.claudeDesktop.mergeKey, "mcpServers");
      assert.match(parsed.codex.entryToml, /\[mcp_servers\.androperator\]/);
      assert.match(parsed.codex.entryToml, /\[mcp_servers\.androperator\.env\]/);
      assert.strictEqual(parsed.genericStdioConsumer.server.serverName, undefined);
      assert.deepStrictEqual(parsed.genericStdioConsumer.server.args, [
        "/opt/androperator/dist/cli/index.js",
        "mcp",
        "serve",
      ]);
      assert.strictEqual(parsed.genericStdioConsumer.server.env.ADB_PATH, "/opt/android/platform-tools/adb");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("writes AGENTS.md content using installed runtime skill information when available", async () => {
    const homeDir = await makeTempHome();

    try {
      const registryPath = await writeRuntimeRegistry(homeDir);
      await writeBundledSkill(homeDir, "androperator-agent-orientation");
      await writeBundledSkill(homeDir, "androperator-upgrade");
      await writeBundledSkill(homeDir, "androperator-skill-author-by-agent-discovery");
      await writeBundledSkill(homeDir, "androperator-skill-author-by-recording");
      await writeFile(join(homeDir, ".androperator", "bundled-skills", "version.txt"), "0.7.4\n", "utf8");

      await setupHost({
        env: { HOME: homeDir, ANDROPERATOR_SKILLS_DIR: dirname(registryPath) },
        installedAt: "2026-04-23T10:11:12Z",
        cliJsPath: "/opt/androperator/dist/cli/index.js",
        processExecPath: "/usr/local/bin/node",
      });

      const guidePath = join(homeDir, ".androperator", "AGENTS.md");
      const guide = await readFile(guidePath, "utf8");

      assert.match(guide, /## Runtime Skills/);
      assert.match(guide, new RegExp(dirname(registryPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(guide, /### Application/);
      assert.match(guide, /com\.example\.weather/);
      assert.match(guide, /com\.example\.weather\.check-status/);
      assert.match(guide, /androperator skills run com\.example\.weather\.check-status --city-name <city_name>/);
      assert.match(guide, /npm install -g androperator@latest/);
      assert.match(guide, /androperator install/);
      assert.match(guide, /install\.sh` as recovery-only fallback/);
      assert.match(guide, /Recommended first-run flow:/);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("treats cliJsPath null as an explicit request to use wrapper-form MCP config output", async () => {
    const homeDir = await makeTempHome();

    try {
      await setupHost({
        env: {
          HOME: homeDir,
          ANDROPERATOR_BIN_PATH: "/usr/local/bin/androperator",
        },
        installedAt: "2026-04-23T10:11:12Z",
        cliJsPath: null,
        processExecPath: "/usr/local/bin/node",
      });

      const snippetPath = join(homeDir, ".androperator", "mcp-config-snippet.json");
      const parsed = JSON.parse(await readFile(snippetPath, "utf8"));

      assert.strictEqual(parsed.claudeDesktop.entry.androperator.command, "/usr/local/bin/androperator");
      assert.deepStrictEqual(parsed.claudeDesktop.entry.androperator.args, ["mcp", "serve"]);
      assert.match(parsed.notes[2], /npm shell wrapper/);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("keeps the shared-agent bridge bounded and idempotent", async () => {
    const homeDir = await makeTempHome();

    try {
      const sharedAgentsPath = join(homeDir, ".agents", "AGENTS.md");
      await mkdir(join(homeDir, ".agents"), { recursive: true });
      await writeFile(
        sharedAgentsPath,
        [
          "# Shared Guide",
          "",
          "Intro text",
          "",
          "<!-- ANDROPERATOR_SHARED_AGENT_BRIDGE:START -->",
          "outdated bridge",
          "<!-- ANDROPERATOR_SHARED_AGENT_BRIDGE:END -->",
          "",
          "Footer text",
          "",
        ].join("\n"),
        "utf8",
      );

      const first = await setupHost({
        env: { HOME: homeDir },
        installedAt: "2026-04-23T10:11:12Z",
        cliJsPath: "/opt/androperator/dist/cli/index.js",
        processExecPath: "/usr/local/bin/node",
      });
      const second = await setupHost({
        env: { HOME: homeDir },
        installedAt: "2026-04-23T10:11:12Z",
        cliJsPath: "/opt/androperator/dist/cli/index.js",
        processExecPath: "/usr/local/bin/node",
      });

      const bridge = await readFile(sharedAgentsPath, "utf8");
      assert.match(bridge, /# Shared Guide/);
      assert.match(bridge, /Footer text/);
      assert.strictEqual((bridge.match(/ANDROPERATOR_SHARED_AGENT_BRIDGE:START/g) ?? []).length, 1);
      assert.strictEqual((bridge.match(/ANDROPERATOR_SHARED_AGENT_BRIDGE:END/g) ?? []).length, 1);
      assert.match(bridge, /Androperator runtime skills stay in the `androperator` CLI surface\./);

      const firstBridge = first.artifacts.find((artifact) => artifact.artifact === "sharedAgentBridge");
      const secondBridge = second.artifacts.find((artifact) => artifact.artifact === "sharedAgentBridge");
      assert.strictEqual(firstBridge?.status, "updated");
      assert.strictEqual(secondBridge?.status, "skipped");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("keeps shared-agent bridge failures non-fatal while reporting the failed artifact", async () => {
    const homeDir = await makeTempHome();

    try {
      const sharedAgentsPath = join(homeDir, ".agents", "AGENTS.md");
      await mkdir(join(homeDir, ".agents"), { recursive: true });
      await writeFile(join(homeDir, ".agents", "real-guide.md"), "# Shared Guide\n", "utf8");
      await symlink("real-guide.md", sharedAgentsPath);

      const result = await setupHost({
        env: { HOME: homeDir },
        installedAt: "2026-04-23T10:11:12Z",
        cliJsPath: "/opt/androperator/dist/cli/index.js",
        processExecPath: "/usr/local/bin/node",
      });

      const bridge = result.artifacts.find((artifact) => artifact.artifact === "sharedAgentBridge");
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, "warn");
      assert.strictEqual(result.message, "Host setup completed with a shared-agent bridge warning; continuing.");
      assert.deepStrictEqual(result.summary, {
        written: 3,
        updated: 0,
        skipped: 0,
        failed: 1,
      });
      assert.strictEqual(bridge?.status, "failed");
      assert.match(bridge?.message ?? "", /must be a regular file/);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});

describe("cmdHostSetup", () => {
  it("reports deterministic JSON outcomes for reruns", async () => {
    const homeDir = await makeTempHome();

    try {
      process.env.HOME = homeDir;
      delete process.env.ANDROPERATOR_SKILLS_DIR;
      delete process.env.SKILLS_REGISTRY_PATH;
      delete process.env.ADB_PATH;
      process.env.CODEX_HOME = join(homeDir, ".codex");

      await mkdir(join(homeDir, ".agents"), { recursive: true });
      await writeFile(join(homeDir, ".agents", "AGENTS.md"), "# Shared\n", "utf8");

      const first = JSON.parse(await cmdHostSetup({
        format: "json",
        installedAt: "2026-04-23T10:11:12Z",
      }));
      const second = JSON.parse(await cmdHostSetup({
        format: "json",
        installedAt: "2026-04-23T10:11:12Z",
      }));

      assert.deepStrictEqual(first.artifacts.map((artifact: { artifact: string; status: string }) => artifact.artifact), [
        "installState",
        "mcpConfigSnippet",
        "agentGuide",
        "sharedAgentBridge",
      ]);
      assert.deepStrictEqual(second.artifacts.map((artifact: { status: string }) => artifact.status), [
        "skipped",
        "skipped",
        "skipped",
        "skipped",
      ]);
      assert.deepStrictEqual(second.summary, {
        written: 0,
        updated: 0,
        skipped: 4,
        failed: 0,
      });
      assert.strictEqual(second.ok, true);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("does not set a failure exit code when only the shared-agent bridge fails", async () => {
    const homeDir = await makeTempHome();

    try {
      process.env.HOME = homeDir;
      delete process.env.ANDROPERATOR_SKILLS_DIR;
      delete process.env.SKILLS_REGISTRY_PATH;
      delete process.env.ADB_PATH;
      delete process.env.CODEX_HOME;

      await mkdir(join(homeDir, ".agents"), { recursive: true });
      await writeFile(join(homeDir, ".agents", "real-guide.md"), "# Shared Guide\n", "utf8");
      await symlink("real-guide.md", join(homeDir, ".agents", "AGENTS.md"));

      const output = JSON.parse(await cmdHostSetup({
        format: "json",
        installedAt: "2026-04-23T10:11:12Z",
      }));

      const bridge = output.artifacts.find((artifact: { artifact: string }) => artifact.artifact === "sharedAgentBridge");
      assert.strictEqual(output.ok, true);
      assert.strictEqual(output.status, "warn");
      assert.strictEqual(output.message, "Host setup completed with a shared-agent bridge warning; continuing.");
      assert.strictEqual(process.exitCode, undefined);
      assert.strictEqual(bridge?.status, "failed");
      assert.match(bridge?.message ?? "", /must be a regular file/);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reports a success message when all host artifacts succeed", async () => {
    const homeDir = await makeTempHome();

    try {
      process.env.HOME = homeDir;
      delete process.env.ANDROPERATOR_SKILLS_DIR;
      delete process.env.SKILLS_REGISTRY_PATH;
      delete process.env.ADB_PATH;
      delete process.env.CODEX_HOME;

      const output = JSON.parse(await cmdHostSetup({
        format: "json",
        installedAt: "2026-04-23T10:11:12Z",
      }));

      assert.strictEqual(output.ok, true);
      assert.strictEqual(output.status, "ok");
      assert.strictEqual(output.message, "Host setup complete.");
      assert.strictEqual(process.exitCode, undefined);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
