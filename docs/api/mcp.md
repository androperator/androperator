# MCP Server

## Purpose

Describe the first-party stdio MCP server exposed by `androperator mcp serve`: how to launch it, how to configure long-running MCP clients, which tools ship today, and what behavior to expect when device state changes under a running client.

For the post-install decision of whether you should start with MCP or with
`androperator skills`, read [Host Agent Orientation](../host-agents.md) first.
This page assumes you have already decided that MCP is the correct front door.

## Sources

- CLI command registration: `apps/node/src/cli/registry.ts`
- MCP bootstrap: `apps/node/src/cli/commands/mcp.ts`, `apps/node/src/mcp/server.ts`
- Shared MCP tool helpers: `apps/node/src/mcp/tools/common.ts`, `apps/node/src/mcp/selectors.ts`
- Core tools: `apps/node/src/mcp/tools/core.ts`
- Named tools: `apps/node/src/mcp/tools/named.ts`
- MCP session defaults: `apps/node/src/mcp/session.ts`
- Installer-generated MCP snippet: [`install.sh`](https://github.com/androperator/androperator/blob/main/sites/androperator-public/install.sh)
- Execution contract: `apps/node/src/contracts/execution.ts`
- Error codes: `apps/node/src/contracts/errors.ts`
- Selector contract: `apps/node/src/contracts/selectors.ts`
- Result envelope: `apps/node/src/contracts/result.ts`
- Package Node requirement: `apps/node/package.json`

## What It Is

`androperator mcp serve` starts a local stdio MCP server for MCP clients such as Claude Desktop. Execution-backed tools may return the shared [result envelope](overview.md#result-envelope) in tool output. The server is transport-only:

- it speaks MCP over stdin/stdout
- it does not expose HTTP or SSE
- it uses the same canonical execution engine as the CLI and `serve`
- it starts even when no Android device is connected

If no device is connected at startup, the process still boots normally. Tool calls that need a device then return structured Androperator errors such as `NO_DEVICES` or `ADB_NOT_FOUND`.

## Start The Server

Installed package command:

```bash
androperator mcp serve
```

Development validation command:

```bash
npm --prefix apps/node run build
androperator mcp serve
```

Notes:

- `mcp serve` is a long-running stdio transport. Do not wrap it in another CLI command that also writes to stdout.
- The MCP path is detected before the normal CLI formatter runs, so stdout is reserved for MCP protocol messages only.
- Global CLI flags such as `--device`, `--device-id`, and `--operator-package` are not accepted on the `mcp serve` argv line. Pass `deviceId` and `operatorPackage` per MCP tool call instead, or store them for the current MCP session with `configure`.
- Node.js `24+` is required.

## Installer-Generated Snippet

`install.sh` writes a host-specific MCP snippet to:

- `~/.androperator/mcp-config-snippet.json`

That file is generated from the installer's current binary path, detected `adb`
path, `DEFAULT_OPERATOR_PACKAGE` (`com.androperator.operator`), and
`~/.androperator/logs`. It includes:

- `claudeDesktop.entry.androperator`
- `codex.entryToml`
- `genericStdioConsumer.server`

When the installer can resolve the packaged CLI JS entrypoint, the generated
snippet uses the installer's current absolute Node executable path instead of a
bare `node` command so GUI MCP clients do not depend on shell `PATH`.

The installer does not auto-register the MCP server with any client. The file
is a paste-ready bridge, not an automatic configuration mutation.

## Claude Desktop Example

Example `mcpServers` entry:

```json
{
  "mcpServers": {
    "androperator": {
      "command": "node",
      "args": [
        "<installed_androperator_path>/dist/cli/index.js",
        "mcp",
        "serve"
      ],
      "env": {
        "ADB_PATH": "<adb_path>",
        "ANDROPERATOR_OPERATOR_PACKAGE": "com.androperator.operator.dev",
        "ANDROPERATOR_LOG_DIR": "<log_dir>",
        "ANDROPERATOR_LOG_LEVEL": "info"
      }
    }
  }
}
```

Why `node` is the command:

- the npm package ships `dist/cli/index.js`
- MCP desktop clients usually want an explicit executable plus argument list
- using `node` plus the installed CLI entrypoint avoids relying on shell wrappers

## When To Use MCP Versus `androperator skills`

Use `androperator skills` when:

- your host can shell out to the CLI directly
- you want to discover installed runtime skills by app, keyword, or id
- you want the runtime-skill wrapper semantics from `skills get` and `skills run`

Use MCP when:

- your host already supports stdio MCP
- you want a long-running registered tool surface instead of repeated CLI process launches
- you need general device tools such as `devices`, `snapshot`, `execute`, and `configure`, not only runtime-skill discovery

These surfaces are complementary:

- `androperator skills` is the primary runtime-skill discovery and wrapper surface
- `androperator mcp serve` is the primary tool-registration surface for MCP-capable hosts
- [Host Agent Orientation](../host-agents.md) is the canonical post-install route for choosing between them

## Environment For Long-Running MCP Clients

These environment variables matter most for MCP use:

| Variable | Default | Why MCP users care |
| --- | --- | --- |
| `ADB_PATH` | `adb` from `PATH` | MCP clients like Claude Desktop usually do not inherit your interactive shell `PATH`. Set this explicitly in the MCP client config. |
| `ANDROPERATOR_OPERATOR_PACKAGE` | `com.androperator.operator` | Use `com.androperator.operator.dev` for local branch testing against the debug APK. |
| `ANDROPERATOR_LOG_DIR` | `~/.androperator/logs` | Primary diagnostics path for MCP users because Claude Desktop does not surface stderr. |
| `ANDROPERATOR_LOG_LEVEL` | `info` | Raise to `debug` when diagnosing tool failures. |

Important diagnostics rule:

- stderr is not visible in Claude Desktop
- when an MCP session fails, check the log file under `ANDROPERATOR_LOG_DIR`
- `ANDROPERATOR_LOG_LEVEL=debug` is the main way to get more runtime detail from a GUI MCP client

For the full environment-variable contract, see [Environment Variables](environment.md).

## Selector Shape

Selector-taking MCP tools accept this object shape:

| Field | Maps to `NodeMatcher` | Meaning |
| --- | --- | --- |
| `id` | `resourceId` | Exact Android resource id |
| `role` | `role` | Exact node role |
| `text` | `textEquals` | Exact visible text |
| `textContains` | `textContains` | Substring match on visible text |
| `desc` | `contentDescEquals` | Exact content description |
| `descContains` | `contentDescContains` | Substring match on content description |
| `ancestor` | `ancestor` | Non-empty canonical NodePredicate for a strict ancestor |
| `descendant` | `descendant` | Non-empty canonical NodePredicate for an eligible strict descendant |

Rules:

- at least one selector field must be present and non-empty
- an all-empty selector is rejected at the MCP boundary
- selector objects are used by `click`, `type`, `read`, `wait`, and `scroll_until`

For the underlying selector contract, see [Selectors](selectors.md).

## Tool Summary

<!-- CODE-DERIVED: mcp-tool-summary -->

## Tool Details

All execution-backed tools accept these common options unless noted otherwise:

| Field | Required | Meaning |
| --- | --- | --- |
| `deviceId` | no | Explicit adb device serial. Strongly recommended when multiple devices are connected. |
| `operatorPackage` | no | Operator package override. Blank string is rejected. |
| `timeoutMs` | no | Execution timeout override. Values must stay within the normal execution timeout bounds or the MCP boundary rejects them with `InvalidParams`. For `wait`, this is the wait duration and the execution timeout is derived from it. |

You can also store `deviceId`, `operatorPackage`, and `timeoutMs` once per MCP server process with `configure`. When both are present, per-call values win over session defaults for each field independently.

<a id="mcp-tool-devices"></a>
### `devices`

List adb-visible devices.

Input:

```json
{}
```

Success payload shape:

```json
{
  "devices": [
    {
      "serial": "emulator-5554",
      "state": "device"
    }
  ]
}
```

Notes:

- this is observational output only
- it does not apply execution-time device resolution rules

<a id="mcp-tool-snapshot"></a>
### `snapshot`

Capture the current UI hierarchy XML.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package |
| `timeoutMs` | no | Execution timeout; defaults to `30000` |
| `maxChars` | no | Raw mode only; truncate XML to this many characters. Minimum `1`. |
| `compact` | no | Return a bounded structural JSON projection; default `false` |
| `maxNodes` | no | Requires compact; integer `1..1000`, default `100` |
| `maxTextChars` | no | Requires compact; integer `1..4096` Unicode code points per field, default `256` |
| `saveRaw` | no | Save exact XML in a new runtime-owned temporary file; default `false` |

Example call:

```json
{
  "deviceId": "<device_serial>",
  "operatorPackage": "com.androperator.operator.dev",
  "maxChars": 2000
}
```

Minimal compact call:

```json
{"compact": true, "maxNodes": 100}
```

Set `compact: true` whenever supplying `maxNodes` or `maxTextChars`.
Omitting `compact`, or setting it to `false`, selects raw XML and rejects those
limits. Omit `maxChars` in compact mode. Invalid combinations return MCP
`-32602` before device dispatch, with guidance for correcting the arguments.
The published tool schema also describes and encodes these dependencies.
Compact limits bound returned output only; they do not reduce hierarchy capture
or transfer cost.

Success payload includes:

- `snapshot`: XML string from `snapshot`
- `truncated`: present as `true` only when `maxChars` shortened the XML
- `deviceId`
- `terminalSource`
- `envelope`

The fields above describe raw mode. With `compact: true`, `compact` replaces the
top-level `snapshot` and snapshot `data.text` in the envelope copy. Node paths,
state fields, counts, and errors follow the [compact snapshot contract](snapshot.md#compact-output-and-raw-artifacts).
`compact` and `maxChars` cannot be combined. `saveRaw: true` returns
`rawArtifactPath` inside `compact` in compact mode, or top-level in raw mode.
Caller-provided `rawPath` is rejected; MCP cannot choose arbitrary host paths.

When `maxChars` is applied, the returned `envelope` is truncated consistently with the top-level `snapshot` field, so MCP clients do not receive a second full-copy XML payload through `content` or `structuredContent`.

<a id="mcp-tool-evidence-capture"></a>
### `evidence_capture`

Capture a local screenshot/raw-hierarchy bundle. Accepts common `deviceId`,
`operatorPackage`, and `timeoutMs` arguments, plus optional `label` (at most
2048 UTF-16 code units) and `context` (JSON object, at most 16 KiB UTF-8).
`outputDir` and other caller-chosen host paths are rejected.

The server creates a unique bundle under `~/.androperator/evidence/bundles` and
returns `{ok,status,manifestPath,evidenceId}` in both content forms. Only complete
capture has `ok: true`. Partial/failed captures set `isError: true` and retain
`manifestPath` when writable. The opaque caller context remains separate from
capture status. See [Still Evidence Bundles](evidence.md) for metadata, artifact
validation, partial files, deadlines, and the schema.

<a id="mcp-tool-execute"></a>
### `execute`

Run a caller-supplied action list through the canonical execution validator and runtime.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `actions` | yes | Array of action objects. Each action must include `id` and `type`; `params` is optional passthrough data. |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package. Blank string is rejected before runtime dispatch. |
| `timeoutMs` | no | Top-level execution timeout. Defaults to `30000`. |

Example call:

```json
{
  "deviceId": "<device_serial>",
  "operatorPackage": "com.androperator.operator.dev",
  "actions": [
    {
      "id": "sleep-1",
      "type": "sleep",
      "params": {
        "durationMs": 1000
      }
    }
  ]
}
```

Validation boundary:

- MCP only enforces `actions` presence plus `id` and `type` on each element
- the full action contract is enforced later by `validateExecution()`
- MCP rejects caller-controlled `take_screenshot` `path` values so an MCP client cannot choose arbitrary host write locations
- exact lower-case `on_screen_log_set` and `on_screen_log_clear` aliases reach
  the canonical executor and normalize to `set_on_screen_log` and
  `clear_on_screen_log`; MCP does not expose separate panel tools
- `params.template` carries live overlay templates unchanged to Android; supply
  exactly one of `text` or `template`, with the same styling fields
- case or whitespace variants and on-screen log parameter aliases are rejected

Use `execute` for `show_toast` and `cancel_toast`; there are no separate toast tools.
See [Toast actions](actions.md#action-show-toast) for parameters and submission semantics.

Use [Actions](actions.md) for canonical action types and params, and
[On-screen logs](on-screen-logs.md) for the panel-specific raw contract.
The `on-screen-log set` and `clear` conveniences are CLI commands; MCP clients
continue to use `execute` with the same canonical action parameters.

<a id="mcp-tool-configure"></a>
### `configure`

Store per-session defaults for execution-backed MCP tools.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `deviceId` | no | Session default adb device serial |
| `operatorPackage` | no | Session default operator package |
| `timeoutMs` | no | Session default execution timeout. Must stay within the normal execution timeout bounds or `configure` rejects it with `InvalidParams`. |

Rules:

- all fields are optional
- blank or whitespace-only `deviceId` and `operatorPackage` are rejected with `InvalidParams`
- `timeoutMs` must stay within the normal execution timeout bounds before it is stored
- the stored state is scoped to the current `createMcpServer()` instance only
- the response shape is always `{ "session": { ...currentValues } }`
- unset fields are omitted from `session`
- per-call tool arguments override session defaults field-by-field

Example call:

```json
{
  "deviceId": "<device_serial>",
  "operatorPackage": "com.androperator.operator.dev",
  "timeoutMs": 15000
}
```

Example success payload:

```json
{
  "session": {
    "deviceId": "<device_serial>",
    "operatorPackage": "com.androperator.operator.dev",
    "timeoutMs": 15000
  }
}
```

<a id="mcp-tool-open"></a>
### `open`

Open an app or URI.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `appId` | conditional | Android package id |
| `uri` | conditional | URI to open |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package |
| `timeoutMs` | no | Execution timeout. Defaults to `15000`. |

Rule:

- provide exactly one of `appId` or `uri`

Example app launch:

```json
{
  "appId": "com.android.settings",
  "deviceId": "<device_serial>"
}
```

Example URI launch:

```json
{
  "uri": "https://androperator.com",
  "deviceId": "<device_serial>"
}
```

<a id="mcp-tool-swipe"></a>
### `swipe`

Swipe between absolute screen coordinates, then release. `start`, `end`, and
`durationMs` are all required; there is no duration default. See the
[swipe action contract](actions.md#action-swipe) for bounds, timing, results,
and failures. Common `deviceId`, `operatorPackage`, and `timeoutMs` options apply.

```json
{
  "start": { "x": 100, "y": 500 },
  "end": { "x": 800, "y": 500 },
  "durationMs": 300,
  "deviceId": "<device_serial>"
}
```

<a id="mcp-tool-drag"></a>
### `drag`

Hold at `start`, move to `end` without lifting, then release. `start`, `end`,
`holdDurationMs`, and `moveDurationMs` are required. Requires Android API 26.
See the [drag action contract](actions.md#action-drag) for validation, evidence,
and cancellation semantics. Common `deviceId`, `operatorPackage`, and `timeoutMs`
options apply. Use a fresh snapshot to verify the application's drop result.

Call the named `drag` tool with these arguments, not an execution action wrapper:

```json
{
  "start": { "x": 600, "y": 1600 },
  "end": { "x": 200, "y": 1000 },
  "holdDurationMs": 1200,
  "moveDurationMs": 800,
  "deviceId": "<device_serial>",
  "timeoutMs": 30000
}
```

Replace the example coordinates with bounds from the target's current snapshot.
For a local development Operator, include
`"operatorPackage": "com.androperator.operator.dev"`.

<a id="mcp-tool-click"></a>
### `click`

Click a node or an absolute coordinate.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `selector` | conditional | Selector object |
| `coordinate` | conditional | `{ "x": <int>, "y": <int> }` |
| `clickType` | no | One of `default`, `long_click`, `focus` |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package |
| `timeoutMs` | no | Execution timeout. Defaults to `30000`. |

Rule:

- provide exactly one of `selector` or `coordinate`

Example selector click:

```json
{
  "selector": {
    "text": "Network & internet"
  },
  "deviceId": "<device_serial>"
}
```

Example coordinate click:

```json
{
  "coordinate": {
    "x": 540,
    "y": 1180
  },
  "deviceId": "<device_serial>"
}
```

<a id="mcp-tool-type"></a>
### `type`

Type text into a matching field.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `selector` | yes | Target field selector |
| `text` | yes | Text to enter |
| `submit` | no | When `true`, request best-effort submit after entry |
| `clear` | no | Replace-style entry remains the goal. On Android `ACTION_SET_TEXT` targets, `true` first dispatches `ACTION_SET_TEXT("")`; on Android 13+ custom editors the runtime can use the API 33 input-connection fallback while still replacing existing content |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package |
| `timeoutMs` | no | Execution timeout. Defaults to `30000`. |

Behavior notes:

- the MCP `type` tool builds a normal `enter_text` execution and returns the
  standard execution payload
- The returned step separates `data.text_entry`, `data.submission`, and
  `data.submit_method`; `data.submit` remains the requested flag. Accepted submission
  does not prove navigation. Observe the destination separately.
- Android prefers a real editor action for `submit=true` when one is available
- if submit is requested but no truthful submit action exists after text entry,
  the text-entry step still succeeds
- for the full action contract and runtime details, see
  [Actions - `enter_text`](actions.md#action-enter-text)

Example call:

```json
{
  "selector": {
    "id": "com.android.settings:id/search_src_text"
  },
  "text": "battery",
  "clear": true,
  "deviceId": "<device_serial>"
}
```

<a id="mcp-tool-read"></a>
### `query_ui`

Inspect structured node state with optional `matcher`, `visibility`, and `limit`,
plus the common `deviceId`, `operatorPackage`, and `timeoutMs` options. `matcher`
uses the canonical NodeMatcher keys (`resourceId`, `textEquals`, and so on),
including canonical `ancestor` and `descendant` predicates. Omit it to match all
eligible nodes. Visibility defaults to `on_screen`; limit defaults to 100 and
accepts integers from 1 through 1000.

```json
{
  "matcher": {"resourceId": "row", "descendant": {"textEquals": "Display"}},
  "visibility": "all",
  "limit": 25
}
```

Success includes a parsed `query` object and the original correlated result
envelope whose `data.query` remains a JSON string. Zero matches succeed. See
[query_ui](actions.md#action-query-ui) for NodeSummary fields, null state,
visibility, truncation, the 256 KiB response limit, and observation-local paths.
The parsed result preserves per-node `accessibilityDataSensitive`, including
null or an absent field. Treat either as unknown. The field reports Android
node metadata, not a private-mode verdict. The tool does not convert paths into action targets.

### `read`

Read text from one node or all matches. Supports regex validation to filter results at the runtime boundary.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `selector` | yes | Target selector |
| `all` | no | When `true`, returns a JSON array payload instead of a single string |
| `container` | no | Optional container selector |
| `validator` | no | Validation mode. Currently only `"regex"` is supported. |
| `validatorPattern` | no | Required when `validator` is `"regex"`. A valid regex pattern the matched text must satisfy. |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package |
| `timeoutMs` | no | Execution timeout. Defaults to `30000`. |

Example single-value read:

```json
{
  "selector": {
    "text": "Network & internet"
  },
  "deviceId": "<device_serial>"
}
```

Example all-values read:

```json
{
  "selector": {
    "textContains": "Wi"
  },
  "all": true,
  "deviceId": "<device_serial>"
}
```

Example regex-validated read:

```json
{
  "selector": {
    "id": "com.example:id/version_text"
  },
  "validator": "regex",
  "validatorPattern": "^\\d+\\.\\d+\\.\\d+$",
  "deviceId": "<device_serial>"
}
```

<a id="mcp-tool-press"></a>
### `press`

Press a supported Android navigation key or TV remote button.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `key` | yes | One of `back`, `home`, `recents`, `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right`, `dpad_center`, `bookmark`, `profile`, `settings`, `tv`. See [button mappings and dispatch behavior](actions.md#action-press-key). |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package |
| `timeoutMs` | no | Execution timeout. Defaults to `10000`. |

Example call:

```json
{
  "key": "back",
  "deviceId": "<device_serial>"
}
```

<a id="mcp-tool-wait"></a>
### `wait`

Wait until a matching node appears.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `selector` | yes | Target selector |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package |
| `timeoutMs` | no | Wait duration in milliseconds. The execution timeout becomes `max(timeoutMs + 5000, 30000)`. |

Example call:

```json
{
  "selector": {
    "text": "Settings"
  },
  "timeoutMs": 8000,
  "deviceId": "<device_serial>"
}
```

<a id="mcp-tool-scroll-until"></a>
### `scroll_until`

Scroll in the given direction until a matching node appears, optionally clicking it afterward.

Parameters:

| Field | Required | Notes |
| --- | --- | --- |
| `selector` | yes | Target selector |
| `direction` | yes | Scroll direction: `"down"`, `"up"`, `"left"`, or `"right"` |
| `container` | no | Optional container selector |
| `clickAfter` | no | When `true`, the runtime uses action type `scroll_and_click` |
| `deviceId` | no | Explicit target device |
| `operatorPackage` | no | Explicit operator package |
| `timeoutMs` | no | Execution timeout. Defaults to `30000`. |

Example scroll only:

```json
{
  "selector": {
    "text": "About phone"
  },
  "direction": "down",
  "deviceId": "<device_serial>"
}
```

Example scroll then click:

```json
{
  "selector": {
    "text": "About phone"
  },
  "direction": "up",
  "clickAfter": true,
  "deviceId": "<device_serial>"
}
```

## Result And Error Behavior

Tool responses use normal MCP `tools/call` results:

- success responses serialize JSON in the text content and, for object payloads, also expose `structuredContent`
- execution failures return `isError: true`
- unknown exceptions are caught and returned as MCP tool errors instead of crashing the server

Common failure cases:

- `NO_DEVICES`: no usable Android target is connected
- `ADB_NOT_FOUND`: `adb` could not be resolved or executed
- `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`: more than one device is connected and no `deviceId` was supplied
- `EXECUTION_CONFLICT_IN_FLIGHT`: another execution-backed tool is already running on the same device and operator package
- `EXECUTION_VALIDATION_FAILED`: invalid MCP arguments or invalid action payload

For the full error-code catalog, see [Errors](errors.md).

## Device And Concurrency Caveats

Device targeting rules:

- if one device is connected, omitting `deviceId` is usually fine
- if multiple devices are connected, pass `deviceId`
- for local branch testing, prefer `com.androperator.operator.dev`

Concurrency rules:

- `devices` is observational and does not use the execution lock
- execution-backed tools share the same in-flight protection as the CLI
- concurrent calls against the same device and operator package may return `EXECUTION_CONFLICT_IN_FLIGHT`
- this is expected behavior, not a transport bug

## Smoke-Test Flow

One reproducible terminal smoke path:

```bash
npm --prefix apps/node run build
node validation/test_mcp_stdio_smoke.mjs
```

What the smoke script proves:

1. it starts the MCP stdio server command
2. it completes the MCP initialize handshake over stdio
3. it verifies `devices`
4. it opens Android Settings on a real device or emulator
5. it captures a snapshot and confirms the XML contains node elements
6. it performs a selector-driven read using text discovered from the live snapshot

The smoke script prefers a physical device when both a physical device and an emulator are connected. Override with `ANDROPERATOR_SMOKE_DEVICE=<device_serial>` if needed.

## Strict selectors

Named `click`, `type`, `read`, `wait`, `scroll`, `scroll_until`, and
`scroll_and_click` tools accept optional boolean `strict` and optional `container`
using the same shorthand selector shape as `selector`. `scroll` performs one
scroll; `scroll_and_click` defaults `clickAfter` to true. Raw `execute` accepts the
canonical `params.strict` and `params.container` fields. Query predicates remain
unchanged. See [strict selection](selectors.md#strict-action-selection) for the
counts, scope, failure data, and matching-Operator requirement.

Non-strict duplicate selections include a discovery hint for `--strict` in
`data.selection_warning`. Named `read` keeps its existing scalar/list value in
the first content item and adds a second JSON text item containing
`selection_warning` when needed. Unique reads and intentional multi-target
read-all results keep their existing output unless the explicit container is
ambiguous. See [duplicate-selection hints](selectors.md#duplicate-selection-hints).


<a id="mcp-tool-evidence-video-start"></a>
<a id="mcp-tool-evidence-video-status"></a>
<a id="mcp-tool-evidence-video-stop"></a>
### Managed video tools

`evidence_video_start` starts bounded screen recording with required
`durationSeconds` (1..180), optional `size`, `label`, `context`, and device/Operator
selection. An explicit configured session target can supply the device. It
allocates a managed bundle and returns `sessionId`; it never accepts output paths.
`evidence_video_status` and `evidence_video_stop` accept only `sessionId`, without
path or target overrides. Recording/startup confirmation is distinct from verified
media completion; stop succeeds only when finalization is complete. Pending or
failed stops and partial/failed captures set `isError: true`.
See [Managed video](evidence.md#managed-video) for lifecycle, prerequisites,
artifacts, ownership and recovery contracts.
