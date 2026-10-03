import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { getRunningEmulatorAvdName, isEmulatorBooted, listRunningEmulators, resolveRunningEmulatorByName } from "../../domain/android-emulators/runningEmulators.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

async function writeAvd(homeDir: string, name: string, configIni: string): Promise<void> {
  const avdRoot = join(homeDir, ".android", "avd");
  await mkdir(join(avdRoot, `${name}.avd`), { recursive: true });
  await writeFile(join(avdRoot, `${name}.avd`, "config.ini"), configIni, "utf8");
  await writeFile(join(avdRoot, `${name}.ini`), "target=android-35\n", "utf8");
}

describe("running emulator discovery", () => {
  const originalHome = process.env.HOME;
  let testHome: string;

  beforeEach(async () => {
    testHome = await mkdtemp(join(tmpdir(), "androperator-running-emulator-test-"));
    process.env.HOME = testHome;
    await writeAvd(
      testHome,
      "androperator-pixel",
      [
        "PlayStore.enabled=true",
        "abi.type=arm64-v8a",
        "image.sysdir.1=system-images/android-35/google_apis_playstore/arm64-v8a/",
        "hw.device.name=pixel_7",
        "target=android-35",
      ].join("\n")
    );
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("parses emulator console avd name output", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    const config = getDefaultRuntimeConfig({ runner });

    const avdName = await getRunningEmulatorAvdName(config, "emulator-5554");
    assert.strictEqual(avdName, "androperator-pixel");
  });

  it("requires both boot properties to report booted state", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    const config = getDefaultRuntimeConfig({ runner });

    assert.strictEqual(await isEmulatorBooted(config, "emulator-5554"), true);

    const runner2 = new FakeProcessRunner();
    runner2.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner2.queueResult({ code: 0, stdout: "0\n", stderr: "" });
    const config2 = getDefaultRuntimeConfig({ runner: runner2 });

    assert.strictEqual(await isEmulatorBooted(config2, "emulator-5554"), false);
  });

  it("lists running emulators with normalized support metadata", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({
      code: 0,
      stdout: "List of devices attached\nemulator-5554\tdevice\nphysical-1\tdevice\n",
      stderr: "",
    });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const config = getDefaultRuntimeConfig({ runner });
    const emulators = await listRunningEmulators(config);

    assert.deepStrictEqual(emulators, [
      {
        type: "emulator",
        avdName: "androperator-pixel",
        serial: "emulator-5554",
        booted: true,
        supported: true,
        unsupportedReasons: [],
      },
    ]);
  });

  it("resolves a running emulator by AVD name", async () => {
    const runner = new FakeProcessRunner();
    runner.queueResult({
      code: 0,
      stdout: "List of devices attached\nemulator-5554\tdevice\n",
      stderr: "",
    });
    runner.queueResult({ code: 0, stdout: "OK\nandroperator-pixel\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "1\n", stderr: "" });

    const config = getDefaultRuntimeConfig({ runner });
    const emulator = await resolveRunningEmulatorByName(config, "androperator-pixel");
    assert.ok(emulator);
    assert.strictEqual(emulator?.serial, "emulator-5554");
  });
});
