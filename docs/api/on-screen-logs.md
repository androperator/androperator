# On-screen Logs

## Purpose

`set_on_screen_log` and `clear_on_screen_log` are raw execution actions for a
small Operator-owned diagnostic panel. Show literal execution labels or configure
a template once and let Android update application and device metadata locally.

The panel belongs to the connected Operator accessibility service, not to the
foreground app and not to a host process. It is one visible panel per Operator
service.

This feature requires Android API 22 or later. On Android API 21,
`set_on_screen_log` fails closed with `ON_SCREEN_LOG_RENDER_FAILED` before it
attempts to attach a window.

## Sources

- Node validation: `apps/node/src/domain/executions/validateExecution.ts`
- Node screenshot finalization: `apps/node/src/domain/executions/runExecution.ts`
- Android action parsing: `apps/android/shared/data/operator/src/main/kotlin/androperator/operator/agent/AgentCommandParser.kt`
- Panel controller: `apps/android/shared/data/operator/src/main/kotlin/androperator/operator/onscreenlog/OnScreenLogPanelController.kt`
- Result mapping: `apps/android/shared/data/task/src/main/kotlin/androperator/task/runner/UiActionEngine.kt`
- Snapshot metadata: `apps/android/shared/data/uitree/src/main/kotlin/androperator/uitree/UiTreeInspectorAndroid.kt`

## Raw Actions

Use canonical lower-case action names in stored execution payloads. The CLI
commands below map to the same actions. There is no separate HTTP endpoint or
MCP tool; existing generic execution transports carry the same raw action list.

| Canonical action | Exact Node input alias | Purpose | Parameters |
| --- | --- | --- | --- |
| `set_on_screen_log` | `on_screen_log_set` | Show or replace the current panel. | Exactly one of `text` or `template` is required. Other fields are optional. |
| `clear_on_screen_log` | `on_screen_log_clear` | Remove the current panel. | Omit `params` or use exactly `{}`. |

At the Node execution boundary, the two aliases above normalize to their
canonical types before validation and dispatch. Result `actionType` values stay
canonical. Do not change case or add surrounding whitespace to either a
canonical type or an alias. Their parameter objects are strict and do not
translate generic keys such as `value` to `text`.

See [Actions](actions.md#action-set-on-screen-log) for the complete parameter
table and validation limits.

### Set example

```json
{
  "commandId": "on-screen-log-example",
  "taskId": "on-screen-log-example",
  "source": "agent",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    {
      "id": "show-label",
      "type": "set_on_screen_log",
      "params": {
        "text": "FLOW-001: Observe settings",
        "anchor": "right",
        "textAlign": "left",
        "topOffsetDp": 8,
        "edgeOffsetDp": 12,
        "widthDp": 320,
        "fontSizeSp": 16,
        "textColor": "#FFFFFFFF",
        "backgroundColor": "#B3000000",
        "ttlMs": 12000
      }
    },
    {
      "id": "observe-label",
      "type": "snapshot"
    },
    {
      "id": "clear-label",
      "type": "clear_on_screen_log"
    }
  ]
}
```

## Live templates

Supply `params.template` instead of `params.text`. Literal `text` never expands
placeholders, even when it contains `{{...}}`. Android resolves templates; Node,
Serve and MCP do not poll or resolve metadata.

| Placeholder | Value |
| --- | --- |
| `{{foreground_app.icon}}` | Declared application icon, inline at text size; adaptive icons are supported |
| `{{foreground_app.package_name}}` | Verified foreground application package |
| `{{foreground_app.version_code}}` | Full installed version code as decimal text |
| `{{foreground_app.version_name}}` | Declared version name |
| `{{device.manufacturer}}` | Android manufacturer |
| `{{device.model}}` | Android model |
| `{{system.language_code}}` | Primary system locale language, for example `en` |
| `{{system.language_tag}}` | Primary system locale language tag, for example `en-US` |
| `{{system.language_name}}` | Language name in its own language, for example `Deutsch` |

For example:

```bash
androperator on-screen-log set --template '{{foreground_app.icon}} {{foreground_app.package_name}}
{{foreground_app.version_code}} | {{foreground_app.version_name}}
{{system.language_tag}} | {{system.language_name}}' --device <device_serial> --operator-package com.androperator.operator.dev
```

Only the nine exact names above are supported. Unknown or malformed placeholders
fail validation before changing the current panel; errors list supported names.
Write `{{{{` for literal `{{` and `}}}}` for literal `}}`, for example
`{{{{device.model}}}}` displays `{{device.model}}`. Single braces are literal.
There are no expressions, HTML entities, recursive expansion, or HTML rendering.
Ordinary spaces, LF newlines and TAB characters are supported.

Both input forms require 1-2048 UTF-16 code units and a non-whitespace character;
control characters other than LF and TAB are rejected. Expanded templates are
bounded to 8192 UTF-16 units, with each substituted text value bounded to 256.
Metadata control characters become spaces. Expansion never splits a surrogate
pair; bounded content ends with an ellipsis. Layout can additionally wrap or
truncate at the usable display height. An icon occupies one inline position;
metadata is not reparsed as template syntax.

App fields and the icon come from the same foreground observation. In split-screen,
the panel follows the focused application, excluding the keyboard and this overlay.
Home can identify the launcher. System panels retain the last verified app as
context; starting under a panel has no app context. Locked and unavailable states
clear app context. `Unavailable` and a neutral gray icon represent missing values;
a known package remains visible when only its metadata is unavailable. Updates
are event-driven samples, not a complete or instantaneous focus history.

System-language fields follow the primary system locale independently of the
Operator's per-app language. Locale changes refresh the panel. Package changes
invalidate metadata caches. Templates using only device or language fields do
not subscribe to foreground observation.

Initial success acknowledges the first rendered state, which can contain
unavailable app metadata while lookup is pending. Refresh does not reset TTL.
Replacement, clear, expiry and service detach cancel the old subscription and
lookups. Late results cannot restore a removed panel. A refresh layout or renderer
failure hides the panel; it cannot report a new execution error after the original
request has completed. Existing screenshot timing and capture limitations apply.

## CLI Commands

`on-screen-log set` shows or fully replaces the panel. `on-screen-log clear`
removes it, including when it is already hidden. Both use the canonical action
validator and the normal mutation execution path.

```bash
androperator on-screen-log set --text "FLOW-001: Observe settings" --anchor right --text-align left --top-offset-dp 24 --edge-offset-dp 12 --width-dp 280 --font-size-sp 12 --text-color '#FFFFFFFF' --background-color '#B3000000' --ttl-ms 300000 --device <device_serial>
androperator on-screen-log clear --device <device_serial>
```

| Set flag | Raw field |
| --- | --- |
| `--text` (exclusive with `--template`) | `text` |
| `--template` (exclusive with `--text`) | `template` |
| `--anchor` | `anchor` |
| `--text-align` | `textAlign` |
| `--top-offset-dp` | `topOffsetDp` |
| `--edge-offset-dp` | `edgeOffsetDp` |
| `--width-dp` | `widthDp` |
| `--font-size-sp` | `fontSizeSp` |
| `--text-color` | `textColor` |
| `--background-color` | `backgroundColor` |
| `--ttl-ms` | `ttlMs` |

The [raw parameter limits and defaults](actions.md#action-set-on-screen-log)
apply unchanged. Omitted flags remain omitted until canonical defaults apply;
zero offsets are preserved. Numeric flags accept a complete integral JSON
number token, including `12.0` and `1e3`. Blank, hexadecimal, fractional,
nonfinite, and suffix-bearing tokens such as `12px` are rejected before dispatch.
Text preserves whitespace and newlines within the API's validation limits.

Clear accepts only common execution/output options. Both commands reject extra
positional arguments, unknown flags, and missing values. Set also rejects
repeated panel flags. Syntax errors return structured errors with nonzero status;
canonical parameter violations return `EXECUTION_VALIDATION_FAILED`.

Common options include `--device`, `--operator-package`, `--timeout`,
`--output json|pretty`, and `--no-daemon`, before or after the command.
For local debug builds, pass `--operator-package com.androperator.operator.dev`.
JSON is the default and wraps the normal execution result under `envelope`;
step data uses exactly the string-valued keys below. The host `logs` command
is unchanged.

Both commands permit direct fallback only when the daemon has not dispatched.
An uncertain post-dispatch result is never automatically replayed; explicit
`--no-daemon` runs the same validated payload directly.

For visible capture, await each command separately:

```bash
androperator on-screen-log set --text "FLOW-001: Before" --device <device_serial>
androperator screenshot --path <absolute_before_png> --device <device_serial>
androperator on-screen-log set --text "FLOW-001: After" --anchor right --device <device_serial>
androperator screenshot --path <absolute_after_png> --device <device_serial>
androperator on-screen-log clear --device <device_serial>
```

Inspect the images independently. Successful draw acknowledgement does not
promise that a compositor capture includes that generation.

## Replacement and Lifetime

Each successful `set_on_screen_log` replaces the entire current panel. It does
not patch omitted fields from a prior panel. Defaults apply again for every
omitted optional field.

Node and Android validate the complete new payload before it can change an
existing panel. A malformed payload therefore cannot alter the visible panel.

After Android acknowledges that the requested panel generation has drawn, the
service schedules one local expiry for `ttlMs`. Expiry removes that same
generation only. A replacement or `clear_on_screen_log` cancels the older
expiry. The panel does not show a countdown, tick, or receive host-driven
elapsed-time updates.

Calling `clear_on_screen_log` while no panel is visible succeeds and returns
the same cleared result.

## Placement, Geometry, and Text

`anchor` selects the physical left or right side of the usable display. The
controller first excludes system-bar and display-cutout insets, then applies
`topOffsetDp` from the usable top edge and `edgeOffsetDp` inward from the
selected usable side.

`widthDp` is the full panel width, including its fixed 8 dp inner padding.
`fontSizeSp` follows Android font scale. The result `bounds` is the actual
physical-pixel rectangle in `[left,top][right,bottom]` form after those
conversions.

On Android 10 (API 29), the controller reads the default display's public
cutout safe insets. On Android 9 (API 28), a service cannot obtain those
insets from a public display-level API before an overlay is attached. If the
framework declares a built-in cutout on API 28, `set_on_screen_log` fails with
`ON_SCREEN_LOG_LAYOUT_INVALID` rather than attach with unknown unsafe geometry.

The panel accepts multiline text. If it cannot fit in the remaining usable
vertical area, Android truncates the text when at least one complete line fits
and returns `truncated: "true"`. If even one complete line plus padding cannot
fit, the action fails with `ON_SCREEN_LOG_LAYOUT_INVALID`.

When Android configuration changes, the service recomputes the panel using its
stored logical dp and sp values. If the new usable area cannot contain it, the
service removes the panel rather than leaving stale geometry on screen.

## Successful Result Data

On a successful `set_on_screen_log`, the step has these exact string-valued
data keys:

| Key | Meaning |
| --- | --- |
| `visible` | Always `"true"`. |
| `rendered` | Always `"true"` after Android acknowledges the generation's draw. |
| `truncated` | `"true"` when text was shortened to fit, otherwise `"false"`. |
| `anchor` | Resolved `left` or `right`. |
| `text_align` | Resolved `left` or `right`. |
| `top_offset_dp` | Resolved integer input as a string. |
| `edge_offset_dp` | Resolved integer input as a string. |
| `width_dp` | Resolved integer input as a string. |
| `font_size_sp` | Resolved integer input as a string. |
| `text_color` | Uppercase normalized `#AARRGGBB` value. |
| `background_color` | Uppercase normalized `#AARRGGBB` value. |
| `ttl_ms` | Resolved integer input as a string. |
| `bounds` | Actual pixel rectangle in `[left,top][right,bottom]` form. |

The result never echoes caller text, templates, or resolved metadata. Bounds and
`truncated` describe the initial acknowledged state, not future live refreshes.

On a successful `clear_on_screen_log`, step data is exactly:

```json
{
  "visible": "false"
}
```

It does not include `rendered`.

## Rendering, Interaction, and Capture Limits

The panel uses an accessibility-overlay window that is not touchable or
focusable. It does not become an accessibility text node, so its label cannot
be selected by normal UI-tree matching or `read_text`. Underlying app input can
continue through the panel.

`rendered: "true"` is a draw acknowledgement from the Android panel view. It
confirms that the requested generation drew before the controller deadline. It
does not guarantee that a later compositor capture, screenshot, or external
screen recorder includes the panel. Treat screenshots as separate observations
and verify them independently when their pixels matter.

The panel is not a secure window. Capture inclusion remains dependent on the
device and capture path.

### Current raw screenshot ordering

For `take_screenshot`, the current Node runtime captures host pixels after the
Android action list has returned its result envelope. A single action list that
orders `set_on_screen_log`, `take_screenshot`, and `clear_on_screen_log` can
therefore write a screenshot after the clear has already removed the panel.

To capture a visible panel with the raw CLI or Serve transport, use separate
executions in this order:

1. `set_on_screen_log`
2. `take_screenshot` with the caller-selected absolute path
3. `clear_on_screen_log`

The MCP `execute` tool rejects caller-controlled `take_screenshot` paths. For
MCP, omit `params.path` and use the runtime-managed `data.path` returned in the
result envelope if that path is useful to the MCP client. The same ordering
limit still applies to separate executions.

This is a capture-ordering limit of the existing screenshot pipeline, not a
stronger rendering acknowledgement. The panel's `rendered: "true"` result still
means only that Android drew the requested generation.

## Verification

Save the JSON action list from the example above to an absolute path and first
validate it without a device:

```bash
androperator exec --payload <absolute_path_to_execution.json> --validate-only
```

Success has exit code `0`, `ok: true`, and `validated: true`. Validation rejects
bad panel parameters with `EXECUTION_VALIDATION_FAILED` before dispatch.

For a live check, run a raw execution that orders `set_on_screen_log`,
`snapshot`, and `clear_on_screen_log` with an explicit target:

```bash
androperator exec --payload <absolute_path_to_execution.json> --device <device_serial> --operator-package <package_name> --no-daemon
```

On a successful run, check all of these exact result paths:

- `envelope.status == "success"`
- the set step has `success == true`, `data.visible == "true"`, and `data.rendered == "true"`
- the snapshot step has `success == true` and `data.operator_overlay_visible == "true"`
- the clear step has `success == true` and `data.visible == "false"`

If capture pixels matter, run a separate raw `take_screenshot` execution while
the panel remains visible. The raw CLI and Serve transports can use a
caller-selected output file; MCP must omit `params.path` and returns its
runtime-managed path in step data. Do not use a successful draw acknowledgement
as proof of screenshot inclusion.

## Failure Modes

| Surface | Code | Meaning and recovery |
| --- | --- | --- |
| Input validation | `EXECUTION_VALIDATION_FAILED` | The action name, parameter type, range, color, or strict object shape is invalid. Correct the payload and rerun it. The current panel is unchanged. |
| Service | `ON_SCREEN_LOG_SERVICE_UNAVAILABLE` | The Operator accessibility service or its window host is unavailable. Repair the service, then rerun the raw action. |
| Layout | `ON_SCREEN_LOG_LAYOUT_INVALID` | The usable display cannot contain the requested panel or one complete line. Adjust the supplied geometry or text and retry. |
| Rendering | `ON_SCREEN_LOG_RENDER_FAILED` | Android could not attach or update the panel. Verify service health, then issue a replacement action. |
| Draw acknowledgement | `ON_SCREEN_LOG_RENDER_TIMEOUT` | Android did not acknowledge a draw before the 2000 ms controller limit. Treat visibility as unconfirmed, inspect a new snapshot, and retry only if needed. |

See [Errors](errors.md#on-screen-log-panel-failures) for the exact structured
failure contract.

## Snapshot Metadata

A successful Android `snapshot` includes the string field
`operator_overlay_visible`:

| Value | Meaning |
| --- | --- |
| `"true"` | The current Operator-owned on-screen log panel is visible. |
| `"false"` | No current Operator-owned on-screen log panel is visible. |

This field deliberately has narrower meaning than `has_overlay`,
`overlay_package`, and `window_count`. Those existing fields preserve their raw
runtime metadata and are not changed or filtered by this feature. See
[Snapshot Format](snapshot.md) for the normal snapshot result contract.

## Generic Transports

Use the same JSON action objects with these existing execution surfaces:

- `androperator exec` using a raw execution payload
- `POST /execute` in the [Serve API](serve.md#endpoint-post-execute)
- the MCP [`execute`](mcp.md#mcp-tool-execute) tool

After a transport accepts an action object, canonical action validation happens
before Android dispatch. Invalid action names, parameter types, ranges, colors,
and strict object shapes return `EXECUTION_VALIDATION_FAILED`; they cannot
change an existing panel. MCP can instead return transport `InvalidParams` for
malformed tool shape, such as missing `actions` or blank action `id` or `type`.
Runtime failures are described in [Errors](errors.md#on-screen-log-panel-failures).

## Related Pages

- [Actions](actions.md)
- [Snapshot Format](snapshot.md)
- [Errors](errors.md)
- [Serve API](serve.md)
- [MCP Server](mcp.md)
