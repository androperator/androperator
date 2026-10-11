import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupOperator as realSetupOperator } from "../../domain/device/setupOperator.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

const TEST_APK_PATH = join(tmpdir(), "androperator-test-operator.apk");

function makeConfig(runner: FakeProcessRunner) {
  return getDefaultRuntimeConfig({
    runner,
    deviceId: "test-device",
  });
}

const ready = { ok: true as const, state: { screenOn: true, deviceLocked: false, userUnlocked: true } };
const setupOperator: typeof realSetupOperator = (config, apk, pkg, dependencies) =>
  realSetupOperator(config, apk, pkg, dependencies ?? { probe: async () => ready, wait: async () => {} });

describe("setupOperator - domain", () => {
  before(() => {
    // Create a dummy APK file so existsSync passes.
    writeFileSync(TEST_APK_PATH, "fake-apk-content");
  });

  after(() => {
    try { rmSync(TEST_APK_PATH); } catch { /* ignore */ }
  });

  it("fails fast when APK path does not exist", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    const result = await setupOperator(config, "/nonexistent/operator.apk");

    assert.strictEqual(result.install.ok, false);
    assert.match(result.install.error ?? "", /APK file not found/);
    assert.strictEqual(result.permissions, undefined);
    assert.strictEqual(result.verification, undefined);
  });

  it("returns install failure when adb install returns non-zero", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    // adb install fails
    runner.queueResult({ code: 1, stdout: "", stderr: "INSTALL_FAILED_ALREADY_EXISTS" });

    const result = await setupOperator(config, TEST_APK_PATH);

    assert.strictEqual(result.install.ok, false);
    assert.match(result.install.error ?? "", /INSTALL_FAILED_ALREADY_EXISTS/);
    assert.strictEqual(result.install.exitCode, 1);
    assert.strictEqual(result.permissions, undefined);
  });

  it("returns grant failure when receiver package is detected but accessibility grant fails", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    // adb install succeeds
    runner.queueResult({ code: 0, stdout: "Success", stderr: "" });
    // listInstalledOperatorPackages: release pkg found
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator", stderr: "" });
    // listInstalledOperatorPackages: debug pkg not found
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // grantAccessibilityPermission: settings get fails
    runner.queueResult({ code: 1, stdout: "", stderr: "settings: command failed" });
    // grantNotificationPermission: still called by grantDevicePermissions
    runner.queueResult({ code: 1, stdout: "", stderr: "Not a changeable permission type" });
    // grantNotificationListenerPermission: still called
    runner.queueResult({ code: 0, stdout: "null", stderr: "" });
    // cmd notification allow_listener
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // grantDevicePermissions completes without verification after permission failure
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await setupOperator(config, TEST_APK_PATH);

    assert.strictEqual(result.install.ok, true);
    assert.ok(result.permissions);
    assert.strictEqual(result.permissions?.accessibility.ok, false);
    assert.strictEqual(result.verification, undefined);
  });

  it("reports verification failure when auto-detect cannot find the installed package", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    runner.queueResult({ code: 0, stdout: "Success", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await setupOperator(config, TEST_APK_PATH);

    assert.strictEqual(result.install.ok, true);
    assert.strictEqual(result.permissions, undefined);
    assert.ok(result.verification);
    assert.strictEqual(result.verification?.ok, false);
    assert.strictEqual(result.verification?.packageInstalled, false);
    assert.match(result.verification?.error ?? "", /Could not detect installed Operator package after install/);
  });

  it("reports verification failure when both operator variants are installed", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    runner.queueResult({ code: 0, stdout: "Success", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev", stderr: "" });

    const result = await setupOperator(config, TEST_APK_PATH);

    assert.strictEqual(result.install.ok, true);
    assert.strictEqual(result.permissions, undefined);
    assert.ok(result.verification);
    assert.strictEqual(result.verification?.ok, false);
    assert.strictEqual(result.verification?.packageInstalled, false);
    assert.match(result.verification?.error ?? "", /Multiple Operator package variants are installed/);
  });

  it("does not mistake the debug package for the release package during auto-detect", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    runner.queueResult({ code: 0, stdout: "Success", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev", stderr: "" });
    runner.queueResult({ code: 0, stdout: "null", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 1, stdout: "", stderr: "Not a changeable permission type" });
    runner.queueResult({ code: 0, stdout: "null", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev", stderr: "" });

    const result = await setupOperator(config, TEST_APK_PATH);

    assert.strictEqual(result.operatorPackage, "com.androperator.operator.dev");
    assert.strictEqual(result.verification?.ok, true);
  });

  it("returns full success result when all phases pass", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    // adb install succeeds
    runner.queueResult({ code: 0, stdout: "Success", stderr: "" });
    // listInstalledOperatorPackages: release pkg found
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator", stderr: "" });
    // listInstalledOperatorPackages: debug pkg not found
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // grantAccessibilityPermission: read current (no existing)
    runner.queueResult({ code: 0, stdout: "null", stderr: "" });
    // set accessibility_enabled
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // set enabled_accessibility_services
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // grantNotificationPermission: already granted
    runner.queueResult({ code: 1, stdout: "", stderr: "Not a changeable permission type" });
    // grantNotificationListenerPermission: read current (no existing)
    runner.queueResult({ code: 0, stdout: "null", stderr: "" });
    // cmd notification allow_listener
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // verification: pm list packages
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator", stderr: "" });

    const result = await setupOperator(config, TEST_APK_PATH);

    assert.strictEqual(result.install.ok, true);
    assert.strictEqual(result.operatorPackage, "com.androperator.operator");
    assert.ok(result.permissions);
    assert.strictEqual(result.permissions?.accessibility.ok, true);
    assert.strictEqual(result.permissions?.notification.ok, true);
    assert.strictEqual(result.permissions?.notificationListener.ok, true);
    assert.ok(result.verification);
    assert.strictEqual(result.verification?.ok, true);
    assert.strictEqual(result.verification?.packageInstalled, true);
  });

  it("respects explicit --operator-package and skips auto-detect", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    // adb install succeeds
    runner.queueResult({ code: 0, stdout: "Success", stderr: "" });
    // grantAccessibilityPermission: read current (already enabled)
    runner.queueResult({ code: 0, stdout: "com.androperator.operator.dev/androperator.operator.accessibilityservice.OperatorAccessibilityService", stderr: "" });
    // grantNotificationPermission: already granted
    runner.queueResult({ code: 1, stdout: "", stderr: "Not a changeable permission type" });
    // grantNotificationListenerPermission: already enabled
    runner.queueResult({ code: 0, stdout: "com.androperator.operator.dev/action.notification.NotificationListenerService", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // verification: pm list packages
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev", stderr: "" });

    const result = await setupOperator(config, TEST_APK_PATH, "com.androperator.operator.dev");

    assert.strictEqual(result.operatorPackage, "com.androperator.operator.dev");
    assert.strictEqual(result.install.ok, true);
    assert.strictEqual(result.permissions?.accessibility.alreadyEnabled, true);
    assert.strictEqual(result.verification?.ok, true);

    // Explicit operator-package should avoid the release/debug auto-detect probes.
    const detectCalls = runner.calls.filter(c =>
      c.args.length >= 6 &&
      c.args[2] === "shell" &&
      c.args[3] === "pm" &&
      c.args[4] === "list" &&
      c.args[5] === "packages" &&
      c.args[6] === "com.androperator.operator"
    );
    assert.strictEqual(detectCalls.length, 0, "Should not probe the release package when operator-package is explicit");
  });

  it("fails verification gracefully when pm list does not find package", async () => {
    const runner = new FakeProcessRunner();
    const config = makeConfig(runner);

    // adb install succeeds
    runner.queueResult({ code: 0, stdout: "Success", stderr: "" });
    // listInstalledOperatorPackages: release pkg found
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator", stderr: "" });
    // listInstalledOperatorPackages: debug pkg not found
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // grantAccessibilityPermission: already enabled
    runner.queueResult({ code: 0, stdout: "com.androperator.operator/androperator.operator.accessibilityservice.OperatorAccessibilityService", stderr: "" });
    // grantNotificationPermission: skip (not changeable)
    runner.queueResult({ code: 1, stdout: "", stderr: "Not a changeable permission type" });
    // grantNotificationListenerPermission: already enabled
    runner.queueResult({ code: 0, stdout: "com.androperator.operator/action.notification.NotificationListenerService", stderr: "" });
    // cmd notification allow_listener
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    // verification: pm list returns nothing
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await setupOperator(config, TEST_APK_PATH);

    assert.strictEqual(result.install.ok, true);
    assert.ok(result.verification);
    assert.strictEqual(result.verification?.ok, false);
    assert.strictEqual(result.verification?.packageInstalled, false);
    assert.match(result.verification?.error ?? "", /not found after install/);
  });
  function queueInstalled(runner: FakeProcessRunner) {
    for (const stdout of ["Success", "com.androperator.operator/androperator.operator.accessibilityservice.OperatorAccessibilityService", "", "com.androperator.operator/action.notification.NotificationListenerService", "", "package:com.androperator.operator"]) {
      runner.queueResult({ code: 0, stdout, stderr: "" });
    }
  }

  function queueRepair(runner: FakeProcessRunner) {
    for (const stdout of ["other.app/other.Service", "", ""]) runner.queueResult({ code: 0, stdout, stderr: "" });
  }

  it("repairs a lost post-install accessibility grant and proves the selected service responds", async () => {
    const runner = new FakeProcessRunner(); queueInstalled(runner); queueRepair(runner);
    let probes = 0, waits = 0;
    const result = await setupOperator(makeConfig(runner), TEST_APK_PATH, "com.androperator.operator", {
      probe: async config => {
        assert.equal(config.operatorPackage, "com.androperator.operator");
        return ++probes === 1 ? { ok: false, code: "DEVICE_ACCESSIBILITY_NOT_RUNNING", message: "Service unavailable" } : ready;
      },
      wait: async () => { waits++; },
    });
    assert.equal(result.verification?.ok, true);
    assert.equal(result.verification?.readiness?.attempts.length, 2);
    assert.equal(result.verification?.readiness?.attempts[0].ok, false);
    assert.equal(result.verification?.error, undefined);
    assert.equal(waits, 1);
    assert.equal(result.permissions?.accessibility.alreadyEnabled, false);
    assert.equal(runner.calls.filter(c => c.args.includes("install")).length, 1);
    assert.ok(runner.calls.some(c => c.args.includes("other.app/other.Service:com.androperator.operator/androperator.operator.accessibilityservice.OperatorAccessibilityService")));
  });

  it("bounds unavailable-service recovery and never calls package presence ready", async () => {
    const runner = new FakeProcessRunner(); queueInstalled(runner); queueRepair(runner); queueRepair(runner);
    const result = await setupOperator(makeConfig(runner), TEST_APK_PATH, "com.androperator.operator", {
      probe: async () => ({ ok: false, code: "DEVICE_ACCESSIBILITY_NOT_RUNNING", message: "Service unavailable" }),
      wait: async () => {},
    });
    assert.equal(result.verification?.packageInstalled, true);
    assert.equal(result.verification?.ok, false);
    assert.equal(result.verification?.readiness?.attempts.length, 3);
    assert.match(result.verification?.error ?? "", /handshake failed/);
  });

  it("does not repair permissions after a transport failure", async () => {
    const runner = new FakeProcessRunner(); queueInstalled(runner);
    const result = await setupOperator(makeConfig(runner), TEST_APK_PATH, "com.androperator.operator", {
      probe: async () => ({ ok: false, code: "RESULT_ENVELOPE_TIMEOUT", message: "No correlated response" }),
      wait: async () => { assert.fail("No retry expected"); },
    });
    assert.equal(result.verification?.ok, false);
    assert.equal(result.verification?.readiness?.attempts.length, 1);
    assert.equal(runner.calls.length, 6);
  });

  it("preserves a permission repair failure", async () => {
    const runner = new FakeProcessRunner(); queueInstalled(runner);
    runner.queueResult({ code: 1, stdout: "", stderr: "Device disconnected" });
    const result = await setupOperator(makeConfig(runner), TEST_APK_PATH, "com.androperator.operator", {
      probe: async () => ({ ok: false, code: "DEVICE_ACCESSIBILITY_NOT_RUNNING", message: "Service unavailable" }),
      wait: async () => {},
    });
    assert.equal(result.permissions?.accessibility.ok, false);
    assert.equal(result.verification?.ok, false);
    assert.equal(result.verification?.readiness?.attempts.length, 1);
  });

  it("verifies a service on a locked phone without claiming interactive readiness", async () => {
    const runner = new FakeProcessRunner(); queueInstalled(runner);
    const result = await setupOperator(makeConfig(runner), TEST_APK_PATH, "com.androperator.operator", {
      probe: async () => ({ ok: true, state: { screenOn: false, deviceLocked: true, userUnlocked: true } }),
      wait: async () => { assert.fail("No retry expected"); },
    });
    assert.equal(result.verification?.ok, true);
    assert.equal(runner.calls.length, 6);
  });

});
