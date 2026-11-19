import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import type { Execution } from "../../contracts/execution.js";
import { resolveDevice } from "../devices/resolveDevice.js";
import { runExecution, type RunExecutionOptions, type RunExecutionResult } from "../executions/runExecution.js";
import { validateExecution } from "../executions/validateExecution.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const wallpaperTargets = ["home", "lock", "both"] as const;
export type WallpaperTarget = typeof wallpaperTargets[number];
export type SetWallpaperOptions = Pick<RunExecutionOptions, "deviceId" | "operatorPackage" | "adbPath" | "runner" | "timeoutMs" | "signal" | "logger">;

async function readImage(imagePath: string): Promise<Buffer> {
  const file = await open(imagePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX_IMAGE_BYTES) {
      throw new Error("Expected a nonempty regular image file of at most 8 MiB");
    }
    const image = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < image.length) {
      const { bytesRead } = await file.read(image, offset, image.length - offset);
      if (bytesRead === 0) throw new Error("Image changed while reading");
      offset += bytesRead;
    }
    if ((await file.stat()).size !== image.length) throw new Error("Image changed while reading");
    return image;
  } finally {
    await file.close();
  }
}

/** Apply a host-local static image through the selected Operator, without a picker. */
export async function setWallpaper(
  imagePath: string,
  target: WallpaperTarget,
  options: SetWallpaperOptions = {},
): Promise<RunExecutionResult> {
  const uploadToken = randomUUID().replaceAll("-", "");
  const execution: Execution = {
    commandId: `set-wallpaper-${uploadToken}`,
    taskId: "set-wallpaper",
    source: "androperator-node",
    timeoutMs: options.timeoutMs ?? 30000,
    expectedFormat: "android-ui-automator",
    actions: [{ id: "a1", type: "set_wallpaper" }],
  };
  let image: Buffer;
  try {
    if (typeof imagePath !== "string" || imagePath.trim().length === 0) throw new Error("An image path is required");
    if (!wallpaperTargets.includes(target)) throw new Error("Target must be home, lock, or both");
    if (options.deviceId !== undefined && options.deviceId.trim().length === 0) throw new Error("Device must be nonblank");
    if (options.operatorPackage !== undefined && !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(options.operatorPackage)) {
      throw new Error("Operator package must be an Android package name");
    }
    image = await readImage(imagePath);
    execution.actions[0].params = { target, uploadToken, sha256: createHash("sha256").update(image).digest("hex") };
    validateExecution(execution);
  } catch (error) {
    return { ok: false, error: { code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: error instanceof Error ? error.message : String(error) } };
  }

  const config = getDefaultRuntimeConfig({ ...options, adbPath: options.adbPath ?? process.env.ADB_PATH });
  const operatorPackage = config.operatorPackage;
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(operatorPackage)) {
    return { ok: false, error: { code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: "Operator package must be an Android package name" } };
  }
  const uri = `content://${operatorPackage}.wallpaper-upload/${uploadToken}`;
  let uploadUser: string | undefined;
  try {
    const { deviceId } = await resolveDevice(config);
    config.deviceId = deviceId;
    const sdk = await runAdb(config, ["shell", "getprop", "ro.build.version.sdk"], {
      timeoutMs: execution.timeoutMs, signal: options.signal,
    });
    const sdkVersion = sdk.stdout.trim();
    if (sdk.code !== 0 || !/^\d+$/.test(sdkVersion)) {
      return { ok: false, deviceId, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: "Unable to determine the Android API level" } };
    }
    if (Number(sdkVersion) < 28) {
      return { ok: false, deviceId, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: "Setting wallpaper requires Android 9 (API 28) or later" } };
    }
    const currentUser = await runAdb(config, ["shell", "am", "get-current-user"], {
      timeoutMs: execution.timeoutMs, signal: options.signal,
    });
    const userId = currentUser.stdout.trim();
    if (currentUser.code !== 0 || !/^\d+$/.test(userId)) {
      return { ok: false, deviceId, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: "Unable to determine the current Android user" } };
    }
    uploadUser = userId;
    const upload = await runAdb(config, ["shell", "-T", "content", "write", "--user", userId, "--uri", uri], {
      input: image, timeoutMs: execution.timeoutMs, signal: options.signal, logOutput: false,
    });
    if (upload.code !== 0 || upload.stderr.trim() !== "" || upload.stdout.trim() !== "") {
      return { ok: false, deviceId, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: upload.stderr.trim() || upload.stdout.trim() || "Unable to upload wallpaper to the Operator" } };
    }
    return await runExecution(execution, { ...options, deviceId, operatorPackage, adbPath: config.adbPath, runner: config.runner });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
      return { ok: false, error: { ...error, code: String(error.code), message: String(error.message) } };
    }
    return { ok: false, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: String(error) } };
  } finally {
    if (uploadUser !== undefined) {
      await runAdb(config, ["shell", "content", "delete", "--user", uploadUser, "--uri", uri], { timeoutMs: 5000, logOutput: false }).catch(() => {});
    }
  }
}
