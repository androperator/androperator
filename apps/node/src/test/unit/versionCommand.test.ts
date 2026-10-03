import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { cmdVersion } from "../../cli/commands/version.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { getCliVersion, probeVersionCompatibility } from "../../domain/version/compatibility.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";
import { ERROR_CODES } from "../../contracts/errors.js";

function mockApkVersionForCurrentCli(): { versionName: string; versionCode: number } {
  return { versionName: `${getCliVersion()}-d`, versionCode: 100 };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("cmdVersion", () => {
  it("returns the CLI version without touching adb", async () => {
    const output = await cmdVersion({ format: "json" });
    const parsed = JSON.parse(output);

    assert.match(parsed.cliVersion, /^\d+\.\d+\.\d+/);
  });

  it("reports compatibility details for an installed compatible APK", async () => {
    const runner = new FakeProcessRunner();
    const { versionName, versionCode } = mockApkVersionForCurrentCli();

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator\n", stderr: "" });
    runner.queueResult({
      code: 0,
      stdout: `    versionCode=${versionCode} minSdk=21 targetSdk=35\n    versionName=${versionName}\n`,
      stderr: "",
    });

    const output = await cmdVersion({
      format: "json",
      checkCompat: true,
      operatorPackage: "com.androperator.operator",
      runner,
    });
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.compatible, true);
    assert.strictEqual(parsed.operatorPackage, "com.androperator.operator");
    assert.strictEqual(parsed.apkVersion, versionName);
    assert.strictEqual(parsed.apkVersionCode, versionCode);
  });

  it("returns a non-compatible payload when the APK is missing", async () => {
    const runner = new FakeProcessRunner();
    const version = getCliVersion();
    const operatorPackage = "com.androperator.operator.dev";

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const output = await cmdVersion({
      format: "json",
      checkCompat: true,
      operatorPackage,
      runner,
    });
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.compatible, false);
    assert.strictEqual(parsed.error.code, ERROR_CODES.OPERATOR_NOT_INSTALLED);
    assert.deepStrictEqual(parsed.remediation, [
      `Download the matching APK: https://downloads.androperator.com/operator/v${version}/operator-v${version}.apk`,
      `Download the checksum: https://downloads.androperator.com/operator/v${version}/operator-v${version}.apk.sha256`,
      `Verify the checksum: sha256sum -c operator-v${version}.apk.sha256`,
      `Install the matching APK: androperator operator setup --apk operator-v${version}.apk --device <device_id> --operator-package ${operatorPackage}`,
      "If you are targeting the local debug package, rebuild and reinstall the debug APK from the same source checkout instead of using the release download.",
    ]);
  });

  it("reports a variant mismatch when the alternate receiver package is installed", async () => {
    const runner = new FakeProcessRunner();

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator\n", stderr: "" });

    const output = await cmdVersion({
      format: "json",
      checkCompat: true,
      operatorPackage: "com.androperator.operator.dev",
      runner,
    });
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.compatible, false);
    assert.strictEqual(parsed.error.code, ERROR_CODES.OPERATOR_VARIANT_MISMATCH);
    assert.match(parsed.error.message, /Expected com\.androperator\.operator\.dev/);
  });

  it("treats the debug APK as an alternate variant when the release package is requested", async () => {
    const runner = new FakeProcessRunner();

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });

    const output = await cmdVersion({
      format: "json",
      checkCompat: true,
      operatorPackage: "com.androperator.operator",
      runner,
    });
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.compatible, false);
    assert.strictEqual(parsed.error.code, ERROR_CODES.OPERATOR_VARIANT_MISMATCH);
    assert.match(parsed.error.message, /Expected com\.androperator\.operator but found installed variant com\.androperator\.operator\.dev/);
  });

  it("sets a non-zero exit code when device resolution fails", async () => {
    const runner = new FakeProcessRunner();

    runner.queueResult({ code: 0, stdout: "List of devices attached\n", stderr: "" });

    const output = await cmdVersion({
      format: "json",
      checkCompat: true,
      operatorPackage: "com.androperator.operator.dev",
      runner,
    });
    const parsed = JSON.parse(output);

    assert.strictEqual(parsed.code, ERROR_CODES.NO_DEVICES);
    assert.strictEqual(process.exitCode, 1);
  });
});

describe("probeVersionCompatibility", () => {
  it("returns variant mismatch when only the alternate receiver package is installed", async () => {
    const runner = new FakeProcessRunner();
    const config = getDefaultRuntimeConfig({
      runner,
      deviceId: "test-device-1",
      operatorPackage: "com.androperator.operator.dev",
    });

    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator\n", stderr: "" });

    const result = await probeVersionCompatibility(config);

    assert.strictEqual(result.compatible, false);
    assert.strictEqual(result.error?.code, ERROR_CODES.OPERATOR_VARIANT_MISMATCH);
    assert.ok(result.remediation?.includes("Use --operator-package com.androperator.operator"));
  });

  it("returns invalid when the installed APK version is malformed", async () => {
    const runner = new FakeProcessRunner();
    const config = getDefaultRuntimeConfig({
      runner,
      deviceId: "test-device-1",
      operatorPackage: "com.androperator.operator",
    });

    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator\n", stderr: "" });
    runner.queueResult({
      code: 0,
      stdout: "    versionCode=104900 minSdk=21 targetSdk=35\n    versionName=build-main\n",
      stderr: "",
    });

    const result = await probeVersionCompatibility(config);

    assert.strictEqual(result.compatible, false);
    assert.strictEqual(result.error?.code, ERROR_CODES.APK_VERSION_INVALID);
  });

  it("returns variant mismatch when only the debug APK matches a release package substring", async () => {
    const runner = new FakeProcessRunner();
    const config = getDefaultRuntimeConfig({
      runner,
      deviceId: "test-device-1",
      operatorPackage: "com.androperator.operator",
    });

    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.androperator.operator.dev\n", stderr: "" });

    const result = await probeVersionCompatibility(config);

    assert.strictEqual(result.compatible, false);
    assert.strictEqual(result.error?.code, ERROR_CODES.OPERATOR_VARIANT_MISMATCH);
    assert.ok(result.remediation?.includes("Use --operator-package com.androperator.operator.dev"));
  });

  it("returns a shell error when package queries fail", async () => {
    const runner = new FakeProcessRunner();
    const config = getDefaultRuntimeConfig({
      runner,
      deviceId: "test-device-1",
      operatorPackage: "com.androperator.operator",
    });

    runner.queueResult({ code: 1, stdout: "", stderr: "cmd: Can't find service: package", error: new Error("shell failed") });

    const result = await probeVersionCompatibility(config);

    assert.strictEqual(result.compatible, false);
    assert.strictEqual(result.error?.code, ERROR_CODES.DEVICE_SHELL_UNAVAILABLE);
    assert.match(result.error?.message ?? "", /Could not query installed packages/);
    assert.deepStrictEqual(result.remediation, [
      "Verify adb shell access with: adb shell pm list packages",
      "Reconnect the device or restart adb if shell commands are failing",
    ]);
  });
});
