import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { inspectConfiguredAvd, listConfiguredAvds } from "../../domain/android-emulators/configuredAvds.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

async function writeAvd(homeDir: string, name: string, configIni: string, rootIni = ""): Promise<void> {
  const avdRoot = join(homeDir, ".android", "avd");
  await mkdir(join(avdRoot, `${name}.avd`), { recursive: true });
  await writeFile(join(avdRoot, `${name}.avd`, "config.ini"), configIni, "utf8");
  await writeFile(join(avdRoot, `${name}.ini`), rootIni || "target=android-35\n", "utf8");
}

describe("configured AVD discovery", () => {
  const originalHome = process.env.HOME;
  let testHome: string;

  beforeEach(async () => {
    testHome = await mkdtemp(join(tmpdir(), "androperator-avd-test-"));
    process.env.HOME = testHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("inspects a supported configured AVD", async () => {
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

    const avd = await inspectConfiguredAvd("androperator-pixel");
    assert.deepStrictEqual(avd, {
      name: "androperator-pixel",
      exists: true,
      running: false,
      apiLevel: 35,
      abi: "arm64-v8a",
      playStore: true,
      deviceProfile: "pixel_7",
      systemImage: "system-images;android-35;google_apis_playstore;arm64-v8a",
      supported: true,
      unsupportedReasons: [],
    });
  });

  it("marks unsupported configured AVDs with explicit reasons", async () => {
    await writeAvd(
      testHome,
      "Pixel_9",
      [
        "PlayStore.enabled=true",
        "abi.type=arm64-v8a",
        "image.sysdir.1=system-images/android-36/google_apis_playstore_ps16k/arm64-v8a/",
        "hw.device.name=pixel_9",
        "target=android-36",
      ].join("\n")
    );

    const avd = await inspectConfiguredAvd("Pixel_9");
    assert.strictEqual(avd.supported, false);
    assert.deepStrictEqual(avd.unsupportedReasons, [
      "unsupported_api_level",
      "unsupported_device_profile",
    ]);
  });

  it("lists configured AVDs from emulator -list-avds and preserves running state", async () => {
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

    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "androperator-pixel\n", stderr: "" });
    const config = getDefaultRuntimeConfig({ runner });

    const avds = await listConfiguredAvds(config, new Set(["androperator-pixel"]));
    assert.strictEqual(avds.length, 1);
    assert.strictEqual(avds[0].name, "androperator-pixel");
    assert.strictEqual(avds[0].running, true);
    assert.strictEqual(runner.calls[0].command, config.emulatorPath);
    assert.deepStrictEqual(runner.calls[0].args, ["-list-avds"]);
  });

  it("recognizes Google Play AVDs when PlayStore.enabled is no but the system image is playstore", async () => {
    await writeAvd(
      testHome,
      "androperator-pixel",
      [
        "PlayStore.enabled=no",
        "abi.type=arm64-v8a",
        "image.sysdir.1=system-images/android-35/google_apis_playstore/arm64-v8a/",
        "tag.id=google_apis_playstore",
        "hw.device.name=pixel_7",
        "target=android-35",
      ].join("\n")
    );

    const avd = await inspectConfiguredAvd("androperator-pixel");
    assert.strictEqual(avd.playStore, true);
    assert.strictEqual(avd.supported, true);
    assert.deepStrictEqual(avd.unsupportedReasons, []);
  });
});
