import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { Execution } from "../../contracts/execution.js";
import { isWearKey } from "../../contracts/keys.js";

export const WEAR_COMMANDS: Record<string, string[]> = {
  wear_rotary_clockwise: ["rotaryencoder", "scroll", "--axis", "SCROLL,-1"],
  wear_rotary_counterclockwise: ["rotaryencoder", "scroll", "--axis", "SCROLL,1"],
  wear_stem_primary: ["keyevent", "KEYCODE_STEM_PRIMARY"],
  wear_stem_1: ["keyevent", "KEYCODE_STEM_1"],
  wear_stem_2: ["keyevent", "KEYCODE_STEM_2"],
  wear_stem_3: ["keyevent", "KEYCODE_STEM_3"],
};

/** Reject incompatible targets before any action in a mixed execution runs. */
export async function preflightWearInputs(execution: Execution, config: RuntimeConfig, deadline: number, signal: AbortSignal): Promise<void> {
  const keys = execution.actions.filter(action => action.type === "press_key" && isWearKey(action.params?.key))
    .map(action => action.params!.key!.trim().toLowerCase());
  if (keys.length === 0 || signal.aborted) return;
  const feature = await runAdb(config, ["shell", "pm", "has-feature", "android.hardware.type.watch"], { timeoutMs: Math.max(1, deadline - Date.now()) });
  if (signal.aborted) return;
  if (feature.code !== 0 || feature.stdout.trim() !== "true" || feature.stderr.trim() !== "") {
    throw { code: "WEAR_DEVICE_REQUIRED", message: "Wear inputs require a reachable Wear OS target reporting android.hardware.type.watch; select it with --device." };
  }
  if (!keys.some(key => key.startsWith("wear_rotary_"))) return;
  const usage = await runAdb(config, ["shell", "input"], { timeoutMs: Math.max(1, deadline - Date.now()) });
  if (signal.aborted) return;
  if (usage.code !== 0 || usage.stderr.trim() !== "" || !/\brotaryencoder\b/.test(usage.stdout)
    || !/^\s+scroll\s/m.test(usage.stdout) || !/--axis\b/.test(usage.stdout) || !/\bSCROLL\b/.test(usage.stdout)) {
    throw { code: "WEAR_ROTARY_UNSUPPORTED", message: "This watch shell lacks input rotaryencoder scroll --axis SCROLL support. Use a Wear OS image with that command; no swipe fallback is used." };
  }
}
