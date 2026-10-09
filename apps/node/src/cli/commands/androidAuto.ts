import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import { AndroidAutoClient, androidAutoSocketPath, startAndroidAutoBroker } from "../../domain/android-auto/broker.js";
import { autoError, DhuSession } from "../../domain/android-auto/session.js";

export interface AndroidAutoOptions {
  operation: "start" | "stop" | "status";
  deviceId: string;
  binary?: string;
  timeoutMs: number;
}

export async function cmdAndroidAuto(options: AndroidAutoOptions): Promise<string | undefined> {
  const path = androidAutoSocketPath(options.deviceId);
  if (options.operation !== "start") {
    const client = AndroidAutoClient.connect(path);
    try {
      return JSON.stringify(await client.request(options.deviceId, options.operation, options.timeoutMs));
    } catch (error) {
      throw autoError("ANDROID_AUTO_SESSION_UNAVAILABLE", `No accessible DHU session for this device: ${typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)}. Run android-auto start --device <device_serial>.`);
    } finally { client.close(); }
  }
  const deadline = Date.now() + options.timeoutMs;
  const remaining = () => {
    const timeout = deadline - Date.now();
    if (timeout < 1) throw autoError("COMMAND_TIMEOUT", "Android Auto startup timed out");
    return timeout;
  };
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), "Library", "Android", "sdk");
  const binary = options.binary === undefined ? join(sdk, "extras", "google", "auto", process.platform === "win32" ? "desktop-head-unit.exe" : "desktop-head-unit") : resolve(options.binary);
  if (!existsSync(binary)) throw autoError("ANDROID_AUTO_DHU_MISSING", "Install Android Auto Desktop Head Unit using Android SDK Manager, or supply --dhu-path <binary>.");
  const config = getDefaultRuntimeConfig({ deviceId: options.deviceId, adbPath: process.env.ADB_PATH });
  const state = await runAdb(config, ["get-state"], { timeoutMs: remaining() });
  if (state.code !== 0 || state.stdout.trim() !== "device") throw autoError("DEVICE_NOT_FOUND", "The selected phone is not connected and authorized through ADB");

  let session: DhuSession | undefined;
  let port: string | undefined;
  const controller = new AbortController();
  // Reserve the per-device socket before opening a projection connection. A second
  // start must not disrupt an existing DHU session.
  const broker = await startAndroidAutoBroker(options.deviceId, {
    isReady: () => session !== undefined,
    press: async (key, timeout, signal) => {
      if (!session) throw autoError("ANDROID_AUTO_NOT_READY", "DHU is not ready");
      await session.press(key, timeout, signal);
    },
    close: async () => { controller.abort(); await session?.close(); },
  }, path);
  const stop = () => { controller.abort(); void broker.close(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const forward = await runAdb(config, ["forward", "tcp:0", "tcp:5277"], { timeoutMs: remaining() });
    const value = forward.stdout.trim();
    if (forward.code !== 0 || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw autoError("ANDROID_AUTO_FORWARD_FAILED", `Cannot forward the phone head unit server: ${forward.stderr || forward.stdout}`);
    port = value;
    if (controller.signal.aborted) throw autoError("RESULT_TRANSPORT_CANCELLED", "Android Auto startup canceled");
    session = await DhuSession.start(binary, Number(port), remaining(), controller.signal);
    if (controller.signal.aborted) throw autoError("RESULT_TRANSPORT_CANCELLED", "Android Auto startup canceled");
    process.stdout.write(JSON.stringify({ ok: true, deviceId: options.deviceId, ready: true, transport: "dhu", inputMode: "rotary" }) + "\n");
    await Promise.race([broker.closed, session.closed]);
    return undefined;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await broker.close();
    await session?.close();
    if (port !== undefined) await runAdb(config, ["forward", "--remove", `tcp:${port}`], { timeoutMs: 3000 });
  }
}
