/** Buttons executed by the Node bridge, matching the Android Emulator TV remote. */
export const TV_REMOTE_KEYS = [
  "dpad_up", "dpad_down", "dpad_left", "dpad_right", "dpad_center",
  "bookmark", "profile", "settings", "tv",
] as const;

/** Single-detent rotation and controller buttons injected through AAOS car_service. */
export const AAOS_KEYS = [
  "aaos_rotary_clockwise", "aaos_rotary_counterclockwise",
  "aaos_rotary_nudge_up", "aaos_rotary_nudge_down", "aaos_rotary_nudge_left", "aaos_rotary_nudge_right",
  "aaos_rotary_center",
] as const;

export function isAaosKey(key: string | undefined): boolean {
  return key !== undefined && (AAOS_KEYS as readonly string[]).includes(key.trim().toLowerCase());
}

/** Inputs for an explicitly started Android Auto Desktop Head Unit session. */
export const ANDROID_AUTO_KEYS = [
  "android_auto_rotary_clockwise", "android_auto_rotary_counterclockwise",
  "android_auto_rotary_nudge_up", "android_auto_rotary_nudge_down", "android_auto_rotary_nudge_left", "android_auto_rotary_nudge_right",
  "android_auto_rotary_center", "android_auto_back", "android_auto_home",
] as const;

/** Canonical press_key values, shared by execution validation and public tool schemas. */
export const SYSTEM_KEYS = ["back", "home", "recents", ...TV_REMOTE_KEYS, ...AAOS_KEYS, ...ANDROID_AUTO_KEYS] as const;
export type SystemKey = typeof SYSTEM_KEYS[number];

export function isTvRemoteKey(key: string | undefined): boolean {
  return key !== undefined && (TV_REMOTE_KEYS as readonly string[]).includes(key.trim().toLowerCase());
}
