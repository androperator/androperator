import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { DoctorService } from "../../../domain/doctor/DoctorService.js";
import { getDefaultRuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { FakeProcessRunner as BaseFakeProcessRunner } from "../fakes/FakeProcessRunner.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import { createAndroperatorLogger } from "../../../adapters/logger.js";
import { getCliVersion } from "../../../domain/version/compatibility.js";

// Existing readiness fixtures assume optional video tooling is healthy.
class FakeProcessRunner extends BaseFakeProcessRunner {
  override async run(command: string, args: string[]) {
    if (command === "scrcpy") return { code: 0, stdout: "--capture-orientation --no-window --no-audio --no-control --video-codec --max-size --record-format --time-limit", stderr: "" };
    if (command === "ffmpeg" || command === "ffprobe") return { code: 0, stdout: "ffmpeg version 6.1", stderr: "" };
    return super.run(command, args);
  }
}

function withTempBundledSkillsDir<T>(config: T, baseDir: string): T {
  (config as T & { bundledSkillsDir?: string }).bundledSkillsDir = join(baseDir, "bundled-skills");
  return config;
}

describe("DoctorService", () => {
  let fakeAgentCliDir: string;
  let fakeRegistryDir: string;
  let originalPath: string | undefined;
  let originalLogDir: string | undefined;
  let originalRegistryPath: string | undefined;

  beforeEach(async () => {
    originalPath = process.env.PATH;
    originalLogDir = process.env.ANDROPERATOR_LOG_DIR;
    originalRegistryPath = process.env.ANDROPERATOR_SKILLS_REGISTRY;
    fakeAgentCliDir = await mkdtemp(join(tmpdir(), "androperator-doctor-agent-cli-"));
    fakeRegistryDir = await mkdtemp(join(tmpdir(), "androperator-doctor-registry-"));
    process.env.ANDROPERATOR_LOG_DIR = join(fakeRegistryDir, "logs");
    const fakeAgentPath = join(fakeAgentCliDir, "codex");
    const registryPath = join(fakeRegistryDir, "skills", "skills-registry.json");
    await mkdir(join(fakeRegistryDir, "skills"), { recursive: true });
    await writeFile(fakeAgentPath, "#!/bin/sh\nexit 0\n", "utf8");
    // Keep DoctorService tests isolated from any developer-local skills registry so
    // host.skill-agent-cli.skills assertions stay deterministic across machines.
    await writeFile(registryPath, `${JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-04-16T00:00:00Z", skills: [] }, null, 2)}\n`, "utf8");
    await chmod(fakeAgentPath, 0o755);
    process.env.PATH = `${fakeAgentCliDir}${delimiter}${originalPath ?? ""}`;
    process.env.ANDROPERATOR_SKILLS_REGISTRY = registryPath;
  });

  afterEach(async () => {
    if (originalLogDir === undefined) delete process.env.ANDROPERATOR_LOG_DIR;
    else process.env.ANDROPERATOR_LOG_DIR = originalLogDir;
    await rm(fakeAgentCliDir, { recursive: true, force: true });
    await rm(fakeRegistryDir, { recursive: true, force: true });
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalRegistryPath === undefined) {
      delete process.env.ANDROPERATOR_SKILLS_REGISTRY;
    } else {
      process.env.ANDROPERATOR_SKILLS_REGISTRY = originalRegistryPath;
    }
  });

  it("treats missing APK as a critical failure and skips the handshake", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), fakeRegistryDir);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService().run({ config });

    assert.strictEqual(report.criticalOk, false);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.deviceId, "test-device-1");

    const apkPresence = report.checks.find(check => check.id === "readiness.apk.presence");
    assert.ok(apkPresence);
    assert.strictEqual(apkPresence.status, "fail");
    assert.strictEqual(apkPresence.code, ERROR_CODES.OPERATOR_NOT_INSTALLED);

    assert.ok(!report.checks.some(check => check.id === "readiness.handshake"));
    assert.deepStrictEqual(report.nextActions, [
      "If you do not already have a matching local debug APK at ~/.androperator/downloads/operator-debug.apk, rebuild the debug app from the same checkout before rerunning setup.",
      "androperator operator setup --apk ~/.androperator/downloads/operator-debug.apk --device test-device-1 --operator-package com.androperator.operator.dev",
    ]);
  });

  it("fails when the installed APK is version-incompatible and skips the handshake", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), fakeRegistryDir);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({
      code: 0,
      stdout: "    versionCode=200000 minSdk=21 targetSdk=35\n    versionName=0.1.4-d\n",
      stderr: "",
    });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService().run({ config });

    assert.strictEqual(report.criticalOk, false);
    assert.strictEqual(report.ok, false);

    const versionCheck = report.checks.find(check => check.id === "readiness.version.compatibility");
    assert.ok(versionCheck);
    assert.strictEqual(versionCheck.status, "fail");
    assert.strictEqual(versionCheck.code, ERROR_CODES.VERSION_INCOMPATIBLE);
    assert.ok(!report.checks.some(check => check.id === "readiness.handshake"));
  });

  it("still reports the orchestrated agent CLI advisory when adb server startup fails", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), fakeRegistryDir);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 1, stdout: "", stderr: "cannot start adb server" });

    const report = await new DoctorService().run({ config });

    const defaultAgentCliCheck = report.checks.find(check => check.id === "host.skill-agent-cli.default");
    assert.ok(defaultAgentCliCheck);
    assert.strictEqual(defaultAgentCliCheck.status, "pass");

    const installedAgentCliCheck = report.checks.find(check => check.id === "host.skill-agent-cli.skills");
    assert.ok(installedAgentCliCheck);
    assert.strictEqual(installedAgentCliCheck.status, "pass");

    const adbServer = report.checks.find(check => check.id === "host.adb.server");
    assert.ok(adbServer);
    assert.strictEqual(adbServer.status, "fail");
    assert.strictEqual(adbServer.code, ERROR_CODES.ADB_SERVER_FAILED);
  });

  it("fails clearly when the installed APK version cannot be read", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), fakeRegistryDir);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Package [com.androperator.operator.dev]\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService().run({ config });

    assert.strictEqual(report.criticalOk, false);
    const versionCheck = report.checks.find(check => check.id === "readiness.version.compatibility");
    assert.ok(versionCheck);
    assert.strictEqual(versionCheck.status, "fail");
    assert.strictEqual(versionCheck.code, ERROR_CODES.APK_VERSION_UNREADABLE);
    assert.strictEqual(versionCheck.summary, "Could not verify CLI and installed APK version compatibility.");
    assert.ok(!report.checks.some(check => check.id === "readiness.handshake"));
  });

  it("fails readiness when multiple devices are connected and no --device is given", async () => {
    // A required warning must stop before any device-specific command and
    // remain distinguishable from a verified target in both readiness fields.
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner }), fakeRegistryDir);

    // checkAdbPresence: isAdbAvailable → adb version
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    // checkAdbPresence: runAdb version (evidence)
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    // checkAdbServer: adb start-server
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // checkDeviceDiscovery: adb devices (two devices → warn)
    runner.queueResult({ code: 0, stdout: "List of devices attached\nserial1\tdevice\nserial2\tdevice\n", stderr: "" });

    const report = await new DoctorService().run({ config });

    assert.strictEqual(report.criticalOk, false);
    assert.strictEqual(report.ok, false);
    assert.ok(report.skippedChecks?.some(check => check.id === "readiness.handshake" && check.blockedBy.includes("device.discovery")));

    // Discovery check must be present as a warn
    const discovery = report.checks.find(c => c.id === "device.discovery");
    assert.ok(discovery);
    assert.strictEqual(discovery.status, "warn");
    assert.strictEqual(discovery.code, ERROR_CODES.MULTIPLE_DEVICES_DEVICE_ID_REQUIRED);

    // No device-specific checks should have run
    assert.ok(!report.checks.some(c => c.id === "device.capability"), "device.capability should not run");
    assert.ok(!report.checks.some(c => c.id === "readiness.apk.presence"), "readiness.apk.presence should not run");
    assert.ok(!report.checks.some(c => c.id === "readiness.handshake"), "readiness.handshake should not run");

    // deviceId must remain unresolved
    assert.strictEqual(report.deviceId, undefined);
  });

  it("fails when the release package is requested but only debug is installed", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator" }), fakeRegistryDir);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService().run({ config });

    assert.strictEqual(report.criticalOk, false);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.operatorPackage, "com.androperator.operator");
    assert.ok(report.skippedChecks?.some(check => check.id === "readiness.handshake" && check.blockedBy.includes("readiness.apk.presence")));
    const apkPresence = report.checks.find(check => check.id === "readiness.apk.presence");
    assert.ok(apkPresence);
    assert.strictEqual(apkPresence.status, "fail");
    assert.strictEqual(apkPresence.code, ERROR_CODES.OPERATOR_VARIANT_MISMATCH);
    assert.ok(!report.checks.some(check => check.id === "readiness.version.compatibility"));
    assert.ok(!report.checks.some(check => check.id === "readiness.handshake"));
  });

  it("treats package query failures as critical and skips the handshake", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), fakeRegistryDir);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 1, stdout: "", stderr: "cmd: Can't find service: package" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService().run({ config });

    assert.strictEqual(report.criticalOk, false);
    assert.strictEqual(report.ok, false);

    const apkPresence = report.checks.find(check => check.id === "readiness.apk.presence");
    assert.ok(apkPresence);
    assert.strictEqual(apkPresence.status, "fail");
    assert.strictEqual(apkPresence.code, ERROR_CODES.DEVICE_SHELL_UNAVAILABLE);
    assert.ok(!report.checks.some(check => check.id === "readiness.handshake"));
  });

  it("lists the shell download step before the setup command", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator" }), fakeRegistryDir);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService().run({ config });

    const apkPresence = report.checks.find(check => check.id === "readiness.apk.presence");
    assert.ok(apkPresence);
    assert.deepStrictEqual(apkPresence.fix?.steps.map(step => step.value), [
      "androperator operator download",
      "androperator operator setup --apk ~/.androperator/downloads/operator.apk --device test-device-1",
    ]);
  });

  it("runs operator download before operator setup during doctor autofix", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator" }), fakeRegistryDir);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    runner.queueResult({ code: 1, stdout: "", stderr: "adb unavailable after remediation" });
    const report = await new DoctorService().run({ config, fix: true });
    assert.strictEqual(report.ok, false);
    assert.ok(report.checks.some(check => check.id === "host.adb.presence" && check.status === "fail"));

    const shellCalls = runner.calls.filter(call => call.command === "bash").map(call => call.args[1]);
    assert.deepStrictEqual(shellCalls, [
      "androperator operator download",
      "androperator operator setup --apk ~/.androperator/downloads/operator.apk --device test-device-1",
    ]);
  });

  it("marks non-interactive devices critical and skips smoke", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), fakeRegistryDir);
    let smokeCalled = false;

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: 'openjdk version "21.0.1"', stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({
      code: 0,
      stdout: `    versionCode=606060 minSdk=21 targetSdk=35\n    versionName=${getCliVersion()}-d\n`,
      stderr: "",
    });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService({
      runHandshake: async () => ({
        id: "readiness.handshake",
        status: "pass",
        summary: "Handshake successful.",
      }),
      checkDeviceInteractiveState: async () => ({
        id: "readiness.device.interactive",
        status: "fail",
        code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
        summary: "Device is not interactive.",
        evidence: {
          deviceLocked: true,
          screenOn: false,
          userUnlocked: false,
        },
      }),
      runSmokeTest: async () => {
        smokeCalled = true;
        return {
          id: "readiness.smoke",
          status: "pass",
          summary: "Smoke test successful.",
        };
      },
    }).run({ config, full: true });

    assert.strictEqual(report.criticalOk, false);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(smokeCalled, false);

    const interactiveCheck = report.checks.find(check => check.id === "readiness.device.interactive");
    assert.ok(interactiveCheck);
    assert.strictEqual(interactiveCheck.status, "fail");
    assert.strictEqual(interactiveCheck.code, ERROR_CODES.DEVICE_NOT_INTERACTIVE);
    assert.deepStrictEqual(interactiveCheck.evidence, {
      deviceLocked: true,
      screenOn: false,
      userUnlocked: false,
    });
    assert.ok(!report.checks.some(check => check.id === "readiness.smoke"));
  });

  it("reuses handshake interactive evidence instead of re-probing device state", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), fakeRegistryDir);
    let interactiveCheckCalls = 0;

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({
      code: 0,
      stdout: `    versionCode=606060 minSdk=21 targetSdk=35\n    versionName=${getCliVersion()}-d\n`,
      stderr: "",
    });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService({
      runHandshake: async () => ({
        id: "readiness.handshake",
        status: "pass",
        summary: "Handshake successful.",
        evidence: {
          screenOn: true,
          deviceLocked: false,
          userUnlocked: true,
        },
      }),
      checkDeviceInteractiveState: async () => {
        interactiveCheckCalls += 1;
        return {
          id: "readiness.device.interactive",
          status: "fail",
          code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
          summary: "Should not run",
        };
      },
    }).run({ config });

    assert.strictEqual(interactiveCheckCalls, 0);
    const interactiveCheck = report.checks.find(check => check.id === "readiness.device.interactive");
    assert.ok(interactiveCheck);
    assert.strictEqual(interactiveCheck?.status, "pass");
    assert.deepStrictEqual(interactiveCheck?.evidence, {
      screenOn: true,
      deviceLocked: false,
      userUnlocked: true,
    });
  });

  it("falls back to the dedicated interactive check when handshake evidence is unavailable", async () => {
    const runner = new FakeProcessRunner();
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), fakeRegistryDir);
    let interactiveCheckCalls = 0;

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({
      code: 0,
      stdout: `    versionCode=606060 minSdk=21 targetSdk=35\n    versionName=${getCliVersion()}-d\n`,
      stderr: "",
    });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService({
      runHandshake: async () => ({
        id: "readiness.handshake",
        status: "pass",
        summary: "Handshake successful.",
        evidence: undefined,
      }),
      checkDeviceInteractiveState: async () => {
        interactiveCheckCalls += 1;
        return {
          id: "readiness.device.interactive",
          status: "fail",
          code: ERROR_CODES.RESULT_ENVELOPE_MALFORMED,
          summary: "Could not verify whether the device is interactive.",
          detail: "doctor_ping returned an invalid boolean for screen_on: missing",
        };
      },
    }).run({ config });

    assert.strictEqual(interactiveCheckCalls, 1);
    const interactiveCheck = report.checks.find(check => check.id === "readiness.device.interactive");
    assert.ok(interactiveCheck);
    assert.strictEqual(interactiveCheck?.status, "fail");
    assert.strictEqual(interactiveCheck?.code, ERROR_CODES.RESULT_ENVELOPE_MALFORMED);
  });
});

describe("DoctorService logging", () => {
  let tempRoot: string;
  let fakeAgentCliDir: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "androperator-doctor-log-"));
    originalPath = process.env.PATH;
    fakeAgentCliDir = await mkdtemp(join(tmpdir(), "androperator-doctor-log-agent-cli-"));
    const fakeAgentPath = join(fakeAgentCliDir, "codex");
    await writeFile(fakeAgentPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(fakeAgentPath, 0o755);
    process.env.PATH = `${fakeAgentCliDir}${delimiter}${originalPath ?? ""}`;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(fakeAgentCliDir, { recursive: true, force: true });
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });

  it("logs one doctor.check entry per check", async () => {
    const runner = new FakeProcessRunner();
    const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "info" });
    const config = withTempBundledSkillsDir(getDefaultRuntimeConfig({ runner, operatorPackage: "com.androperator.operator.dev" }), tempRoot);

    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Android Debug Bridge version 1.0.41", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "33\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical size: 1080x2400\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Physical density: 420\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const report = await new DoctorService().run({ config, logger });

    assert.strictEqual(report.ok, false);
    const contents = await readFile(logger.logPath()!, "utf8");
    const lines = contents.trimEnd().split("\n").map(line => JSON.parse(line) as { event: string; message?: string });
    assert.ok(lines.some(line => line.event === "doctor.check"));
    assert.ok(lines.some(line => line.message?.includes("readiness.apk.presence")));
  });
});

import { EventEmitter } from "node:events";
import { runBackgroundObservationDoctor } from "../../../domain/doctor/backgroundObservation.js";
it("background diagnostics use only host checks and service reads, preserving denied access", async () => {
  for (const denied of [false, true]) {
    const runner = new FakeProcessRunner();
    let stream: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    runner.spawn = ((command, args) => {
      runner.calls.push({ command, args });
      stream = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
      return stream;
    }) as FakeProcessRunner["spawn"];
    runner.run = async (command, args) => {
      runner.calls.push({ command, args });
      const text = args.join(" ");
      let stdout = "";
      if (args.includes("version")) stdout = "Android Debug Bridge version 1.0.41";
      else if (args.includes("start-server")) stdout = "";
      else if (args.includes("devices")) stdout = "List of devices attached\ntest-device\tdevice\n";
      else if (text.includes("pm list packages")) stdout = "package:com.test.operator";
      else if (text.includes("dumpsys package")) stdout = `versionName=${getCliVersion()}\nversionCode=1`;
      else if (args.includes("get-current-user")) stdout = "0";
      else if (args.includes("get-started-user-state")) stdout = "RUNNING_UNLOCKED";
      else if (text.includes("am broadcast")) {
        const execution = JSON.parse(text.match(/\{.*\}/)![0]);
        const type = execution.actions[0].type;
        assert.ok(["list_notifications", "list_media_sessions"].includes(type));
        const payload = { schemaVersion: 1, observedElapsedMs: 100, deviceState: { screenOn: false, deviceLocked: true, userUnlocked: true }, total: 0, truncated: false, [type === "list_notifications" ? "notifications" : "sessions"]: [] };
        const envelope = { commandId: execution.commandId, taskId: execution.taskId, status: denied ? "failed" : "success", error: denied ? "denied" : null,
          stepResults: [{ id: "a1", actionType: type, success: !denied, data: denied ? { errorCode: "NOTIFICATION_ACCESS_DENIED", error: "denied" } : { payload: JSON.stringify(payload) } }] };
        setTimeout(() => stream.stdout.emit("data", Buffer.from(`[Androperator-Result] ${JSON.stringify(envelope)}\n`)), 5);
        stdout = "Broadcast completed: result=0";
      } else throw new Error(`Forbidden diagnostic command: ${text}`);
      return { code: 0, stdout, stderr: "" };
    };
    const report = await runBackgroundObservationDoctor(getDefaultRuntimeConfig({ runner, deviceId: "test-device", operatorPackage: "com.test.operator" }));
    assert.equal(report.ok, !denied, JSON.stringify(report));
    if (denied) assert.equal(report.checks.at(-1)?.code, "NOTIFICATION_ACCESS_DENIED");
    else assert.deepEqual(report.checks.at(-1)?.evidence, { screenOn: false, deviceLocked: true, userUnlocked: true });
    assert.equal(runner.calls.some(call => /WAKEUP|KEYCODE_HOME|doctor_ping|logcat -c|settings put|uiautomator|am start/.test(call.args.join(" "))), false);
  }
});
