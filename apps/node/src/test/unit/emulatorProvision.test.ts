import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { provisionEmulator } from "../../domain/android-emulators/provision.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

async function writeAvd(homeDir: string, name: string, configIni: string): Promise<void> {
  const avdRoot = join(homeDir, ".android", "avd");
  await mkdir(join(avdRoot, `${name}.avd`), { recursive: true });
  await writeFile(join(avdRoot, `${name}.avd`, "config.ini"), configIni, "utf8");
  await writeFile(join(avdRoot, `${name}.ini`), "target=android-35\n", "utf8");
}

// Queue 4 successful tool availability checks (adb, emulator, sdkmanager, avdmanager)
function queueToolChecks(runner: FakeProcessRunner) {
  runner.queueResult({ code: 0, stdout: "usage", stderr: "" });
  runner.queueResult({ code: 0, stdout: "usage", stderr: "" });
  runner.queueResult({ code: 0, stdout: "usage", stderr: "" });
  runner.queueResult({ code: 0, stdout: "usage", stderr: "" });
}

describe("emulator provisioning", () => {
  const originalHome = process.env.HOME;
  let testHome: string;

  beforeEach(async () => {
    testHome = await mkdtemp(join(tmpdir(), "androperator-emulator-provision-test-"));
    process.env.HOME = testHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("reuses a running supported emulator immediately", async () => {
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
    queueToolChecks(runner);
    runner.queueResult({ code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" }); // sys.boot_completed
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" }); // dev.bootcomplete
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // development_settings_enabled
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // adb_enabled

    const config = getDefaultRuntimeConfig({ runner });
    const result = await provisionEmulator(config);

    assert.deepStrictEqual(result, {
      type: "emulator",
      avdName: "androperator-pixel",
      serial: "emulator-5554",
      booted: true,
      created: false,
      started: false,
      reused: true,
    });
  });

  it("waits for boot completion when reusing an unbooted running emulator", async () => {
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
    queueToolChecks(runner);
    // listRunningEmulators: device found but not yet booted
    runner.queueResult({ code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "0\n", stderr: "" }); // sys.boot_completed = 0
    runner.queueResult({ code: 0, stdout: "0\n", stderr: "" }); // dev.bootcomplete = 0
    // waitForBootCompletion polling: both props now 1
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" }); // sys.boot_completed
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" }); // dev.bootcomplete
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // development_settings_enabled
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // adb_enabled

    const config = getDefaultRuntimeConfig({ runner });
    const result = await provisionEmulator(config);

    assert.strictEqual(result.avdName, "androperator-pixel");
    assert.strictEqual(result.serial, "emulator-5554");
    assert.strictEqual(result.booted, true);
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.started, false);
    assert.strictEqual(result.created, false);
  });

  it("starts a supported configured AVD when none are running", async () => {
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
    queueToolChecks(runner);
    runner.queueResult({ code: 0, stdout: "List of devices attached\n", stderr: "" }); // no running emulators
    runner.queueResult({ code: 0, stdout: "androperator-pixel\n", stderr: "" }); // emulator -list-avds
    // waitForEmulatorRegistration: first poll finds no device, second finds it
    runner.queueResult({ code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "0\n", stderr: "" }); // not booted yet (registration poll)
    runner.queueResult({ code: 0, stdout: "0\n", stderr: "" });
    // waitForBootCompletion
    runner.queueResult({ code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" }); // sys.boot_completed
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" }); // dev.bootcomplete
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // development_settings_enabled
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // adb_enabled

    const config = getDefaultRuntimeConfig({ runner });
    const result = await provisionEmulator(config);

    assert.strictEqual(result.avdName, "androperator-pixel");
    assert.strictEqual(result.serial, "emulator-5554");
    assert.strictEqual(result.created, false);
    assert.strictEqual(result.started, true);
    assert.strictEqual(result.reused, true);
  });

  it("creates a new supported AVD when none exist", async () => {
    const runner = new FakeProcessRunner();
    queueToolChecks(runner);
    runner.queueResult({ code: 0, stdout: "List of devices attached\n", stderr: "" }); // no running emulators
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // emulator -list-avds: empty
    runner.queueResult({ code: 0, stdout: "Installed packages:\n", stderr: "" }); // sdkmanager --list_installed
    runner.queueResult({ code: 0, stdout: "licenses accepted", stderr: "" }); // sdkmanager --licenses
    runner.queueResult({ code: 0, stdout: "installed", stderr: "" }); // sdkmanager <image>
    runner.queueResult(
      { code: 0, stdout: "created", stderr: "" },
      () => writeAvd(
        testHome,
        "androperator-pixel-20gb",
        [
          "PlayStore.enabled=true",
          "abi.type=arm64-v8a",
          "disk.dataPartition.size=6G",
          "image.sysdir.1=system-images/android-35/google_apis_playstore/arm64-v8a/",
          "hw.device.name=pixel_7",
        ].join("\n")
      )
    ); // avdmanager create avd
    // waitForEmulatorRegistration
    runner.queueResult({ code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel-20gb\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" }); // sys.boot_completed
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" }); // dev.bootcomplete
    // waitForBootCompletion
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // development_settings_enabled
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // adb_enabled

    const config = getDefaultRuntimeConfig({ runner });
    const result = await provisionEmulator(config, { dataPartitionSize: "20GB" });

    assert.strictEqual(result.created, true);
    assert.strictEqual(result.started, true);
    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.avdName, "androperator-pixel-20gb");
    assert.deepStrictEqual(runner.calls[9].args, [
      "create", "avd", "--force", "--name", "androperator-pixel-20gb",
      "--package", "system-images;android-35;google_apis_playstore;arm64-v8a",
      "--device", "pixel_7",
    ]);
    const configIni = await readFile(join(testHome, ".android", "avd", "androperator-pixel-20gb.avd", "config.ini"), "utf8");
    assert.match(configIni, /^disk\.dataPartition\.size=20G$/m);
  });

  it("refuses to auto-provision an existing unsupported default AVD", async () => {
    await writeAvd(
      testHome,
      "androperator-pixel-12gb",
      [
        "PlayStore.enabled=false",
        "abi.type=x86_64",
        "image.sysdir.1=system-images/android-34/google_apis/x86_64/",
        "hw.device.name=pixel_9",
      ].join("\n")
    );

    const runner = new FakeProcessRunner();
    queueToolChecks(runner);
    runner.queueResult({ code: 0, stdout: "List of devices attached\n", stderr: "" }); // no running emulators
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // emulator -list-avds: empty

    const config = getDefaultRuntimeConfig({ runner });
    await assert.rejects(
      () => provisionEmulator(config),
      (error: unknown) => {
        const typed = error as { code: string };
        assert.strictEqual(typed.code, ERROR_CODES.EMULATOR_UNSUPPORTED);
        return true;
      }
    );
  });

  it("throws ANDROID_SDK_TOOL_MISSING when a required SDK tool is unavailable", async () => {
    const runner = new FakeProcessRunner();
    // checkRequiredEmulatorTools checks all 4 tools unconditionally
    runner.queueResult({ code: 0, stdout: "usage", stderr: "" }); // adb ok
    runner.queueResult({ code: 127, stdout: "", stderr: "", error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) }); // emulator missing
    runner.queueResult({ code: 0, stdout: "usage", stderr: "" }); // sdkmanager ok
    runner.queueResult({ code: 0, stdout: "usage", stderr: "" }); // avdmanager ok

    const config = getDefaultRuntimeConfig({ runner });
    await assert.rejects(
      () => provisionEmulator(config),
      (error: unknown) => {
        const typed = error as { code: string };
        assert.strictEqual(typed.code, ERROR_CODES.ANDROID_SDK_TOOL_MISSING);
        return true;
      }
    );
  });
});
