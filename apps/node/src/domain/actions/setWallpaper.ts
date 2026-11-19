import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { ERROR_CODES, isAndroperatorError } from "../../contracts/errors.js";
import type { Execution } from "../../contracts/execution.js";
import { resolveDevice } from "../devices/resolveDevice.js";
import { executionCancellationError, runExecution, type RunExecutionOptions, type RunExecutionResult } from "../executions/runExecution.js";
import { validateExecution } from "../executions/validateExecution.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const UPLOAD_PROVIDER_CLASS = "androperator.task.runner.WallpaperUploadProvider";
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
  const canceled = executionCancellationError(options.signal);
  if (canceled !== undefined) return { ok: false, error: canceled };
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
    const message = error instanceof Error || isAndroperatorError(error) ? error.message : String(error);
    return { ok: false, error: { code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message } };
  }

  const config = getDefaultRuntimeConfig({ ...options, adbPath: options.adbPath ?? process.env.ADB_PATH });
  const operatorPackage = config.operatorPackage;
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(operatorPackage)) {
    return { ok: false, error: { code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: "Operator package must be an Android package name" } };
  }
  const authority = `${operatorPackage}.wallpaper-upload`;
  const uri = `content://${authority}/${uploadToken}`;
  const checkCancellation = () => {
    const error = executionCancellationError(options.signal);
    if (error !== undefined) throw error;
  };
  const runStagingCommand = async (args: string[], input?: Buffer) => {
    checkCancellation();
    const result = await runAdb(config, args, {
      input, timeoutMs: execution.timeoutMs, signal: options.signal, logOutput: false,
    });
    checkCancellation();
    return result;
  };
  let uploadUser: string | undefined;
  try {
    checkCancellation();
    const { deviceId } = await resolveDevice(config);
    config.deviceId = deviceId;
    const sdk = await runStagingCommand(["shell", "getprop", "ro.build.version.sdk"]);
    const sdkVersion = sdk.stdout.trim();
    if (sdk.code !== 0 || !/^\d+$/.test(sdkVersion)) {
      return { ok: false, deviceId, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: "Unable to determine the Android API level" } };
    }
    if (Number(sdkVersion) < 28) {
      return { ok: false, deviceId, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: "Setting wallpaper requires Android 9 (API 28) or later" } };
    }
    const currentUser = await runStagingCommand(["shell", "am", "get-current-user"]);
    const userId = currentUser.stdout.trim();
    if (currentUser.code !== 0 || !/^\d+$/.test(userId) || Number(userId) > 2147483647) {
      return { ok: false, deviceId, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: "Unable to determine the current Android user" } };
    }
    // An authority name alone is insufficient to identify the app receiving the image.
    const packageDump = await runStagingCommand(["shell", "dumpsys", "package", operatorPackage]);
    const packageLines = packageDump.stdout.split("\n").map(line => line.trim());
    const authorityIndex = packageLines.indexOf(`[${authority}]:`);
    const providerLine = authorityIndex < 0 ? undefined : packageLines[authorityIndex + 1];
    const expectedProvider = ` ${operatorPackage}/${UPLOAD_PROVIDER_CLASS}}`;
    const installedForUser = packageLines.some(line =>
      line.startsWith(`User ${userId}: `) && /\binstalled=true\b/.test(line),
    );
    if (packageDump.code !== 0 || !installedForUser ||
        !providerLine?.startsWith("Provider{") || !providerLine.endsWith(expectedProvider)) {
      return { ok: false, deviceId, error: {
        code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED,
        message: `Wallpaper upload provider for ${operatorPackage} was not found for Android user ${userId}. Install the matching Operator APK.`,
      } };
    }
    uploadUser = userId;
    const upload = await runStagingCommand(["shell", "-T", "content", "write", "--user", userId, "--uri", uri], image);
    if (upload.code !== 0 || upload.stderr.trim() !== "" || upload.stdout.trim() !== "") {
      return { ok: false, deviceId, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: upload.stderr.trim() || upload.stdout.trim() || "Unable to upload wallpaper to the Operator" } };
    }
    return await runExecution(execution, { ...options, deviceId, operatorPackage, adbPath: config.adbPath, runner: config.runner, androidUserId: Number(userId) });
  } catch (error) {
    const canceledDuringStaging = executionCancellationError(options.signal);
    if (canceledDuringStaging !== undefined) return { ok: false, error: canceledDuringStaging };
    if (isAndroperatorError(error)) return { ok: false, error: { ...error } };
    return { ok: false, error: { code: ERROR_CODES.WALLPAPER_UPLOAD_FAILED, message: String(error) } };
  } finally {
    if (uploadUser !== undefined) {
      await runAdb(config, ["shell", "content", "delete", "--user", uploadUser, "--uri", uri], { timeoutMs: 5000, logOutput: false }).catch(() => {});
    }
  }
}
