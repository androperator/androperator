import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DoctorService } from "../../../domain/doctor/DoctorService.js";
import { getDefaultRuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import { FakeProcessRunner } from "../fakes/FakeProcessRunner.js";
import { getCliVersion } from "../../../domain/version/compatibility.js";
import type { DoctorCheckResult } from "../../../contracts/doctor.js";
import { cmdDoctor } from "../../../cli/commands/doctor.js";

class ReadinessRunner extends FakeProcessRunner {
  installed = true;
  version = `${getCliVersion()}-d`;
  devices = "test-device\tdevice\n";
  failCommand?: string;
  repairSucceeds = true;
  async run(command: string, args: string[]) {
    this.calls.push({ command, args });
    if (["scrcpy", "ffmpeg", "ffprobe"].includes(command)) return { code: 127, stdout: "", stderr: "not installed" };
    const action = args.join(" ");
    if (command === "bash") {
      if (this.repairSucceeds) this.installed = true;
      return { code: this.repairSucceeds ? 0 : 1, stdout: "", stderr: "" };
    }
    if (this.failCommand !== undefined && action.includes(this.failCommand)) {
      return { code: 1, stdout: "", stderr: "injected failure" };
    }
    let stdout = "";
    if (command === "java") stdout = 'openjdk version "21.0.1"';
    else if (command === "./gradlew") stdout = "BUILD SUCCESSFUL";
    else if (action.endsWith("version")) stdout = "Android Debug Bridge version 1.0.41";
    else if (action.endsWith("start-server")) stdout = "";
    else if (action.endsWith("devices")) stdout = `List of devices attached\n${this.devices}`;
    else if (action.includes("shell getprop ro.build.version.sdk")) stdout = "35";
    else if (action.includes("shell wm size")) stdout = "Physical size: 1080x2400";
    else if (action.includes("shell wm density")) stdout = "Physical density: 420";
    else if (action.includes("shell pm list packages")) stdout = this.installed ? "package:com.androperator.operator.dev\n" : "";
    else if (action.includes("shell dumpsys package")) stdout = `versionCode=100000\nversionName=${this.version}\n`;
    else if (action.includes("shell settings get")) stdout = "1";
    else if (action.includes("shell am start")) stdout = "Starting activity";
    else throw new Error(`Unexpected fixture command: ${command} ${action}`);
    return { code: 0, stdout, stderr: "" };
  }
}

describe("selected Operator readiness policy", () => {
  let root: string;
  let savedEnvironment: NodeJS.ProcessEnv;
  beforeEach(async () => {
    savedEnvironment = { ...process.env };
    root = await mkdtemp(join(tmpdir(), "doctor-readiness-policy-"));
    const registry = join(root, "registry.json");
    await writeFile(registry, JSON.stringify({ schemaVersion: "1.0", skills: [] }));
    await mkdir(join(root, "empty-path"));
    process.env.PATH = join(root, "empty-path");
    process.env.ANDROPERATOR_SKILLS_REGISTRY = registry;
    process.env.ANDROPERATOR_LOG_DIR = join(root, "logs");
  });
  afterEach(async () => {
    process.env = savedEnvironment;
    process.exitCode = undefined;
    await rm(root, { recursive: true, force: true });
  });

  function setup(handshakeResult?: DoctorCheckResult, logWarning = false) {
    const runner = new ReadinessRunner();
    const config = Object.assign(getDefaultRuntimeConfig({ runner, deviceId: "test-device", operatorPackage: "com.androperator.operator.dev" }), {
      bundledSkillsDir: join(root, "no-bundled-skills"),
    });
    let handshakes = 0;
    const service = new DoctorService({
      runHandshake: async () => {
        handshakes++;
        return handshakeResult ?? {
          id: "readiness.handshake", status: "pass", summary: "Verified handshake",
          evidence: { screenOn: true, deviceLocked: false, userUnlocked: true },
        };
      },
      runSmokeTest: async () => ({ id: "readiness.smoke", status: "pass", summary: "Smoke passed" }),
      ...(logWarning ? { checkLogDestination: async (): Promise<DoctorCheckResult> => ({
        id: "host.logs.writable", status: "warn", code: "LOG_DIRECTORY_UNWRITABLE", summary: "Injected log failure",
      }) } : {}),
    });
    return { runner, config, service, handshakes: () => handshakes };
  }

  for (const full of [false, true]) {
    it(`passes ${full ? "full" : "normal"} readiness despite missing optional agent tooling and unwritable logs`, async () => {
      const { service, config, handshakes } = setup(undefined, true);
      const report = await service.run({ config, full });
      assert.equal(report.ok, true);
      assert.equal(report.criticalOk, true);
      assert.deepEqual(report.skippedChecks, []);
      assert.equal(handshakes(), 1);
      assert.ok(report.checks.some(check => check.id === "host.video.dependencies" && check.status === "warn"));
      assert.ok(report.checks.some(check => check.id === "host.skill-agent-cli.default" && check.status === "warn"));
      assert.equal(report.checks.some(check => check.id === "readiness.smoke"), full);
    });
  }

  for (const status of ["fail", "warn"] as const) {
    it(`fails when handshake reports ${status} and never runs interactive or smoke checks`, async () => {
      const { service, config } = setup({ id: "readiness.handshake", status, code: "RESULT_ENVELOPE_TIMEOUT", summary: "Unverified" });
      const report = await service.run({ config, full: true });
      assert.equal(report.ok, false);
      assert.equal(report.criticalOk, false);
      for (const id of ["readiness.device.interactive", "readiness.smoke"]) {
        assert.ok(report.skippedChecks?.some(check => check.id === id && check.blockedBy.includes("readiness.handshake")));
      }
    });
  }

  it("fails a locked device and records the skipped full-mode smoke test", async () => {
    const { service, config } = setup({ id: "readiness.handshake", status: "pass", summary: "Reachable",
      evidence: { screenOn: true, deviceLocked: true, userUnlocked: true } });
    const report = await service.run({ config, full: true });
    assert.equal(report.ok, false);
    assert.ok(report.checks.some(check => check.code === "DEVICE_NOT_INTERACTIVE"));
    assert.deepEqual(report.skippedChecks?.map(check => check.id), ["readiness.smoke"]);
  });

  for (const phase of [":app:assembleDebug", ":app:installDebug", "shell am start"]) {
    it(`requires full-mode completion when ${phase} fails`, async () => {
      const { service, config, runner, handshakes } = setup();
      runner.failCommand = phase;
      const report = await service.run({ config, full: true });
      assert.equal(report.ok, false);
      assert.equal(report.criticalOk, false);
      assert.equal(handshakes(), 0);
      assert.ok(report.skippedChecks?.some(check => check.id === "readiness.handshake"));
      assert.ok(report.skippedChecks?.some(check => check.id === "readiness.smoke"));
    });
  }

  it("fails missing devices and preserves skipped prerequisite evidence in CLI output", async () => {
    const { service, config, runner, handshakes } = setup();
    runner.devices = "";
    const report = await service.run({ config });
    assert.equal(report.ok, false);
    assert.equal(handshakes(), 0);
    assert.ok(report.skippedChecks?.some(check => check.id === "readiness.handshake" && check.blockedBy.includes("device.discovery")));
    for (const format of ["json", "pretty"] as const) {
      const output = await cmdDoctor({ format, checkOnly: true }, { doctorService: { run: async () => report } });
      assert.equal(process.exitCode, 1);
      if (format === "json") assert.deepEqual(JSON.parse(output).skippedChecks, report.skippedChecks);
      else assert.match(output, /\[SKIP\] `readiness.handshake`/);
    }
  });

  for (const repairSucceeds of [false, true]) {
    it(`reruns prerequisites and handshake after ${repairSucceeds ? "successful" : "failed"} remediation`, async () => {
      const { service, config, runner, handshakes } = setup();
      runner.installed = false;
      runner.repairSucceeds = repairSucceeds;
      const report = await service.run({ config, fix: true });
      assert.equal(report.ok, repairSucceeds);
      assert.equal(report.criticalOk, repairSucceeds);
      assert.equal(handshakes(), repairSucceeds ? 1 : 0);
      assert.equal(runner.calls.filter(call => call.args.includes("devices") || call.args.includes("devices -l")).length, 2);
      assert.equal(runner.calls.filter(call => call.command === "bash").length, 1);
      assert.equal(report.operatorPackage, config.operatorPackage);
      if (!repairSucceeds) assert.ok(report.nextActions?.some(action => action.includes("operator setup")));
    });
  }
});
