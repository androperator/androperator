import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { emulatorBackend } from "../../adapters/android-emulator/index.js";
import type { ConfiguredAvdDetails, CreateAvdOptions } from "../../adapters/android-emulator/contracts.js";
import { getDefaultRuntimeConfig, type RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { createAvd, ensureSystemImageInstalled, startAvd } from "../../domain/android-emulators/lifecycle.js";
import { listConfiguredAvds } from "../../domain/android-emulators/configuredAvds.js";
import { listRunningEmulators } from "../../domain/android-emulators/runningEmulators.js";
import { provisionEmulator } from "../../domain/android-emulators/provision.js";
import { cmdEmulatorStart } from "../../cli/commands/emulator.js";
import { startServer } from "../../cli/commands/serve.js";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

const avd: ConfiguredAvdDetails = {
  name: "test-avd", exists: true, running: false, apiLevel: 35, abi: "arm64-v8a",
  playStore: true, deviceProfile: "pixel_7", systemImage: "system-images;android-35;google_apis_playstore;arm64-v8a",
};
const launchError = { code: "EMULATOR_START_FAILED", message: "backend launch rejected" };

test("consumer supplies defaults and explicit replacement/license policy without dropping blank overrides", async (t) => {
  const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
  const calls: CreateAvdOptions[] = [];
  t.mock.method(emulatorBackend, "createAvd", async (received: RuntimeConfig, options: CreateAvdOptions) => {
    assert.equal(received, config);
    calls.push(options);
  });
  await createAvd(config, { name: "test-avd" });
  assert.deepEqual(calls[0], {
    name: "test-avd", systemImage: avd.systemImage, deviceProfile: "pixel_7",
    dataPartitionSize: "12G", replace: true, acceptLicenses: true,
  });
  await createAvd(config, { name: "test-avd", systemImage: "", deviceProfile: "custom", dataPartitionSize: "4G" });
  assert.deepEqual(calls[1], { ...calls[0], systemImage: "", deviceProfile: "custom", dataPartitionSize: "4G" });
  const install = t.mock.method(emulatorBackend, "ensureSystemImageInstalled", async () => {});
  await ensureSystemImageInstalled(config);
  assert.deepEqual(install.mock.calls[0].arguments, [config, avd.systemImage, { acceptLicenses: true }]);
});

test("consumer adds compatibility to raw configured and running backend facts", async (t) => {
  const config = getDefaultRuntimeConfig({ runner: new FakeProcessRunner() });
  const unsupported = { ...avd, apiLevel: 36 };
  t.mock.method(emulatorBackend, "listConfiguredAvds", async () => [unsupported]);
  t.mock.method(emulatorBackend, "inspectConfiguredAvd", async () => unsupported);
  t.mock.method(emulatorBackend, "listRunningEmulators", async () => [
    { type: "emulator", avdName: avd.name, serial: "emulator-5554", booted: true },
  ]);
  const configured = await listConfiguredAvds(config);
  assert.equal(configured[0].supported, false);
  assert.deepEqual(configured[0].unsupportedReasons, ["unsupported_api_level"]);
  assert.deepEqual(await listRunningEmulators(config), [{
    type: "emulator", avdName: avd.name, serial: "emulator-5554", booted: true,
    supported: false, unsupportedReasons: ["unsupported_api_level"],
  }]);
});

test("legacy launch waits for spawn and translates asynchronous spawn errors", async () => {
  const runner = new FakeProcessRunner();
  const child = Object.assign(new EventEmitter(), { unref() {} });
  runner.spawn = () => child;
  const config = getDefaultRuntimeConfig({ runner });
  let finished = false;
  const started = startAvd(config, avd.name).then(() => { finished = true; });
  await setImmediate();
  assert.equal(finished, false);
  child.emit("spawn");
  await started;
  const failed = startAvd(config, avd.name);
  child.emit("error", new Error("missing executable"));
  await assert.rejects(failed, { code: "EMULATOR_START_FAILED", message: "missing executable" });
});

test("CLI awaits backend launch before readiness and preserves its error", async (t) => {
  t.mock.method(emulatorBackend, "inspectConfiguredAvd", async () => avd);
  t.mock.method(emulatorBackend, "listRunningEmulators", async () => []);
  let rejectLaunch!: (error: unknown) => void;
  t.mock.method(emulatorBackend, "startAvd", () => new Promise<void>((_resolve, reject) => { rejectLaunch = reject; }));
  const wait = t.mock.method(emulatorBackend, "waitForEmulatorRegistration", async () => "emulator-5554");
  const result = cmdEmulatorStart(avd.name, { format: "json" });
  await setImmediate();
  assert.equal(wait.mock.callCount(), 0);
  rejectLaunch(launchError);
  assert.deepEqual(JSON.parse(await result), launchError);
  assert.equal(wait.mock.callCount(), 0);
});

for (const existing of [true, false]) {
  test(`provision awaits backend launch for ${existing ? "existing" : "new"} AVDs`, async (t) => {
    t.mock.method(emulatorBackend, "assertRequiredEmulatorTools", async () => {});
    t.mock.method(emulatorBackend, "listRunningEmulators", async () => []);
    t.mock.method(emulatorBackend, "listConfiguredAvds", async () => existing ? [avd] : []);
    t.mock.method(emulatorBackend, "inspectConfiguredAvd", async () => ({ ...avd, exists: false }));
    const create = t.mock.method(emulatorBackend, "createAvd", async () => {});
    t.mock.method(emulatorBackend, "startAvd", async () => { await setImmediate(); throw launchError; });
    const wait = t.mock.method(emulatorBackend, "waitForEmulatorRegistration", async () => "emulator-5554");
    await assert.rejects(provisionEmulator(getDefaultRuntimeConfig({ runner: new FakeProcessRunner() })), launchError);
    assert.equal(create.mock.callCount(), existing ? 0 : 1);
    assert.equal(wait.mock.callCount(), 0);
  });
}

test("HTTP awaits backend launch failure and continues serving requests", async (t) => {
  t.mock.method(emulatorBackend, "inspectConfiguredAvd", async () => avd);
  t.mock.method(emulatorBackend, "listRunningEmulators", async () => []);
  t.mock.method(emulatorBackend, "startAvd", async () => { await setImmediate(); throw launchError; });
  const wait = t.mock.method(emulatorBackend, "waitForEmulatorRegistration", async () => "emulator-5554");
  let server: Server | undefined;
  try {
    server = await startServer({ host: "127.0.0.1", port: 0, verbose: false });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/android/emulators/${avd.name}/start`, { method: "POST", signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 500);
    const body = await response.json() as { ok: boolean; error: unknown };
    assert.equal(body.ok, false);
    assert.deepEqual(body.error, launchError);
    assert.equal(wait.mock.callCount(), 0);
    assert.equal((await fetch(`${base}/ping`)).status, 200);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
  }
});
