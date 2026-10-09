import { ANDROID_AUTO_KEYS } from "../../contracts/keys.js";

/** DHU console commands. These control projection, never the phone or AAOS. */
export const ANDROID_AUTO_COMMANDS = {
  android_auto_rotary_clockwise: "dpad rotate right",
  android_auto_rotary_counterclockwise: "dpad rotate left",
  android_auto_nudge_up: "dpad up",
  android_auto_nudge_down: "dpad down",
  android_auto_nudge_left: "dpad left",
  android_auto_nudge_right: "dpad right",
  android_auto_center: "dpad click",
  android_auto_back: "dpad back",
  android_auto_home: "keycode home",
} as const satisfies Record<typeof ANDROID_AUTO_KEYS[number], string>;
export type AndroidAutoKey = keyof typeof ANDROID_AUTO_COMMANDS;
export function isAndroidAutoKey(key: string | undefined): key is AndroidAutoKey {
  return key !== undefined && Object.hasOwn(ANDROID_AUTO_COMMANDS, key);
}
