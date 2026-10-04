import { mkdir, readFile, rename, chmod, lstat, unlink, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_OPERATOR_PACKAGE } from "../config/resolveOperatorPackage.js";
import { getCliVersion } from "../version/compatibility.js";

export type HostArtifactKey =
  | "installState"
  | "mcpConfigSnippet"
  | "agentGuide"
  | "sharedAgentBridge";

export type HostArtifactStatus = "written" | "updated" | "skipped" | "failed";

export interface HostArtifactOutcome {
  artifact: HostArtifactKey;
  path: string;
  status: HostArtifactStatus;
  message?: string;
}

export interface HostSetupResult {
  ok: boolean;
  status: "ok" | "warn" | "failed";
  message: string;
  artifacts: HostArtifactOutcome[];
  summary: {
    written: number;
    updated: number;
    skipped: number;
    failed: number;
  };
}

export interface HostSetupOptions {
  installedAt?: string;
  cliVersion?: string | null;
  apkVersion?: string | null;
  lastDeviceSerial?: string | null;
  adbPath?: string | null;
  operatorPackage?: string;
  logDir?: string;
  codexConfigPath?: string;
  claudeConfigPathMac?: string;
  claudeConfigPathLinux?: string;
  bundledSkillsDir?: string;
  androperatorDir?: string;
  sharedAgentsPath?: string;
  cliWrapperPath?: string;
  cliJsPath?: string | null;
  processExecPath?: string;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

function isNonFatalHostArtifactFailure(result: HostArtifactOutcome): boolean {
  return result.artifact === "sharedAgentBridge" && result.status === "failed";
}

function classifyHostSetupResult(results: HostArtifactOutcome[]): {
  ok: boolean;
  status: "ok" | "warn" | "failed";
  message: string;
} {
  const failedArtifacts = results.filter((result) => result.status === "failed");
  const onlyNonFatalFailures = failedArtifacts.length > 0
    && failedArtifacts.every((result) => isNonFatalHostArtifactFailure(result));

  if (failedArtifacts.length === 0) {
    return {
      ok: true,
      status: "ok",
      message: "Host setup complete.",
    };
  }

  if (onlyNonFatalFailures) {
    return {
      ok: true,
      status: "warn",
      message: "Host setup completed with a shared-agent bridge warning; continuing.",
    };
  }

  return {
    ok: false,
    status: "failed",
    message: "Host setup failed.",
  };
}

function resolveBundledSkillsDir(options: HostSetupOptions): string {
  if (options.bundledSkillsDir !== undefined) {
    return options.bundledSkillsDir;
  }
  return join(getHomeDir(options.env), ".androperator", "bundled-skills");
}

const SHARED_BRIDGE_START = "<!-- ANDROPERATOR_SHARED_AGENT_BRIDGE:START -->";
const SHARED_BRIDGE_END = "<!-- ANDROPERATOR_SHARED_AGENT_BRIDGE:END -->";

function nullIfBlank(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return value.length > 0 ? value : null;
}

function getHomeDir(env: NodeJS.ProcessEnv | undefined): string {
  const home = env?.HOME;
  if (typeof home === "string" && home.length > 0) {
    return home;
  }
  return homedir();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensurePrivateAndroperatorDir(androperatorDir: string): Promise<void> {
  await mkdir(androperatorDir, { recursive: true, mode: 0o700 });
  try {
    await chmod(androperatorDir, 0o700);
  } catch {
    // Best-effort permission tightening only.
  }
}

async function secureFileIfPresent(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    return;
  }
  try {
    await chmod(path, 0o600);
  } catch {
    // Best-effort permission tightening only.
  }
}

async function writeArtifactFile(path: string, content: string, mode?: number): Promise<HostArtifactStatus> {
  let existing: string | undefined;
  try {
    existing = await readFile(path, "utf8");
    if (existing === content) {
      return "skipped";
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  await mkdir(dirname(path), { recursive: true });

  const tempPath = join(dirname(path), `.androperator-host-artifact.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, content, { encoding: "utf8", mode });
  if (mode !== undefined) {
    try {
      await chmod(tempPath, mode);
    } catch {
      // Best-effort only.
    }
  }

  try {
    await rename(tempPath, path);
  } finally {
    if (await fileExists(tempPath)) {
      await unlink(tempPath);
    }
  }

  return existing === undefined ? "written" : "updated";
}

function resolveInstalledAt(options: HostSetupOptions): string {
  if (typeof options.installedAt === "string" && options.installedAt.length > 0) {
    return options.installedAt;
  }
  return (options.now ?? (() => new Date()))().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildInstallStateContent(options: HostSetupOptions): string {
  const installState = {
    schemaVersion: 1,
    installedAt: resolveInstalledAt(options),
    cliVersion: options.cliVersion === undefined ? getCliVersion() : nullIfBlank(options.cliVersion),
    apkVersion: nullIfBlank(options.apkVersion),
    lastDeviceSerial: nullIfBlank(options.lastDeviceSerial),
  };
  return `${JSON.stringify(installState, null, 2)}\n`;
}

function resolveCliJsPath(options: HostSetupOptions): string {
  const explicitPath = options.cliJsPath;
  if (explicitPath === null) {
    return "";
  }
  if (typeof explicitPath === "string") {
    return explicitPath;
  }

  const envOverride = options.env?.ANDROPERATOR_CLI_JS_PATH;
  if (typeof envOverride === "string") {
    return envOverride;
  }

  const argvPath = process.argv[1];
  if (typeof argvPath === "string" && argvPath.length > 0) {
    return resolve(argvPath);
  }

  return "";
}

function buildMcpConfigSnippetContent(options: HostSetupOptions, androperatorDir: string): string {
  const operatorPackage = options.operatorPackage ?? DEFAULT_OPERATOR_PACKAGE;
  const logDir = options.logDir ?? join(androperatorDir, "logs");
  const homeDir = getHomeDir(options.env);
  const codexConfigPath = options.codexConfigPath ?? join(options.env?.CODEX_HOME ?? join(homeDir, ".codex"), "config.toml");
  const claudeConfigPathMac = options.claudeConfigPathMac ?? join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  const claudeConfigPathLinux = options.claudeConfigPathLinux ?? join(homeDir, ".config", "Claude", "claude_desktop_config.json");
  const cliWrapperPath = options.cliWrapperPath ?? options.env?.ANDROPERATOR_BIN_PATH ?? "androperator";
  const cliJsPath = resolveCliJsPath(options);
  const adbPath = nullIfBlank(options.adbPath ?? options.env?.ADB_PATH);
  const adbPlaceholder = "<set ADB_PATH to your adb binary>";
  const adbValue = adbPath ?? adbPlaceholder;
  const useNodeForm = cliJsPath.length > 0;
  const command = useNodeForm ? (options.processExecPath ?? process.execPath) : cliWrapperPath;
  const args = useNodeForm ? [cliJsPath, "mcp", "serve"] : ["mcp", "serve"];
  const serverConfig = {
    command,
    args,
    env: {
      ADB_PATH: adbValue,
      ANDROPERATOR_OPERATOR_PACKAGE: operatorPackage,
      ANDROPERATOR_LOG_DIR: logDir,
      ANDROPERATOR_LOG_LEVEL: "info",
    },
  };

  const notes = [
    "This snippet is generated for the current host.",
    "Regenerate it with androperator host setup if the androperator binary path or adb path changes.",
  ];

  if (!useNodeForm) {
    notes.push(
      "Could not resolve the Androperator CLI JS entrypoint, so this snippet uses the npm shell wrapper. Claude Desktop and other GUI MCP clients usually do not inherit your shell PATH; if launch fails, replace \"command\" with \"node\" and \"args\" with [\"<installed_androperator_path>/dist/cli/index.js\", \"mcp\", \"serve\"]."
    );
  }

  if (adbPath === null) {
    notes.push(
      `adb was not found on PATH at setup time. Replace ADB_PATH (${adbPlaceholder}) with the absolute path to your adb binary before using this snippet.`
    );
  }

  const tomlArgs = args.map((value) => JSON.stringify(value)).join(", ");
  const snippet = {
    notes,
    claudeDesktop: {
      configPathHints: [claudeConfigPathMac, claudeConfigPathLinux],
      mergeKey: "mcpServers",
      entry: {
        androperator: serverConfig,
      },
    },
    codex: {
      configPath: codexConfigPath,
      entryToml: [
        "[mcp_servers.androperator]",
        `command = ${JSON.stringify(command)}`,
        `args = [${tomlArgs}]`,
        "[mcp_servers.androperator.env]",
        `ADB_PATH = ${JSON.stringify(adbValue)}`,
        `ANDROPERATOR_OPERATOR_PACKAGE = ${JSON.stringify(operatorPackage)}`,
        `ANDROPERATOR_LOG_DIR = ${JSON.stringify(logDir)}`,
        "ANDROPERATOR_LOG_LEVEL = \"info\"",
        "",
      ].join("\n"),
    },
    genericStdioConsumer: {
      serverName: "androperator",
      server: serverConfig,
    },
  };

  return `${JSON.stringify(snippet, null, 2)}\n`;
}

async function listInstalledBundledSkillNames(bundledSkillsDir: string): Promise<{
  installed: string[];
  hasVersionFile: boolean;
}> {
  const installed: string[] = [];
  if (!(await fileExists(bundledSkillsDir))) {
    return { installed, hasVersionFile: false };
  }

  const entries = await readdir(bundledSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = join(bundledSkillsDir, entry.name, "SKILL.md");
    if (await fileExists(skillPath)) {
      installed.push(entry.name);
    }
  }

  installed.sort((left, right) => left.localeCompare(right));
  return {
    installed,
    hasVersionFile: await fileExists(join(bundledSkillsDir, "version.txt")),
  };
}

async function buildAgentGuideContent(options: HostSetupOptions): Promise<string> {
  const bundledSkillsDir = resolveBundledSkillsDir(options);
  const { installed, hasVersionFile } = await listInstalledBundledSkillNames(bundledSkillsDir);
  const lines = [
    "# Androperator", "", "Deterministic Android execution and evidence for the current agent.", "",
    "## Quick start", "", "- `androperator doctor` - verify readiness",
    "- `androperator snapshot` - observe current state",
    "- Choose an action from current evidence, then verify the requested outcome.",
    "- Use explicit `--device` when multiple targets are connected.", "",
    "## Agent instructions", "",
    "The current agent owns app strategy, recovery and outcome verification. Ordinary helpers are optional.",
    "Save reusable instructions when requested or worthwhile; one-off tasks do not require authoring a skill.",
    "Recordings are optional evidence of a likely route, not an execution program.", "",
    "## Bundled Skills", "", "Inspect host guidance with `androperator bundled-skills list`.",
    "Start with `androperator-agent-orientation` on an unfamiliar host.",
    "Use `androperator-upgrade` for a whole-product refresh.",
    "Use `androperator-skill-author-by-agent-discovery` for bounded exploration and optional authoring.",
    "Use `androperator-learn-from-recording` when a demonstration contributes missing evidence.",
    "", `Installed guidance: ${bundledSkillsDir}`, ...installed.map(name => `- ${name}`),
  ];
  if (installed.length === 0 || !hasVersionFile) lines.push("", "Install or refresh guidance with `androperator bundled-skills install`.");
  lines.push("", "## Documentation", "", "- https://docs.androperator.com/llms.txt", "- https://docs.androperator.com/host-agents/");
  return `${lines.join("\n")}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSharedAgentBridgeContent(sharedAgentsContent: string, localAgentGuidePath: string): string {
  const bridgeBlock = [
    SHARED_BRIDGE_START,
    "## Androperator",
    "",
    "The current agent follows instructions and uses Androperator for Android actions and evidence.",
    `- Read \`${localAgentGuidePath}\``,
    "- Inspect `androperator bundled-skills list` for installed host guidance.",
    "- Start with `androperator-agent-orientation` on an unfamiliar host.",
    "- Observe current state, act, and verify the requested result; report blockers truthfully.",
    SHARED_BRIDGE_END,
  ].join("\n");

  const bridgePattern = new RegExp(
    `${escapeRegExp(SHARED_BRIDGE_START)}[\\s\\S]*?${escapeRegExp(SHARED_BRIDGE_END)}`,
    "g",
  );
  const cleaned = sharedAgentsContent.replace(bridgePattern, "");
  const separator = cleaned.length === 0
    ? ""
    : (cleaned.endsWith("\n\n") ? "" : (cleaned.endsWith("\n") ? "\n" : "\n\n"));
  return `${cleaned}${separator}${bridgeBlock}`;
}

export async function setupHost(
  options: HostSetupOptions = {},
): Promise<HostSetupResult> {
  const homeDir = getHomeDir(options.env);
  const androperatorDir = options.androperatorDir ?? join(homeDir, ".androperator");
  const installStatePath = join(androperatorDir, "install-state.json");
  const mcpConfigSnippetPath = join(androperatorDir, "mcp-config-snippet.json");
  const agentGuidePath = join(androperatorDir, "AGENTS.md");
  const sharedAgentsPath = options.sharedAgentsPath ?? join(homeDir, ".agents", "AGENTS.md");

  await ensurePrivateAndroperatorDir(androperatorDir);

  const results: HostArtifactOutcome[] = [];

  const installStateContent = buildInstallStateContent(options);
  try {
    const status = await writeArtifactFile(installStatePath, installStateContent, 0o600);
    await secureFileIfPresent(installStatePath);
    results.push({ artifact: "installState", path: installStatePath, status });
  } catch (error) {
    results.push({
      artifact: "installState",
      path: installStatePath,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const mcpConfigSnippetContent = buildMcpConfigSnippetContent(options, androperatorDir);
  try {
    const status = await writeArtifactFile(mcpConfigSnippetPath, mcpConfigSnippetContent, 0o600);
    await secureFileIfPresent(mcpConfigSnippetPath);
    results.push({ artifact: "mcpConfigSnippet", path: mcpConfigSnippetPath, status });
  } catch (error) {
    results.push({
      artifact: "mcpConfigSnippet",
      path: mcpConfigSnippetPath,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const agentGuideContent = await buildAgentGuideContent(options);
    const status = await writeArtifactFile(agentGuidePath, agentGuideContent, 0o600);
    await secureFileIfPresent(agentGuidePath);
    results.push({ artifact: "agentGuide", path: agentGuidePath, status });
  } catch (error) {
    results.push({
      artifact: "agentGuide",
      path: agentGuidePath,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!(await fileExists(sharedAgentsPath))) {
    results.push({
      artifact: "sharedAgentBridge",
      path: sharedAgentsPath,
      status: "skipped",
      message: "Shared agent guide not found; skipping Androperator bridge update.",
    });
  } else {
    try {
      const sharedAgentsStat = await lstat(sharedAgentsPath);
      if (!sharedAgentsStat.isFile()) {
        throw new Error(`${sharedAgentsPath} must be a regular file`);
      }

      const sharedAgentsContent = await readFile(sharedAgentsPath, "utf8");
      const nextContent = buildSharedAgentBridgeContent(sharedAgentsContent, agentGuidePath);
      const status = await writeArtifactFile(sharedAgentsPath, nextContent, sharedAgentsStat.mode & 0o777);
      results.push({ artifact: "sharedAgentBridge", path: sharedAgentsPath, status });
    } catch (error) {
      results.push({
        artifact: "sharedAgentBridge",
        path: sharedAgentsPath,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = results.reduce(
    (accumulator, result) => {
      accumulator[result.status] += 1;
      return accumulator;
    },
    { written: 0, updated: 0, skipped: 0, failed: 0 },
  );
  const classified = classifyHostSetupResult(results);
  return {
    ok: classified.ok,
    status: classified.status,
    message: classified.message,
    artifacts: results,
    summary,
  };
}
