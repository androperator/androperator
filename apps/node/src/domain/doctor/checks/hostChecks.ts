import { lstat, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isAdbAvailable, runAdb } from "../../../adapters/android-bridge/adbClient.js";
import { type RuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { type DoctorCheckResult } from "../../../contracts/doctor.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import { DOCTOR_DOCS_URLS } from "../docsUrls.js";
import {
  listPackagedBundledSkills,
  resolveBundledSkillDiscoveryGroups,
  inspectBundledSkillDiscoveryEntry,
  resolveBundledSkillsInstalledDir,
  resolvePackagedBundledSkillsSourceDir,
} from "../../bundledSkills/copyBundledSkills.js";
import { getCliVersion } from "../../version/compatibility.js";

const BUNDLED_SKILLS_VERSION_FILENAME = "version.txt";
const BUNDLED_SKILLS_UPDATE_COMMAND = "androperator bundled-skills update";

export interface CheckBundledSkillsStalenessOptions {
  installedDir?: string;
  sourceDir?: string;
  cliVersion?: string;
  getCliVersionFn?: () => string;
  claudeSkillsDir?: string;
  agentsSkillsDir?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function buildBundledSkillsWarn(
  summary: string,
  detail: string,
  evidence: Record<string, unknown>,
  fixOverride?: DoctorCheckResult["fix"]
): DoctorCheckResult {
  return {
    id: "host.bundled-skills.staleness",
    status: "warn",
    code: ERROR_CODES.AGENT_SKILLS_STALE,
    summary,
    detail,
    fix: fixOverride ?? {
      title: "Update bundled-skills",
      platform: "any",
      steps: [
        { kind: "shell", value: BUNDLED_SKILLS_UPDATE_COMMAND },
      ],
    },
    evidence,
  };
}

function buildBundledSkillsPathRepairFix(installedDir: string): DoctorCheckResult["fix"] {
  return {
    title: "Repair bundled-skills install path",
    platform: "any",
    steps: [
      {
        kind: "manual",
        value: `Remove or rename the conflicting path at ${installedDir}.`,
      },
      { kind: "shell", value: "androperator bundled-skills install" },
    ],
  };
}

async function findMissingInstalledAgentSkills(
  installedDir: string,
  expectedSkills: string[]
): Promise<string[]> {
  const missingSkills: string[] = [];

  for (const skillName of expectedSkills) {
    try {
      const skillFileStat = await stat(join(installedDir, skillName, "SKILL.md"));
      if (!skillFileStat.isFile()) {
        missingSkills.push(skillName);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        missingSkills.push(skillName);
        continue;
      }
      throw error;
    }
  }

  return missingSkills;
}

interface BrokenAgentDiscoveryEntry {
  dirLabel: string;
  discoveryDir: string;
  skillName: string;
  issue: "missing" | "conflict" | "broken" | "wrong-target" | "legacy-symlink" | "unmarked" | "stale";
  expectedTarget: string;
  actualTarget?: string;
}

async function findBrokenAgentDiscoveryEntries(
  installedDir: string,
  expectedSkills: string[],
  options: CheckBundledSkillsStalenessOptions
): Promise<BrokenAgentDiscoveryEntry[]> {
  const discoveryGroups = await resolveBundledSkillDiscoveryGroups(options);

  const brokenEntries: BrokenAgentDiscoveryEntry[] = [];

  for (const group of discoveryGroups) {
    const discoveryDir = group.dir;
    const dirLabel = group.aliases.map(alias => alias.label).join(",");
    for (const skillName of expectedSkills) {
      const inspection = await inspectBundledSkillDiscoveryEntry(group, installedDir, skillName);
      if (inspection.status === "ok") {
        continue;
      }
      brokenEntries.push({
        dirLabel,
        discoveryDir,
        skillName,
        issue: inspection.status,
        expectedTarget: inspection.expectedTarget,
        actualTarget: inspection.actualTarget,
      });
    }
  }

  return brokenEntries;
}

export async function checkNodeVersion(): Promise<DoctorCheckResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0], 10);
  const MIN_NODE_VERSION = 24;

  if (major < MIN_NODE_VERSION) {
    return {
      id: "host.node.version",
      status: "fail",
      code: ERROR_CODES.NODE_TOO_OLD,
      summary: `Node version ${version} is too old.`,
      detail: `Androperator requires Node.js v${MIN_NODE_VERSION} or newer.`,
      fix: {
        title: "Upgrade Node.js",
        platform: "any",
        steps: [
          { kind: "shell", value: "nvm install 24" },
          { kind: "shell", value: "nvm use 24" },
          { kind: "manual", value: "Alternatively, download from nodejs.org" }
        ],
        docsUrl: DOCTOR_DOCS_URLS.setup,
      },
    };
  }

  return {
    id: "host.node.version",
    status: "pass",
    summary: `Node version ${version} is compatible.`,
  };
}

export async function checkAdbPresence(config: RuntimeConfig): Promise<DoctorCheckResult> {
  const adbOk = await isAdbAvailable(config);
  if (!adbOk) {
    return {
      id: "host.adb.presence",
      status: "fail",
      code: ERROR_CODES.ADB_NOT_FOUND,
      summary: "adb not found in PATH.",
      detail: "The Android Debug Bridge (adb) is required to communicate with devices.",
      fix: {
        title: "Install Android Platform Tools",
        platform: "any",
        steps: [
          { kind: "manual", value: "macOS: brew install --cask android-platform-tools" },
          { kind: "manual", value: "Linux: sudo apt update && sudo apt install android-tools-adb" }
        ],
        docsUrl: DOCTOR_DOCS_URLS.setup,
      },
    };
  }

  const { stdout } = await runAdb(config, ["version"]);
  return {
    id: "host.adb.presence",
    status: "pass",
    summary: "adb is installed.",
    evidence: { version: stdout.trim() },
  };
}

export async function checkAdbServer(config: RuntimeConfig): Promise<DoctorCheckResult> {
  const { code, stderr } = await runAdb(config, ["start-server"]);
  if (code !== 0) {
    return {
      id: "host.adb.server",
      status: "fail",
      code: ERROR_CODES.ADB_SERVER_FAILED,
      summary: "adb server failed to start.",
      detail: stderr,
      fix: {
        title: "Restart adb server",
        platform: "any",
        steps: [
          { kind: "shell", value: "adb kill-server" },
          { kind: "shell", value: "adb start-server" }
        ],
        docsUrl: DOCTOR_DOCS_URLS.setup,
      },
    };
  }

  return {
    id: "host.adb.server",
    status: "pass",
    summary: "adb server is healthy.",
  };
}

export async function checkBundledSkillsStaleness(
  _config: RuntimeConfig,
  options: CheckBundledSkillsStalenessOptions = {}
): Promise<DoctorCheckResult> {
  const installedDir = resolveBundledSkillsInstalledDir({
    installedDir: options.installedDir,
    homeDir: options.homeDir,
  });
  const versionPath = join(installedDir, BUNDLED_SKILLS_VERSION_FILENAME);
  let cliVersion: string;
  try {
    cliVersion = options.cliVersion ?? (options.getCliVersionFn ?? getCliVersion)();
  } catch (error) {
    return buildBundledSkillsWarn(
      "CLI version metadata could not be read.",
      error instanceof Error ? error.message : String(error),
      {
        installedDir,
      }
    );
  }

  try {
    const installedDirStat = await stat(installedDir);
    if (!installedDirStat.isDirectory()) {
      return buildBundledSkillsWarn(
        `Bundled-skills install path exists but is not a directory: ${installedDir}.`,
        "Remove or rename the conflicting path first, then re-run the bundled-skills installer.",
        {
          installedDir,
          cliVersion,
        },
        buildBundledSkillsPathRepairFix(installedDir)
      );
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      try {
        const danglingEntryStat = await lstat(installedDir);
        return buildBundledSkillsWarn(
          danglingEntryStat.isSymbolicLink()
            ? `Bundled-skills install path is a dangling symlink: ${installedDir}.`
            : `Bundled-skills install path could not be resolved cleanly: ${installedDir}.`,
          "Remove or rename the broken path first, then re-run the bundled-skills installer.",
          {
            installedDir,
            cliVersion,
            pathType: danglingEntryStat.isSymbolicLink() ? "dangling-symlink" : "unresolved-entry",
          },
          buildBundledSkillsPathRepairFix(installedDir)
        );
      } catch (lstatError) {
        if (!isMissingPathError(lstatError)) {
          return buildBundledSkillsWarn(
            "Bundled-skills install state could not be inspected.",
            lstatError instanceof Error ? lstatError.message : String(lstatError),
            {
              installedDir,
              cliVersion,
            }
          );
        }
        return {
          id: "host.bundled-skills.staleness",
          status: "pass",
          summary: "Bundled-skills not yet installed.",
          evidence: {
            installedDir,
          },
        };
      }
    }
    return buildBundledSkillsWarn(
      "Bundled-skills install state could not be inspected.",
      error instanceof Error ? error.message : String(error),
      {
        installedDir,
        cliVersion,
      }
    );
  }

  let installedVersion: string;
  try {
    installedVersion = (await readFile(versionPath, "utf8")).trim();
  } catch (error) {
    if (!isMissingPathError(error)) {
      return buildBundledSkillsWarn(
        "Bundled-skills version file could not be read.",
        error instanceof Error ? error.message : String(error),
        {
          installedDir,
          versionPath,
          cliVersion,
        }
      );
    }
    return buildBundledSkillsWarn(
      "Bundled-skills version file is missing.",
      `Expected ${versionPath} to contain the installed bundled-skills version.`,
      {
        installedDir,
        versionPath,
        cliVersion,
      }
    );
  }

  if (installedVersion === "") {
    return buildBundledSkillsWarn(
      "Bundled-skills version file is empty.",
      `Expected ${versionPath} to contain the installed bundled-skills version.`,
      {
        installedDir,
        versionPath,
        cliVersion,
      }
    );
  }

  const sourceDir = resolvePackagedBundledSkillsSourceDir({
    sourceDir: options.sourceDir,
    env: options.env,
  });

  let expectedSkills: string[];
  try {
    expectedSkills = await listPackagedBundledSkills(sourceDir);
  } catch (error) {
    return buildBundledSkillsWarn(
      "Packaged bundled-skills could not be inspected.",
      error instanceof Error ? error.message : String(error),
      {
        installedDir,
        installedVersion,
        cliVersion,
      }
    );
  }

  if (expectedSkills.length === 0) {
    return buildBundledSkillsWarn(
      "Packaged bundled-skills list is empty.",
      "Expected at least one packaged bundled skill containing SKILL.md.",
      {
        installedDir,
        installedVersion,
        cliVersion,
      }
    );
  }

  let missingSkills: string[];
  try {
    missingSkills = await findMissingInstalledAgentSkills(installedDir, expectedSkills);
  } catch (error) {
    return buildBundledSkillsWarn(
      "Bundled-skills install could not be fully inspected.",
      error instanceof Error ? error.message : String(error),
      {
        installedDir,
        installedVersion,
        cliVersion,
        expectedSkills,
      }
    );
  }

  if (missingSkills.length > 0) {
    return buildBundledSkillsWarn(
      "Bundled-skills install is missing expected packaged skills.",
      "Re-run the bundled-skills installer to restore the packaged first-party skill set.",
      {
        installedDir,
        installedVersion,
        cliVersion,
        expectedSkills,
        missingSkills,
      }
    );
  }

  let brokenDiscoveryEntries: BrokenAgentDiscoveryEntry[];
  try {
    brokenDiscoveryEntries = await findBrokenAgentDiscoveryEntries(installedDir, expectedSkills, options);
  } catch (error) {
    return buildBundledSkillsWarn(
      "Bundled-skills discovery links could not be inspected.",
      error instanceof Error ? error.message : String(error),
      {
        installedDir,
        installedVersion,
        cliVersion,
      }
    );
  }

  if (brokenDiscoveryEntries.length > 0) {
    const brokenDiscoveryByDir: Record<string, BrokenAgentDiscoveryEntry[]> = {};
    for (const entry of brokenDiscoveryEntries) {
      (brokenDiscoveryByDir[entry.dirLabel] ??= []).push(entry);
    }
    const affectedDirs = Object.keys(brokenDiscoveryByDir);
    const detailParts = Object.entries(brokenDiscoveryByDir)
      .map(([dirLabel, entries]) => `${dirLabel}: ${entries.map((entry) => `${entry.skillName} (${entry.issue})`).join(", ")}`);

    return buildBundledSkillsWarn(
      "Bundled-skills discovery links are incomplete or invalid.",
      `Managed discovery entries are broken in ${affectedDirs.join(" and ")} skill directories. ${detailParts.join("; ")}`,
      {
        installedDir,
        installedVersion,
        cliVersion,
        brokenDiscoveryByDir,
      }
    );
  }

  if (installedVersion === cliVersion) {
    return {
      id: "host.bundled-skills.staleness",
      status: "pass",
      summary: "Bundled-skills are up to date.",
      evidence: {
        installedDir,
        installedVersion,
        cliVersion,
      },
    };
  }

  return {
    id: "host.bundled-skills.staleness",
    status: "warn",
    code: ERROR_CODES.AGENT_SKILLS_STALE,
    summary: `Bundled-skills (v${installedVersion}) are outdated (CLI is v${cliVersion}).`,
    detail: "Installed bundled-skills should be refreshed to match the current CLI version.",
    fix: {
      title: "Update bundled-skills",
      platform: "any",
      steps: [
        { kind: "shell", value: BUNDLED_SKILLS_UPDATE_COMMAND },
      ],
    },
    evidence: {
      installedDir,
      installedVersion,
      cliVersion,
    },
  };
}
