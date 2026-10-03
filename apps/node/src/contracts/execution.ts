/**
 * Execution unit contract. Aligns with Android AgentCommand / UiAction.
 */
import type { NodeMatcher } from "./selectors.js";

export interface ActionParams {
  notificationKey?: string;
  actionId?: string;
  positionMs?: number;
  positionToleranceMs?: number;
  mediaSessionId?: string;
  maxTextChars?: number;
  waitTimeoutMs?: number;
  applicationId?: string;
  sessionId?: string;
  uri?: string;
  durationMs?: number;
  holdDurationMs?: number;
  moveDurationMs?: number;
  path?: string;
  matcher?: NodeMatcher;
  visibility?: "on_screen" | "all";
  limit?: number;
  coordinate?: { x: number; y: number };
  /** swipe/drag: required endpoints in screen pixels; each action requires its duration fields. */
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  text?: string;
  /** show_toast: native Android duration, default short. */
  duration?: "short" | "long";
  /** set_on_screen_log: Android-resolved template, exclusive with text */
  template?: string;
  /** set_on_screen_log: physical screen edge */
  anchor?: "left" | "right";
  /** set_on_screen_log: physical text alignment within the panel */
  textAlign?: "left" | "right";
  /** set_on_screen_log: distance from the usable top edge, in dp */
  topOffsetDp?: number;
  /** set_on_screen_log: distance inward from the selected usable edge, in dp */
  edgeOffsetDp?: number;
  /** set_on_screen_log: complete panel width, including padding, in dp */
  widthDp?: number;
  /** set_on_screen_log: text size in sp */
  fontSizeSp?: number;
  /** set_on_screen_log: #RRGGBB or #AARRGGBB */
  textColor?: string;
  /** set_on_screen_log: #RRGGBB or #AARRGGBB */
  backgroundColor?: string;
  /** set_on_screen_log: stale-label expiry in milliseconds */
  ttlMs?: number;
  submit?: boolean;
  clear?: boolean;
  /** clickType: default | long_click | focus */
  clickType?: string;
  container?: NodeMatcher;
  strict?: boolean;
  direction?: string;
  maxSwipes?: number;
  distanceRatio?: number;
  settleDelayMs?: number;
  /** scroll_until */
  maxScrolls?: number;
  maxDurationMs?: number;
  noPositionChangeThreshold?: number;
  findFirstScrollableChild?: boolean;
  /** scroll_and_click: when false, scroll until visible but do not click */
  clickAfter?: boolean;
  validator?: string;
  validatorPattern?: string;
  /** read_text: when true, return all matches */
  all?: boolean;
  /** press_key: back | home | recents */
  key?: string;
  retry?: Record<string, unknown>;
  scrollRetry?: Record<string, unknown>;
  clickRetry?: Record<string, unknown>;
  // wait_for_navigation params
  expectedPackage?: string;
  expectedNode?: NodeMatcher;
  /** Action-level timeout in milliseconds (distinct from execution-level timeoutMs) */
  timeoutMs?: number;
  /** open_app only: skip the foreground readiness wait and return after dispatch */
  skipNavigationWait?: boolean;
  /** open_app only: timeout budget for the foreground readiness wait */
  navigationTimeoutMs?: number;
  // read_key_value_pair params
  labelMatcher?: NodeMatcher;
}

export interface ExecutionAction {
  id: string;
  type: string;
  params?: ActionParams;
}

export interface Execution {
  commandId: string;
  taskId: string;
  source: string;
  expectedFormat: "android-ui-automator";
  timeoutMs: number;
  actions: ExecutionAction[];
  /** Optional marker for direct execution. */
  mode?: "direct";
}
