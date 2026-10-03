import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupOperator } from "../../domain/device/setupOperator.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

const TEST_APK_PATH = join(tmpdir(), "androperator-test-operator.apk");

function makeConfig(runner: FakeProcessRunner) {
  return getDefaultRuntimeConfig({
    runner,
    deviceId: "test-device",
  });
}

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
});
