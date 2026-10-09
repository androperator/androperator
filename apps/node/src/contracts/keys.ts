/** Buttons executed by the Node bridge, matching the Android Emulator TV remote. */
export const TV_REMOTE_KEYS = [
  "dpad_up", "dpad_down", "dpad_left", "dpad_right", "dpad_center",
  "bookmark", "profile", "settings", "tv",
] as const;

/** Single-detent rotation and controller buttons injected through AAOS car_service. */
export const AUTOMOTIVE_KEYS = [
  "rotary_clockwise", "rotary_counterclockwise",
  "rotary_nudge_up", "rotary_nudge_down", "rotary_nudge_left", "rotary_nudge_right",
  "rotary_center",
] as const;

export function isAutomotiveKey(key: string | undefined): boolean {
  return key !== undefined && (AUTOMOTIVE_KEYS as readonly string[]).includes(key.trim().toLowerCase());
}

/** Inputs for an explicitly started Android Auto Desktop Head Unit session. */
export const ANDROID_AUTO_KEYS = [
  "android_auto_rotary_clockwise", "android_auto_rotary_counterclockwise",
  "android_auto_nudge_up", "android_auto_nudge_down", "android_auto_nudge_left", "android_auto_nudge_right",
  "android_auto_center", "android_auto_back", "android_auto_home",
] as const;

/** Canonical press_key values, shared by execution validation and public tool schemas. */
export const SYSTEM_KEYS = ["back", "home", "recents", ...TV_REMOTE_KEYS, ...AUTOMOTIVE_KEYS, ...ANDROID_AUTO_KEYS] as const;
export type SystemKey = typeof SYSTEM_KEYS[number];

export function isTvRemoteKey(key: string | undefined): boolean {
  return key !== undefined && (TV_REMOTE_KEYS as readonly string[]).includes(key.trim().toLowerCase());
}
