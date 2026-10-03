import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { cp, lstat, mkdtemp, realpath, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkAdbPresence,
  checkAdbServer,
  checkNodeVersion,
  checkBundledSkillsStaleness,
} from "../../../domain/doctor/checks/hostChecks.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import { getDefaultRuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { FakeProcessRunner } from "../fakes/FakeProcessRunner.js";
import { getCliVersion } from "../../../domain/version/compatibility.js";
import {
    listPackagedBundledSkills,
    MANAGED_BUNDLED_SKILL_COPY_MARKER,
    MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT,
} from "../../../domain/bundledSkills/copyBundledSkills.js";

describe("Doctor: hostChecks", () => {
    const tempRoots: string[] = [];
    const directorySymlinkType = process.platform === "win32" ? "junction" : "dir";

    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    });

    async function makeTempRoot(prefix: string): Promise<string> {
        const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
        tempRoots.push(root);
        return root;
    }

    async function getExpectedBundledSkills(): Promise<string[]> {
        return listPackagedBundledSkills();
    }

    async function createDirectorySymlink(targetPath: string, linkPath: string): Promise<void> {
        await symlink(targetPath, linkPath, directorySymlinkType);
    }

    async function createManagedAgentsCopy(sourcePath: string, copyPath: string): Promise<void> {
        await cp(sourcePath, copyPath, { recursive: true, force: true, dereference: true });
        await writeFile(join(copyPath, MANAGED_BUNDLED_SKILL_COPY_MARKER), MANAGED_BUNDLED_SKILL_COPY_MARKER_CONTENT, "utf8");
    }

    async function seedHealthyAgentSkillsInstall(
        installedDir: string,
        discoveryDirs: string[],
        version = getCliVersion()
    ): Promise<string[]> {
        const skillNames = await getExpectedBundledSkills();
        await mkdir(installedDir, { recursive: true });
        for (const discoveryDir of discoveryDirs) {
            await mkdir(discoveryDir, { recursive: true });
        }
        for (const skillName of skillNames) {
            const skillDir = join(installedDir, skillName);
            await mkdir(skillDir, { recursive: true });
            await writeFile(join(skillDir, "SKILL.md"), `# ${skillName}\n`, "utf8");
            await createDirectorySymlink(skillDir, join(discoveryDirs[0], skillName));
            await createManagedAgentsCopy(skillDir, join(discoveryDirs[1], skillName));
        }
        await writeFile(join(installedDir, "version.txt"), `${version}\n`, "utf8");
        return skillNames;
    }

    function withNodeVersion(version: string, fn: () => Promise<void> | void): Promise<void> | void {
        const originalVersionDescriptor = Object.getOwnPropertyDescriptor(process, "version");
        Object.defineProperty(process, "version", {
            configurable: true,
            value: version,
        });

        const restore = () => {
            if (originalVersionDescriptor) {
                Object.defineProperty(process, "version", originalVersionDescriptor);
                return;
            }

            Reflect.deleteProperty(process as unknown as Record<string, unknown>, "version");
        };

        try {
            const result = fn();
            if (result && typeof (result as Promise<void>).then === "function") {
                return (result as Promise<void>).finally(restore);
            }
            restore();
            return result;
        } catch (error) {
            restore();
            throw error;
        }
    }

    describe("checkNodeVersion", () => {
        it("fails below the Node 24 floor and passes at the floor", async () => {
            await withNodeVersion("v23.11.0", async () => {
                const result = await checkNodeVersion();

                assert.strictEqual(result.status, "fail");
                assert.strictEqual(result.code, ERROR_CODES.NODE_TOO_OLD);
                assert.match((result as any).detail, /Node\.js v24 or newer/);
                assert.match((result as any).fix.steps[0].value, /nvm install 24/);
            });

            await withNodeVersion("v24.0.0", async () => {
                const result = await checkNodeVersion();

                assert.strictEqual(result.status, "pass");
                assert.strictEqual((result as any).summary, "Node version v24.0.0 is compatible.");
            });
        });
    });

    describe("checkAdbPresence", () => {
        it("returns ADB_NOT_FOUND when adb is missing", async () => {
            const runner = new FakeProcessRunner();
            const config = getDefaultRuntimeConfig({ runner });

            runner.queueError(127, "ENOENT"); // simulate adb not found for adb version

            const result = await checkAdbPresence(config);

            assert.strictEqual(result.status, "fail");
            assert.strictEqual(result.code, ERROR_CODES.ADB_NOT_FOUND);
            assert.strictEqual(runner.calls.length, 1);
            assert.strictEqual(runner.calls[0].args[0], "version");
        });

        it("returns pass with version when adb is present", async () => {
            const runner = new FakeProcessRunner();
            const config = getDefaultRuntimeConfig({ runner });

            runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" }); // for check
            runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" }); // for actual display

            const result = await checkAdbPresence(config);

            assert.strictEqual(result.status, "pass");
            assert.strictEqual((result as any).evidence.version, "Android Debug Bridge version 1.0.41");
        });
    });

    describe("checkAdbServer", () => {
        it("returns ADB_SERVER_FAILED when server fails to start", async () => {
            const runner = new FakeProcessRunner();
            const config = getDefaultRuntimeConfig({ runner });

            runner.queueResult({ code: 1, stdout: "", stderr: "cannot bind to port 5037" });

            const result = await checkAdbServer(config);

            assert.strictEqual(result.status, "fail");
            assert.strictEqual(result.code, ERROR_CODES.ADB_SERVER_FAILED);
            assert.strictEqual((result as any).detail, "cannot bind to port 5037");
        });

        it("returns pass when server starts successfully", async () => {
            const runner = new FakeProcessRunner();
            const config = getDefaultRuntimeConfig({ runner });

            runner.queueResult({ code: 0, stdout: "daemon started successfully", stderr: "" });

            const result = await checkAdbServer(config);

            assert.strictEqual(result.status, "pass");
        });
    });

    describe("checkBundledSkillsStaleness", () => {
        it("passes when the bundled-skills install dir does not exist", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-missing-");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });

            const result = await checkBundledSkillsStaleness(config, {
                installedDir: join(root, "missing-bundled-skills"),
            });

            assert.strictEqual(result.status, "pass");
            assert.strictEqual(result.summary, "Bundled-skills not yet installed.");
        });

        it("derives the default installed dir from homeDir when installedDir is unset", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-alt-home-");
            const homeDir = join(root, "alt-home");
            const installedDir = join(homeDir, ".androperator", "bundled-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });

            const result = await checkBundledSkillsStaleness(config, { homeDir });

            assert.strictEqual(result.status, "pass");
            assert.strictEqual(result.summary, "Bundled-skills not yet installed.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
            });
        });

        it("warns when the bundled-skills install path is a regular file", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-file-conflict-");
            const installedDir = join(root, "bundled-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            await writeFile(installedDir, "not a directory\n", "utf8");

            const result = await checkBundledSkillsStaleness(config, { installedDir });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, `Bundled-skills install path exists but is not a directory: ${installedDir}.`);
            assert.deepStrictEqual(result.fix?.steps, [
                { kind: "manual", value: `Remove or rename the conflicting path at ${installedDir}.` },
                { kind: "shell", value: "androperator bundled-skills install" },
            ]);
        });

        it("warns when the bundled-skills install path is a dangling symlink", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-dangling-link-");
            const installedDir = join(root, "bundled-skills");
            const missingTarget = join(root, "missing-target");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            await createDirectorySymlink(missingTarget, installedDir);

            const result = await checkBundledSkillsStaleness(config, { installedDir });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, `Bundled-skills install path is a dangling symlink: ${installedDir}.`);
            assert.deepStrictEqual(result.fix?.steps, [
                { kind: "manual", value: `Remove or rename the conflicting path at ${installedDir}.` },
                { kind: "shell", value: "androperator bundled-skills install" },
            ]);
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                cliVersion: getCliVersion(),
                pathType: "dangling-symlink",
            });
        });

        it("warns when the CLI version metadata cannot be read", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-cli-version-fail-");
            const installedDir = join(root, "bundled-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                getCliVersionFn: () => {
                    throw new Error("package.json version is missing");
                },
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.summary, "CLI version metadata could not be read.");
        });

        it("warns when the bundled-skills install dir exists but version.txt is missing", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-no-version-");
            const installedDir = join(root, "bundled-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            await mkdir(installedDir, { recursive: true });

            const result = await checkBundledSkillsStaleness(config, { installedDir });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, "Bundled-skills version file is missing.");
            assert.deepStrictEqual(result.fix?.steps, [{ kind: "shell", value: "androperator bundled-skills update" }]);
        });

        it("passes when version.txt matches the current CLI version", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-current-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "pass");
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, "Bundled-skills are up to date.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
            });
        });

        it("warns when the Claude discovery link is missing", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-missing-claude-link-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            await rm(join(claudeSkillsDir, targetSkill), { force: true });

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.fix?.steps, [{ kind: "shell", value: "androperator bundled-skills update" }]);
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    claude: [{
                        actualTarget: undefined,
                        dirLabel: "claude",
                        discoveryDir: claudeSkillsDir,
                        skillName: targetSkill,
                        issue: "missing",
                        expectedTarget: join(installedDir, targetSkill),
                    }],
                },
            });
        });

        it("passes without a Codex directory when shared and Claude discovery are healthy", async () => {
            const root = await makeTempRoot("androperator-doctor-shared-discovery-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const codexSkillsDir = join(root, "absent-codex-skills");
            await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            const result = await checkBundledSkillsStaleness(getDefaultRuntimeConfig(), {
                installedDir, claudeSkillsDir, agentsSkillsDir,
            });
            assert.strictEqual(result.status, "pass");
            await assert.rejects(lstat(codexSkillsDir), { code: "ENOENT" });
        });

        it("warns when the generic agents managed copy is missing", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-missing-agents-copy-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            await rm(join(agentsSkillsDir, targetSkill), { recursive: true, force: true });

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    agents: [{
                        actualTarget: undefined,
                        dirLabel: "agents",
                        discoveryDir: agentsSkillsDir,
                        skillName: targetSkill,
                        issue: "missing",
                        expectedTarget: join(installedDir, targetSkill),
                    }],
                },
            });
        });

        it("warns when the generic agents managed copy is unmarked", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-unmarked-agents-copy-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            await rm(join(agentsSkillsDir, targetSkill, MANAGED_BUNDLED_SKILL_COPY_MARKER), { force: true });

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    agents: [{
                        actualTarget: undefined,
                        dirLabel: "agents",
                        discoveryDir: agentsSkillsDir,
                        skillName: targetSkill,
                        issue: "unmarked",
                        expectedTarget: join(installedDir, targetSkill),
                    }],
                },
            });
        });

        it("warns when the generic agents managed copy is stale", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-stale-agents-copy-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            await rm(join(agentsSkillsDir, targetSkill, "SKILL.md"), { force: true });

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    agents: [{
                        actualTarget: undefined,
                        dirLabel: "agents",
                        discoveryDir: agentsSkillsDir,
                        skillName: targetSkill,
                        issue: "stale",
                        expectedTarget: join(installedDir, targetSkill),
                    }],
                },
            });
        });

        it("warns when the generic agents entry is a legacy managed symlink", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-legacy-agents-link-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            await rm(join(agentsSkillsDir, targetSkill), { recursive: true, force: true });
            await createDirectorySymlink(join(installedDir, targetSkill), join(agentsSkillsDir, targetSkill));

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    agents: [{
                        actualTarget: join(installedDir, targetSkill),
                        dirLabel: "agents",
                        discoveryDir: agentsSkillsDir,
                        skillName: targetSkill,
                        issue: "legacy-symlink",
                        expectedTarget: join(installedDir, targetSkill),
                    }],
                },
            });
        });

        it("warns when a managed discovery link points to the wrong target", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-wrong-link-target-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            const wrongTargetRoot = join(root, "wrong-target", targetSkill);
            await mkdir(wrongTargetRoot, { recursive: true });
            await rm(join(claudeSkillsDir, targetSkill), { force: true });
            await createDirectorySymlink(wrongTargetRoot, join(claudeSkillsDir, targetSkill));

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    claude: [{
                        dirLabel: "claude",
                        discoveryDir: claudeSkillsDir,
                        skillName: targetSkill,
                        issue: "wrong-target",
                        expectedTarget: join(installedDir, targetSkill),
                        actualTarget: wrongTargetRoot,
                    }],
                },
            });
        });

        it("warns when a discovery entry is a conflicting non-symlink", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-conflicting-entry-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            await rm(join(claudeSkillsDir, targetSkill), { force: true });
            await writeFile(join(claudeSkillsDir, targetSkill), "not a symlink\n", "utf8");

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    claude: [{
                        actualTarget: undefined,
                        dirLabel: "claude",
                        discoveryDir: claudeSkillsDir,
                        skillName: targetSkill,
                        issue: "conflict",
                        expectedTarget: join(installedDir, targetSkill),
                    }],
                },
            });
        });

        it("warns when the generic agents entry is a conflicting file", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-conflicting-agents-entry-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            await rm(join(agentsSkillsDir, targetSkill), { recursive: true, force: true });
            await writeFile(join(agentsSkillsDir, targetSkill), "not a managed copy\n", "utf8");

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    agents: [{
                        actualTarget: undefined,
                        dirLabel: "agents",
                        discoveryDir: agentsSkillsDir,
                        skillName: targetSkill,
                        issue: "conflict",
                        expectedTarget: join(installedDir, targetSkill),
                    }],
                },
            });
        });

        it("warns when a managed discovery link is dangling", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-broken-link-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const missingTarget = join(root, "missing-target");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);
            await rm(join(claudeSkillsDir, targetSkill), { force: true });
            await createDirectorySymlink(missingTarget, join(claudeSkillsDir, targetSkill));

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.summary, "Bundled-skills discovery links are incomplete or invalid.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                brokenDiscoveryByDir: {
                    claude: [{
                        dirLabel: "claude",
                        discoveryDir: claudeSkillsDir,
                        skillName: targetSkill,
                        issue: "broken",
                        expectedTarget: join(installedDir, targetSkill),
                        actualTarget: missingTarget,
                    }],
                },
            });
        });

        it("warns when version.txt differs from the current CLI version", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-stale-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir], "0.0.1");

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, `Bundled-skills (v0.0.1) are outdated (CLI is v${getCliVersion()}).`);
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: "0.0.1",
                cliVersion: getCliVersion(),
            });
        });

        it("warns when version.txt matches but no installed skill directory contains SKILL.md", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-empty-tree-");
            const installedDir = join(root, "bundled-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const expectedSkills = await getExpectedBundledSkills();
            await mkdir(join(installedDir, "broken-skill"), { recursive: true });
            await writeFile(join(installedDir, "version.txt"), `${getCliVersion()}\n`, "utf8");

            const result = await checkBundledSkillsStaleness(config, { installedDir });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, "Bundled-skills install is missing expected packaged skills.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                expectedSkills,
                missingSkills: expectedSkills,
            });
        });

        it("warns when the packaged install is missing androperator-upgrade", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-missing-upgrade-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const expectedSkills = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);

            await rm(join(installedDir, "androperator-upgrade"), { recursive: true, force: true });

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, "Bundled-skills install is missing expected packaged skills.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                expectedSkills,
                missingSkills: ["androperator-upgrade"],
            });
        });

        it("warns when an expected skill path cannot be inspected for a non-ENOENT reason", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-uninspectable-skill-");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const codexSkillsDir = join(root, "codex-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const [targetSkill] = await getExpectedBundledSkills();
            await mkdir(installedDir, { recursive: true });
            await mkdir(claudeSkillsDir, { recursive: true });
            await mkdir(codexSkillsDir, { recursive: true });
            await mkdir(agentsSkillsDir, { recursive: true });
            await writeFile(join(installedDir, targetSkill), "not a directory\n", "utf8");
            await createDirectorySymlink(join(installedDir, targetSkill), join(claudeSkillsDir, targetSkill));
            await createDirectorySymlink(join(installedDir, targetSkill), join(codexSkillsDir, targetSkill));
            await createDirectorySymlink(join(installedDir, targetSkill), join(agentsSkillsDir, targetSkill));
            await writeFile(join(installedDir, "version.txt"), `${getCliVersion()}\n`, "utf8");

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, "Bundled-skills install could not be fully inspected.");
            const expectedSkills = await getExpectedBundledSkills();
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                expectedSkills,
            });
        });

        it("respects ANDROPERATOR_BUNDLED_SKILLS when deriving the expected packaged skill set", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-override-source-");
            const sourceDir = join(root, "custom-bundled-skills");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const customSkill = "custom-bundled-skill";

            await mkdir(join(sourceDir, customSkill), { recursive: true });
            await writeFile(join(sourceDir, customSkill, "SKILL.md"), `# ${customSkill}\n`, "utf8");
            await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
                env: {
                    ...process.env,
                    ANDROPERATOR_BUNDLED_SKILLS: sourceDir,
                },
            });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, "Bundled-skills install is missing expected packaged skills.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
                expectedSkills: [customSkill],
                missingSkills: [customSkill],
            });
        });

        it("does not honor ANDROPERATOR_AGENT_SKILLS when deriving the expected packaged skill set", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-legacy-source-");
            const sourceDir = join(root, "legacy-agent-skills");
            const installedDir = join(root, "bundled-skills");
            const claudeSkillsDir = join(root, "claude-skills");
            const agentsSkillsDir = join(root, "agents-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            const expectedSkills = await seedHealthyAgentSkillsInstall(installedDir, [claudeSkillsDir, agentsSkillsDir]);

            await mkdir(join(sourceDir, "legacy-agent-skill"), { recursive: true });
            await writeFile(join(sourceDir, "legacy-agent-skill", "SKILL.md"), "# legacy-agent-skill\n", "utf8");

            const result = await checkBundledSkillsStaleness(config, {
                installedDir,
                claudeSkillsDir,
                agentsSkillsDir,
                env: {
                    ...process.env,
                    ANDROPERATOR_AGENT_SKILLS: sourceDir,
                },
            });

            assert.strictEqual(result.status, "pass");
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                installedVersion: getCliVersion(),
                cliVersion: getCliVersion(),
            });
            assert.deepStrictEqual(expectedSkills, await getExpectedBundledSkills());
        });

        it("warns when version.txt cannot be read for a non-ENOENT reason", async () => {
            const root = await makeTempRoot("androperator-doctor-agent-skills-unreadable-version-");
            const installedDir = join(root, "bundled-skills");
            const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
            await mkdir(join(installedDir, "androperator-learn-from-recording"), { recursive: true });
            await writeFile(join(installedDir, "androperator-learn-from-recording", "SKILL.md"), "# androperator-learn-from-recording\n", "utf8");
            await mkdir(join(installedDir, "version.txt"), { recursive: true });

            const result = await checkBundledSkillsStaleness(config, { installedDir });

            assert.strictEqual(result.status, "warn");
            assert.strictEqual(result.code, ERROR_CODES.AGENT_SKILLS_STALE);
            assert.strictEqual(result.id, "host.bundled-skills.staleness");
            assert.strictEqual(result.summary, "Bundled-skills version file could not be read.");
            assert.deepStrictEqual(result.evidence, {
                installedDir,
                versionPath: join(installedDir, "version.txt"),
                cliVersion: getCliVersion(),
            });
        });
    });
});
