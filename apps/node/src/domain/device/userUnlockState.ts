import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";

/** A read-only Direct Boot guard. Unsupported shell probes leave runtime errors authoritative. */
export async function probeUserUnlockState(config: RuntimeConfig): Promise<{ userId: number; userUnlocked: boolean } | undefined> {
  let userId = config.androidUserId;
  if (userId === undefined) {
    const current = await runAdb(config, ["shell", "am", "get-current-user"]);
    if (current.code !== 0 || !/^\d+$/.test(current.stdout.trim())) return undefined;
    userId = Number(current.stdout.trim());
  }
  const state = await runAdb(config, ["shell", "am", "get-started-user-state", String(userId)]);
  if (state.code !== 0) return undefined;
  switch (state.stdout.trim()) {
    case "RUNNING_UNLOCKED": return { userId, userUnlocked: true };
    case "RUNNING_LOCKED":
    case "RUNNING_UNLOCKING": return { userId, userUnlocked: false };
    default: return undefined;
  }
}
