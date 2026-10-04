import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packageEmulatorBackend as backend } from "../../adapters/android-emulator/packageBackend.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { createAndroperatorLogger } from "../../adapters/logger.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

const success = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const image = "system-images;android-35;google_apis_playstore;arm64-v8a";

test("package ADB bridge clears ambient serial for discovery and logs each selected emulator", async () => {
  const runner = new FakeProcessRunner();
  runner.queueResult(success("List of devices attached\nemulator-5554\tdevice\n"));
  runner.queueResult(success("test-avd\nOK\n"));
  runner.queueResult(success("1\n"));
  runner.queueResult(success("1\n"));
  const events: string[] = [];
  const logger = createAndroperatorLogger({ logLevel: "debug", fileLogging: false });
  logger.emit = (event) => { events.push(`${event.event}:${event.deviceId ?? ""}`); };
  const config = getDefaultRuntimeConfig({ runner, deviceId: "unrelated-device", logger, adbPath: "custom-adb" });
  assert.deepEqual(await backend.listRunningEmulators(config), [{ type: "emulator", avdName: "test-avd", serial: "emulator-5554", booted: true }]);
  assert.deepEqual(runner.calls.map((call) => call.args), [
    ["devices"], ["-s", "emulator-5554", "emu", "avd", "name"],
    ["-s", "emulator-5554", "shell", "getprop", "sys.boot_completed"],
    ["-s", "emulator-5554", "shell", "getprop", "dev.bootcomplete"],
  ]);
  assert.ok(runner.calls.every((call) => call.command === "custom-adb"));
  assert.equal(events.filter((event) => event === "adb.command:").length, 1);
  assert.equal(events.filter((event) => event === "adb.command:emulator-5554").length, 3);
});

test("package refuses inconclusive discovery and preserves error codes", async () => {
  const runner = new FakeProcessRunner();
  runner.queueResult({ code: 1, stdout: "", stderr: "adb unavailable" });
  const config = getDefaultRuntimeConfig({ runner });
  await assert.rejects(backend.deleteAvd(config, "test-avd"), { code: "ADB_QUERY_FAILED" });
  assert.equal(runner.calls.length, 1);
  runner.queueResult(success("List of devices attached\nemulator-5554\toffline\n"));
  await assert.rejects(backend.deleteAvd(config, "test-avd"), { code: "EMULATOR_ALREADY_RUNNING" });
  assert.equal(runner.calls.length, 2);
});

test("package verifies installed images and understands Android CLI shim output", async () => {
  const runner = new FakeProcessRunner();
  const config = getDefaultRuntimeConfig({ runner });
  runner.queueResult(success(`Installed packages:\n ${image.replaceAll(";", "/")} 9.0.0 Installed image`));
  await backend.ensureSystemImageInstalled(config, image, { acceptLicenses: true });
  assert.equal(runner.calls.length, 1);
  runner.queueResult(success());
  runner.queueResult(success("Skipping install"));
  runner.queueResult(success());
  await assert.rejects(backend.ensureSystemImageInstalled(config, image, { acceptLicenses: false }), { code: "ANDROID_SYSTEM_IMAGE_INSTALL_FAILED" });
});

test("package inspection follows locator paths while leaving compatibility to the consumer", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "emulator-package-locator-"));
  const previous = process.env.ANDROID_AVD_HOME;
  process.env.ANDROID_AVD_HOME = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.ANDROID_AVD_HOME; else process.env.ANDROID_AVD_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });
  const data = join(root, "redirected");
  await mkdir(data);
  await writeFile(join(root, "test-avd.ini"), `path=${data}\ntarget=android-35\n`);
  await writeFile(join(data, "config.ini"), "hw.device.name=pixel_7\n");
  const avd = await backend.inspectConfiguredAvd("test-avd");
  assert.equal(avd.deviceProfile, "pixel_7");
  assert.equal("supported" in avd, false);
});
