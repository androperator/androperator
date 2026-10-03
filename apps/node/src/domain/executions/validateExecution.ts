import { validateOnScreenLogTemplate } from "../../contracts/onScreenLogTemplate.js";
import { notificationMediaParamsSchema } from "../../contracts/notifications.js";
import { dragParamsSchema } from "../../contracts/drag.js";
import { swipeParamsSchema } from "../../contracts/swipe.js";
import { z } from "zod";
import { LIMITS } from "../../contracts/limits.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { getCanonicalActionType } from "../../contracts/aliases.js";
import type { ActionParams, Execution } from "../../contracts/execution.js";
import { normalizeExecutionInput } from "../../contracts/inputAliases.js";

export const nodePredicateFields = {
  resourceId: selectorString(), role: selectorString(), textEquals: selectorString(),
  textContains: selectorString(), contentDescEquals: selectorString(), contentDescContains: selectorString(),
};

function selectorString() {
  return z.string().max(LIMITS.MAX_MATCHER_VALUE_LENGTH).optional();
}

const hasPredicateField = (value: object) => Object.values(value).some(entry =>
  typeof entry === "string" ? entry.trim().length > 0 : entry !== undefined);
export const nodePredicateSchema = z.object(nodePredicateFields).strict().refine(hasPredicateField, "Predicate must have at least one nonblank field");
export const nodeMatcherSchema = z.object({
  ...nodePredicateFields,
  ancestor: nodePredicateSchema.optional(),
  descendant: nodePredicateSchema.optional(),
}).strict().refine(hasPredicateField, "Matcher must have at least one nonblank field");

export const queryParamsSchema = z.object({
  matcher: nodeMatcherSchema.optional(),
  visibility: z.enum(["on_screen", "all"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
}).strict();

const coordinateSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

const onScreenLogIntegerSchema = z.number().finite().int().optional();
const onScreenLogColorPattern = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
// Keep this explicit list aligned with OnScreenLogContract.isContractWhitespace on Android.
const onScreenLogWhitespaceOnlyPattern = /^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*$/u;
const onScreenLogAllowedParamKeys = new Set([
  "text",
  "template",
  "anchor",
  "textAlign",
  "topOffsetDp",
  "edgeOffsetDp",
  "widthDp",
  "fontSizeSp",
  "textColor",
  "backgroundColor",
  "ttlMs",
]);

function hasForbiddenOnScreenLogControlCharacter(value: string): boolean {
  return /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u.test(value);
}

function hasOnScreenLogNonWhitespaceCharacter(value: string): boolean {
  return !onScreenLogWhitespaceOnlyPattern.test(value);
}

function normalizeOnScreenLogColor(value: string): string {
  const uppercase = value.toUpperCase();
  return uppercase.length === 7 ? `#FF${uppercase.slice(1)}` : uppercase;
}

const actionParamsSchema = z.object({
  applicationId: z.string().optional(),
  sessionId: z.string().optional(),
  uri: z.string().max(LIMITS.MAX_URI_LENGTH).optional(),
  durationMs: z.number().optional(),
  path: z.string().optional(),
  matcher: nodeMatcherSchema.optional(),
  coordinate: coordinateSchema.optional(),
  text: z.string().max(LIMITS.MAX_MATCHER_VALUE_LENGTH).optional(),
  submit: z.boolean().optional(),
  clear: z.boolean().optional(),
  clickType: z.string().optional(),
  container: nodeMatcherSchema.optional(),
  strict: z.boolean().optional(),
  direction: z.string().optional(),
  maxSwipes: z.number().optional(),
  distanceRatio: z.number().optional(),
  settleDelayMs: z.number().optional(),
  maxScrolls: z.number().optional(),
  maxDurationMs: z.number().optional(),
  noPositionChangeThreshold: z.number().optional(),
  findFirstScrollableChild: z.boolean().optional(),
  clickAfter: z.boolean().optional(),
  validator: z.string().optional(),
  validatorPattern: z.string().optional(),
  key: z.string().optional(),
  retry: z.record(z.unknown()).optional(),
  scrollRetry: z.record(z.unknown()).optional(),
  clickRetry: z.record(z.unknown()).optional(),
  // wait_for_navigation params
  expectedPackage: z.string().max(LIMITS.MAX_MATCHER_VALUE_LENGTH).optional(),
  expectedNode: nodeMatcherSchema.optional(),
  timeoutMs: z.number().optional(),
  skipNavigationWait: z.boolean().optional(),
  navigationTimeoutMs: z
    .number()
    .int()
    .min(LIMITS.MIN_EXECUTION_TIMEOUT_MS)
    .max(LIMITS.MAX_EXECUTION_TIMEOUT_MS)
    .optional(),
  // read_key_value_pair params
  labelMatcher: nodeMatcherSchema.optional(),
  // read_text params
  all: z.boolean().optional(),
}).strict();

const setOnScreenLogParamsSchema = z.object({
  text: z.string().max(2048).optional(),
  template: z.string().max(2048).optional(),
  anchor: z.enum(["left", "right"]).optional(),
  textAlign: z.enum(["left", "right"]).optional(),
  topOffsetDp: onScreenLogIntegerSchema,
  edgeOffsetDp: onScreenLogIntegerSchema,
  widthDp: onScreenLogIntegerSchema,
  fontSizeSp: onScreenLogIntegerSchema,
  textColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  ttlMs: onScreenLogIntegerSchema,
}).strict();

const clearOnScreenLogParamsSchema = z.object({}).strict();

function paramsSchemaForAction(actionType: string) {
  if (actionType === "show_toast") return z.object({
    text: z.string().min(1).max(2048).refine(value => value.trim().length > 0, "show_toast requires nonblank text"),
    duration: z.enum(["short", "long"]).optional(),
  }).strict();
  if (actionType === "cancel_toast") return z.object({}).strict().optional();
  if (actionType === "swipe") return swipeParamsSchema;
  if (actionType === "drag") return dragParamsSchema;
  const serviceSchema = notificationMediaParamsSchema(actionType);
  if (serviceSchema !== undefined) return serviceSchema;
  if (actionType === "query_ui") return queryParamsSchema.optional();
  if (actionType === "set_on_screen_log") {
    return setOnScreenLogParamsSchema.optional();
  }
  if (actionType === "clear_on_screen_log") {
    return clearOnScreenLogParamsSchema.optional();
  }
  return actionParamsSchema.optional();
}

function hasStructurallyValidActionParams(actionType: string, params: unknown): boolean {
  return paramsSchemaForAction(actionType).safeParse(params).success;
}

// NOTE: "doctor_ping" is intentionally excluded. It is an internal diagnostic action
// used only by `androperator doctor`, which bypasses validateExecution and dispatches
// directly via broadcastAgentCommand. It is not part of the public agent-facing API.
const supportedTypes = [
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

const actionSchema = z.object({
  id: z.string().min(1).max(LIMITS.MAX_ID_LENGTH),
  type: z.string().max(64).transform((s) => getCanonicalActionType(s)),
  params: z.unknown().optional(),
}).strict().superRefine((action, ctx) => {
  const paramsSchema = paramsSchemaForAction(action.type);
  const parsedParams = paramsSchema.safeParse(action.params);
  if (parsedParams.success) {
    return;
  }
  for (const issue of parsedParams.error.errors) {
    ctx.addIssue({
      ...issue,
      path: ["params", ...issue.path],
    });
  }
});

const validationHintByActionParam = new Map<string, string>([
  ["snapshot.format", "'format' was removed from snapshot. Remove this parameter."],
]);

const executionSchema = z.object({
  commandId: z.string().min(1).max(LIMITS.MAX_ID_LENGTH),
  taskId: z.string().min(1).max(LIMITS.MAX_ID_LENGTH),
  source: z.string().min(1).max(LIMITS.MAX_SOURCE_LENGTH),
  expectedFormat: z.literal("android-ui-automator"),
  timeoutMs: z
    .number()
    .min(LIMITS.MIN_EXECUTION_TIMEOUT_MS)
    .max(LIMITS.MAX_EXECUTION_TIMEOUT_MS),
  actions: z
    .array(actionSchema)
    .min(1)
    .max(LIMITS.MAX_EXECUTION_ACTIONS)
    .refine(
      (actions) => {
        const types = actions.map((a) => a.type);
        return types.every((t) =>
          (supportedTypes as readonly string[]).includes(t)
        );
      },
      {
        message: "All action types must be supported",
        params: { code: ERROR_CODES.EXECUTION_ACTION_UNSUPPORTED },
      }
    ),
  mode: z.literal("direct").optional(),
}).strict().superRefine((execution, ctx) => {
  const addIssue = (index: number, message: string, path: string[]) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path: ["actions", index, ...path],
    });
  };

  execution.actions.forEach((action, index) => {
    // The action-level refinement already reports structural parameter errors. Do not run
    // semantic checks on malformed raw values, where legacy checks may assume strings or
    // objects and otherwise throw instead of returning EXECUTION_VALIDATION_FAILED.
    if (!hasStructurallyValidActionParams(action.type, action.params)) {
      return;
    }
    const params = action.params as ActionParams | undefined;
    const selectionActions = ["click", "enter_text", "read_text", "wait_for_node", "scroll", "scroll_until", "scroll_and_click"];
    if (params?.strict !== undefined && !selectionActions.includes(action.type)) {
      addIssue(index, "strict is only supported by node-targeted actions", ["params", "strict"]);
    }
    if (action.type === "click" && params?.coordinate !== undefined && (params.strict === true || params.container !== undefined)) {
      addIssue(index, "coordinate click cannot use strict or container", ["params", "coordinate"]);
    }
    switch (action.type) {
      case "open_app":
      case "close_app":
        if (!params?.applicationId || params.applicationId.trim() === "") {
          addIssue(index, `${action.type} requires params.applicationId`, ["params", "applicationId"]);
        }
        break;
      case "start_recording":
      case "stop_recording":
        if (params?.sessionId !== undefined && params.sessionId.trim() === "") {
          addIssue(index, `${action.type} params.sessionId must not be blank`, ["params", "sessionId"]);
        }
        break;
      case "open_uri":
        if (!params?.uri || params.uri.trim() === "") {
          addIssue(index, "open_uri requires params.uri", ["params", "uri"]);
        }
        break;
      case "sleep":
        if (typeof params?.durationMs !== "number" || params.durationMs < 0) {
          addIssue(index, "sleep requires params.durationMs >= 0", ["params", "durationMs"]);
        } else if (params.durationMs > LIMITS.MAX_EXECUTION_TIMEOUT_MS) {
          addIssue(
            index,
            `sleep.durationMs must not exceed ${LIMITS.MAX_EXECUTION_TIMEOUT_MS} ms`,
            ["params", "durationMs"]
          );
        }
        break;
      case "click":
        if (!params?.matcher && !params?.coordinate) {
          addIssue(index, "click requires params.matcher or params.coordinate", ["params"]);
        }
        if (params?.matcher && params?.coordinate) {
          addIssue(index, "click params.matcher and params.coordinate are mutually exclusive", ["params"]);
        }
        if (params?.coordinate && params?.clickType === "focus") {
          addIssue(index, "click params.coordinate does not support clickType='focus'", ["params", "clickType"]);
        }
        break;
      case "wait_for_node":
        if (!params?.matcher) {
          addIssue(index, "wait_for_node requires params.matcher", ["params", "matcher"]);
        }
        break;
      case "read_text":
        if (!params?.matcher) {
          addIssue(index, "read_text requires params.matcher", ["params", "matcher"]);
        }
        // regex validator requires validatorPattern
        if (params?.validator === "regex") {
          if (!params?.validatorPattern || params.validatorPattern.trim() === "") {
            addIssue(index, "read_text with validator='regex' requires params.validatorPattern", ["params", "validatorPattern"]);
          } else {
            // Compile only to check syntax here; this does not match the pattern against text on the host.
            try {
              new RegExp(params.validatorPattern);
            } catch {
              addIssue(index, "read_text params.validatorPattern is not a valid regex pattern", ["params", "validatorPattern"]);
            }
          }
        }
        break;
      case "enter_text":
        if (!params?.matcher) {
          addIssue(index, "enter_text requires params.matcher", ["params", "matcher"]);
        }
        if (typeof params?.text !== "string" || params.text.length === 0) {
          addIssue(index, "enter_text requires non-empty params.text", ["params", "text"]);
        }
        break;
      case "set_on_screen_log": {
        const invalidKeys = Object.keys(params ?? {}).filter(key => !onScreenLogAllowedParamKeys.has(key));
        for (const invalidKey of invalidKeys) {
          addIssue(
            index,
            `set_on_screen_log does not accept params.${invalidKey}`,
            ["params", invalidKey]
          );
        }

        if ((params?.text !== undefined) === (params?.template !== undefined)) {
          addIssue(index, "set_on_screen_log requires exactly one of params.text or params.template", ["params"]);
        }
        for (const field of ["text", "template"] as const) {
          const value = params?.[field];
          if (value === undefined) continue;
          if (value.length < 1 || value.length > 2048) {
            addIssue(index, `set_on_screen_log params.${field} must contain 1..2048 UTF-16 code units`, ["params", field]);
          }
          if (!hasOnScreenLogNonWhitespaceCharacter(value)) {
            addIssue(index, `set_on_screen_log params.${field} must include a non-whitespace character`, ["params", field]);
          }
          if (hasForbiddenOnScreenLogControlCharacter(value)) {
            addIssue(index, `set_on_screen_log params.${field} contains a control character other than LF or TAB`, ["params", field]);
          }
          if (field === "template") {
            const error = validateOnScreenLogTemplate(value);
            if (error) addIssue(index, error, ["params", field]);
          }
        }

        const validateRange = (key: "topOffsetDp" | "edgeOffsetDp" | "widthDp" | "fontSizeSp" | "ttlMs", minimum: number, maximum: number) => {
          const value = params?.[key];
          if (value !== undefined && (value < minimum || value > maximum)) {
            addIssue(index, `set_on_screen_log params.${key} must be in [${minimum}, ${maximum}]`, ["params", key]);
          }
        };
        validateRange("topOffsetDp", 0, 1000);
        validateRange("edgeOffsetDp", 0, 1000);
        validateRange("widthDp", 80, 600);
        validateRange("fontSizeSp", 8, 24);
        validateRange("ttlMs", 1000, 3600000);

        for (const key of ["textColor", "backgroundColor"] as const) {
          const value = params?.[key];
          if (value !== undefined && !onScreenLogColorPattern.test(value)) {
            addIssue(
              index,
              `set_on_screen_log params.${key} must be exactly #RRGGBB or #AARRGGBB`,
              ["params", key]
            );
          }
        }
        break;
      }
      case "clear_on_screen_log": {
        const rawParams = action.params;
        if (
          rawParams !== undefined &&
          (
            typeof rawParams !== "object" ||
            rawParams === null ||
            Array.isArray(rawParams) ||
            Object.keys(rawParams).length > 0
          )
        ) {
          addIssue(index, "clear_on_screen_log accepts omitted params or {} only", ["params"]);
        }
        break;
      }
      case "scroll_and_click":
        if (!params?.matcher) {
          addIssue(index, "scroll_and_click requires params.matcher", ["params", "matcher"]);
        }
        break;
      case "scroll": {
        const SUPPORTED_DIRECTIONS = ["down", "up", "left", "right"] as const;
        if (params?.direction !== undefined) {
          const normalizedDir = params.direction.trim().toLowerCase();
          if (!(SUPPORTED_DIRECTIONS as readonly string[]).includes(normalizedDir)) {
            addIssue(
              index,
              `scroll params.direction must be one of: ${SUPPORTED_DIRECTIONS.join(", ")}`,
              ["params", "direction"]
            );
          }
        }
        if (params?.distanceRatio !== undefined) {
          if (params.distanceRatio < 0 || params.distanceRatio > 1) {
            addIssue(index, "scroll params.distanceRatio must be in [0.0, 1.0]", ["params", "distanceRatio"]);
          }
        }
        if (params?.settleDelayMs !== undefined) {
          if (params.settleDelayMs < 0 || params.settleDelayMs > 10000) {
            addIssue(index, "scroll params.settleDelayMs must be in [0, 10000]", ["params", "settleDelayMs"]);
          }
        }
        break;
      }
      case "scroll_until": {
        if (params?.clickAfter === true && !params?.matcher) {
          addIssue(index, "scroll_until params.clickAfter=true requires params.matcher", ["params", "matcher"]);
        }
        const SUPPORTED_DIRECTIONS_SU = ["down", "up", "left", "right"] as const;
        if (params?.direction !== undefined) {
          const normalizedDir = params.direction.trim().toLowerCase();
          if (!(SUPPORTED_DIRECTIONS_SU as readonly string[]).includes(normalizedDir)) {
            addIssue(
              index,
              `scroll_until params.direction must be one of: ${SUPPORTED_DIRECTIONS_SU.join(", ")}`,
              ["params", "direction"]
            );
          }
        }
        if (params?.distanceRatio !== undefined) {
          if (params.distanceRatio < 0 || params.distanceRatio > 1) {
            addIssue(index, "scroll_until params.distanceRatio must be in [0.0, 1.0]", ["params", "distanceRatio"]);
          }
        }
        if (params?.settleDelayMs !== undefined) {
          if (params.settleDelayMs < 0 || params.settleDelayMs > 10000) {
            addIssue(index, "scroll_until params.settleDelayMs must be in [0, 10000]", ["params", "settleDelayMs"]);
          }
        }
        if (params?.maxScrolls !== undefined) {
          if (!Number.isInteger(params.maxScrolls) || params.maxScrolls < 1 || params.maxScrolls > 200) {
            addIssue(index, "scroll_until params.maxScrolls must be an integer in [1, 200]", ["params", "maxScrolls"]);
          }
        }
        if (params?.maxDurationMs !== undefined) {
          if (params.maxDurationMs < 0 || params.maxDurationMs > 120000) {
            addIssue(index, "scroll_until params.maxDurationMs must be in [0, 120000]", ["params", "maxDurationMs"]);
          }
        }
        if (params?.noPositionChangeThreshold !== undefined) {
          if (!Number.isInteger(params.noPositionChangeThreshold) || params.noPositionChangeThreshold < 1 || params.noPositionChangeThreshold > 20) {
            addIssue(index, "scroll_until params.noPositionChangeThreshold must be an integer in [1, 20]", ["params", "noPositionChangeThreshold"]);
          }
        }
        break;
      }
      case "press_key": {
        const SUPPORTED_KEYS = ["back", "home", "recents"] as const;
        const normalizedKey = params?.key?.trim().toLowerCase();
        if (!normalizedKey) {
          addIssue(index, "press_key requires params.key", ["params", "key"]);
        } else if (!(SUPPORTED_KEYS as readonly string[]).includes(normalizedKey)) {
          addIssue(
            index,
            `press_key params.key must be one of: ${SUPPORTED_KEYS.join(", ")}`,
            ["params", "key"]
          );
        }
        break;
      }
      case "take_screenshot":
        if (params?.path !== undefined && params.path.trim() === "") {
          addIssue(index, "take_screenshot params.path must be a non-empty string", ["params", "path"]);
        }
        break;
      case "wait_for_navigation": {
        const hasExpectedPackage = params?.expectedPackage !== undefined && params.expectedPackage.trim() !== "";
        const hasExpectedNode = params?.expectedNode !== undefined;
        if (!hasExpectedPackage && !hasExpectedNode) {
          addIssue(index, "wait_for_navigation requires at least one of params.expectedPackage or params.expectedNode", ["params"]);
        }
        if (typeof params?.timeoutMs !== "number" || params.timeoutMs <= 0) {
          addIssue(index, "wait_for_navigation requires params.timeoutMs > 0", ["params", "timeoutMs"]);
        } else if (params.timeoutMs > 30000) {
          addIssue(index, "wait_for_navigation params.timeoutMs must not exceed 30000", ["params", "timeoutMs"]);
        }
        break;
      }
      case "read_key_value_pair":
        if (!params?.labelMatcher) {
          addIssue(index, "read_key_value_pair requires params.labelMatcher", ["params", "labelMatcher"]);
        }
        break;
      default:
        break;
    }
  });
});

export interface ValidationFailure {
  code: typeof ERROR_CODES.EXECUTION_VALIDATION_FAILED;
  message: string;
  details?: {
    path?: string;
    reason?: string;
    actionId?: string;
    actionType?: string;
    invalidKeys?: string[];
    hint?: string;
  };
}

/**
 * Validate execution payload. Returns normalized execution or throws ValidationFailure.
 * Call before any adb invocation.
 */
export function validateExecution(input: unknown): Execution {
  const normalizedInput = normalizeExecutionInput(input);
  const parsed = executionSchema.safeParse(normalizedInput);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    const details: NonNullable<ValidationFailure["details"]> = {
      path: first?.path.join("."),
      reason: parsed.error.message,
    };

    if (first && first.path[0] === "actions") {
      const actionIndex = first.path[1] as number | undefined;
      const rawActions = (input as { actions?: unknown[] } | undefined)?.actions;
      const rawAction = actionIndex !== undefined ? rawActions?.[actionIndex] : undefined;
      const actionId = (rawAction as { id?: unknown })?.id;
      const actionType = (rawAction as { type?: unknown })?.type;
      const canonicalActionType = typeof actionType === "string" ? getCanonicalActionType(actionType) : undefined;

      if (typeof actionId === "string") {
        details.actionId = actionId;
      }
      if (typeof actionType === "string") {
        details.actionType = actionType;
      }

      if (first.code === "unrecognized_keys") {
        const invalidKeys = (first as { keys?: string[] }).keys;
        if (invalidKeys !== undefined) {
          details.invalidKeys = invalidKeys;
          if (canonicalActionType !== undefined) {
            for (const invalidKey of invalidKeys) {
              const hint = validationHintByActionParam.get(`${canonicalActionType}.${invalidKey}`);
              if (hint !== undefined) {
                details.hint = hint;
                break;
              }
            }
          }
        }
      }
    }

    const err: ValidationFailure = {
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
      message: first?.message ?? "Invalid execution payload",
      details,
    };
    throw err;
  }
  const execution = parsed.data as Execution;
  return {
    ...execution,
    actions: execution.actions.map((action) => {
      if (action.type !== "set_on_screen_log" || action.params === undefined) {
        return action;
      }
      const textColor = action.params.textColor;
      const backgroundColor = action.params.backgroundColor;
      return {
        ...action,
        params: {
          ...action.params,
          ...(textColor !== undefined ? { textColor: normalizeOnScreenLogColor(textColor) } : {}),
          ...(backgroundColor !== undefined ? { backgroundColor: normalizeOnScreenLogColor(backgroundColor) } : {}),
        },
      };
    }),
  };
}

/**
 * Validate payload size (bytes) before parsing.
 */
export function validatePayloadSize(payload: string): void {
  const bytes = new TextEncoder().encode(payload).length;
  if (bytes > LIMITS.MAX_PAYLOAD_BYTES) {
    throw {
      code: ERROR_CODES.PAYLOAD_TOO_LARGE,
      message: `Payload exceeds ${LIMITS.MAX_PAYLOAD_BYTES} bytes (got ${bytes})`,
    };
  }
}
