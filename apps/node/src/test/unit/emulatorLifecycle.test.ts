import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import {
  createAvd,
  deleteAvd,
  enableEmulatorDeveloperSettings,
  ensureSystemImageInstalled,
  normalizeEmulatorDataPartitionSize,
  startAvd,
  stopAvd,
  waitForBootCompletion,
  waitForEmulatorRegistration,
} from "../../domain/android-emulators/lifecycle.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

async function writeAvdAtRoot(avdRoot: string, name: string, configIni: string): Promise<void> {
  await mkdir(join(avdRoot, `${name}.avd`), { recursive: true });
  await writeFile(join(avdRoot, `${name}.avd`, "config.ini"), configIni, "utf8");
  await writeFile(join(avdRoot, `${name}.ini`), "target=android-35\n", "utf8");
}

async function writeAvd(homeDir: string, name: string, configIni: string): Promise<void> {
  await writeAvdAtRoot(join(homeDir, ".android", "avd"), name, configIni);
}

function restoreOptionalEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("emulator lifecycle", () => {
  const originalHome = process.env.HOME;
  const originalAndroidHome = process.env.ANDROID_HOME;
  const originalAndroidSdkRoot = process.env.ANDROID_SDK_ROOT;
  const originalAndroidAvdHome = process.env.ANDROID_AVD_HOME;
  let testHome: string;

  beforeEach(async () => {
    testHome = await mkdtemp(join(tmpdir(), "androperator-emulator-lifecycle-test-"));
    process.env.HOME = testHome;
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;
    delete process.env.ANDROID_AVD_HOME;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    restoreOptionalEnv("ANDROID_HOME", originalAndroidHome);
    restoreOptionalEnv("ANDROID_SDK_ROOT", originalAndroidSdkRoot);
    restoreOptionalEnv("ANDROID_AVD_HOME", originalAndroidAvdHome);
  });

  it("installs a missing system image after accepting licenses", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "Installed packages:\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "licenses accepted", stderr: "" });
    runner.queueResult({ code: 0, stdout: "installed", stderr: "" });

    const config = getDefaultRuntimeConfig({ runner });
    await ensureSystemImageInstalled(config, "system-images;android-35;google_apis_playstore;arm64-v8a");

    assert.strictEqual(runner.calls[0].command, config.sdkmanagerPath);
    assert.deepStrictEqual(runner.calls[0].args, ["--list_installed"]);
    assert.strictEqual(runner.calls[1].command, config.sdkmanagerPath);
    assert.deepStrictEqual(runner.calls[1].args, ["--licenses"]);
    assert.strictEqual(runner.calls[2].command, config.sdkmanagerPath);
    assert.deepStrictEqual(runner.calls[2].args, ["system-images;android-35;google_apis_playstore;arm64-v8a"]);
  });

  it("creates an AVD with a deterministic avdmanager command", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({
      code: 0,
      stdout: "system-images;android-35;google_apis_playstore;arm64-v8a\n",
      stderr: "",
    });
    runner.queueResult(
      { code: 0, stdout: "created", stderr: "" },
      () => writeAvd(
        testHome,
        "androperator-pixel",
        [
          "PlayStore.enabled=true",
          "disk.dataPartition.size=6G",
        ].join("\n")
      )
    );

    const config = getDefaultRuntimeConfig({ runner });
    await createAvd(config, { name: "androperator-pixel" });

    assert.strictEqual(runner.calls[1].command, config.avdmanagerPath);
    assert.deepStrictEqual(runner.calls[1].args, [
      "create", "avd", "--force", "--name", "androperator-pixel",
      "--package", "system-images;android-35;google_apis_playstore;arm64-v8a",
      "--device", "pixel_7",
    ]);
    const configIni = await readFile(join(testHome, ".android", "avd", "androperator-pixel.avd", "config.ini"), "utf8");
    assert.match(configIni, /^disk\.dataPartition\.size=12G$/m);
  });

  it("creates an AVD with a caller-provided gigabyte data partition size", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({
      code: 0,
      stdout: "system-images;android-35;google_apis_playstore;arm64-v8a\n",
      stderr: "",
    });
    runner.queueResult(
      { code: 0, stdout: "created", stderr: "" },
      () => writeAvd(
        testHome,
        "androperator-pixel",
        [
          "PlayStore.enabled=true",
          "disk.dataPartition.size=6G",
        ].join("\n")
      )
    );

    const config = getDefaultRuntimeConfig({ runner });
    await createAvd(config, { name: "androperator-pixel", dataPartitionSize: "16GB" });

    const configIni = await readFile(join(testHome, ".android", "avd", "androperator-pixel.avd", "config.ini"), "utf8");
    assert.match(configIni, /^disk\.dataPartition\.size=16G$/m);
  });

  it("normalizes gigabyte data partition size values and rejects other units", () => {
    assert.strictEqual(normalizeEmulatorDataPartitionSize("16GB"), "16G");
    assert.strictEqual(normalizeEmulatorDataPartitionSize("16g"), "16G");
    assert.strictEqual(normalizeEmulatorDataPartitionSize("16gb"), "16G");
    assert.throws(
      () => normalizeEmulatorDataPartitionSize("16384M"),
      (error: unknown) => {
        const typed = error as { code?: string; details?: { expectedFormat?: string } };
        assert.strictEqual(typed.code, ERROR_CODES.ANDROID_AVD_CREATE_FAILED);
        assert.strictEqual(typed.details?.expectedFormat, "<positive_integer>G|GB");
        return true;
      }
    );
    assert.throws(
      () => normalizeEmulatorDataPartitionSize("0G"),
      (error: unknown) => {
        const typed = error as { code?: string };
        assert.strictEqual(typed.code, ERROR_CODES.ANDROID_AVD_CREATE_FAILED);
        return true;
      }
    );
  });

  it("sizes created AVDs under ANDROID_AVD_HOME when it is set", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({
      code: 0,
      stdout: "system-images;android-35;google_apis_playstore;arm64-v8a\n",
      stderr: "",
    });

    const avdRoot = join(testHome, "custom-avd-home");
    process.env.ANDROID_AVD_HOME = ` ${avdRoot} `;
    runner.queueResult(
      { code: 0, stdout: "created", stderr: "" },
      () => writeAvdAtRoot(
        avdRoot,
        "androperator-pixel",
        [
          "PlayStore.enabled=true",
          "disk.dataPartition.size=6G",
        ].join("\n")
      )
    );

    const config = getDefaultRuntimeConfig({ runner });
    await createAvd(config, { name: "androperator-pixel" });

    const configIni = await readFile(join(avdRoot, "androperator-pixel.avd", "config.ini"), "utf8");
    assert.match(configIni, /^disk\.dataPartition\.size=12G$/m);
  });

  it("wraps data partition config write failures in the AVD create contract", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({
      code: 0,
      stdout: "system-images;android-35;google_apis_playstore;arm64-v8a\n",
      stderr: "",
    });
    runner.queueResult(
      { code: 0, stdout: "created", stderr: "" },
      async () => {
        await writeAvd(
          testHome,
          "androperator-pixel",
          [
            "PlayStore.enabled=true",
            "disk.dataPartition.size=6G",
          ].join("\n")
        );
        const configPath = join(testHome, ".android", "avd", "androperator-pixel.avd", "config.ini");
        await chmod(configPath, 0o444);
      }
    );
    runner.queueResult({ code: 0, stdout: "deleted", stderr: "" });

    const configPath = join(testHome, ".android", "avd", "androperator-pixel.avd", "config.ini");

    const config = getDefaultRuntimeConfig({ runner });
    await assert.rejects(
      () => createAvd(config, { name: "androperator-pixel" }),
      (error: unknown) => {
        const typed = error as { code: string; details?: { path?: string } };
        assert.strictEqual(typed.code, ERROR_CODES.ANDROID_AVD_CREATE_FAILED);
        assert.strictEqual(typed.details?.path, configPath);
        return true;
      }
    );
    assert.deepStrictEqual(runner.calls[2].args, ["delete", "avd", "--name", "androperator-pixel"]);
  });

  it("does not delete a preexisting AVD when data partition config write fails", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({
      code: 0,
      stdout: "system-images;android-35;google_apis_playstore;arm64-v8a\n",
      stderr: "",
    });
    runner.queueResult({ code: 0, stdout: "created", stderr: "" });

    await writeAvd(
      testHome,
      "androperator-pixel",
      [
        "PlayStore.enabled=true",
        "disk.dataPartition.size=6G",
      ].join("\n")
    );
    const configPath = join(testHome, ".android", "avd", "androperator-pixel.avd", "config.ini");
    await chmod(configPath, 0o444);

    const config = getDefaultRuntimeConfig({ runner });
    await assert.rejects(
      () => createAvd(config, { name: "androperator-pixel" }),
      (error: unknown) => {
        const typed = error as { code: string; details?: { path?: string } };
        assert.strictEqual(typed.code, ERROR_CODES.ANDROID_AVD_CREATE_FAILED);
        assert.strictEqual(typed.details?.path, configPath);
        return true;
      }
    );
    assert.strictEqual(runner.calls.length, 2);
  });

  it("starts an AVD detached with fully ignored stdio", () => {
    const runner = new FakeProcessRunner();
    const config = getDefaultRuntimeConfig({ runner });

    startAvd(config, "androperator-pixel");

    assert.strictEqual(runner.calls[0].command, config.emulatorPath);
    assert.deepStrictEqual(runner.calls[0].args, ["@androperator-pixel", "-no-snapshot-load", "-no-boot-anim"]);
    assert.deepStrictEqual(runner.calls[0].options, {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
    });
  });

  it("waits for emulator registration by polling adb devices and emulator console naming", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "List of devices attached\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "0\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "0\n", stderr: "" });

    const config = getDefaultRuntimeConfig({ runner });
    const serial = await waitForEmulatorRegistration(config, "androperator-pixel", 2_500);
    assert.strictEqual(serial, "emulator-5554");
  });

  it("times out when boot completion never reaches both properties", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "0\n", stderr: "" });

    const config = getDefaultRuntimeConfig({ runner });
    await assert.rejects(
      () => waitForBootCompletion(config, "emulator-5554", 5),
      (error: unknown) => {
        const typed = error as { code: string };
        assert.strictEqual(typed.code, ERROR_CODES.EMULATOR_BOOT_TIMEOUT);
        return true;
      }
    );
  });

  it("stops and deletes by AVD name", async () => {
    await writeAvd(
      testHome,
      "androperator-pixel",
      [
        "PlayStore.enabled=true",
        "abi.type=arm64-v8a",
        "image.sysdir.1=system-images/android-35/google_apis_playstore/arm64-v8a/",
        "hw.device.name=pixel_7",
      ].join("\n")
    );

    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const config = getDefaultRuntimeConfig({ runner });
    await stopAvd(config, "androperator-pixel");
    assert.deepStrictEqual(runner.calls[4].args, ["-s", "emulator-5554", "emu", "kill"]);

    const deleteRunner = new FakeProcessRunner();
    deleteRunner.queueResult({ code: 0, stdout: "List of devices attached\n", stderr: "" });
    deleteRunner.queueResult({ code: 0, stdout: "", stderr: "" });
    const deleteConfig = getDefaultRuntimeConfig({ runner: deleteRunner });
    await deleteAvd(deleteConfig, "androperator-pixel");
    assert.deepStrictEqual(deleteRunner.calls[1].args, ["delete", "avd", "--name", "androperator-pixel"]);
  });

  it("enables developer settings and adb on a booted emulator", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const config = getDefaultRuntimeConfig({ runner });
    await enableEmulatorDeveloperSettings(config, "emulator-5554");

    assert.deepStrictEqual(runner.calls[0].args, [
      "-s", "emulator-5554", "shell", "settings", "put", "global", "development_settings_enabled", "1",
    ]);
    assert.deepStrictEqual(runner.calls[1].args, [
      "-s", "emulator-5554", "shell", "settings", "put", "global", "adb_enabled", "1",
    ]);
  });
});
