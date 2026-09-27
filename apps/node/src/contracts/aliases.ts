/**
 * Action type aliases: input-only conveniences that normalize to canonical types.
 * Canonical form is stored and logged. Table is explicit/versioned.
 */
const ACTION_ALIAS_TO_CANONICAL: Record<string, string> = {
  open_url: "open_uri",
  tap: "click",
  press: "click",
  wait_for: "wait_for_node",
  find: "wait_for_node",
  find_node: "wait_for_node",
  read: "read_text",
  snapshot_ui: "snapshot",
  sleep: "sleep",
  screenshot: "take_screenshot",
  capture_screenshot: "take_screenshot",
  type_text: "enter_text",
  text_entry: "enter_text",
  input_text: "enter_text",
  key_press: "press_key",
  on_screen_log_set: "set_on_screen_log",
  on_screen_log_clear: "clear_on_screen_log",
};

const ON_SCREEN_LOG_EXACT_INPUT_TYPES = new Set([
  "set_on_screen_log",
  "clear_on_screen_log",
  "on_screen_log_set",
  "on_screen_log_clear",
]);

// NOTE: "doctor_ping" is intentionally absent. It is an internal diagnostic action
// used only by `clawperator doctor` via broadcastAgentCommand, not the agent-facing API.
export const CANONICAL_ACTION_TYPES = [
  "list_notifications", "list_media_sessions", "get_media_status", "observe_media", "media_pause", "media_play", "dismiss_notification", "invoke_notification_action", "media_seek",
  "show_toast",
  "cancel_toast",
  "open_app",
  "open_uri",
  "close_app",
  "start_recording",
  "stop_recording",
  "wait_for_node",
  "click",
  "swipe",
  "drag",
  "scroll_and_click",
  "scroll",
  "scroll_until",
  "read_text",
  "query_ui",
  "enter_text",
  "snapshot",
  "take_screenshot",
  "sleep",
  "press_key",
  "wait_for_navigation",
  "read_key_value_pair",
  "set_on_screen_log",
  "clear_on_screen_log",
] as const;

export type CanonicalActionType = (typeof CANONICAL_ACTION_TYPES)[number];

/**
 * Normalize action type input to canonical form.
 * Returns canonical type or throws if unknown.
 */
export function normalizeActionType(input: string): CanonicalActionType {
  const canonical = getCanonicalActionType(input);
  if (!CANONICAL_ACTION_TYPES.includes(canonical as CanonicalActionType)) {
    throw new Error(`Unsupported action type: ${input}`);
  }
  return canonical as CanonicalActionType;
}

export function getCanonicalActionType(input: string): string {
  const normalized = input.trim().toLowerCase();
  const canonical = ACTION_ALIAS_TO_CANONICAL[normalized] ?? normalized;
  if (
    (canonical === "set_on_screen_log" || canonical === "clear_on_screen_log") &&
    !ON_SCREEN_LOG_EXACT_INPUT_TYPES.has(input)
  ) {
    // These raw actions accept only their exact canonical names and their two
    // explicit aliases. Do not let generic normalization accept case or whitespace
    // variants at the public ingress boundary.
    return input;
  }
  return canonical;
}
