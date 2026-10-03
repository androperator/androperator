import { isAndroidSdkToolAvailable, type AndroidSdkTool } from "../../adapters/android-sdk/hostToolClient.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { ERROR_CODES, type AndroperatorError } from "../../contracts/errors.js";

export interface HostToolAvailability {
  tool: AndroidSdkTool;
  available: boolean;
}

export async function checkRequiredEmulatorTools(
  config: RuntimeConfig
): Promise<HostToolAvailability[]> {
  const tools: AndroidSdkTool[] = ["adb", "emulator", "sdkmanager", "avdmanager"];
  const results: HostToolAvailability[] = [];
  for (const tool of tools) {
    results.push({
      tool,
      available: await isAndroidSdkToolAvailable(config, tool),
    });
  }
  return results;
}

export async function assertRequiredEmulatorTools(
  config: RuntimeConfig
): Promise<void> {
  const results = await checkRequiredEmulatorTools(config);
  const missing = results.filter((result) => !result.available).map((result) => result.tool);
  if (missing.length === 0) {
    return;
  }

  const error: AndroperatorError = {
    code: ERROR_CODES.ANDROID_SDK_TOOL_MISSING,
    message: `Required Android SDK tools are missing: ${missing.join(", ")}`,
    details: { missingTools: missing },
  };
  throw error;
}
