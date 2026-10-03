import { ERROR_CODES } from "../contracts/errors.js";
import { LIMITS } from "../contracts/limits.js";
import { normalizeEmulatorDataPartitionSize } from "../domain/android-emulators/lifecycle.js";
import { formatError } from "./output.js";
import type { Logger } from "../adapters/logger.js";
import type { NodeMatcher } from "../contracts/selectors.js";
import {
  resolveElementMatcherFromCli,
  resolveContainerMatcherFromCli,
  hasElementSelectorFlag,
  makeMissingSelectorError,
  ELEMENT_SELECTOR_VALUE_FLAGS,
  CONTAINER_SELECTOR_VALUE_FLAGS,
  ELEMENT_SELECTOR_FLAG_ALIASES,
  CONTAINER_SELECTOR_FLAG_ALIASES,
} from "./selectorFlags.js";
import type { CliFlagAliasSpec } from "./flagAliases.js";

// ---------------------------------------------------------------------------
// Exported utilities (moved from index.ts so registry handlers can use them)
// ---------------------------------------------------------------------------

export class UsageError extends Error {}

export function getOpt(rest: string[], flag: string): string | undefined {
  const i = rest.indexOf(flag);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined;
}

export function getStringOpt(rest: string[], flag: string): string | undefined {
  const i = rest.indexOf(flag);
  if (i < 0) {
    return undefined;
  }
  if (!rest[i + 1]) {
    throw new UsageError(`${flag} requires a value`);
  }
  return rest[i + 1];
}

export function getStringOptStrict(
  rest: string[],
  flag: string,
  knownFlags: readonly string[] = [],
): string | undefined {
  const i = rest.indexOf(flag);
  if (i < 0) {
    return undefined;
  }

  const value = rest[i + 1];
  if (!value) {
    throw new UsageError(`${flag} requires a value`);
  }

  if (value === "--") {
    const escapedValue = rest[i + 2];
    if (!escapedValue) {
      throw new UsageError(`${flag} requires a value`);
    }
    return escapedValue;
  }

  if (knownFlags.includes(value)) {
    throw new UsageError(`${flag} requires a value`);
  }

  if (value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value. Use '${flag} -- <literal>' for a literal value that starts with --`);
  }

  return value;
}

function getEmulatorStorageSizeOpt(rest: string[], knownFlags: readonly string[]): string | undefined {
  const flagAliases = ["--storage-size", "--size", "--disk-size", "--data-partition-size"];
  const provided = flagAliases
    .map((flag) => ({ flag, value: getStringOptStrict(rest, flag, knownFlags) }))
    .filter((entry): entry is { flag: string; value: string } => entry.value !== undefined);
  if (provided.length > 1) {
    throw new UsageError("Use only one emulator storage size flag: --storage-size, --size, --disk-size, or --data-partition-size");
  }
  const value = provided[0]?.value;
  if (value === undefined) {
    return undefined;
  }
  try {
    return normalizeEmulatorDataPartitionSize(value);
  } catch {
    throw new UsageError("--storage-size must be a positive integer followed by G or GB, for example 12G");
  }
}

export function getNumberOpt(rest: string[], flag: string): number | undefined {
  const i = rest.indexOf(flag);
  if (i < 0) {
    return undefined;
  }
  if (!rest[i + 1]) {
    throw new UsageError(`${flag} requires a value`);
  }
  return Number(rest[i + 1]);
}

export function hasFlag(rest: string[], flag: string): boolean {
  return rest.includes(flag);
}

/**
 * Positional tokens that are not flags and not values paired with `valueFlags`.
 * Tokens in `booleanFlags` are skipped without consuming a following argument.
 */
export function barePositionalTokens(
  rest: string[],
  valueFlags: readonly string[],
  booleanFlags: readonly string[],
): string[] {
  const valueSet = new Set(valueFlags);
  const boolSet = new Set(booleanFlags);
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === undefined) continue;
    if (a.startsWith("-")) {
      if (valueSet.has(a)) {
        if (rest[i + 1] !== undefined && !rest[i + 1].startsWith("-")) {
          i += 1;
        }
        continue;
      }
      if (boolSet.has(a)) {
        continue;
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * Return a copy of rest with the given flag and its following value removed.
 * If the flag is not present, returns the original array.
 */
export function stripFlagWithValue(rest: string[], flag: string): string[] {
  const i = rest.indexOf(flag);
  if (i < 0) return rest;
  const next = rest[i + 1];
  if (next === undefined || next.startsWith("-")) return rest;
  return [...rest.slice(0, i), ...rest.slice(i + 2)];
}

export function getInvalidTimeoutResult(timeoutMs: number | undefined, options: { format: "json" | "pretty" }): string | undefined {
  if (timeoutMs !== undefined && !Number.isFinite(timeoutMs)) {
    return formatError(
      {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message: "timeoutMs must be a finite number",
      },
      options
    );
  }
  return undefined;
}

/**
 * `read --all` and `read-value --all` need machine-readable stdout. JSON is the default output
 * format, so only explicit non-JSON output is rejected for these multi-result paths.
 */
export function readAllRequiresJsonOutputError(options: {
  command: "read" | "read-value";
  format: "json" | "pretty";
}): string | undefined {
  const { command, format } = options;
  if (format !== "json") {
    return formatError(
      {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message:
          command === "read"
            ? 'read --all requires JSON output. The default output is JSON; do not use --output pretty for multi-result reads.\n\nExample:\n  androperator read --text "Price" --all'
            : 'read-value --all requires JSON output. The default output is JSON; do not use --output pretty for multi-result reads.\n\nExample:\n  androperator read-value --label "Battery" --all',
      },
      { format },
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HandlerContext = {
  argv: string[];
  rest: string[];
  format: "json" | "pretty";
  explicitJsonOutput: boolean;
  verbose: boolean;
  noDaemon: boolean;
  logger: Logger;
  deviceId?: string;
  operatorPackage?: string;
  timeoutMs?: number;
};

export interface CommandDef {
  name: string;
  synonyms?: string[];
  summary: string;
  help: string;
  subtopics?: Record<string, string>;
  topLevelBlock?: string;
  group: string;
  docsVisibility?: "normal" | "shim" | "alias";
  docsAliasOf?: string;
  documentedFlags?: string[];
  supportedFlags?: string[] | ((rest: string[]) => string[]);
  flagAliases?: readonly CliFlagAliasSpec[] | ((rest: string[]) => readonly CliFlagAliasSpec[]);
  handler: (ctx: HandlerContext) => Promise<string | void>;
}

// ---------------------------------------------------------------------------
// Help text constants (verbatim from original index.ts)
// ---------------------------------------------------------------------------

const HELP_OPERATOR_SETUP = `androperator operator setup

Usage:
  androperator operator setup --apk <path> [--device <id>] [--operator-package <package>] [--output <json|pretty>]

Required:
  --apk <path>              Local filesystem path to the Operator APK file

Optional:
  --device <id>          Target Android device serial (required when multiple devices are connected)
  --operator-package <pkg>  Operator package identifier (required when both release and debug variants are installed)

Notes:
  - This is the canonical setup command for the Androperator Operator APK.
  - Runs three phases in order: install, permission grant, verification.
  - Install phase: copies the APK onto the device via adb.
  - Permission grant phase: enables the accessibility service and notification listener.
  - Verification phase: confirms the package is visible to the package manager.
  - Fails with a structured error if any phase fails. The error code identifies which phase failed.
  - If omitted, setup auto-detects the package only when exactly one known Operator variant is installed.
  - If both release and debug variants are installed, pass --operator-package explicitly.
  - Do not use raw adb install for normal setup. It leaves the device in a partial state without required permissions.
  - operator install remains a compatibility alias for operator setup.
  - Use androperator grant-device-permissions only after the Operator APK crashes and Android revokes permissions.
`;

const HELP_OPERATOR_DOWNLOAD = `androperator operator download

Usage:
  androperator operator download [--operator-package <package>] [--output <json|pretty>]

Optional:
  --operator-package <pkg>  Operator package identifier. Automatic download currently supports com.androperator.operator only.

Notes:
  - This is the canonical surface for Operator APK metadata fetch, download, and checksum verification.
  - Writes the verified APK to ~/.androperator/downloads/operator.apk via getOperatorPackageApkPath(operatorPackage).
  - Returns structured JSON including localPath, operatorVersion, sha256, and operatorPackage.
  - The metadata source defaults to https://downloads.androperator.com/operator/latest.json.
  - Override the metadata source for testing with ANDROPERATOR_APK_METADATA_URL.
  - Non-release packages such as com.androperator.operator.dev must use a matching local debug APK instead of public download.
`;

const HELP_OPERATOR_REMEDIATE = `androperator operator remediate

Usage:
  androperator operator remediate [--operator-package <package>] [--output <json|pretty>]

Optional:
  --operator-package <pkg>  Operator package identifier to inspect and remediate across connected devices

Notes:
  - Enumerates all adb-visible devices and returns a structured per-device result.
  - Keeps doctor single-device by contract; remediation loops live here, not inside doctor.
  - Uses doctor reports to classify devices as ready, warning-only, remediated, adb-unready, or failed.
  - Reuses operator download/setup for APK remediation and doctor --fix only for single-device recovery such as handshake permission re-grants.
  - Exit code 0 means no connected device failed remediation.
  - adb-unready devices are still reported in the structured result, but they do not change the exit code by themselves.
  - Exit code 1 means at least one connected device still failed remediation.
`;

const HELP_OPERATOR = `androperator operator

Usage:
  androperator operator setup --apk <path> [--device <id>] [--operator-package <package>] [--output <json|pretty>]
  androperator operator download [--operator-package <package>] [--output <json|pretty>]
  androperator operator remediate [--operator-package <package>] [--output <json|pretty>]

Subcommands:
  setup     Install the Operator APK, grant required permissions, and verify readiness
  download  Fetch Operator APK metadata, download the release APK, and verify its checksum
  remediate Inspect connected devices and apply remediation policy
`;

const HELP_INSTALL = `androperator install

Usage:
  androperator install [--operator-package <package>] [--output <json|pretty>]

Optional:
  --operator-package <pkg>  Operator package identifier to remediate and record in host artifacts

Notes:
  - This is the canonical post-bootstrap install route after the CLI is installed.
  - install.sh delegates here after it finishes shell-owned prerequisite bootstrap.
  - Internally sequences: operator remediate, bundled-skills install, and host setup.
  - Returns stable JSON for automation and installer tests.
  - Pretty output is intended for installer pass-through and human review.
  - Exit code 1 means no connected device is ready, remediation still failed, or host setup failed.
  - Bundled-skills install, and the shared-agent bridge remain best-effort warnings when the core install is otherwise usable.
  - If multiple connected devices are ready, future commands must target one device explicitly with --device.
  - Use 'androperator operator setup --apk <path>' when you only need direct APK install, permission grant, and verification.
`;

const HELP_DAEMON = `androperator daemon

Usage:
  androperator daemon start [--device <id>] [--operator-package <package>] [--output <json|pretty>]
  androperator daemon stop [--device <id>] [--output <json|pretty>]
  androperator daemon status [--device <id>] [--output <json|pretty>]
  androperator daemon restart [--device <id>] [--operator-package <package>] [--output <json|pretty>]

Subcommands:
  start    Start the background daemon process for the selected device key
  stop     Stop the daemon process and clean up PID and socket files
  status   Report daemon liveness, PID, version, uptime, and socket path
  restart  Stop then start the daemon process

Notes:
  - The daemon uses a Unix domain socket under ~/.androperator/daemon/.
  - The daemon run subcommand is internal and is intentionally omitted from help.
`;


const HELP_BUNDLED_SKILLS_INSTALL = `androperator bundled-skills install

Usage:
  androperator bundled-skills install [--output <json|pretty>]

Notes:
  - Copies packaged first-party bundled skills to ~/.androperator/bundled-skills/
  - Installs the packaged bundled-skill front doors that help host agents operate Androperator
  - Creates Claude Code, Codex, and generic agents discovery directories unconditionally
  - Symlinks each installed skill into ~/.claude/skills/ and the Codex skills dir
  - Copies each installed skill into ~/.agents/skills/ for generic agent runtimes
  - Use 'androperator bundled-skills list' after install to inspect the available host-agent helpers on this machine
`;

const HELP_BUNDLED_SKILLS_UPDATE = `androperator bundled-skills update

Usage:
  androperator bundled-skills update [--output <json|pretty>]

Notes:
  - Re-copies packaged first-party bundled skills into ~/.androperator/bundled-skills/
  - Groups discovery directory aliases by physical path
  - Uses managed copies for groups containing ~/.agents/skills/; otherwise uses symlinks
  - Backs up exact known legacy first-party copies before migration
  - Verifies discovery ownership before reporting success
  - Refreshes generic agents discovery copies in ~/.agents/skills/
  - Safe to run multiple times
`;

const HELP_BUNDLED_SKILLS_LIST = `androperator bundled-skills list

Usage:
  androperator bundled-skills list [--output <json|pretty>]

Notes:
  - Lists installed first-party bundled skills from ~/.androperator/bundled-skills/
  - Shows the absolute SKILL.md path for each installed bundled skill
  - Use this when you need to inspect the installed host-agent helpers on this machine
  - 'androperator-agent-orientation' is the first-run orientation skill for unfamiliar hosts
  - 'androperator-agent-control-loop' guides bounded adaptive execution and optional authoring of reusable instructions
  - 'androperator-upgrade' is the whole-product upgrade route that checks androperator --version, verifies Node 24+, npm reachability, and Java 17/21, then uses npm install -g androperator@latest, androperator install, and androperator doctor when the CLI is already viable
  - 'androperator-skill-author-by-agent-discovery' supports bounded exploration and optional instruction authoring
  - 'androperator-skill-author-by-recording' uses optional human demonstration as evidence for adaptive instructions
`;

const HELP_HOST = `androperator host

Usage:
  androperator host setup [--installed-at <iso8601>] [--cli-version <version>] [--apk-version <version>] [--last-device-serial <serial>] [--output <json|pretty>]

Notes:
  - Sets up CLI-owned durable host artifacts under ~/.androperator/.
  - Writes install-state JSON, MCP config snippet JSON, local AGENTS.md, and the shared-agent bridge when ~/.agents/AGENTS.md exists.
  - Reports per-artifact outcomes as written, updated, skipped, or failed.
  - Safe to rerun. Unchanged artifacts are reported as skipped.
  - Use --installed-at to pin install-state output deterministically for tests or installer orchestration.
  - Use --cli-version when an installer wrapper needs the setup install-state to reflect the wrapper-reported CLI version exactly.
`;

const HELP_RECORDING = `androperator recording

Usage:
  androperator recording start|stop|pull|export ... ('record' is an alias)
`;

const HELP_RECORDING_EXPORT = `androperator recording export

Usage:
  androperator recording export --input <file|directory> [--out <file>] [--snapshots <omit|include>] [--output <json|pretty>]
  androperator record export --input <file|directory> [--out <file>] [--snapshots <omit|include>] [--output <json|pretty>]

Options:
  --input <file|directory>       Local NDJSON recording file, or a directory resolved to the newest *.ndjson recording
  --out <file>                   Output JSON file path
  --snapshots <omit|include>     Snapshot XML mode (default: omit)

Notes:
  - Replaces a trailing .ndjson suffix with .export.json when --out is omitted.
  - Otherwise appends .export.json to the input path when --out is omitted.
  - Preserves raw recording evidence for agent or human review.
  - Does not generate skill logic, selectors, or parameters.
`;

const HELP_DOCTOR = `androperator doctor

Usage:
  androperator doctor [--output <json|pretty>] [--device <id>] [--operator-package <package>] [--verbose]
  androperator doctor --fix
  androperator doctor --full
  androperator doctor --check-only

Notes:
  - Default Operator package: com.androperator.operator
  - Use --operator-package com.androperator.operator.dev for local debug APKs. --receiver-package is a legacy alias (see global options).
  - Exit code 0 means every required check for the selected mode ran and passed.
  - Exit code 1 means readiness is unverified, including device ambiguity, a missing selected APK, or handshake failure.
  - --check-only uses the same readiness exit status. Missing prerequisite checks appear in skippedChecks.
  - --fix attempts shell remediation once, then reruns checks before reporting readiness.
  - Log-path and optional host-tool warnings do not block healthy device readiness.
  - If handshake times out, rerun with --verbose and compare the installed APK package with --operator-package.
`;

const HELP_VERSION = `androperator version

Usage:
  androperator version
  androperator version --check-compat [--device <id>] [--operator-package <package>] [--output <json|pretty>]

  Notes:
  - Default Operator package: com.androperator.operator
  - Use --operator-package com.androperator.operator.dev for local debug APKs. --receiver-package is a legacy alias (see global options).
  - --check-compat compares the CLI version with the installed APK version on the device.
`;

const HELP_GRANT_DEVICE_PERMISSIONS = `androperator grant-device-permissions

Usage:
  androperator grant-device-permissions [--device <id>] [--operator-package <package>] [--output <json|pretty>]

Notes:
  - Default Operator package: com.androperator.operator
  - Use --operator-package com.androperator.operator.dev for local debug APKs. --receiver-package is a legacy alias (see global options).
  - Grants accessibility, notification posting, and notification listener permissions via adb.
  - This command is for crash recovery only. Use it when the Operator APK crashes and Android revokes permissions.
  - For normal setup, always use androperator operator setup instead.
`;

const HELP_SNAPSHOT = `androperator snapshot — Get current Android UI hierarchy as XML

Usage:
  androperator snapshot [--device <id>] [--operator-package <pkg>]

Options:
  --compact             Return a bounded JSON hierarchy projection
  --max-nodes <n>       Compact node limit: 1..1000 (default: 100)
  --max-text-chars <n>  Compact per-field code point limit: 1..4096 (default: 256)
  --raw-path <file>     Save exact XML to a new host file (must not exist)
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait for snapshot (default: 30000ms)
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id

Notes:
  - If the current host is unfamiliar, inspect 'androperator bundled-skills list' and start with 'androperator-agent-orientation' before driving the raw CLI directly.

Examples:
  androperator snapshot
  androperator snapshot --device <device_serial>
`;

const HELP_SCREENSHOT = `androperator screenshot — Capture device screen

Usage:
  androperator screenshot [--path <file>] [--device <id>] [--operator-package <pkg>]

Options:
  --path <file>          Save PNG to file path (if omitted, output is base64)
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait (default: 30000ms)
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id, --file

Result geometry:
  captureWidthPx and captureHeightPx describe the original PNG in pixels, with a top-left origin.
  Resized previews use different coordinates; scale back to the original image first.
  Verify current display geometry before using image coordinates for clicks.

Examples:
  androperator screenshot --path /tmp/screen.png
  androperator screenshot --device <device_serial>
`;

const HELP_CLICK = `androperator click — Tap a UI element by selector or coordinates

Usage:
  androperator click --text "Login" [--device <id>] [--operator-package <pkg>]
  androperator click --id "btn_submit" [--device <id>] [--operator-package <pkg>]
  androperator click --coordinate 100 200 [--device <id>] [--operator-package <pkg>]

Selector flags (choose one):
  --text <string>        Click element with matching visible text
  --id <string>          Click element with matching resource ID
  --coordinate <x> <y>   Click at exact coordinates (pixels)
  --desc <string>        Click element with matching content description
  --role <string>        Click element of matching role (e.g. button)
  --selector <json>      Click using advanced NodeMatcher JSON

Options:
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait for element (default: 10000)
  --long                 Perform a long press (clickType: long_click)
  --focus                Set input focus without clicking (clickType: focus)
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id, tap, --resource-id, --content-desc, --content-desc-contains

Examples:
  androperator click --text "Submit"
  androperator click --id "login_button" --device <device_serial>
`;

const HELP_OPEN = `androperator open — Open an Android app or URL

Usage:
  androperator open <package-id> [--device <id>] [--operator-package <pkg>]
  androperator open <url_or_uri> [--device <id>] [--operator-package <pkg>]

Target types:
  Package ID (e.g. com.android.settings) uses open_app
  URL/URI (e.g. https://google.com) uses open_uri

Options:
  --app <target>         Alternative to positional target argument
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait
  --navigation-timeout-ms <ms>  Foreground readiness wait budget for package targets
  --skip-navigation-wait Skip the foreground readiness wait after launching a package
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id, open-app, open_app, open-uri, open-url, open_uri, open_url, --package, --package-id, --application-id, --app-id, --url, --uri

Examples:
  androperator open com.android.settings
  androperator open https://androperator.com
`;

const HELP_TYPE = `androperator type — Type text into a UI element

Usage:
  androperator type "hello world" --id "search_box" [--device <id>] [--operator-package <pkg>]
  androperator type "admin" --text "Username" [--device <id>] [--operator-package <pkg>]

Text to type:
  Positional argument (e.g. "hello world") or --text <string> if not using --text as a selector.

Selector flags (choose one):
  --id <string>          Match element by resource ID
  --role <string>        Match element by role
  --desc <string>        Match element by content description
  --selector <json>      Raw NodeMatcher JSON

Options:
  --output <json|pretty> Output format (default: json)
  --submit               Press Enter after typing
  --clear                Clear existing text before typing
  --timeout <ms>         Max time to wait for element
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id, fill, enter-text, enter_text, --resource-id, --content-desc, --content-desc-contains

Examples:
  androperator type "hello world" --role textfield
  androperator type "search query" --id "com.example:id/search_box" --submit
`;

const HELP_READ_VALUE = `androperator read-value — Read value associated with a labeled element

Usage:
  androperator read-value --label "Battery"
  androperator read-value --label-id "battery_label"

Label selector flags (choose one):
  --label <string>       Match label by exact visible text
  --label-id <string>    Match label by Android resource ID
  --label-desc <string>  Match label by exact content description

Options:
  --all                  Return all matches as a JSON array (not compatible with --output pretty)
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id, read-kv, read-key-value-pair, read_key_value_pair, --text, --label-text, --id, --resource-id, --desc, --content-desc

Examples:
  androperator read-value --label "Battery"
  androperator read-value --label "Wi-Fi" --all
`;

const HELP_READ = `androperator read — Read text content from a UI element

Usage:
  androperator read --text "Price" [--device <id>] [--operator-package <pkg>]
  androperator read --id "tv_price" [--device <id>] [--operator-package <pkg>]

Selector flags (choose one):
  --text <string>        Match element by visible text
  --id <string>          Match element by resource ID
  --desc <string>        Match element by content description
  --role <string>        Match element by role
  --selector <json>      Match using advanced NodeMatcher JSON

Options:
  --all                  Return all matches as a JSON array (not compatible with --output pretty)
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait for element
  --no-daemon            Force direct execution instead of daemon proxy

Container selector flags (all optional):
  --container-text <text>           Container with exact visible text
  --container-text-contains <text>  Container with partial text match
  --container-id <resource-id>      Container by Android resource ID
  --container-desc <text>           Container by exact content description
  --container-desc-contains <text>  Container by partial content description
  --container-role <role>           Container by element role
  --container-selector <json>       Container by raw NodeMatcher JSON

Also accepted as: --device-id, read-text, read_text, --resource-id, --content-desc, --content-desc-contains, --container-resource-id, --container-content-desc, --container-content-desc-contains

Examples:
  androperator read --id "com.example:id/battery_level"
  androperator read --text "Battery"
  androperator read --text "Price" --all
`;

const HELP_WAIT = `androperator wait

Usage:
  androperator wait --text <text> [--device <id>] [--operator-package <pkg>] [--timeout <ms>]
  androperator wait --id <resource-id> [--device <id>] [--operator-package <pkg>] [--timeout <ms>]
  androperator wait --role <role> [--device <id>] [--operator-package <pkg>] [--timeout <ms>]
  androperator wait --desc <text> [--device <id>] [--operator-package <pkg>] [--timeout <ms>]
  androperator wait --selector '<json>' [--device <id>] [--operator-package <pkg>] [--timeout <ms>]

Selector flags (at least one required; combine for AND matching):
  --text <text>           Exact visible text
  --text-contains <text>  Partial text match
  --id <resource-id>      Android resource ID
  --desc <text>           Exact content description
  --desc-contains <text>  Partial content description
  --role <role>           Element role
  --selector <json>       Raw NodeMatcher JSON (advanced; mutually exclusive with simple flags)

Notes:
  - Waits until the first matching element appears.
  - --timeout sets the wait duration (not the execution envelope timeout); must be a positive number of milliseconds when provided (omit it to use the default).
  - Use --no-daemon to force direct execution instead of daemon proxy.
  - Execution timeout is set to max(waitTimeout + 5000, globalTimeout) to prevent early termination.
  - Default wait timeout is 30000ms (30 seconds) when --timeout is not specified.
  - Multiple simple flags combine with AND semantics.

Also accepted as:
  find, find-node, find_node, wait-for, wait_for, wait-for-node, wait_for_node
  --resource-id, --content-desc, --content-desc-contains

Examples:
  androperator wait --text "Done"
  androperator wait --id "com.example:id/progress" --timeout 10000
  androperator wait --role button --text-contains "OK"
  Advanced (raw NodeMatcher JSON): androperator wait --selector '{"textEquals":"Done"}'
`;

const HELP_WAIT_FOR_NAV = `androperator wait-for-nav — Wait for app or screen transition

Usage:
  androperator wait-for-nav --app com.google.home --timeout 5000 [--device <id>] [--operator-package <pkg>]
  androperator wait-for-nav --text "Settings" --timeout 5000 [--device <id>] [--operator-package <pkg>]

Required (choose one or both):
  --app <package>        Wait until this app is in the foreground
  --text <string>        Wait until element with exact visible text appears
  --id <string>          Wait until element with this Android resource ID appears
  ... (and other selector flags like --desc, --role)

Options:
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Required. Maximum time to wait (1-30000ms)
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id, wait-for-navigation, wait_for_navigation, --package, --package-id, --application-id, --app-id, --resource-id, --content-desc, --content-desc-contains

Examples:
  androperator wait-for-nav --app com.google.home --timeout 5000
  androperator wait-for-nav --text "Settings" --timeout 5000
`;

const HELP_PRESS = `androperator press — Send navigation keys and TV remote buttons

Usage:
  androperator press <key> [--device <id>] [--operator-package <pkg>]

Valid keys:
  back       Navigate to previous screen
  home       Return to home screen
  recents    Open recent apps
  dpad_up, dpad_down, dpad_left, dpad_right  Move TV focus
  dpad_center Select the focused item
  bookmark   Send the TV watchlist/bookmark key
  profile    Send the emulator dashboard key (notification)
  settings   Open Android TV settings
  tv         Open the emulator Live Channels activity

Options:
  --key <name>           System key to press (alias for positional arg)
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id, press-key, press_key, --button

Examples:
  androperator press home
  androperator press back
`;

const HELP_BACK = `androperator back — Navigate to the previous screen

Usage:
  androperator back [--device <id>] [--operator-package <pkg>]

Options:
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id

Examples:
  androperator back
`;

const HELP_CLOSE = `androperator close

Usage:
  androperator close <package> [--device <id>] [--operator-package <pkg>] [--timeout <ms>]
  androperator close --app <package> [--device <id>] [--operator-package <pkg>] [--timeout <ms>]

Required:
  <package>             Android application package ID (e.g., com.android.settings)
  --app <package>       Alternative to positional argument

Synonym:
  close-app, close_app  Same as close

Options:
  --no-daemon            Force direct execution instead of daemon proxy

Notes:
  - Force-stops the specified application via adb.
  - The close_app action runs as a pre-flight in the Node layer before broadcast dispatch.
  - Requires the target app to be installed (does not need to be running).

Also accepted as:
  --package, --package-id, --application-id, --app-id

Examples:
  androperator close com.android.settings
  androperator close com.google.android.apps.chromecast.app
  androperator close-app com.android.settings
`;

const HELP_SLEEP = `androperator sleep

Usage:
  androperator sleep <ms> [--device <id>] [--operator-package <pkg>]

Required:
  <ms>                    Duration in milliseconds (non-negative)

Notes:
  - Pauses execution for the specified duration.
  - Duration must be >= 0 and <= ${LIMITS.MAX_EXECUTION_TIMEOUT_MS}ms.
  - Execution timeout is set to max(durationMs + 5000, globalTimeout, 30000).
  - No selector flags - this is a raw timer.
  - Use --no-daemon to force direct execution instead of daemon proxy.

Examples:
  androperator sleep 2000
  androperator sleep 500
  androperator sleep 0
`;

const HELP_SCROLL = `androperator scroll — Scroll the screen in a given direction

Usage:
  androperator scroll down [--device <id>] [--operator-package <pkg>]
  androperator scroll up --container-id "list" [--device <id>] [--operator-package <pkg>]

Valid directions:
  down, up, left, right

Container selector flags (optional, restrict scroll to specific container):
  --container-id <id>    Container by Android resource ID
  --container-text <txt> Container with exact visible text
  --container-role <role> Container by element role

Options:
  --direction <dir>      Direction to scroll (alias for positional arg)
  --output <json|pretty> Output format (default: json)
  --timeout <ms>         Max time to wait (default: 30000ms)
  --no-daemon            Force direct execution instead of daemon proxy

Also accepted as: --device-id, --container-resource-id, --container-content-desc, --container-content-desc-contains

Examples:
  androperator scroll down
  androperator scroll up --container-id "com.example:id/list_view"
`;

const HELP_SCROLL_UNTIL = `androperator scroll-until

Usage:
  androperator scroll-until [<direction>] --text <text> [--click] [--device <id>] [--operator-package <pkg>] [--timeout <ms>]
  androperator scroll-until [<direction>] --id <resource-id> [--click] [--device <id>] [--operator-package <pkg>] [--timeout <ms>]

Valid directions:
  down, up, left, right (default: down)

Selector flags (one is required):
  --text <text>           Target element with exact visible text
  --text-contains <text>  Target element with partial text match
  --id <resource-id>      Target element by Android resource ID
  --desc <text>           Target element by exact content description
  --desc-contains <text>  Target element by partial content description
  --role <role>           Target element by element role
  --selector <json>       Target element by raw NodeMatcher JSON (mutually exclusive with simple flags)

Container selector flags (all optional; restrict scroll to a specific scrollable container):
  --container-text <text>           Container with exact visible text
  --container-text-contains <text>  Container with partial text match
  --container-id <resource-id>      Container by Android resource ID
  --container-desc <text>           Container by exact content description
  --container-desc-contains <text>  Container by partial content description
  --container-role <role>           Container by element role
  --container-selector <json>       Container by raw NodeMatcher JSON

Options:
  --direction <dir>      Direction to scroll (alias for positional arg)
  --click    Click the target element after scrolling to it (becomes scroll_and_click action)
  --no-daemon            Force direct execution instead of daemon proxy

Notes:
  - Synonym: scroll-and-click (implies --click)
  - Without --click, the action type is scroll_until (scroll until element is visible).
  - With --click, the action type is scroll_and_click (scroll until visible, then click).
  - scroll_and_click uses different defaults than raw scroll_until (see agent guide); use exec JSON if you need scroll_until + clickAfter.
  - If a selector is provided but the target never appears, the step fails (data.error TARGET_NOT_FOUND) and JSON output exits non-zero.
  - Tuning parameters (maxScrolls, maxDurationMs, etc.) are not exposed as CLI flags.
    Use 'androperator exec' with raw JSON for advanced tuning.

Examples:
  androperator scroll-until --text "About phone"
  androperator scroll-until --text "Living room" --click
  androperator scroll-until up --text "Settings" --container-id "com.foo:id/list"
  androperator scroll-and-click --text "Submit"  (same as scroll-until --text "Submit" --click)
`;

const HELP_EMULATOR = `androperator emulator

Usage:
  androperator emulator list [--output <json|pretty>]
  androperator emulator inspect <name> [--output <json|pretty>]
  androperator emulator create [--name <name>] [--storage-size <sizeG>] [--output <json|pretty>]
  androperator emulator start <name> [--output <json|pretty>]
  androperator emulator stop <name> [--output <json|pretty>]
  androperator emulator delete <name> [--output <json|pretty>]
  androperator emulator status [--output <json|pretty>]
  androperator emulator provision [--storage-size <sizeG>] [--output <json|pretty>]
  androperator provision emulator [--storage-size <sizeG>] [--output <json|pretty>]

Notes:
  - Emulator provisioning prefers: running supported emulator, stopped supported AVD, then new AVD creation.
  - New AVDs target Android API 35, a Google Play image, and a 12G data partition by default.
  - When --name is omitted, the AVD name includes the storage size, for example androperator-pixel-12gb.
  - --storage-size accepts positive integer gigabyte values such as 12G, 12GB, or 16G.
  - --size, --disk-size, and --data-partition-size are accepted as aliases.
  - JSON is the canonical output format for agent callers.
`;

// ---------------------------------------------------------------------------
// COMMANDS registry
// ---------------------------------------------------------------------------

export const COMMANDS: Record<string, CommandDef> = {};

const OPEN_TARGET_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--app", aliases: ["--package", "--package-id", "--application-id", "--app-id", "--uri", "--url"] },
] as const;

const CLOSE_TARGET_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--app", aliases: ["--package", "--package-id", "--application-id", "--app-id"] },
] as const;

const EXEC_PAYLOAD_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--payload", aliases: ["--execution", "--input", "--file"] },
] as const;

const SCREENSHOT_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--path", aliases: ["--file"] },
] as const;

const PRESS_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--key", aliases: ["--button"] },
] as const;

const WAIT_FOR_NAV_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--app", aliases: ["--package", "--package-id", "--application-id", "--app-id"] },
  ...ELEMENT_SELECTOR_FLAG_ALIASES,
] as const;

const READ_VALUE_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--label", aliases: ["--text", "--label-text"] },
  { canonical: "--label-id", aliases: ["--id", "--resource-id"] },
  { canonical: "--label-desc", aliases: ["--desc", "--content-desc"] },
] as const;

const SERVE_FLAG_ALIASES: readonly CliFlagAliasSpec[] = [
  { canonical: "--host", aliases: ["--bind"] },
] as const;

// operator
COMMANDS["operator"] = {
  name: "operator",
  group: "Setup",
  documentedFlags: ["--apk", "--operator-package"],
  supportedFlags: (rest) => {
    const sub = rest[0];
    if (sub === "setup" || sub === "install") return ["--apk"];
    return [];
  },
  summary: "Install the Operator APK and configure the device",
  help: HELP_OPERATOR,
  subtopics: {
    setup: HELP_OPERATOR_SETUP,
    install: HELP_OPERATOR_SETUP,
    download: HELP_OPERATOR_DOWNLOAD,
    remediate: HELP_OPERATOR_REMEDIATE,
  },
  topLevelBlock: `  operator setup --apk <path> [--device <id>] [--operator-package <package>]
                                            Install the Operator APK, grant required permissions, and verify readiness

  operator download [--operator-package <package>]
                                            Download and verify the release Operator APK to the canonical local path

  operator remediate [--operator-package <package>]
                                            Inspect connected devices and apply remediation policy`,
  handler: async (ctx) => {
    const { rest, format, verbose, logger, deviceId, operatorPackage } = ctx;
    const out = { format, verbose, logger };
    const sub = rest[0];
    if (sub === "setup" || sub === "install") {
      const apkPath = getOpt(rest, "--apk");
      if (!apkPath) {
        return JSON.stringify({ code: "USAGE", message: `operator ${sub ?? "setup"} requires --apk <path>. Use androperator operator setup --help for details.` });
      } else {
        return (await import("./commands/operatorSetup.js")).cmdOperatorSetup({
          ...out,
          apkPath,
          deviceId,
          operatorPackage,
        });
      }
    } else if (sub === "download") {
      return (await import("./commands/operatorDownload.js")).cmdOperatorDownload({
        ...out,
        operatorPackage,
      });
    } else if (sub === "remediate") {
      if (deviceId) {
        throw new UsageError("operator remediate does not accept --device. It enumerates connected devices itself.");
      }
      return (await import("./commands/operatorRemediate.js")).cmdOperatorRemediate({
        ...out,
        operatorPackage,
        logger,
      });
    } else {
      return JSON.stringify({
        code: "USAGE",
        message: sub
          ? `Unknown operator subcommand '${sub}'. Use: androperator operator setup --apk <path>, androperator operator download, or androperator operator remediate`
          : "Use: androperator operator setup --apk <path>, androperator operator download, or androperator operator remediate",
      });
    }
  },
};

// host
COMMANDS["host"] = {
  name: "host",
  group: "Setup",
  documentedFlags: ["--installed-at", "--cli-version", "--apk-version", "--last-device-serial"],
  supportedFlags: (rest) => {
    const sub = rest[0];
    if (sub === "setup") {
      return ["--installed-at", "--cli-version", "--apk-version", "--last-device-serial"];
    }
    return [];
  },
  summary: "Set up durable host artifacts owned by the CLI",
  help: HELP_HOST,
  subtopics: {
    setup: HELP_HOST,
  },
  topLevelBlock: `  host setup [--installed-at <iso8601>] [--cli-version <version>] [--apk-version <version>] [--last-device-serial <serial>]
                                            Write install-state, MCP snippet, local AGENTS.md, and the shared-agent bridge`,
  handler: async (ctx) => {
    const { rest, format, verbose } = ctx;
    const sub = rest[0];
    if (sub === "setup") {
      return (await import("./commands/host.js")).cmdHostSetup({
        format,
        verbose,
        installedAt: getStringOptStrict(rest, "--installed-at", ["--installed-at", "--cli-version", "--apk-version", "--last-device-serial"]),
        cliVersion: getStringOptStrict(rest, "--cli-version", ["--installed-at", "--cli-version", "--apk-version", "--last-device-serial"]),
        apkVersion: getStringOptStrict(rest, "--apk-version", ["--installed-at", "--cli-version", "--apk-version", "--last-device-serial"]),
        lastDeviceSerial: getStringOptStrict(rest, "--last-device-serial", ["--installed-at", "--cli-version", "--apk-version", "--last-device-serial"]),
      });
    }

    return JSON.stringify({
      code: "USAGE",
      message: sub
        ? `Unknown host subcommand '${sub}'. Use: androperator host setup`
        : "Use: androperator host setup",
    });
  },
};

// setup
COMMANDS["setup"] = {
  name: "setup",
  group: "Setup",
  docsVisibility: "shim",
  documentedFlags: [],
  summary: "Alias guidance - use operator setup instead",
  help: HELP_OPERATOR_SETUP,
  handler: async (_ctx) => {
    return JSON.stringify({
      code: "USAGE",
      message: "androperator setup is not a valid top-level command. Use: androperator operator setup --apk <path>",
      canonical: "androperator operator setup --apk <path> [--device <id>] [--operator-package <package>]",
    });
  },
};

// install
COMMANDS["install"] = {
  name: "install",
  group: "Setup",
  summary: "Run the CLI-owned post-bootstrap install flow for device remediation, bundled skills, and host setup",
  help: HELP_INSTALL,
  topLevelBlock: `  install [--operator-package <package>]
                                            Run the CLI-owned post-bootstrap remediation, bundled-skills install, and host setup`,
  documentedFlags: ["--operator-package"],
  handler: async (ctx) => {
    const { format, deviceId, operatorPackage, logger } = ctx;
    if (deviceId) {
      throw new UsageError("install does not accept --device. It remediates connected devices itself and records the last ready device automatically.");
    }
    return (await import("./commands/install.js")).cmdInstall({ format, operatorPackage, logger });
  },
};

// devices
COMMANDS["devices"] = {
  name: "devices",
  group: "Device Management",
  documentedFlags: [],
  supportedFlags: [],
  summary: "List connected Android devices",
  help: "androperator devices\n\nUsage:\n  androperator devices\n\nNotes:\n  - Lists all connected Android devices detected via adb.\n",
  topLevelBlock: `  devices                                   List connected Android devices`,
  handler: async (ctx) => {
    const { format, verbose, logger } = ctx;
    return (await import("./commands/devices.js")).cmdDevices({ format, verbose, logger });
  },
};

// emulator
COMMANDS["emulator"] = {
  name: "emulator",
  group: "Device Management",
  documentedFlags: ["--name", "--storage-size"],
  supportedFlags: (rest) => {
    const sub = rest[0];
    if (sub === "create") return ["--name", "--storage-size", "--size", "--disk-size", "--data-partition-size"];
    if (sub === "provision") return ["--storage-size", "--size", "--disk-size", "--data-partition-size"];
    return [];
  },
  summary: "Manage Android emulators (AVDs)",
  help: HELP_EMULATOR,
  subtopics: {
    list: HELP_EMULATOR,
    inspect: HELP_EMULATOR,
    create: HELP_EMULATOR,
    start: HELP_EMULATOR,
    stop: HELP_EMULATOR,
    delete: HELP_EMULATOR,
    status: HELP_EMULATOR,
    provision: HELP_EMULATOR,
  },
  topLevelBlock: `  emulator list                             List configured Android emulators (AVDs)
  emulator inspect <name>                   Show normalized metadata for one AVD
  emulator create [--name <name>]           Create a supported Google Play AVD
  emulator start <name>                     Start an AVD and wait until Android is ready
  emulator stop <name>                      Stop a running emulator by AVD name
  emulator delete <name>                    Delete an AVD by name
  emulator status                           List running emulators and boot state
  emulator provision                        Reuse or create a supported emulator
  provision emulator                        Alias of emulator provision`,
  handler: async (ctx) => {
    const { rest, format, verbose, logger } = ctx;
    const out = { format, verbose, logger };
    const sub = rest[0];
    if (sub === "list") {
      return (await import("./commands/emulator.js")).cmdEmulatorList(out);
    } else if (sub === "inspect") {
      return rest[1]
        ? (await import("./commands/emulator.js")).cmdEmulatorInspect(rest[1], out)
        : JSON.stringify({ code: "USAGE", message: "emulator inspect <name>" });
    } else if (sub === "create") {
      return (await import("./commands/emulator.js")).cmdEmulatorCreate({
        ...out,
        name: getOpt(rest, "--name"),
        dataPartitionSize: getEmulatorStorageSizeOpt(rest, ["--name", "--storage-size", "--size", "--disk-size", "--data-partition-size"]),
      });
    } else if (sub === "start") {
      return rest[1]
        ? (await import("./commands/emulator.js")).cmdEmulatorStart(rest[1], out)
        : JSON.stringify({ code: "USAGE", message: "emulator start <name>" });
    } else if (sub === "stop") {
      return rest[1]
        ? (await import("./commands/emulator.js")).cmdEmulatorStop(rest[1], out)
        : JSON.stringify({ code: "USAGE", message: "emulator stop <name>" });
    } else if (sub === "delete") {
      return rest[1]
        ? (await import("./commands/emulator.js")).cmdEmulatorDelete(rest[1], out)
        : JSON.stringify({ code: "USAGE", message: "emulator delete <name>" });
    } else if (sub === "status") {
      return (await import("./commands/emulator.js")).cmdEmulatorStatus(out);
    } else if (sub === "provision") {
      return (await import("./commands/emulator.js")).cmdProvisionEmulator({
        ...out,
        dataPartitionSize: getEmulatorStorageSizeOpt(rest, ["--storage-size", "--size", "--disk-size", "--data-partition-size"]),
      });
    } else {
      return JSON.stringify({ code: "USAGE", message: "emulator list|inspect|create|start|stop|delete|status|provision" });
    }
  },
};

// provision
COMMANDS["provision"] = {
  name: "provision",
  group: "Device Management",
  docsVisibility: "alias",
  docsAliasOf: "emulator provision",
  documentedFlags: ["--storage-size"],
  supportedFlags: (rest) => rest[0] === "emulator" ? ["--storage-size", "--size", "--disk-size", "--data-partition-size"] : [],
  summary: "Provision an Android emulator",
  help: HELP_EMULATOR,
  subtopics: {
    emulator: HELP_EMULATOR,
  },
  handler: async (ctx) => {
    const { rest, format, verbose, logger } = ctx;
    const out = { format, verbose, logger };
    if (rest[0] === "emulator") {
      return (await import("./commands/emulator.js")).cmdProvisionEmulator({
        ...out,
        dataPartitionSize: getEmulatorStorageSizeOpt(rest, ["--storage-size", "--size", "--disk-size", "--data-partition-size"]),
      });
    } else {
      return JSON.stringify({ code: "USAGE", message: "provision emulator" });
    }
  },
};

// packages
COMMANDS["packages"] = {
  name: "packages",
  group: "Device Management",
  documentedFlags: ["--third-party"],
  supportedFlags: ["--third-party"],
  summary: "List installed packages on a device",
  help: "androperator packages list\n\nUsage:\n  androperator packages list [--device <id>] [--operator-package <pkg>] [--third-party]\n",
  topLevelBlock: `  packages list [--device <id>] [--operator-package <pkg>] [--third-party]
                                            List installed package IDs on a device`,
  handler: async (ctx) => {
    const { rest, format, verbose, logger, deviceId } = ctx;
    const out = { format, verbose, logger };
    if (rest[0] === "list") {
      return (await import("./commands/packages.js")).cmdPackagesList({
        ...out,
        deviceId,
        thirdParty: hasFlag(rest, "--third-party"),
      });
    } else {
      return JSON.stringify({ code: "USAGE", message: "packages list [--device <id>] [--operator-package <pkg>] [--third-party]" });
    }
  },
};

// exec (synonym: execute). Payload: positional <json-or-file>, --payload, or payload aliases. Public CLI reference must stay aligned.
COMMANDS["exec"] = {
  name: "exec",
  synonyms: ["execute"],
  group: "Execution",
  flagAliases: EXEC_PAYLOAD_FLAG_ALIASES,
  documentedFlags: ["--payload", "--validate-only", "--dry-run", "--goal", "--no-daemon"],
  supportedFlags: (rest) =>
    rest[0] === "best-effort"
      ? ["--payload", "--validate-only", "--dry-run", "--goal"]
      : ["--payload", "--validate-only", "--dry-run", "--no-daemon"],
  summary: "Execute a validated command payload",
  help: `androperator exec

Usage:
  androperator exec <json-or-file> [--validate-only] [--dry-run] [--device <id>] [--operator-package <package>]
  androperator exec --payload <json-or-file> [--validate-only] [--dry-run] [--device <id>] [--operator-package <package>]
  androperator exec best-effort --goal <text> [--device <id>] [--operator-package <package>]

Payload (one of):
  <json-or-file>            Positional: inline JSON or path to a JSON file (see Notes)

Options:
  --payload <json-or-file>  Same as positional payload (primary named form)
  --execution <json-or-file> Alias for --payload (backward compatibility)
  --input <json-or-file>     Alias for --payload
  --file <json-or-file>      Alias for --payload
  --validate-only           Validate payload without executing
  --dry-run                 Print execution plan without running
  --no-daemon               Force direct execution instead of daemon proxy

Notes:
  - Leading '{' is always parsed as inline JSON. Leading '[' tries the string as a file path first; if the file is missing, it is parsed as an inline JSON array. Any other string is read as a file path.
  - Error precedence: unreadable file path -> invalid JSON content -> missing payload.
  - 'execute' is accepted as a synonym for 'exec'.
  - '--execution', '--input', and '--file' are accepted aliases for '--payload'.
  - Use --no-daemon to force direct execution for this call.
  - If the current host is unfamiliar, inspect 'androperator bundled-skills list' and start with 'androperator-agent-orientation' before driving the raw CLI directly.
`,
  topLevelBlock: `  exec <json-or-file> [--validate-only] [--dry-run] [--device <id>] [--operator-package <package>]
                                            Execute a validated command payload or print a dry-run plan
  exec best-effort --goal <text> [--device <id>] [--operator-package <package>]
                                            Produce deterministic next-action suggestion from current UI`,
  handler: async (ctx) => {
    const { rest, format, verbose, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
    const out = { format, verbose, logger };
    if (rest[0] === "best-effort") {
      const goal = getOpt(rest, "--goal");
      return JSON.stringify({
        code: "NOT_IMPLEMENTED",
        message: "exec best-effort is Stage 1 limited; use snapshot + agent reasoning for now",
        goal,
      });
    } else {
      // Support --payload (primary), --execution (alias), or positional argument
      let payloadSource: string | undefined = getOpt(rest, "--payload") ?? getOpt(rest, "--execution");
      if (!payloadSource) {
        // Check for positional argument (first non-flag token), including dash-prefixed
        // file paths that have already passed the unknown-flag preflight.
        const skipFlags = new Set(["--payload", "--execution", "--validate-only", "--dry-run", "--no-daemon"]);
        for (let i = 0; i < rest.length; i += 1) {
          const token = rest[i];
          if (token === "--") {
            break;
          }
          if (skipFlags.has(token)) {
            if (token === "--payload" || token === "--execution") {
              i += 1;
            }
            continue;
          }
          payloadSource = token;
          break;
        }
      }
      if (!payloadSource) {
        return formatError({ code: ERROR_CODES.MISSING_ARGUMENT, message: "exec requires a payload. Use: androperator exec <json-or-file> or androperator exec --payload <json-or-file>" }, { format });
      } else {
        return (await import("./commands/execute.js")).cmdExecute({
          ...out,
          execution: payloadSource,
          deviceId,
          operatorPackage,
          timeoutMs,
          validateOnly: hasFlag(rest, "--validate-only"),
          dryRun: hasFlag(rest, "--dry-run"),
          noDaemon: noDaemon || hasFlag(rest, "--no-daemon"),
          logger,
        });
      }
    }
  },
};

// Device Interaction commands

COMMANDS["evidence"] = {
  name: "evidence",
  group: "Device Interaction",
  summary: "Capture a screenshot and raw hierarchy evidence bundle",
  documentedFlags: ["--output-dir", "--label", "--context-json", "--duration-seconds", "--size", "--session"],
  supportedFlags: ["--output-dir", "--label", "--context-json", "--duration-seconds", "--size", "--session"],
  topLevelBlock: `  evidence capture --output-dir <new-directory>  Capture a still evidence bundle
  evidence video <start|status|stop>              Manage a verified screen recording`,
  help: `androperator evidence capture - Capture local screenshot and hierarchy evidence

Usage:
  androperator evidence capture --output-dir <absolute-new-directory> [--label <text>] [--context-json <object>]

  androperator evidence video start --device <id> --output-dir <absolute-new-directory> --duration-seconds <1..180> [--size <WIDTHxHEIGHT>]
  androperator evidence video status --session <absolute-manifest-path>
  androperator evidence video stop --session <absolute-manifest-path>

Options:
  --duration-seconds <n> Required video duration cap, 1..180 seconds
  --size <WIDTHxHEIGHT>  Positive even dimensions matching the display aspect ratio
  --session <path>       Saved video manifest for status/stop
  --output-dir <dir>     Absolute new directory; existing paths are rejected
  --label <text>         Optional label, at most 2048 UTF-16 code units
  --context-json <json>  Optional caller-owned JSON object, at most 16 KiB UTF-8
  --device <id>          Explicit target device
  --operator-package <pkg>  Selected Operator package
  --timeout <ms>         Overall capture budget: 1000..120000 (default: 30000)
  --output <json|pretty> Output format (default: json)

Captures screenshot first, then raw XML; they are not atomic or automatically settled.
Complete capture exits 0. Partial/failed capture exits 1 and retains available evidence.
Video requires scrcpy 3.0+, ffprobe, and ffmpeg 6.1+ with libx264 and passthrough/demux timing support on PATH (installed separately).
Missing or unsupported dependencies return HOST_DEPENDENCY_MISSING with recovery instructions.
Run androperator doctor --device <id> and inspect host.video.dependencies before recording.
Still screenshots require only ADB. Start confirms a live recorder; only final verification means complete.
Stop waits up to 15 seconds; pending/partial/failed results exit 1. Status uses the saved target.
Existing record commands continue to record accessibility events.
`,
  handler: async ctx => {
    if (ctx.rest[0] === "video") return (await import("./commands/evidence.js")).cmdEvidenceVideo(ctx);
    if (ctx.rest.some(value => ["--duration-seconds", "--size", "--session"].includes(value))) throw new UsageError("Video flags require evidence video");
    if (ctx.rest[0] !== "capture") throw new UsageError("Use evidence capture --output-dir <absolute-new-directory>");
    const outputDir = getStringOptStrict(ctx.rest, "--output-dir");
    if (outputDir === undefined) throw new UsageError("evidence capture requires --output-dir");
    const contextJson = getStringOptStrict(ctx.rest, "--context-json");
    let context: Record<string, unknown> | undefined;
    if (contextJson !== undefined) {
      try { context = JSON.parse(contextJson); }
      catch { throw new UsageError("--context-json must be a JSON object"); }
    }
    const labelIndex = ctx.rest.indexOf("--label");
    const label = labelIndex >= 0 && ctx.rest[labelIndex + 1] === "" ? "" : getStringOptStrict(ctx.rest, "--label");
    const options = { outputDir, context, label, deviceId: ctx.deviceId,
      operatorPackage: ctx.operatorPackage, timeoutMs: ctx.timeoutMs, logger: ctx.logger, format: ctx.format };
    const { validateEvidenceCaptureOptions } = await import("../domain/evidence/capture.js");
    try { validateEvidenceCaptureOptions(options); }
    catch (error) { throw new UsageError((error as { message: string }).message); }
    return (await import("./commands/evidence.js")).cmdEvidenceCapture(options);
  },
};

COMMANDS["snapshot"] = {
  name: "snapshot",
  synonyms: ["snapshot-ui", "snapshot_ui"],
  group: "Device Interaction",
  documentedFlags: ["--no-daemon", "--compact", "--max-nodes", "--max-text-chars", "--raw-path"],
  supportedFlags: ["--no-daemon", "--compact", "--max-nodes", "--max-text-chars", "--raw-path"],
  summary: "Get current Android UI hierarchy as XML",
  help: HELP_SNAPSHOT,
  topLevelBlock: `  snapshot [--device <id>] [--operator-package <pkg>]                     Get current Android UI hierarchy as XML`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
    const invalidTimeout = getInvalidTimeoutResult(timeoutMs, { format });
    if (invalidTimeout) return invalidTimeout;
    const readBudget = (flag: string): number | undefined => {
      const value = getStringOptStrict(rest, flag);
      if (value === undefined) return undefined;
      if (!/^[0-9]+$/.test(value)) throw new UsageError(`${flag} requires an integer`);
      return Number(value);
    };
    const presentationOptions = {
      compact: hasFlag(rest, "--compact"),
      maxNodes: readBudget("--max-nodes"),
      maxTextChars: readBudget("--max-text-chars"),
      rawPath: getStringOptStrict(rest, "--raw-path"),
    };
    const { validateSnapshotPresentationOptions } = await import("../domain/observe/compactSnapshot.js");
    try {
      validateSnapshotPresentationOptions(presentationOptions);
    } catch (error) {
      throw new UsageError((error as { message: string }).message);
    }
    return (await import("./commands/observe.js")).cmdObserveSnapshot({
      ...presentationOptions,
      format,
      deviceId,
      operatorPackage,
      timeoutMs,
      noDaemon: noDaemon || hasFlag(rest, "--no-daemon"),
      logger,
    });
  },
};

COMMANDS["screenshot"] = {
  name: "screenshot",
  synonyms: ["take-screenshot", "take_screenshot", "capture-screenshot"],
  group: "Device Interaction",
  flagAliases: SCREENSHOT_FLAG_ALIASES,
  documentedFlags: ["--path", "--no-daemon"],
  supportedFlags: ["--path", "--no-daemon"],
  summary: "Capture a screenshot from the device",
  help: HELP_SCREENSHOT,
  topLevelBlock: `  screenshot [--device <id>] [--operator-package <pkg>] [--path <file>]
                                            Capture a screenshot from the device`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
    const invalidTimeout = getInvalidTimeoutResult(timeoutMs, { format });
    if (invalidTimeout) return invalidTimeout;
    const path = getStringOpt(rest, "--path");
    return (await import("./commands/observe.js")).cmdObserveScreenshot({
      format,
      deviceId,
      operatorPackage,
      timeoutMs,
      path,
      noDaemon: noDaemon || hasFlag(rest, "--no-daemon"),
      logger,
    });
  },
};

COMMANDS["swipe"] = {
  name: "swipe",
  group: "Device Interaction",
  documentedFlags: ["--start", "--end", "--duration-ms", "--no-daemon"],
  supportedFlags: ["--start", "--end", "--duration-ms", "--no-daemon"],
  summary: "Swipe between screen coordinates with an explicit duration",
  help: `androperator swipe - Swipe between screen coordinates

Usage:
  androperator swipe --start <x> <y> --end <x> <y> --duration-ms <ms>

All three flags are required. Coordinates are non-negative integer screen pixels,
with origin at the top left, and must be inside the current default display.
Start and end must differ. Duration must be an integer from 1 to 10000 milliseconds.
The finger moves immediately in a straight line and releases at the end.
Success means gesture completion, not confirmation of an app-specific effect.

Example:
  androperator swipe --start 100 500 --end 800 500 --duration-ms 300
`,
  topLevelBlock: `  swipe --start <x> <y> --end <x> <y> --duration-ms <ms>
                                            Swipe between screen coordinates`,
  handler: async (ctx) => {
    const values = new Map<string, number[]>();
    const arities = new Map([["--start", 2], ["--end", 2], ["--duration-ms", 1]]);
    const invalid = (message: string) => formatError({
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
      message: `${message}\nExample: androperator swipe --start 100 500 --end 800 500 --duration-ms 300`,
    }, { format: ctx.format });
    for (let i = 0; i < ctx.rest.length; i++) {
      const flag = ctx.rest[i];
      if (flag === "--no-daemon") continue;
      const arity = arities.get(flag);
      if (arity === undefined) return invalid(`Unexpected swipe argument: ${flag}`);
      if (values.has(flag)) return invalid(`${flag} must not appear more than once`);
      const tokens = ctx.rest.slice(i + 1, i + 1 + arity);
      if (tokens.length !== arity || tokens.some(token => !/^\d+$/.test(token))) {
        return invalid(`${flag} requires ${arity} non-negative integer value(s)`);
      }
      values.set(flag, tokens.map(Number));
      i += arity;
    }
    for (const flag of arities.keys()) {
      if (!values.has(flag)) return invalid(`${flag} is required`);
    }
    const [startX, startY] = values.get("--start")!;
    const [endX, endY] = values.get("--end")!;
    return (await import("./commands/action.js")).cmdActionSwipe({
      start: { x: startX, y: startY }, end: { x: endX, y: endY },
      durationMs: values.get("--duration-ms")![0],
      format: ctx.format, deviceId: ctx.deviceId, operatorPackage: ctx.operatorPackage,
      noDaemon: ctx.noDaemon, logger: ctx.logger, timeoutMs: ctx.timeoutMs,
    });
  },
};

COMMANDS["drag"] = {
  name: "drag",
  group: "Device Interaction",
  documentedFlags: ["--start", "--end", "--hold-duration-ms", "--move-duration-ms", "--no-daemon"],
  supportedFlags: ["--start", "--end", "--hold-duration-ms", "--move-duration-ms", "--no-daemon"],
  summary: "Drag between screen coordinates with explicit hold and movement durations",
  help: `androperator drag - Drag between screen coordinates

Usage:
  androperator drag --start <x> <y> --end <x> <y> --hold-duration-ms <ms> --move-duration-ms <ms>

All four flags are required. Coordinates are non-negative integer screen pixels,
with origin at the top left, and must be inside the current default display.
Start and end must differ. Each duration must be an integer from 1 to 10000 milliseconds.
Requires Android 8 (API 26). The finger holds at the start, moves in a straight
line without lifting, then releases. Choose a hold long enough for the app.
Success means gesture completion, not confirmation of an app-specific effect.

Example:
  androperator drag --start 100 500 --end 800 500 --hold-duration-ms 1000 --move-duration-ms 500
`,
  topLevelBlock: `  drag --start <x> <y> --end <x> <y> --hold-duration-ms <ms> --move-duration-ms <ms>
                                            Drag between screen coordinates`,
  handler: async (ctx) => {
    const values = new Map<string, number[]>();
    const arities = new Map([["--start", 2], ["--end", 2], ["--hold-duration-ms", 1], ["--move-duration-ms", 1]]);
    const invalid = (message: string) => formatError({
      code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
      message: `${message}\nExample: androperator drag --start 100 500 --end 800 500 --hold-duration-ms 1000 --move-duration-ms 500`,
    }, { format: ctx.format });
    for (let i = 0; i < ctx.rest.length; i++) {
      const flag = ctx.rest[i];
      if (flag === "--no-daemon") continue;
      const arity = arities.get(flag);
      if (arity === undefined) return invalid(`Unexpected drag argument: ${flag}`);
      if (values.has(flag)) return invalid(`${flag} must not appear more than once`);
      const tokens = ctx.rest.slice(i + 1, i + 1 + arity);
      if (tokens.length !== arity || tokens.some(token => !/^\d+$/.test(token))) {
        return invalid(`${flag} requires ${arity} non-negative integer value(s)`);
      }
      values.set(flag, tokens.map(Number));
      i += arity;
    }
    for (const flag of arities.keys()) {
      if (!values.has(flag)) return invalid(`${flag} is required`);
    }
    const [startX, startY] = values.get("--start")!;
    const [endX, endY] = values.get("--end")!;
    return (await import("./commands/action.js")).cmdActionDrag({
      start: { x: startX, y: startY }, end: { x: endX, y: endY },
      holdDurationMs: values.get("--hold-duration-ms")![0],
      moveDurationMs: values.get("--move-duration-ms")![0],
      format: ctx.format, deviceId: ctx.deviceId, operatorPackage: ctx.operatorPackage,
      noDaemon: ctx.noDaemon, logger: ctx.logger, timeoutMs: ctx.timeoutMs,
    });
  },
};

COMMANDS["click"] = {
  name: "click",
  synonyms: ["tap"],
  group: "Device Interaction",
  flagAliases: [...ELEMENT_SELECTOR_FLAG_ALIASES, ...CONTAINER_SELECTOR_FLAG_ALIASES],
  documentedFlags: ["--strict", "--container-json", "--text", "--id", "--desc", "--role", "--coordinate", "--long", "--focus", "--no-daemon"],
  supportedFlags: ["--strict", ...CONTAINER_SELECTOR_VALUE_FLAGS, "--text", "--text-contains", "--id", "--desc", "--desc-contains", "--role", "--selector", "--coordinate", "--long", "--focus", "--no-daemon"],
  summary: "Tap the first matching UI element",
  help: HELP_CLICK + "\n--strict rejects ambiguous selection before dispatch. --container-json <json> scopes targets to strict descendants of the matching container.\n",
  topLevelBlock: `  click --text <text> | --id <id> | --role <role> [--device <id>] [--operator-package <pkg>]
                                            Tap the first matching UI element`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, noDaemon } = ctx;
    
    let coordinate: { x: number; y: number } | undefined;
    const coordFlags = rest.filter((token) => token === "--coordinate");
    if (coordFlags.length > 1) {
      return formatError({
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message: "--coordinate must not appear more than once",
      }, { format });
    }
    const coordIdx = rest.indexOf("--coordinate");
    if (coordIdx >= 0) {
      const xStr = rest[coordIdx + 1];
      const yStr = rest[coordIdx + 2];
      const x = Number(xStr);
      const y = Number(yStr);
      if (
        !xStr ||
        !yStr ||
        xStr.startsWith("-") ||
        yStr.startsWith("-") ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        y < 0
      ) {
        return formatError({
          code: "EXECUTION_VALIDATION_FAILED",
          message: "--coordinate requires two non-negative integers (x y)",
        }, { format });
      }
      coordinate = { x, y };
    }

    let resolvedMatcher: NodeMatcher | undefined;
    if (!coordinate) {
      if (!hasElementSelectorFlag(rest)) {
        return makeMissingSelectorError("click", format);
      }
      const resolved = resolveElementMatcherFromCli(rest);
      if (!resolved.ok) {
        return formatError(resolved.error, { format });
      }
      resolvedMatcher = resolved.matcher;
    } else if (hasElementSelectorFlag(rest)) {
      return formatError({
        code: "EXECUTION_VALIDATION_FAILED",
        message: "use --coordinate OR a selector, not both",
      }, { format });
    }

    // Check for --long and --focus flags (mutually exclusive)
    const hasLong = hasFlag(rest, "--long");
    const hasFocus = hasFlag(rest, "--focus");
    if (hasLong && hasFocus) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message:
            "--long and --focus are mutually exclusive.\n\nUse --long for a long press, or --focus to set input focus.",
        },
        { format },
      );
    }
    let clickType: "default" | "long_click" | "focus" = "default";
    if (hasLong) clickType = "long_click";
    if (hasFocus) clickType = "focus";
    if (coordinate && clickType === "focus") {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: "--focus is not supported with --coordinate",
        },
        { format },
      );
    }

    const containerResult = resolveContainerMatcherFromCli(rest);
    if (!containerResult.ok) return formatError(containerResult.error, { format });
    return (await import("./commands/action.js")).cmdActionClick({
      format,
      container: containerResult.container,
      strict: hasFlag(rest, "--strict") ? true : undefined,
      matcher: resolvedMatcher,
      coordinate,
      clickType,
      deviceId,
      operatorPackage,
      noDaemon,
      logger,
    });
  },
};

COMMANDS["open"] = {
  name: "open",
  synonyms: ["open-app", "open_app", "open-uri", "open-url", "open_uri", "open_url"],
  group: "Device Interaction",
  flagAliases: OPEN_TARGET_FLAG_ALIASES,
  documentedFlags: ["--app", "--navigation-timeout-ms", "--skip-navigation-wait", "--no-daemon"],
  supportedFlags: ["--app", "--navigation-timeout-ms", "--skip-navigation-wait", "--no-daemon"],
  summary: "Open an app, URL, or URI on the device",
  help: HELP_OPEN,
  topLevelBlock: `  open <package-id|url|uri> [--device <id>] [--operator-package <pkg>]
                                            Open an app, URL, or URI on the device`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, noDaemon } = ctx;
    const appFlag = getOpt(rest, "--app");
    const navigationTimeoutMsRaw = getStringOptStrict(rest, "--navigation-timeout-ms", ["--app", "--navigation-timeout-ms", "--skip-navigation-wait", "--no-daemon"]);
    const skipNavigationWait = hasFlag(rest, "--skip-navigation-wait");
    const bare = barePositionalTokens(rest, ["--app"], []);
    if (appFlag !== undefined && bare.length > 0) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message:
            "open: pass the target as a positional argument or via --app, not both.\n\nSee: androperator open --help",
        },
        { format },
      );
    }
    const target = appFlag ?? bare[0];
    if (!target || target.trim().length === 0) {
      return JSON.stringify({
        code: "MISSING_ARGUMENT",
        message:
          "open requires a target.\n\nUsage:\n  androperator open <package-id>       Open an Android app\n  androperator open <url>              Open a URL in browser\n  androperator open <uri>              Open a deep link\n\nExamples:\n  androperator open com.android.settings\n  androperator open https://example.com",
      });
    }
    if (isOpenCliUriTarget(target)) {
      if (navigationTimeoutMsRaw !== undefined) {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: "--navigation-timeout-ms only applies to package targets",
          },
          { format },
        );
      }
      if (skipNavigationWait) {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: "--skip-navigation-wait only applies to package targets",
          },
          { format },
        );
      }
      return (await import("./commands/action.js")).cmdActionOpenUri({
        format,
        uri: target,
        deviceId,
        operatorPackage,
        noDaemon,
        logger,
      });
    }
    let navigationTimeoutMs: number | undefined;
    if (navigationTimeoutMsRaw !== undefined) {
      navigationTimeoutMs = Number(navigationTimeoutMsRaw);
      if (!Number.isFinite(navigationTimeoutMs) || !Number.isInteger(navigationTimeoutMs)) {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: "--navigation-timeout-ms must be an integer number of milliseconds",
          },
          { format },
        );
      }
    }
    return (await import("./commands/action.js")).cmdActionOpenApp({
      format,
      applicationId: target,
      navigationTimeoutMs,
      skipNavigationWait,
      deviceId,
      operatorPackage,
      noDaemon,
      logger,
    });
  },
};

COMMANDS["type"] = {
  name: "type",
  synonyms: ["fill", "enter-text", "enter_text"],
  group: "Device Interaction",
  flagAliases: [...ELEMENT_SELECTOR_FLAG_ALIASES, ...CONTAINER_SELECTOR_FLAG_ALIASES],
  documentedFlags: ["--strict", "--container-json", "--id", "--desc", "--role", "--submit", "--clear", "--no-daemon"],
  supportedFlags: ["--strict", ...CONTAINER_SELECTOR_VALUE_FLAGS, "--text", "--text-contains", "--id", "--desc", "--desc-contains", "--role", "--selector", "--submit", "--clear", "--no-daemon"],
  summary: "Type text into the first matching UI element",
  help: HELP_TYPE + "\n--strict rejects ambiguous selection before dispatch. --container-json <json> scopes targets to strict descendants of the matching container.\n",
  topLevelBlock: `  type <text> --role <role> | --id <id> [--device <id>] [--operator-package <pkg>]
                                            Type text into the first matching UI element`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, noDaemon } = ctx;
    // --text for type is the text-to-type, not an element selector.
    // Extract it first, then resolve the element selector from the remaining flags.
    const typeTextFlag = getOpt(rest, "--text");
    const allSelectorValueFlags = [...ELEMENT_SELECTOR_VALUE_FLAGS, ...CONTAINER_SELECTOR_VALUE_FLAGS];
    const bare = barePositionalTokens(rest, allSelectorValueFlags, ["--submit", "--clear"]);
    if (typeTextFlag !== undefined && bare.length > 0) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message:
            "type: pass text as a positional argument or via --text, not both.\n\nSee: androperator type --help",
        },
        { format },
      );
    }
    const typeText = typeTextFlag ?? bare[0];
    if (!typeText) {
      return JSON.stringify({
        code: "MISSING_ARGUMENT",
        message: "type requires text to type. Pass text as a positional argument or via --text <text>.",
      });
    }
    // Build rest-for-selector: strip --text <value> so it is not treated as textEquals
    const restForSelector = stripFlagWithValue(rest, "--text");
    // For type, the selector flags exclude --text (used for text-to-type above).
    // Check for any selector flag except --text in restForSelector.
    const TYPE_SELECTOR_FLAGS = ELEMENT_SELECTOR_VALUE_FLAGS.filter((f) => f !== "--text");
    if (!TYPE_SELECTOR_FLAGS.some((f) => restForSelector.includes(f))) {
      return JSON.stringify({
        code: "MISSING_SELECTOR",
        message: `type requires a selector.\nUse one of:\n  --id <resource-id>      Android resource ID\n  --desc <text>           Content description\n  --desc-contains <text>  Partial content description\n  --role <role>           Element role\n  --text-contains <text>  Partial text match\n  --selector <json>       Raw JSON (advanced)\nExample:\n  androperator type "hello" --role textfield`,
      });
    }
    const resolved = resolveElementMatcherFromCli(restForSelector);
    if (!resolved.ok) {
      return formatError(resolved.error, { format });
    }
    const containerResult = resolveContainerMatcherFromCli(rest);
    if (!containerResult.ok) return formatError(containerResult.error, { format });
    return (await import("./commands/action.js")).cmdActionType({
      format,
      container: containerResult.container,
      strict: hasFlag(rest, "--strict") ? true : undefined,
      matcher: resolved.matcher,
      text: typeText,
      submit: hasFlag(rest, "--submit"),
      clear: hasFlag(rest, "--clear"),
      deviceId,
      operatorPackage,
      noDaemon,
      logger,
    });
  },
};

COMMANDS["query"] = {
  name: "query",
  group: "Device Interaction",
  flagAliases: ELEMENT_SELECTOR_FLAG_ALIASES,
  documentedFlags: ["--matcher-json", "--text", "--id", "--role", "--visibility", "--limit", "--no-daemon"],
  supportedFlags: ["--selector", "--text", "--text-contains", "--id", "--desc", "--desc-contains", "--role", "--visibility", "--limit", "--no-daemon"],
  summary: "Inspect matching nodes and their current state",
  help: `androperator query - Inspect matching UI nodes

Usage:
  androperator query [--matcher-json <json> | --text <text> | --id <id> | --role <role>]
                    [--visibility <on_screen|all>] [--limit <1..1000>]
                    [--device <id>] [--operator-package <pkg>] [--timeout <ms>] [--no-daemon]

Omit the matcher to query all eligible nodes; --matcher-json '{}' is invalid.
--matcher-json cannot be combined
with simple selector flags. --text-contains, --desc and --desc-contains also work.
Visibility defaults to on_screen; limit defaults to 100. data.query contains
serialized JSON with totalMatches, truncation and node states, including blank labels.
Paths and snapshot IDs describe one observation and cannot be used as action targets.
Platform visibility does not prove visual non-occlusion.
Queries do not wait for navigation to settle. Use wait with the expected selector
before querying a destination screen. A zero count describes only that capture.

Example:
  androperator query --matcher-json '{"resourceId":"row","descendant":{"textEquals":"Display"}}'
`,
  topLevelBlock: "  query [--matcher-json <json>] [--visibility <on_screen|all>] [--limit <n>]  Inspect node state",
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
    const resolved = resolveElementMatcherFromCli(rest);
    if (!resolved.ok) return formatError(resolved.error, { format });
    for (const flag of ["--visibility", "--limit"]) {
      if (rest.indexOf(flag) !== rest.lastIndexOf(flag)) {
        throw new UsageError(`${flag} must not appear more than once`);
      }
    }
    const visibility = getStringOptStrict(rest, "--visibility", ["--visibility", "--limit"]);
    if (visibility !== undefined && visibility !== "on_screen" && visibility !== "all") {
      throw new UsageError("--visibility must be on_screen or all");
    }
    const rawLimit = getStringOptStrict(rest, "--limit", ["--visibility", "--limit"]);
    if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 1000)) {
      throw new UsageError("--limit must be an integer from 1 to 1000");
    }
    return (await import("./commands/action.js")).cmdQuery({
      matcher: hasElementSelectorFlag(rest) ? resolved.matcher : undefined,
      visibility, limit: rawLimit === undefined ? undefined : Number(rawLimit),
      format, logger, deviceId, operatorPackage, timeoutMs, noDaemon,
    });
  },
};

COMMANDS["read"] = {
  name: "read",
  synonyms: ["read-text", "read_text"],
  group: "Device Interaction",
  flagAliases: [...ELEMENT_SELECTOR_FLAG_ALIASES, ...CONTAINER_SELECTOR_FLAG_ALIASES],
  documentedFlags: ["--strict", "--container-json", "--text", "--id", "--desc", "--role", "--all", "--validate-only", "--dry-run", "--no-daemon"],
  supportedFlags: ["--strict", ...CONTAINER_SELECTOR_VALUE_FLAGS, "--text", "--text-contains", "--id", "--desc", "--desc-contains", "--role", "--selector", "--all", "--validate-only", "--dry-run", "--no-daemon"],
  summary: "Read text from the first matching UI element",
  help: HELP_READ + "\n--strict rejects ambiguous selection before dispatch. --container-json <json> scopes targets to strict descendants of the matching container.\n",
  topLevelBlock: `  read --text <text> | --id <id> | --role <role> [--device <id>] [--operator-package <pkg>]
                                            Read text from the first matching UI element`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
    if (!hasElementSelectorFlag(rest)) {
      return makeMissingSelectorError("read", format);
    }
    const resolved = resolveElementMatcherFromCli(rest);
    if (!resolved.ok) {
      return formatError(resolved.error, { format });
    }
    const readAll = hasFlag(rest, "--all");
    if (readAll) {
      const err = readAllRequiresJsonOutputError({ command: "read", format });
      if (err) return err;
    }
    // Resolve container matcher (optional)
    const containerResult = resolveContainerMatcherFromCli(rest);
    if (!containerResult.ok) {
      return formatError(containerResult.error, { format });
    }
    return (await import("./commands/action.js")).cmdActionRead({
      format,
      matcher: resolved.matcher,
      readAll,
      strict: hasFlag(rest, "--strict") ? true : undefined,
      container: containerResult.container,
      deviceId,
      operatorPackage,
      timeoutMs,
      validateOnly: hasFlag(rest, "--validate-only"),
      dryRun: hasFlag(rest, "--dry-run"),
      noDaemon,
      logger,
    });
  },
};

COMMANDS["wait"] = {
  name: "wait",
  synonyms: ["wait-for", "wait_for", "wait-for-node", "wait_for_node", "find", "find-node", "find_node"],
  group: "Device Interaction",
  flagAliases: [...ELEMENT_SELECTOR_FLAG_ALIASES, ...CONTAINER_SELECTOR_FLAG_ALIASES],
  documentedFlags: ["--strict", "--container-json", "--text", "--id", "--desc", "--role", "--no-daemon"],
  supportedFlags: ["--strict", ...CONTAINER_SELECTOR_VALUE_FLAGS, "--text", "--text-contains", "--id", "--desc", "--desc-contains", "--role", "--selector", "--no-daemon"],
  summary: "Wait until a matching UI element appears",
  help: HELP_WAIT + "\n--strict rejects ambiguous selection before dispatch. --container-json <json> scopes targets to strict descendants of the matching container.\n",
  topLevelBlock: `  wait --text <text> | --id <id> | --role <role> [--device <id>] [--operator-package <pkg>] [--timeout <ms>]
                                            Wait until a matching UI element appears`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
    // For wait, the global --timeout flag sets the wait duration (not execution envelope timeout)
    // Validation: when specified, must be a positive finite duration (0 is rejected; omit --timeout for the default)
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message:
            "--timeout must be a positive number of milliseconds when specified. Omit --timeout to use the default wait cap.",
        },
        { format },
      );
    }
    if (!hasElementSelectorFlag(rest)) {
      return makeMissingSelectorError("wait", format);
    }
    const resolved = resolveElementMatcherFromCli(rest);
    if (!resolved.ok) {
      return formatError(resolved.error, { format });
    }
    const containerResult = resolveContainerMatcherFromCli(rest);
    if (!containerResult.ok) return formatError(containerResult.error, { format });
    return (await import("./commands/action.js")).cmdActionWait({
      format,
      container: containerResult.container,
      strict: hasFlag(rest, "--strict") ? true : undefined,
      matcher: resolved.matcher,
      waitTimeoutMs: timeoutMs,
      deviceId,
      operatorPackage,
      noDaemon,
      logger,
    });
  },
};

COMMANDS["press"] = {
  name: "press",
  synonyms: ["press-key", "press_key"],
  group: "Device Interaction",
  flagAliases: PRESS_FLAG_ALIASES,
  documentedFlags: ["--key", "--no-daemon"],
  supportedFlags: ["--key", "--no-daemon"],
  summary: "Press a navigation key or TV remote button",
  help: HELP_PRESS,
  topLevelBlock: `  press <key> [--device <id>] [--operator-package <pkg>]
                                            Press a navigation key or TV remote button`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, noDaemon } = ctx;
    const keyFlag = getOpt(rest, "--key");
    const bare = barePositionalTokens(rest, ["--key"], []);
    if (keyFlag !== undefined && bare.length > 0) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message:
            "press: pass the key as a positional argument or via --key, not both.\n\nSee: androperator press --help",
        },
        { format },
      );
    }
    const key = keyFlag ?? bare[0];
    if (!key) {
      return JSON.stringify({
        code: "MISSING_ARGUMENT",
        message: "press requires a key name.\n\nValid keys: back, home, recents, dpad_up, dpad_down, dpad_left, dpad_right, dpad_center, bookmark, profile, settings, tv\n\nExample:\n  androperator press back",
      });
    }
    return (await import("./commands/action.js")).cmdActionPressKey({
      format,
      key,
      deviceId,
      operatorPackage,
      noDaemon,
      logger,
    });
  },
};

COMMANDS["back"] = {
  name: "back",
  group: "Device Interaction",
  documentedFlags: ["--no-daemon"],
  supportedFlags: ["--no-daemon"],
  summary: "Press the Android back key",
  help: HELP_BACK,
  topLevelBlock: `  back [--device <id>] [--operator-package <pkg>]                        Press the Android back key`,
  handler: async (ctx) => {
    const { format, logger, deviceId, operatorPackage, noDaemon } = ctx;
    return (await import("./commands/action.js")).cmdActionPressKey({
      format,
      key: "back",
      deviceId,
      operatorPackage,
      noDaemon,
      logger,
    });
  },
};

const closeHandler = async (ctx: HandlerContext): Promise<string | void> => {
  const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
  const invalidTimeout = getInvalidTimeoutResult(timeoutMs, { format });
  if (invalidTimeout) return invalidTimeout;

  const appFlag = getOpt(rest, "--app");
  const bare = barePositionalTokens(rest, ["--app"], []);
  if (appFlag !== undefined && bare.length > 0) {
    return formatError(
      {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message:
          "close: pass the package as a positional argument or via --app, not both.\n\nSee: androperator close --help",
      },
      { format },
    );
  }
  const applicationId = appFlag ?? bare[0];
  if (!applicationId || applicationId.trim().length === 0) {
    return JSON.stringify({
      code: "MISSING_ARGUMENT",
      message:
        "close requires a package name.\n\nUsage:\n  androperator close <package>\n  androperator close --app <package>\n\nExamples:\n  androperator close com.android.settings\n  androperator close com.google.android.apps.chromecast.app",
    });
  }
  return (await import("./commands/action.js")).cmdCloseApp({
    format,
    applicationId,
    deviceId,
    operatorPackage,
    timeoutMs,
    noDaemon,
    logger,
  });
};

COMMANDS["close"] = {
  name: "close",
  synonyms: ["close-app", "close_app"],
  group: "Device Interaction",
  flagAliases: CLOSE_TARGET_FLAG_ALIASES,
  documentedFlags: ["--app", "--no-daemon"],
  supportedFlags: ["--app", "--no-daemon"],
  summary: "Force-stop an Android application",
  help: HELP_CLOSE,
  topLevelBlock: `  close <package> [--device <id>] [--operator-package <pkg>]             Force-stop an Android application`,
  handler: async (ctx) => closeHandler(ctx),
};

export function parseToastArgs(rest: string[]): {
  operation: "show" | "cancel";
  params?: Pick<import("../contracts/execution.js").ActionParams, "text" | "duration">;
} {
  const usage = 'Usage: androperator toast "Starting test run" [--duration short|long], or androperator toast --cancel';
  let text: string | undefined;
  let duration: "short" | "long" | undefined;
  let cancel = false;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === "--cancel") {
      if (cancel) throw new UsageError(`--cancel must be supplied only once. ${usage}`);
      cancel = true;
    } else if (token === "--duration") {
      if (duration !== undefined) throw new UsageError(`--duration must be supplied only once. ${usage}`);
      const value = rest[++i];
      if (value !== "short" && value !== "long") throw new UsageError(`--duration requires short or long. ${usage}`);
      duration = value;
    } else {
      const value = token === "--" ? rest[++i] : token;
      if (value === undefined || (token !== "--" && token.startsWith("-")) || text !== undefined) {
        throw new UsageError(`Unexpected toast argument: ${token}. ${usage}`);
      }
      text = value;
      if (token === "--" && i !== rest.length - 1) throw new UsageError(usage);
    }
  }
  if (cancel) {
    if (text !== undefined || duration !== undefined) throw new UsageError(`--cancel cannot be combined with text or --duration. ${usage}`);
    return { operation: "cancel" };
  }
  if (text === undefined) throw new UsageError(`toast requires text. ${usage}`);
  return { operation: "show", params: { text, ...(duration !== undefined ? { duration } : {}) } };
}

COMMANDS["toast"] = {
  name: "toast",
  group: "Device Interaction",
  summary: "Show or cancel an Operator-owned text toast",
  topLevelBlock: `  toast <text> [--duration short|long] | toast --cancel                Show or cancel a brief on-device message`,
  documentedFlags: ["--duration", "--cancel", "--no-daemon"],
  supportedFlags: ["--duration", "--cancel", "--no-daemon"],
  help: `androperator toast <text> [--duration short|long]

Usage:
  androperator toast "Starting test run"
  androperator toast "Test run complete" --duration long
  androperator toast --cancel

Options:
  --duration <short|long>  Native Android duration (default short), not milliseconds
  --cancel                 Cancel the current API toast; exclusive with text and duration
  --device <id> --operator-package <pkg> --timeout <ms>
  --output <json|pretty> --no-daemon

Text must be nonblank and at most 2048 UTF-16 code units. Use -- before text starting with -.
Each show replaces the previous API toast. Cancellation is harmless when none exists.
Success acknowledges submission to Android, not visibility. Does not wait for dismissal.
Android may truncate or rate-limit toasts. Use on-screen-log for persistent information.
`,
  handler: async ({ rest, format, deviceId, operatorPackage, timeoutMs, noDaemon, logger }) => {
    return (await import("./commands/action.js")).cmdToast({
      ...parseToastArgs(rest), format, deviceId, operatorPackage, timeoutMs, noDaemon, logger,
    });
  },
};

export const ON_SCREEN_LOG_FLAGS = {
  "--text": "text",
  "--template": "template",
  "--anchor": "anchor",
  "--text-align": "textAlign",
  "--top-offset-dp": "topOffsetDp",
  "--edge-offset-dp": "edgeOffsetDp",
  "--width-dp": "widthDp",
  "--font-size-sp": "fontSizeSp",
  "--text-color": "textColor",
  "--background-color": "backgroundColor",
  "--ttl-ms": "ttlMs",
} as const;

const ON_SCREEN_LOG_NUMERIC_FLAGS = new Set([
  "--top-offset-dp", "--edge-offset-dp", "--width-dp", "--font-size-sp", "--ttl-ms",
]);

export function parseOnScreenLogArgs(rest: string[]): {
  operation: "set" | "clear";
  params?: import("../contracts/execution.js").ActionParams;
} {
  const operation = rest[0];
  if (operation !== "set" && operation !== "clear") {
    throw new UsageError("on-screen-log requires the subcommand set or clear");
  }
  const params: Record<string, string | number> = {};
  const seen = new Set<string>();
  for (let i = 1; i < rest.length; i += 1) {
    const flag = rest[i];
    if (operation === "clear" || !Object.hasOwn(ON_SCREEN_LOG_FLAGS, flag)) {
      throw new UsageError(`Unexpected argument for on-screen-log ${operation}: ${flag}`);
    }
    if (seen.has(flag)) {
      throw new UsageError(`${flag} must be supplied only once`);
    }
    seen.add(flag);
    let value = rest[++i];
    if (value === "--") value = rest[++i];
    else if (value?.startsWith("--")) {
      throw new UsageError(`${flag} requires a value`);
    }
    if (value === undefined) throw new UsageError(`${flag} requires a value`);
    const field = ON_SCREEN_LOG_FLAGS[flag as keyof typeof ON_SCREEN_LOG_FLAGS];
    if (ON_SCREEN_LOG_NUMERIC_FLAGS.has(flag)) {
      // Parse the complete decimal token; range/default rules belong to the executor.
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
          || !Number.isFinite(Number(value)) || !Number.isInteger(Number(value))) {
        throw new UsageError(`${flag} requires a finite integral decimal number`);
      }
      params[field] = Number(value);
    } else {
      params[field] = value;
    }
  }
  if (operation === "set" && (params.text !== undefined) === (params.template !== undefined)) {
    throw new UsageError("on-screen-log set requires exactly one of --text or --template");
  }
  return operation === "set" ? { operation, params } : { operation };
}

const HELP_ON_SCREEN_LOG = `androperator on-screen-log set|clear

Usage:
  androperator on-screen-log set (--text <text> | --template <template>) [panel options] [common options]
  androperator on-screen-log clear [common options]

Panel options (set only, each at most once):
  --text <text>                  Literal text, 1-2048 UTF-16 code units
  --template <template>          Live Android template, exclusive with --text
  --anchor <left|right>          Physical horizontal edge (default left)
  --text-align <left|right>      Alignment inside the panel (default left)
  --top-offset-dp <number>       0-1000, default 8
  --edge-offset-dp <number>      0-1000, default 8
  --width-dp <number>            80-600, default 280, including padding
  --font-size-sp <number>        8-24, default 12
  --text-color <hex>             #RRGGBB or #AARRGGBB, default #FFFFFFFF
  --background-color <hex>       #RRGGBB or #AARRGGBB, default #B3000000
  --ttl-ms <number>              1000-3600000, default 300000

Common options:
  --device <id> --operator-package <pkg> --timeout <ms>
  --output <json|pretty> --no-daemon

Examples:
  androperator on-screen-log set --text "FLOW-001: Observe settings" --anchor right
  androperator on-screen-log clear

Notes:
  - Numeric tokens use integral decimal/exponent syntax; zero offsets are preserved.
  - Set replaces all text/style; omitted fields reset to defaults. Clear is idempotent.
  - rendered=true acknowledges a draw, not screenshot pixels.
  - Await separate set, screenshot, replacement, screenshot, and clear executions for capture.
  - An uncertain dispatch is never automatically replayed.
`;

COMMANDS["on-screen-log"] = {
  name: "on-screen-log",
  group: "Device Interaction",
  summary: "Show, replace, or clear a static on-device diagnostic panel",
  topLevelBlock: "  on-screen-log set|clear [--device <id>] [--operator-package <pkg>]     Show, replace, or clear an on-device diagnostic panel",
  help: HELP_ON_SCREEN_LOG,
  subtopics: { set: HELP_ON_SCREEN_LOG, clear: HELP_ON_SCREEN_LOG },
  documentedFlags: [...Object.keys(ON_SCREEN_LOG_FLAGS), "--no-daemon"],
  supportedFlags: rest => rest[0] === "set" ? [...Object.keys(ON_SCREEN_LOG_FLAGS), "--no-daemon"] : ["--no-daemon"],
  handler: async ({ rest, format, deviceId, operatorPackage, timeoutMs, noDaemon, logger }) => {
    const parsed = parseOnScreenLogArgs(rest);
    return (await import("./commands/action.js")).cmdOnScreenLog({
      ...parsed, format, deviceId, operatorPackage, timeoutMs, noDaemon, logger,
    });
  },
};

COMMANDS["sleep"] = {
  name: "sleep",
  group: "Device Interaction",
  documentedFlags: ["--no-daemon"],
  supportedFlags: ["--no-daemon"],
  summary: "Pause execution for a duration",
  help: HELP_SLEEP,
  topLevelBlock: `  sleep <ms> [--device <id>] [--operator-package <pkg>]                  Pause execution for a duration`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;

    // Parse positional duration (handle negative numbers which look like flags)
    // Check rest[0] first since barePositionalTokens skips tokens starting with "-"
    let durationStr: string | undefined;
    if (rest[0] && !rest[0].startsWith("--")) {
      durationStr = rest[0];
    } else {
      const bare = barePositionalTokens(rest, [], []);
      durationStr = bare[0];
    }
    if (!durationStr) {
      return formatError(
        {
          code: "MISSING_ARGUMENT",
          message:
            "sleep requires a duration in milliseconds.\n\nUsage:\n  androperator sleep <ms>\n\nExample:\n  androperator sleep 2000",
        },
        { format },
      );
    }
    const durationMs = Number(durationStr);
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: `Duration must be a non-negative number (got: ${durationStr})`,
        },
        { format },
      );
    }
    if (durationMs > LIMITS.MAX_EXECUTION_TIMEOUT_MS) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: `Duration must be <= ${LIMITS.MAX_EXECUTION_TIMEOUT_MS}ms (got: ${durationMs}ms)`,
        },
        { format },
      );
    }

    return (await import("./commands/action.js")).cmdSleep({
      format,
      durationMs,
      globalTimeoutMs: timeoutMs,
      deviceId,
      operatorPackage,
      noDaemon,
      logger,
    });
  },
};

COMMANDS["scroll"] = {
  name: "scroll",
  group: "Device Interaction",
  flagAliases: CONTAINER_SELECTOR_FLAG_ALIASES,
  documentedFlags: ["--strict", "--container-json", "--direction", "--no-daemon"],
  supportedFlags: ["--strict", ...CONTAINER_SELECTOR_VALUE_FLAGS, "--direction", "--no-daemon"],
  summary: "Scroll the screen in a direction",
  help: HELP_SCROLL + "\n--strict rejects ambiguous selection before dispatch. --container-json <json> scopes targets to strict descendants of the matching container.\n",
  topLevelBlock: `  scroll <down|up|left|right> [--container-id <id>] [--device <id>] [--operator-package <pkg>]
                                            Scroll the screen in a direction`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
    const invalidTimeout = getInvalidTimeoutResult(timeoutMs, { format });
    if (invalidTimeout) return invalidTimeout;
    const scrollValueFlags = ["--direction", ...CONTAINER_SELECTOR_VALUE_FLAGS];
    const directionFlag = getOpt(rest, "--direction");
    const bare = barePositionalTokens(rest, scrollValueFlags, []);
    if (directionFlag !== undefined && bare.length > 0) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message:
            "scroll: pass direction as a positional argument or via --direction, not both.\n\nSee: androperator scroll --help",
        },
        { format },
      );
    }
    const direction = directionFlag ?? bare[0];
    const validDirections = ["down", "up", "left", "right"];
    if (!direction || !validDirections.includes(direction)) {
      return JSON.stringify({
        code: "MISSING_ARGUMENT",
        message: `scroll requires a direction.\n\nValid directions: ${validDirections.join(", ")}\n\nExamples:\n  androperator scroll down\n  androperator scroll up`,
      });
    }
    const containerResolved = resolveContainerMatcherFromCli(rest);
    if (!containerResolved.ok) {
      return formatError(containerResolved.error, { format });
    }
    return (await import("./commands/action.js")).cmdScroll({
      format,
      direction,
      strict: hasFlag(rest, "--strict") ? true : undefined,
      container: containerResolved.container,
      deviceId,
      operatorPackage,
      timeoutMs,
      noDaemon,
      logger,
    });
  },
};

// scroll-until (and synonym scroll-and-click)
const scrollUntilHandler = async (ctx: HandlerContext, clickAfterDefault: boolean): Promise<string | void> => {
  const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;
  const invalidTimeout = getInvalidTimeoutResult(timeoutMs, { format });
  if (invalidTimeout) return invalidTimeout;

  // Check for selector flags
  if (!hasElementSelectorFlag(rest)) {
    return makeMissingSelectorError("scroll-until", format);
  }

  // Parse direction (positional, --direction, or defaults to "down")
  const directionIdx = rest.indexOf("--direction");
  let directionFlag: string | undefined;
  if (directionIdx >= 0) {
    const next = rest[directionIdx + 1];
    if (next === undefined || next.startsWith("-")) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: "scroll-until --direction requires a value.\n\nSee: androperator scroll-until --help",
        },
        { format },
      );
    }
    directionFlag = next;
  }
  const scrollUntilValueFlags = [...ELEMENT_SELECTOR_VALUE_FLAGS, ...CONTAINER_SELECTOR_VALUE_FLAGS, "--click", "--direction"];
  const bare = barePositionalTokens(rest, scrollUntilValueFlags, []);
  if (directionFlag !== undefined && bare.length > 0) {
    return formatError(
      {
        code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
        message:
          "scroll-until: pass direction as a positional argument or via --direction, not both.\n\nSee: androperator scroll-until --help",
      },
      { format },
    );
  }
  const direction = directionFlag ?? bare[0] ?? "down";
  const validDirections = ["down", "up", "left", "right"];
  if (!validDirections.includes(direction)) {
    return formatError(
      {
        code: "MISSING_ARGUMENT",
        message: `Invalid direction: ${direction}. Valid directions: ${validDirections.join(", ")}`,
      },
      { format },
    );
  }

  // Resolve element matcher
  const matcherResult = resolveElementMatcherFromCli(rest);
  if (!matcherResult.ok) {
    return formatError(matcherResult.error, { format });
  }

  // Resolve container matcher (optional)
  const containerResult = resolveContainerMatcherFromCli(rest);
  if (!containerResult.ok) {
    return formatError(containerResult.error, { format });
  }

  // Check for --click flag
  const clickAfter = clickAfterDefault || hasFlag(rest, "--click");

  return (await import("./commands/action.js")).cmdScrollUntil({
    format,
    direction,
    matcher: matcherResult.matcher,
    container: containerResult.container,
    strict: hasFlag(rest, "--strict") ? true : undefined,
    clickAfter,
    deviceId,
    operatorPackage,
    timeoutMs,
    noDaemon,
    logger,
  });
};

COMMANDS["scroll-until"] = {
  name: "scroll-until",
  synonyms: ["scroll_until"],
  group: "Device Interaction",
  flagAliases: [...ELEMENT_SELECTOR_FLAG_ALIASES, ...CONTAINER_SELECTOR_FLAG_ALIASES],
  documentedFlags: ["--strict", "--container-json", "--text", "--id", "--desc", "--role", "--click", "--direction", "--no-daemon"],
  supportedFlags: ["--strict", ...CONTAINER_SELECTOR_VALUE_FLAGS, "--click", "--direction", "--text", "--text-contains", "--id", "--desc", "--desc-contains", "--role", "--selector", "--no-daemon"],
  summary: "Scroll until a target element is visible",
  help: HELP_SCROLL_UNTIL + "\n--strict rejects ambiguous selection before dispatch. --container-json <json> scopes targets to strict descendants of the matching container.\n",
  topLevelBlock: `  scroll-until [<direction>] --text <text> [--click] [--device <id>] [--operator-package <pkg>]
                                            Scroll until a target element is visible (optionally click it)`,
  handler: async (ctx) => scrollUntilHandler(ctx, false),
};

COMMANDS["scroll-and-click"] = {
  name: "scroll-and-click",
  synonyms: ["scroll_and_click"],
  group: "Device Interaction",
  flagAliases: [...ELEMENT_SELECTOR_FLAG_ALIASES, ...CONTAINER_SELECTOR_FLAG_ALIASES],
  documentedFlags: ["--strict", "--container-json", "--text", "--id", "--desc", "--role", "--direction", "--no-daemon"],
  supportedFlags: ["--strict", ...CONTAINER_SELECTOR_VALUE_FLAGS, "--direction", "--text", "--text-contains", "--id", "--desc", "--desc-contains", "--role", "--selector", "--no-daemon"],
  summary: "Scroll until target is visible, then click it (alias for scroll-until --click)",
  help: HELP_SCROLL_UNTIL + "\n--strict rejects ambiguous selection before dispatch. --container-json <json> scopes targets to strict descendants of the matching container.\n",
  topLevelBlock: `  scroll-and-click [<direction>] --text <text> [--device <id>] [--operator-package <pkg>]
                                            Scroll until target is visible, then click it`,
  handler: async (ctx) => scrollUntilHandler(ctx, true),
};

// wait-for-nav (synonym: wait-for-navigation)
COMMANDS["wait-for-nav"] = {
  name: "wait-for-nav",
  synonyms: ["wait-for-navigation", "wait_for_navigation"],
  group: "Device Interaction",
  flagAliases: WAIT_FOR_NAV_FLAG_ALIASES,
  documentedFlags: ["--app", "--timeout", "--text", "--id", "--desc", "--role", "--validate-only", "--dry-run", "--no-daemon"],
  supportedFlags: ["--app", "--text", "--text-contains", "--id", "--desc", "--desc-contains", "--role", "--selector", "--validate-only", "--dry-run", "--no-daemon"],
  summary: "Wait for app or screen navigation to complete",
  help: HELP_WAIT_FOR_NAV,
  topLevelBlock: `  wait-for-nav --app <package> --timeout <ms> [--device <id>] [--operator-package <pkg>]
                                            Wait for app or screen navigation to complete`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs: navTimeoutMs, noDaemon } = ctx;

    // Parse --app flag (reject present-but-empty like --app "" so we do not silently ignore package filter)
    const appIdx = rest.indexOf("--app");
    let expectedPackage: string | undefined;
    if (appIdx >= 0) {
      const next = rest[appIdx + 1];
      if (next === undefined || next.trim() === "" || next.startsWith("--")) {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message:
              "wait-for-nav --app requires a non-empty package id.\n\nExample:\n  androperator wait-for-nav --app com.android.settings --timeout 5000",
          },
          { format },
        );
      }
      expectedPackage = next;
    }

    // --timeout is required (action-level wait duration)
    // It's parsed by getGlobalOpts and passed via ctx.timeoutMs
    if (navTimeoutMs === undefined) {
      return formatError(
        {
          code: ERROR_CODES.MISSING_ARGUMENT,
          message: "wait-for-nav requires --timeout <ms>.\n\nUsage:\n  androperator wait-for-nav --app <package> --timeout <ms>\n  androperator wait-for-nav --text <text> --timeout <ms>\n\nExample:\n  androperator wait-for-nav --app com.google.home --timeout 5000",
        },
        { format },
      );
    }
    if (!Number.isFinite(navTimeoutMs) || navTimeoutMs <= 0) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: "wait-for-nav --timeout must be a positive number of milliseconds",
        },
        { format },
      );
    }
    if (navTimeoutMs > 30000) {
      return formatError(
        {
          code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
          message: "wait-for-nav --timeout must not exceed 30000ms",
        },
        { format },
      );
    }

    // Resolve selector flags (optional if --app is provided)
    let expectedNode: import("../contracts/selectors.js").NodeMatcher | undefined;
    const hasSelector = hasElementSelectorFlag(rest);
    if (hasSelector) {
      const matcherResult = resolveElementMatcherFromCli(rest);
      if (!matcherResult.ok) {
        return formatError(matcherResult.error, { format });
      }
      expectedNode = matcherResult.matcher;
    }

    // Require at least one of --app or selector
    if (!expectedPackage && !expectedNode) {
      return formatError(
        {
          code: ERROR_CODES.MISSING_ARGUMENT,
          message: "wait-for-nav requires --app or a selector, and --timeout.\n\nUsage:\n  androperator wait-for-nav --app <package> --timeout <ms>\n  androperator wait-for-nav --text <text> --timeout <ms>\n\nExample:\n  androperator wait-for-nav --app com.google.home --timeout 5000",
        },
        { format },
      );
    }

    // Build execution and run
    const execution = (await import("../domain/actions/waitForNav.js")).buildWaitForNavExecution(
      expectedPackage,
      expectedNode,
      navTimeoutMs,
    );

    return (await import("./commands/execute.js")).cmdExecute({
      format,
      execution: JSON.stringify(execution),
      deviceId,
      operatorPackage,
      timeoutMs: execution.timeoutMs,
      validateOnly: hasFlag(rest, "--validate-only"),
      dryRun: hasFlag(rest, "--dry-run"),
      noDaemon,
      logger,
    });
  },
};

// read-value (synonym: read-kv)
COMMANDS["read-value"] = {
  name: "read-value",
  synonyms: ["read-kv", "read-key-value-pair", "read_key_value_pair"],
  group: "Device Interaction",
  flagAliases: READ_VALUE_FLAG_ALIASES,
  documentedFlags: ["--label", "--label-id", "--label-desc", "--all", "--validate-only", "--dry-run", "--no-daemon"],
  supportedFlags: ["--label", "--label-id", "--label-desc", "--all", "--validate-only", "--dry-run", "--no-daemon"],
  summary: "Read the value associated with a labeled element",
  help: HELP_READ_VALUE,
  topLevelBlock: `  read-value --label <text>                  Read the value associated with a labeled element`,
  handler: async (ctx) => {
    const { rest, format, logger, deviceId, operatorPackage, timeoutMs, noDaemon } = ctx;

    const readAll = hasFlag(rest, "--all");
    if (readAll) {
      const err = readAllRequiresJsonOutputError({ command: "read-value", format });
      if (err) return err;
    }

    // Build labelMatcher from --label* flags
    const labelMatcher: import("../contracts/selectors.js").NodeMatcher = {};
    const labelText = getOpt(rest, "--label");
    const labelId = getOpt(rest, "--label-id");
    const labelDesc = getOpt(rest, "--label-desc");

    if (labelText !== undefined) {
      if (labelText.trim() === "") {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: "read-value --label value must not be empty",
          },
          { format },
        );
      }
      labelMatcher.textEquals = labelText;
    }
    if (labelId !== undefined) {
      if (labelId.trim() === "") {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: "read-value --label-id value must not be empty",
          },
          { format },
        );
      }
      labelMatcher.resourceId = labelId;
    }
    if (labelDesc !== undefined) {
      if (labelDesc.trim() === "") {
        return formatError(
          {
            code: ERROR_CODES.EXECUTION_VALIDATION_FAILED,
            message: "read-value --label-desc value must not be empty",
          },
          { format },
        );
      }
      labelMatcher.contentDescEquals = labelDesc;
    }

    // Require at least one label flag
    if (Object.keys(labelMatcher).length === 0) {
      return formatError(
        {
          code: ERROR_CODES.MISSING_ARGUMENT,
          message: "read-value requires a label selector.\n\nUsage:\n  androperator read-value --label <text>\n\nExample:\n  androperator read-value --label \"Battery\"",
        },
        { format },
      );
    }

    // Build execution and run
    const execution = (await import("../domain/actions/readValue.js")).buildReadValueExecution(
      labelMatcher,
      readAll,
    );

    return (await import("./commands/execute.js")).cmdExecute({
      format,
      execution: JSON.stringify(execution),
      deviceId,
      operatorPackage,
      timeoutMs,
      validateOnly: hasFlag(rest, "--validate-only"),
      dryRun: hasFlag(rest, "--dry-run"),
      noDaemon,
      logger,
    });
  },
};

// bundled-skills
COMMANDS["bundled-skills"] = {
  name: "bundled-skills",
  group: "Execution",
  summary: "Manage first-party bundled skills for Claude Code, Codex, and generic agent runtimes",
  documentedFlags: [],
  supportedFlags: ["--version", "--output", "--format", "--json", "--help"],
  help: `androperator bundled-skills

Usage:
  androperator bundled-skills list
  androperator bundled-skills install
  androperator bundled-skills update

Notes:
  - Use 'androperator bundled-skills list' to inspect the installed host-agent workflows on this machine.
  - 'androperator-agent-orientation' is the first-run orientation skill when the current host is unfamiliar.
  - 'androperator-upgrade' is the packaged whole-product upgrade route: check androperator --version, verify Node 24+, npm reachability, and Java 17/21, then use npm install -g androperator@latest, androperator install, and androperator doctor. Use install.sh only when the CLI is not reachable or the bootstrap prerequisites need repair.
  - 'androperator-skill-author-by-agent-discovery' supports bounded exploration and optional instruction authoring.
  - 'androperator-skill-author-by-recording' uses optional human demonstration as evidence for adaptive instructions.
  - Post-install authoring guidance: https://docs.androperator.com/skills/authoring/
`,
  subtopics: {
    install: HELP_BUNDLED_SKILLS_INSTALL,
    update: HELP_BUNDLED_SKILLS_UPDATE,
    list: HELP_BUNDLED_SKILLS_LIST,
  },
  topLevelBlock: `  bundled-skills list
                                            List installed first-party bundled skills
  bundled-skills install
                                            Copy and wire packaged bundled skills for Claude Code, Codex, and generic agent runtimes
  bundled-skills update
                                            Refresh installed bundled skills and repair discovery entries`,
  handler: async (ctx) => {
    const { rest, format } = ctx;
    const out = { format, env: process.env };
    if (rest[0] === "list") {
      return (await import("./commands/bundledSkills.js")).cmdBundledSkillsList(out);
    } else if (rest[0] === "install") {
      return (await import("./commands/bundledSkills.js")).cmdBundledSkillsInstall(out);
    } else if (rest[0] === "update") {
      return (await import("./commands/bundledSkills.js")).cmdBundledSkillsUpdate(out);
    } else {
      return JSON.stringify({ code: "USAGE", message: "bundled-skills list|install|update" });
    }
  },
};

// recording
COMMANDS["recording"] = {
  name: "recording",
  synonyms: ["record"],
  group: "Recording",
  documentedFlags: ["--session-id", "--out", "--input", "--snapshots"],
  supportedFlags: (rest) => {
    const sub = rest[0];
    if (sub === "start" || sub === "stop") return ["--session-id"];
    if (sub === "pull") return ["--session-id", "--out"];
    if (sub === "export") return ["--input", "--out", "--snapshots"];
    return [];
  },
  summary: "Manage recording sessions on the Operator app",
  help: HELP_RECORDING,
  subtopics: {
    export: HELP_RECORDING_EXPORT,
  },
  topLevelBlock: `  recording start [--session-id <id>] [--device <serial>] [--operator-package <pkg>]
                                            Start a recording session on the Operator app ('record' is an alias)
  recording stop  [--session-id <id>] [--device <serial>] [--operator-package <pkg>]
                                            Stop the active recording session and finalize the on-device file ('record' is an alias)
  recording pull  [--session-id <id>] [--out <dir>] [--device <serial>]
                                            Pull the on-device NDJSON recording to host (default: ./recordings/, 'record' is an alias)
  recording export --input <file|directory> [--out <file>] [--snapshots <omit|include>]
                                            Export raw recording evidence into agent-context JSON ('record' is an alias)`,
  handler: async (ctx) => {
    const { rest, format, verbose, logger, deviceId, operatorPackage } = ctx;
    const out = { format, verbose, logger };
    const sub = rest[0];
    const runOpts = {
      deviceId,
      operatorPackage,
    };
    if (sub === "start") {
      return (await import("./commands/record.js")).cmdRecordStart({
        ...out,
        sessionId: getStringOptStrict(rest, "--session-id", ["--session-id"]),
        ...runOpts,
      });
    } else if (sub === "stop") {
      return (await import("./commands/record.js")).cmdRecordStop({
        ...out,
        sessionId: getStringOptStrict(rest, "--session-id", ["--session-id"]),
        ...runOpts,
      });
    } else if (sub === "pull") {
      const outputDirFlag = getStringOptStrict(rest, "--out", ["--session-id", "--out"]);
      const outputDir = outputDirFlag ?? "./recordings/";
      return (await import("./commands/record.js")).cmdRecordPull({
        ...out,
        sessionId: getStringOptStrict(rest, "--session-id", ["--session-id", "--out"]),
        outputDir,
        ...runOpts,
      });
    } else if (sub === "export") {
      const inputFile = getStringOptStrict(rest, "--input", ["--input", "--out", "--snapshots"]);
      if (!inputFile) {
        return JSON.stringify({ code: "USAGE", message: "recording export --input <file|directory> [--out <file>] [--snapshots <omit|include>] ('record' is an alias)" });
      }
      const snapshotMode = getStringOptStrict(rest, "--snapshots", ["--input", "--out", "--snapshots"]);
      if (snapshotMode !== undefined && snapshotMode !== "omit" && snapshotMode !== "include") {
        throw new UsageError("recording export --snapshots must be one of: omit, include");
      }
      return (await import("./commands/record.js")).cmdRecordExport({
        ...out,
        inputFile,
        outputFile: getStringOptStrict(rest, "--out", ["--input", "--out", "--snapshots"]),
        snapshotMode,
      });
    } else {
      return JSON.stringify({ code: "USAGE", message: "recording start|stop|pull|export ... ('record' is an alias)" });
    }
  },
};

// daemon
COMMANDS["daemon"] = {
  name: "daemon",
  group: "Execution",
  documentedFlags: [],
  supportedFlags: [],
  summary: "Manage the background Unix socket daemon",
  help: HELP_DAEMON,
  topLevelBlock: `  daemon start|stop|status|restart [--device <id>]
                                            Manage the background Unix socket daemon`,
  handler: async (ctx) => {
    const { rest, format, verbose, logger, deviceId, operatorPackage } = ctx;
    const sub = rest[0];
    const command = await import("./commands/daemon.js");
    if (sub === "run") {
      await command.cmdDaemonRun({ deviceId, operatorPackage, verbose, logger });
      return undefined;
    }
    if (sub === "start") {
      return command.cmdDaemonStart({ format, deviceId, operatorPackage });
    }
    if (sub === "stop") {
      return command.cmdDaemonStop({ format, deviceId });
    }
    if (sub === "status") {
      return command.cmdDaemonStatus({ format, deviceId });
    }
    if (sub === "restart") {
      return command.cmdDaemonRestart({ format, deviceId, operatorPackage });
    }
    return JSON.stringify({ code: "USAGE", message: "daemon start|stop|status|restart" });
  },
};

// serve
export function buildServeCommandOptions(ctx: HandlerContext): {
  ok: true;
  options: {
    port: number;
    host: string;
    operatorPackage?: string;
    verbose: boolean;
    logger: Logger;
  };
} | {
  ok: false;
  output: string;
} {
  const { rest, verbose, logger, operatorPackage } = ctx;
  const portStr = getOpt(rest, "--port");
  const port = portStr ? parseInt(portStr, 10) : 3000;
  const host = getOpt(rest, "--host") ?? "127.0.0.1";
  if (isNaN(port) || port <= 0 || port > 65535) {
    return { ok: false, output: JSON.stringify({ code: "USAGE", message: "Invalid port number. Must be 1-65535." }) };
  }
  return { ok: true, options: { port, host, operatorPackage, verbose, logger } };
}

COMMANDS["serve"] = {
  name: "serve",
  group: "Execution",
  flagAliases: SERVE_FLAG_ALIASES,
  documentedFlags: ["--port", "--host"],
  supportedFlags: ["--port", "--host"],
  summary: "Start local HTTP/SSE server for remote control",
  help: "androperator serve\n\nUsage:\n  androperator serve [--port <number>] [--host <string>]\n\nNotes:\n  - Default host: 127.0.0.1\n",
  topLevelBlock: `  serve [--port <number>] [--host <string>]
                                            Start local HTTP/SSE server for remote control (default host: 127.0.0.1)`,
  handler: async (ctx) => {
    const built = buildServeCommandOptions(ctx);
    if (!built.ok) {
      return built.output;
    }
    await (await import("./commands/serve.js")).cmdServe(built.options);
    // Long-running: cmdServe never resolves in normal operation.
    // Return undefined so the dispatcher's `result !== undefined` guard
    // skips console.log, matching the old switch behavior.
    return undefined;
  },
};

COMMANDS["mcp"] = {
  help: "androperator mcp\n\nUsage:\n  androperator mcp serve\n\nStarts the stdio MCP server for device actions and evidence.\nHost guidance: https://docs.androperator.com/host-agents/\n",
  name: "mcp",
  group: "Execution",
  documentedFlags: [],
  supportedFlags: [],
  summary: "Start the first-party MCP server",
  topLevelBlock: `  mcp serve
                                            Start the first-party stdio MCP server`,
  handler: async (ctx) => {
    const { rest } = ctx;
    if (rest[0] === "serve") {
      return JSON.stringify({
        code: "USAGE",
        message: "mcp serve is a stdio transport and must be launched directly without CLI stdout formatting.",
      });
    }

    return JSON.stringify({ code: "USAGE", message: "mcp serve" });
  },
};

COMMANDS["logs"] = {
  name: "logs",
  group: "Utilities",
  documentedFlags: [],
  supportedFlags: [],
  summary: "Tail the Androperator log file",
  help: "androperator logs\n\nUsage:\n  androperator logs\n\nNotes:\n  - Dumps existing log content then streams new lines.\n  - Press Ctrl+C to stop streaming.\n",
  topLevelBlock: `  logs                                      Tail the Androperator log file (dump then stream)`,
  handler: async (_ctx) => {
    await (await import("./commands/logs.js")).cmdLogs({});
    // Long-running: cmdLogs streams until interrupted.
    // Return undefined so the dispatcher skips console.log.
    return undefined;
  },
};

// Notification/media controls share the canonical action path, including daemon/MCP.
for (const name of ["notifications", "media"] as const) {
  const flags = name === "notifications"
    ? ["--app", "--limit", "--max-text-chars", "--wait-timeout-ms", "--action"]
    : ["--app", "--session", "--duration-ms", "--limit", "--max-text-chars", "--wait-timeout-ms", "--position-ms", "--position-tolerance-ms"];
  COMMANDS[name] = {
    name, group: "Observation", documentedFlags: flags, supportedFlags: flags,
    summary: name === "notifications" ? "Inspect and control active notifications" : "Inspect and control media sessions",
    help: name === "notifications"
      ? "androperator notifications list [--app <package>] [--limit <1-100>] [--max-text-chars <1-1024>]\nandroperator notifications dismiss <key> [--wait-timeout-ms <0-30000>]\nandroperator notifications action <key> --action <action-id>\nReads work while locked/off without waking the device. Mutations retain interactive readiness."
      : "androperator media list [--app <package>]\nandroperator media status <--session <id>|--app <package>>\nandroperator media observe <--session <id>|--app <package>> --duration-ms <1-30000>\nandroperator media <pause|play> <--session <id>|--app <package>> [--wait-timeout-ms <0-30000>]\nandroperator media seek <--session <id>|--app <package>> --position-ms <integer> [--wait-timeout-ms <0-30000>] [--position-tolerance-ms <0-60000>]\nObserve returns once after the requested duration; reports arrive at player-defined intervals. Zero reports does not prove a stall.\nSeek tolerance defaults to 1000 ms; confirmation requires a new player report.\nMedia reads and controls work while locked/off without waking the device or accessibility; UI/notification-mutation lists retain interactive readiness. Estimates are not proof of playback.",
    topLevelBlock: `  ${name} ${name === "media" ? "<list|status|observe|pause|play|seek>" : "<list|dismiss|action>"}\n                                            Inspect notifications or media sessions`,
    handler: async ctx => {
      const { rest } = ctx;
      const operation = rest[0];
      const types: Record<string, import("../contracts/notifications.js").NotificationMediaAction> = name === "notifications"
        ? { list: "list_notifications", dismiss: "dismiss_notification", action: "invoke_notification_action" }
        : { list: "list_media_sessions", status: "get_media_status", observe: "observe_media", pause: "media_pause", play: "media_play", seek: "media_seek" };
      const type = types[operation];
      if (type === undefined) throw new UsageError(`Use ${name} ${Object.keys(types).join("|")}; for example androperator ${name} list.`);
      const notificationMutation = name === "notifications" && operation !== "list";
      const params: import("../contracts/execution.js").ActionParams = {};
      if (notificationMutation) {
        if (rest[1] === undefined || rest[1].startsWith("--")) throw new UsageError("Provide a notification key from notifications list.");
        params.notificationKey = rest[1];
      }
      const seenFlags = new Set<string>();
      for (let index = notificationMutation ? 2 : 1; index < rest.length; index++) {
        const flag = rest[index];
        if (!flags.includes(flag) || seenFlags.has(flag)) throw new UsageError(`Unexpected or repeated argument '${flag}'.`);
        seenFlags.add(flag);
        getStringOptStrict(rest, flag);
        index += rest[index + 1] === "--" ? 2 : 1;
      }
      for (const [flag, key] of [["--app", "applicationId"], ["--session", "mediaSessionId"], ["--action", "actionId"]] as const) {
        const value = getStringOptStrict(rest, flag);
        if (value !== undefined) params[key] = value;
      }
      for (const [flag, key] of [["--duration-ms", "durationMs"], ["--limit", "limit"], ["--max-text-chars", "maxTextChars"], ["--wait-timeout-ms", "waitTimeoutMs"], ["--position-ms", "positionMs"], ["--position-tolerance-ms", "positionToleranceMs"]] as const) {
        const value = getStringOptStrict(rest, flag);
        if (value !== undefined) params[key] = value.trim() === "" ? NaN : Number(value);
      }
      return (await import("./commands/action.js")).cmdNotificationMedia({ ...ctx, type, params });
    },
  };
}

// doctor
COMMANDS["doctor"] = {
  name: "doctor",
  group: "Setup",
  documentedFlags: ["--fix", "--full", "--check-only", "--capability"],
  supportedFlags: ["--fix", "--full", "--check-only", "--capability"],
  summary: "Run environment and runtime checks",
  help: HELP_DOCTOR + "\nUse --capability background-observation for non-waking notification/media readiness. Default: interactive. Background mode rejects --full and --fix.",
  topLevelBlock: `  doctor
                                            Run environment and runtime checks (Stage 3). Use --output json for explicit JSON; --format json is also accepted.
  doctor --fix
                                            Attempt non-destructive host fixes (Stage 3)
  doctor --full
                                            Full Android build + install + handshake + smoke (Stage 3)
  doctor --check-only
                                            Compatibility flag; readiness failures still exit 1`,
  handler: async (ctx) => {
    const { rest, format, verbose, logger, deviceId, operatorPackage } = ctx;
    const out = { format, verbose, logger };
    const isJson = hasFlag(rest, "--json") || format === "json";
    return (await import("./commands/doctor.js")).cmdDoctor({
      ...out,
      format: isJson ? "json" : "pretty",
      fix: hasFlag(rest, "--fix"),
      full: hasFlag(rest, "--full"),
      checkOnly: hasFlag(rest, "--check-only"),
      capability: getStringOptStrict(rest, "--capability"),
      deviceId,
      operatorPackage,
      logger,
    });
  },
};

// grant-device-permissions
COMMANDS["grant-device-permissions"] = {
  name: "grant-device-permissions",
  group: "Setup",
  documentedFlags: [],
  supportedFlags: [],
  summary: "Re-grant accessibility and notification permissions",
  help: HELP_GRANT_DEVICE_PERMISSIONS,
  topLevelBlock: `  grant-device-permissions [--device <id>] [--operator-package <package>]
                                            Re-grant accessibility and notification permissions (remediation only)`,
  handler: async (ctx) => {
    const { format, verbose, logger, deviceId, operatorPackage } = ctx;
    const out = { format, verbose, logger };
    return (await import("./commands/grantDevicePermissions.js")).cmdGrantDevicePermissions({
      ...out,
      deviceId,
      operatorPackage,
    });
  },
};

// version
COMMANDS["version"] = {
  name: "version",
  group: "Setup",
  documentedFlags: ["--check-compat"],
  supportedFlags: ["--check-compat"],
  summary: "Show the CLI version",
  help: HELP_VERSION,
  topLevelBlock: `  version
                                            Show the CLI version
  version --check-compat [--device <id>] [--operator-package <package>]
                                            Compare the CLI version with the installed Operator APK version`,
  handler: async (ctx) => {
    const { rest, format, verbose, logger, deviceId, operatorPackage } = ctx;
    const out = { format, verbose, logger };
    return (await import("./commands/version.js")).cmdVersion({
      ...out,
      checkCompat: hasFlag(rest, "--check-compat"),
      deviceId,
      operatorPackage,
    });
  },
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** True when the open command should use open_uri (target string contains a URI scheme). */
export function isOpenCliUriTarget(target: string): boolean {
  return /[a-z][a-z0-9+\-.]*:\/\//i.test(target);
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// Maps removed compound commands to their flat replacements.
// When a caller types e.g. "action click", cmd="action" and rest[0]="click",
// so we can give a precise "use 'click' instead" message.
const REMOVED_COMPOUND_COMMANDS: Record<string, Record<string, string>> = {
  action: { click: "click", "open-app": "open", "open-uri": "open", type: "type", read: "read", wait: "wait", "press-key": "press" },
  observe: { snapshot: "snapshot", screenshot: "screenshot" },
  inspect: { ui: "snapshot" },
};

const REMOVED_TOP_LEVEL_COMMANDS = new Set([
  "agent-skills",
]);

export function isRemovedTopLevelCommand(cmd: string): boolean {
  return REMOVED_TOP_LEVEL_COMMANDS.has(cmd);
}

export function didYouMean(cmd: string, rest: string[], commands: Record<string, CommandDef>): string {
  // Check removed compound commands first - give precise migration guidance.
  const compoundMap = REMOVED_COMPOUND_COMMANDS[cmd];
  if (compoundMap) {
    const sub = rest[0];
    const replacement = sub ? compoundMap[sub] : undefined;
    if (replacement) {
      return JSON.stringify({
        code: "UNKNOWN_COMMAND",
        message: `'${cmd} ${sub}' has been removed. Use '${replacement}' instead. Run 'androperator ${replacement} --help' for usage.`,
        suggestion: replacement,
      });
    }
    // Known removed namespace but unknown or missing subcommand
    const validSubs = Object.keys(compoundMap).join(", ");
    return JSON.stringify({
      code: "UNKNOWN_COMMAND",
      message: `'${cmd}' has been removed. Use one of: ${validSubs} - e.g. 'androperator snapshot'. Run --help for available commands.`,
    });
  }
  const threshold = Math.max(2, Math.floor(cmd.length / 2));
  // Collect all candidates within threshold distance, then sort deterministically:
  //   1. closest distance first
  //   2. primary name beats synonym at equal distance (more canonical suggestion)
  //   3. alphabetical within same tier (removes dependence on Object.values order)
  const candidates: { name: string; isPrimary: boolean; dist: number }[] = [];
  for (const def of Object.values(commands)) {
    const d = levenshtein(cmd, def.name);
    if (d <= threshold) candidates.push({ name: def.name, isPrimary: true, dist: d });
    for (const syn of def.synonyms ?? []) {
      const ds = levenshtein(cmd, syn);
      if (ds <= threshold) candidates.push({ name: syn, isPrimary: false, dist: ds });
    }
  }
  candidates.sort((a, b) =>
    a.dist !== b.dist ? a.dist - b.dist :
    a.isPrimary !== b.isPrimary ? (b.isPrimary ? 1 : -1) :
    a.name.localeCompare(b.name)
  );
  const bestMatch = candidates[0]?.name;
  if (bestMatch) {
    return JSON.stringify({
      code: "UNKNOWN_COMMAND",
      message: `Unknown command: ${cmd}. Did you mean '${bestMatch}'? Use --help for available commands.`,
      suggestion: bestMatch,
    });
  }
  return JSON.stringify({
    code: "UNKNOWN_COMMAND",
    message: `Unknown command: ${cmd}. Use --help for available commands.`,
  });
}

export function generateTopLevelHelp(commands: Record<string, CommandDef>): string {
  const lines: string[] = [
    "Androperator CLI",
    "",
    "Usage:",
    "  androperator <command> [options]",
    "",
    "Commands:",
  ];

  const groupOrder = [
    "Device Interaction",
    "Device Management",
    "Execution",
    "Recording",
    "Setup"
  ];

  const groups: Record<string, string[]> = {};
  for (const def of Object.values(commands)) {
    if (def.topLevelBlock) {
      if (!groups[def.group]) groups[def.group] = [];
      if (!groups[def.group].includes(def.topLevelBlock)) {
        groups[def.group].push(def.topLevelBlock);
      }
    }
  }

  for (const groupName of groupOrder) {
    if (groups[groupName] && groups[groupName].length > 0) {
      lines.push("");
      lines.push(`  --- ${groupName} ---`);
      lines.push(...groups[groupName]);
    }
  }

  // Any left over groups not in groupOrder
  for (const groupName of Object.keys(groups)) {
    if (!groupOrder.includes(groupName)) {
      lines.push("");
      lines.push(`  --- ${groupName} ---`);
      lines.push(...groups[groupName]);
    }
  }

  lines.push(
    "",
    "Global options:",
    "  --device <id>                           Target Android device serial (Also accepted as: --device-id)",
    "  --operator-package <package>            Target Operator package for broadcast dispatch (Also accepted as: --receiver-package)",
    "  --output <json|pretty>                  Output format (default: json)",
    "  --json                                  Alias for --output json",
    "  --log-level <debug|info|warn|error>     Persistent log level (default: info)",
    "  --timeout <n>                           Override execution timeout (Also accepted as: --timeout-ms)",
    "  --no-daemon                             Force direct execution for daemon-capable commands",
    "  --verbose                               Include debug diagnostics in output",
    "  --help                                  Show help",
    "  --version                               Show version",
    "",
    "Notes:",
    "  - Machine-readable docs for agents: https://docs.androperator.com/llms.txt (index) and https://docs.androperator.com/llms-full.txt (complete docs).",
    "  - Post-install host-agent orientation: https://docs.androperator.com/host-agents/",
    "  - If the current host is unfamiliar, inspect 'androperator bundled-skills list' and start with 'androperator-agent-orientation' before choosing MCP or CLI actions.",
    "  - If this installed Androperator environment needs a whole-product refresh, inspect 'androperator bundled-skills list' and use 'androperator-upgrade' before trying component-level repair commands. androperator-upgrade checks androperator --version, verifies Node 24+, npm reachability, and Java 17/21, then uses npm install -g androperator@latest, androperator install, and androperator doctor when the CLI is already viable.",
    "  - Use 'androperator-skill-author-by-agent-discovery' for bounded exploration and optional reusable instructions.",
    "  - Use 'androperator-skill-author-by-recording' when a demonstration supplies missing evidence.",
    "  - Use 'androperator mcp serve' when the host already supports stdio MCP and wants registered Androperator tools.",
    "  - install is the canonical post-bootstrap route. operator setup remains the APK-specific setup command, and operator install remains its alias.",
    "  - recording is the canonical command family; 'record' is a supported short alias.",
    "  - exec is the canonical command for execution payloads; 'execute' is a supported synonym.",
    "  - Flat commands (snapshot, click, open, type, read, wait, press, back, scroll) are the canonical device interaction surface.",
    "  - Removed nested CLI forms such as `observe snapshot` or `action click`; unknown-command errors suggest the flat replacement.",
    "  - The default Operator package is com.androperator.operator. Use --operator-package com.androperator.operator.dev for local debug builds.",
    "  - Terminal result semantics are driven by [Androperator-Result].",
    ""
  );

  return lines.join("\n");
}

export function resolveHelpFromRegistry(rest: string[], commands: Record<string, CommandDef>): string {
  const nonFlagArgs = rest.filter((a) => !a.startsWith("--"));
  const rawCmd = nonFlagArgs[0];
  if (!rawCmd) {
    return generateTopLevelHelp(commands);
  }
  const def = commands[rawCmd] ?? Object.values(commands).find((c) => c.synonyms?.includes(rawCmd));
  if (!def) {
    return generateTopLevelHelp(commands);
  }
  if (def.subtopics && nonFlagArgs.length > 1) {
    const sub = nonFlagArgs[1];
    if (def.subtopics[sub]) {
      return def.subtopics[sub];
    } else {
      // Unknown subcommand - fall back to top-level help
      return generateTopLevelHelp(commands);
    }
  }
  return def.help;
}

export function resolveSupportedFlagsFromRegistry(def: CommandDef, rest: string[]): string[] {
  if (Array.isArray(def.supportedFlags)) {
    return def.supportedFlags;
  }
  if (typeof def.supportedFlags === "function") {
    return def.supportedFlags(rest);
  }
  return [];
}
