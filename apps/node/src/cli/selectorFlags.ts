/**
 * Selector flag resolution helpers.
 *
 * Parses simple selector flags (--text, --id, --desc, --role, etc.) and
 * container selector flags (--container-text, --container-id, etc.) from
 * a CLI rest-args array, returning a resolved NodeMatcher or a structured
 * error.
 */
import { normalizeMatcherInput } from "../contracts/inputAliases.js";
import { nodeMatcherSchema } from "../domain/executions/validateExecution.js";
import type { NodeMatcher } from "../contracts/selectors.js";
import { ERROR_CODES } from "../contracts/errors.js";
import type { AndroperatorError } from "../contracts/errors.js";
import type { OutputFormat } from "./output.js";
import { formatError } from "./output.js";
import type { CliFlagAliasSpec } from "./flagAliases.js";
import { normalizeCliFlagAliases } from "./flagAliases.js";

// ---------------------------------------------------------------------------
// Flag name constants
// ---------------------------------------------------------------------------

/** All simple element selector flags that take a value. */
export const ELEMENT_SELECTOR_VALUE_FLAGS = [
  "--selector",
  "--text",
  "--text-contains",
  "--id",
  "--desc",
  "--desc-contains",
  "--role",
] as const;

export const ELEMENT_SELECTOR_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--selector", aliases: ["--matcher-json"] },
  { canonical: "--id", aliases: ["--resource-id"] },
  { canonical: "--desc", aliases: ["--content-desc"] },
  { canonical: "--desc-contains", aliases: ["--content-desc-contains"] },
] as const;

/** All container selector flags that take a value. */
export const CONTAINER_SELECTOR_VALUE_FLAGS = [
  "--container-selector",
  "--container-text",
  "--container-text-contains",
  "--container-id",
  "--container-desc",
  "--container-desc-contains",
  "--container-role",
] as const;

export const CONTAINER_SELECTOR_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--container-selector", aliases: ["--container-json"] },
  { canonical: "--container-id", aliases: ["--container-resource-id"] },
  { canonical: "--container-desc", aliases: ["--container-content-desc"] },
  { canonical: "--container-desc-contains", aliases: ["--container-content-desc-contains"] },
] as const;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type MatcherResult =
  | { ok: true; matcher: NodeMatcher }
  | { ok: false; error: AndroperatorError };

export type ContainerResult =
  | { ok: true; container: NodeMatcher | undefined }
  | { ok: false; error: AndroperatorError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if any element selector flag is present in rest.
 * Used by registry handlers to detect the "no selector provided" case.
 */
export function hasElementSelectorFlag(rest: string[]): boolean {
  const normalized = normalizeSelectorFlagAliases(rest);
  return ELEMENT_SELECTOR_VALUE_FLAGS.some((f) => normalized.includes(f));
}

function normalizeFlagAliases(
  rest: string[],
  aliasSpecs: readonly CliFlagAliasSpec[],
): string[] {
  return normalizeCliFlagAliases(rest, aliasSpecs);
}

function normalizeSelectorFlagAliases(rest: string[]): string[] {
  return normalizeFlagAliases(rest, ELEMENT_SELECTOR_FLAG_ALIASES);
}

function normalizeContainerFlagAliases(rest: string[]): string[] {
  return normalizeFlagAliases(rest, CONTAINER_SELECTOR_FLAG_ALIASES);
}

/**
 * Read a flag value from rest, returning the raw next token (including "").
 * Returns undefined if the flag is absent.
 * Throws a plain Error if the flag is present but no following token exists.
 *
 * If the same flag token appears more than once in `rest`, callers should reject
 * first via `duplicateValueFlagError` so behavior is explicit.
 */
function readFlagRaw(rest: string[], flag: string): string | undefined {
  const i = rest.indexOf(flag);
  if (i < 0) return undefined;
  const next = rest[i + 1];
  if (next === undefined || next.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return next;
}

/** Rejects when any flag in `flags` appears more than once as a token in `rest`. */
function duplicateValueFlagError(
  rest: string[],
  flags: readonly string[],
): AndroperatorError | undefined {
  for (const flag of flags) {
    let count = 0;
    for (const t of rest) {
      if (t === flag) count += 1;
    }
    if (count > 1) {
      return {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message: `${flag} must not appear more than once`,
      };
    }
  }
  return undefined;
}

function blankError(flag: string): AndroperatorError {
  return {
    code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
    message: `${flag} value must not be blank`,
  };
}

// ---------------------------------------------------------------------------
// Element matcher resolution
// ---------------------------------------------------------------------------

/**
 * Resolve element selector flags from a CLI rest array.
 *
 * Returns { ok: true, matcher } if at least some flags are present and valid
 * (including the empty-matcher case when no flags are present - callers must
 * check hasElementSelectorFlag to detect the truly-missing-selector case).
 *
 * Returns { ok: false, error } on mutual exclusion or blank string violations.
 */
export function resolveElementMatcherFromCli(rest: string[]): MatcherResult {
  rest = normalizeSelectorFlagAliases(rest);
  const dupEl = duplicateValueFlagError(rest, ELEMENT_SELECTOR_VALUE_FLAGS);
  if (dupEl) return { ok: false, error: dupEl };

  let selectorJson: string | undefined;
  let text: string | undefined;
  let textContains: string | undefined;
  let id: string | undefined;
  let desc: string | undefined;
  let descContains: string | undefined;
  let role: string | undefined;

  try {
    selectorJson = readFlagRaw(rest, "--selector");
    text = readFlagRaw(rest, "--text");
    textContains = readFlagRaw(rest, "--text-contains");
    id = readFlagRaw(rest, "--id");
    desc = readFlagRaw(rest, "--desc");
    descContains = readFlagRaw(rest, "--desc-contains");
    role = readFlagRaw(rest, "--role");
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const hasSimpleFlags = [text, textContains, id, desc, descContains, role].some(
    (v) => v !== undefined,
  );

  // Mutual exclusion: --selector + any simple flag
  if (selectorJson !== undefined && hasSimpleFlags) {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message: "use --selector OR the simple flags, not both",
      },
    };
  }

  // --selector JSON path
  if (selectorJson !== undefined) {
    if (selectorJson.trim() === "") {
      return { ok: false, error: blankError("--selector") };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(selectorJson);
    } catch {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: "--selector must be valid JSON",
        },
      };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: "--selector must be a JSON object",
        },
      };
    }
    if (Object.keys(parsed).length === 0) {
      return { ok: false, error: {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message: "--selector (--matcher-json) must not be empty. For all-node discovery, use query without a matcher; other actions require a non-empty selector.",
      } };
    }
    const validated = nodeMatcherSchema.safeParse(normalizeMatcherInput(parsed));
    if (!validated.success) return { ok: false, error: {
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: validated.error.message,
    } };
    return { ok: true, matcher: validated.data };
  }

  // Simple flags path - validate blank strings
  const simpleChecks: [string, string | undefined][] = [
    ["--text", text],
    ["--text-contains", textContains],
    ["--id", id],
    ["--desc", desc],
    ["--desc-contains", descContains],
    ["--role", role],
  ];
  for (const [flag, value] of simpleChecks) {
    if (value !== undefined && value.trim() === "") {
      return { ok: false, error: blankError(flag) };
    }
  }

  // Build matcher from simple flags
  const matcher: NodeMatcher = {};
  if (text !== undefined) matcher.textEquals = text;
  if (textContains !== undefined) matcher.textContains = textContains;
  if (id !== undefined) matcher.resourceId = id;
  if (desc !== undefined) matcher.contentDescEquals = desc;
  if (descContains !== undefined) matcher.contentDescContains = descContains;
  if (role !== undefined) matcher.role = role;

  return { ok: true, matcher };
}

// ---------------------------------------------------------------------------
// Container matcher resolution
// ---------------------------------------------------------------------------

/**
 * Resolve container selector flags (--container-*) from a CLI rest array.
 *
 * Returns { ok: true, container: undefined } when no container flags are present.
 * Returns { ok: true, container: NodeMatcher } when container flags are valid.
 * Returns { ok: false, error } on mutual exclusion or blank string violations.
 */
export function resolveContainerMatcherFromCli(rest: string[]): ContainerResult {
  rest = normalizeContainerFlagAliases(rest);
  const dupCt = duplicateValueFlagError(rest, CONTAINER_SELECTOR_VALUE_FLAGS);
  if (dupCt) return { ok: false, error: dupCt };

  let selectorJson: string | undefined;
  let text: string | undefined;
  let textContains: string | undefined;
  let id: string | undefined;
  let desc: string | undefined;
  let descContains: string | undefined;
  let role: string | undefined;

  try {
    selectorJson = readFlagRaw(rest, "--container-selector");
    text = readFlagRaw(rest, "--container-text");
    textContains = readFlagRaw(rest, "--container-text-contains");
    id = readFlagRaw(rest, "--container-id");
    desc = readFlagRaw(rest, "--container-desc");
    descContains = readFlagRaw(rest, "--container-desc-contains");
    role = readFlagRaw(rest, "--container-role");
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const hasSimpleFlags = [text, textContains, id, desc, descContains, role].some(
    (v) => v !== undefined,
  );

  // No container flags at all
  if (selectorJson === undefined && !hasSimpleFlags) {
    return { ok: true, container: undefined };
  }

  // Mutual exclusion: --container-selector + any simple container flag
  if (selectorJson !== undefined && hasSimpleFlags) {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message: "use --container-selector OR the --container-* flags, not both",
      },
    };
  }

  // --container-selector JSON path
  if (selectorJson !== undefined) {
    if (selectorJson.trim() === "") {
      return { ok: false, error: blankError("--container-selector") };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(selectorJson);
    } catch {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: "--container-selector must be valid JSON",
        },
      };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: "--container-selector must be a JSON object",
        },
      };
    }
    const validated = nodeMatcherSchema.safeParse(normalizeMatcherInput(parsed));
    if (!validated.success) return { ok: false, error: {
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: validated.error.message,
    } };
    return { ok: true, container: validated.data };
  }

  // Simple --container-* flags - validate blank strings
  const simpleChecks: [string, string | undefined][] = [
    ["--container-text", text],
    ["--container-text-contains", textContains],
    ["--container-id", id],
    ["--container-desc", desc],
    ["--container-desc-contains", descContains],
    ["--container-role", role],
  ];
  for (const [flag, value] of simpleChecks) {
    if (value !== undefined && value.trim() === "") {
      return { ok: false, error: blankError(flag) };
    }
  }

  // Build container matcher from simple flags
  const container: NodeMatcher = {};
  if (text !== undefined) container.textEquals = text;
  if (textContains !== undefined) container.textContains = textContains;
  if (id !== undefined) container.resourceId = id;
  if (desc !== undefined) container.contentDescEquals = desc;
  if (descContains !== undefined) container.contentDescContains = descContains;
  if (role !== undefined) container.role = role;

  return { ok: true, container };
}

// ---------------------------------------------------------------------------
// Missing-selector error helpers
// ---------------------------------------------------------------------------

const SELECTOR_FLAG_LIST = `Use one of:
  --text <text>           Exact visible text
  --text-contains <text>  Partial text match
  --id <resource-id>      Android resource ID
  --desc <text>           Content description
  --desc-contains <text>  Partial content description
  --role <role>           Element role
  --coordinate <x> <y>    Exact coordinates (pixels)
  --selector <json>       Raw JSON (advanced)`;

/** Build the missing-selector error for a given command (respects output format). */
export function makeMissingSelectorError(command: string, format: OutputFormat = "json"): string {
  return formatError(
    {
      code: "MISSING_SELECTOR",
      message: `${command} requires a selector.\n\n${SELECTOR_FLAG_LIST}\n\nExamples:\n  androperator ${command} --text "Wi-Fi"\n  androperator ${command} --id "button_submit"`,
    },
    { format },
  );
}
