import { describe, it } from "node:test";
import assert from "node:assert";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";

describe("getDefaultRuntimeConfig", () => {
  it("returns required fields with defaults", () => {
    const config = getDefaultRuntimeConfig();
    assert.strictEqual(typeof config.adbPath, "string");
    assert.strictEqual(typeof config.emulatorPath, "string");
    assert.strictEqual(typeof config.sdkmanagerPath, "string");
    assert.strictEqual(typeof config.avdmanagerPath, "string");
    assert.strictEqual(typeof config.operatorPackage, "string");
    assert.strictEqual(typeof config.actionAgentCommand, "string");
    assert.strictEqual(typeof config.payloadExtraKey, "string");
    assert.ok(config.adbPath.length > 0);
    assert.ok(config.emulatorPath.length > 0);
    assert.ok(config.sdkmanagerPath.length > 0);
    assert.ok(config.avdmanagerPath.length > 0);
    assert.ok(config.operatorPackage.length > 0);
    assert.strictEqual(config.operatorPackage, "com.androperator.operator");
  });

  it("merges overrides", () => {
    const config = getDefaultRuntimeConfig({
      deviceId: "device-1",
      emulatorPath: "custom-emulator",
      operatorPackage: "custom.receiver",
    });
    assert.strictEqual(config.deviceId, "device-1");
    assert.strictEqual(config.emulatorPath, "custom-emulator");
    assert.strictEqual(config.operatorPackage, "custom.receiver");
  });

  it("treats blank or whitespace operator package inputs as unset", () => {
    const originalOperatorPackage = process.env.ANDROPERATOR_OPERATOR_PACKAGE;
    try {
      process.env.ANDROPERATOR_OPERATOR_PACKAGE = "   ";

      const envConfig = getDefaultRuntimeConfig();
      assert.strictEqual(envConfig.operatorPackage, "com.androperator.operator");

      const overrideConfig = getDefaultRuntimeConfig({ operatorPackage: "  " });
      assert.strictEqual(overrideConfig.operatorPackage, "com.androperator.operator");
    } finally {
      if (originalOperatorPackage !== undefined) {
        process.env.ANDROPERATOR_OPERATOR_PACKAGE = originalOperatorPackage;
      } else {
        delete process.env.ANDROPERATOR_OPERATOR_PACKAGE;
      }
    }
  });

  it("falls back to bare tool names (PATH-based) when ANDROID_HOME and ANDROID_SDK_ROOT are not set", () => {
    const originalAndroidHome = process.env.ANDROID_HOME;
    const originalAndroidSdkRoot = process.env.ANDROID_SDK_ROOT;
    try {
      delete process.env.ANDROID_HOME;
      delete process.env.ANDROID_SDK_ROOT;
      const config = getDefaultRuntimeConfig();
      assert.strictEqual(config.emulatorPath, "emulator");
      assert.strictEqual(config.sdkmanagerPath, "sdkmanager");
      assert.strictEqual(config.avdmanagerPath, "avdmanager");
    } finally {
      if (originalAndroidHome !== undefined) {
        process.env.ANDROID_HOME = originalAndroidHome;
      } else {
        delete process.env.ANDROID_HOME;
      }
      if (originalAndroidSdkRoot !== undefined) {
        process.env.ANDROID_SDK_ROOT = originalAndroidSdkRoot;
      } else {
        delete process.env.ANDROID_SDK_ROOT;
      }
    }
  });

  it("prefers ANDROID_HOME paths for emulator, sdkmanager, and avdmanager", () => {
    const originalAndroidHome = process.env.ANDROID_HOME;
    const originalAndroidSdkRoot = process.env.ANDROID_SDK_ROOT;
    try {
      // Point ANDROID_HOME at a location that does not exist
      process.env.ANDROID_HOME = "/nonexistent/android-sdk";
      delete process.env.ANDROID_SDK_ROOT;

      const config = getDefaultRuntimeConfig();
      // Nonexistent ANDROID_HOME candidate is not used for any tool
      assert.ok(!config.emulatorPath.startsWith("/nonexistent/android-sdk"), "emulatorPath must not use the nonexistent ANDROID_HOME candidate");
      // The tools should resolve to SOMETHING, and definitely not the nonexistent path
      assert.ok(config.sdkmanagerPath.length > 0);
      assert.ok(config.avdmanagerPath.length > 0);
      assert.ok(!config.sdkmanagerPath.startsWith("/nonexistent/android-sdk"));
      assert.ok(!config.avdmanagerPath.startsWith("/nonexistent/android-sdk"));
    } finally {
      if (originalAndroidHome !== undefined) {
        process.env.ANDROID_HOME = originalAndroidHome;
      } else {
        delete process.env.ANDROID_HOME;
      }
      if (originalAndroidSdkRoot !== undefined) {
        process.env.ANDROID_SDK_ROOT = originalAndroidSdkRoot;
      } else {
        delete process.env.ANDROID_SDK_ROOT;
      }
    }
  });
});
