# Actions

For a complete discovery, strict selection, scroll, assertion, and capture workflow,
see [scoped selection walkthrough](scoped-selection.md).

## Purpose

Define the canonical `ExecutionAction.type` values, the exact parameters each action accepts, which values are validated by Node, and what success and failure data an agent can rely on.

## Sources

- Canonical action types: `apps/node/src/contracts/aliases.ts`
- Shared parameter shape: `apps/node/src/contracts/execution.ts`
- Validation rules: `apps/node/src/domain/executions/validateExecution.ts`
- CLI-built payload defaults: `apps/node/src/domain/actions/` and `apps/node/src/domain/observe/`
- Android payload parsing: `apps/android/shared/data/operator/src/main/kotlin/androperator/operator/agent/AgentCommandParser.kt`
- Android action/result behavior: `apps/android/shared/data/task/src/main/kotlin/androperator/task/runner/UiAction.kt` and `UiActionEngine.kt`
- Android text-entry runtime behavior: `apps/android/shared/data/uitree/src/main/kotlin/androperator/uitree/UiTreeManagerAndroid.kt`

## General Rules

| Rule | Meaning |
| --- | --- |
| Canonical action names only | Stored payloads should use canonical types such as `open_uri`, `wait_for_node`, and `take_screenshot`. Input aliases are normalized before validation. The on-screen log aliases are exact input values, while their parameter keys remain canonical-only. |
| Canonical payload keys still win | Node accepts common input aliases such as snake_case top-level keys, `package` for `applicationId`, `url` for `uri`, `selector` for `matcher`, and `value` for `text`, but the normalized payload always uses the canonical field names. The on-screen log actions intentionally reject these parameter aliases. |
| `params` is optional at the schema level | Action-specific validation then decides whether it is actually required. |
| Selectors live on a separate page | `matcher`, `container`, `expectedNode`, and `labelMatcher` all use the [Selectors](selectors.md) `NodeMatcher` contract. |
| `StepResult.data` is a string map | Node may attach known keys such as `text`, `path`, `warn`, `application_id`, `error`, or `message`, but most actions do not have a richer static success schema. |
| CLI coverage is narrower than raw JSON | Some advanced fields in `ActionParams` are accepted only through `androperator exec` JSON, not through flat CLI flags. |
| Runtime details are not always Node guarantees | When this page calls out Android-returned success keys, treat them as current runtime behavior verified from Android code, not as a stricter Node-side schema guarantee. |

## Action receipts and failure evidence

An accepted click, text operation, swipe, drag, or scroll dispatch is evidence of the Android
attempt. It does not verify navigation, persisted state, or any application
postcondition. Follow it with a wait, query, read, or snapshot that checks the
specific expected state. A wait for a label already present before the click
cannot prove navigation.

With the v0.10 Operator, selector-targeted click, text, and scroll actions add
these string-valued fields to `data`:

| Field | Meaning |
| --- | --- |
| `target` | Serialized [NodeSummary](selectors.md) for the actual dispatch node, from that attempt's capture. Omitted when no target was resolved. |
| `matched_target` | Originally selected NodeSummary when click fallback dispatches to an ancestor or uses a coordinate gesture. |
| `candidate_count` | Base-10 count from the selector resolution used for dispatch. |
| `dispatch_method` | `accessibility_action` for Android accessibility operations (including service text-input APIs), `coordinate_gesture` for a gesture, or `none` before dispatch. |
| `dispatch_accepted` | `"true"` or `"false"`. Gesture acceptance is recorded when Android accepts dispatch, before the asynchronous completion callback. |
| `elapsed_ms` | Base-10 elapsed milliseconds from the Android monotonic clock, including resolution and settling. |

Coordinate clicks report `coordinate` as serialized JSON `{ "x": 100, "y": 200 }`
and omit `target` and `candidate_count`. A failed pre-dispatch action reports
`dispatch_method: "none"` and `dispatch_accepted: "false"`. Receipts do not add a
copy of the entered text. For bounded scroll searches, the receipt describes the
last dispatch; `scrolls_executed` counts the loop's gestures. If the target is
already visible, no dispatch is claimed.

Thrown action failures stop the sequence and retain all completed steps plus
one failed step with its original `id` and `actionType`. Failed-step `errorCode`
and top-level `errorCode` identify the failure; `error` preserves its message.
Command timeout or cancellation retains collected evidence and emits one terminal
result. Cancellation still stops execution. Existing actions that *return* a
failed step continue to subsequent actions; Node still reports the execution as
failed. Returned failed steps add `data.errorCode` while retaining their legacy
`data.error` code. This sequence policy is unchanged.

Missing application hierarchies include serialized `diagnostics` JSON with
`serviceAvailable`, `rootAvailable`, `windowCount`, and `foregroundPackage`.
Unavailable service/window metadata is `null`; a known missing root is `false`.
These observations do not require an application root or select another window.
Raw on-screen log actions remain usable without an application hierarchy.

Migration: receipts require the matching v0.10 Operator. Parse JSON fields
explicitly; `StepResult.data` remains a string map. Coordinate receipt consumers
must parse the new JSON object rather than the older coordinate display string.
Handle the new scroll outcomes below instead of assuming unchanged content is an
edge. No mutation is replayed to obtain a receipt or recover from a failed
post-dispatch observation.

## Retry Object Shape

Several actions accept `retry`, `scrollRetry`, or `clickRetry` objects in raw `androperator exec` JSON. Node accepts these fields as part of `ActionParams`, and Android parses them into a retry policy with these keys:

```json
{
  "maxAttempts": 4,
  "initialDelayMs": 400,
  "maxDelayMs": 2000,
  "backoffMultiplier": 2,
  "jitterRatio": 0.15
}
```

Meaning:

- `maxAttempts` counts the initial attempt, so `1` means no retry.
- `initialDelayMs` is the delay before the first retry.
- `maxDelayMs` caps exponential backoff growth.
- `backoffMultiplier` must be `>= 1.0`.
- `jitterRatio` must be in `[0.0, 1.0]`.
- Android clamps `maxAttempts` to `1..10`.
- Android clamps `initialDelayMs` to `0..30000`.
- Android clamps `maxDelayMs` to `initialDelayMs..60000`.
- Android clamps `backoffMultiplier` to `1.0..5.0`.
- Android clamps `jitterRatio` to `0.0..1.0`.
- if you omit a retry object, Android applies an action-specific default such as `UiReadiness`, `UiScroll`, `AppLaunch`, `AppClose`, or `None`.

## Canonical Types And Input Aliases

Canonical public action types:

```text
open_app
open_uri
close_app
start_recording
stop_recording
wait_for_node
click
scroll_and_click
scroll
scroll_until
read_text
query_ui
enter_text
snapshot
take_screenshot
sleep
press_key
wait_for_navigation
read_key_value_pair
set_on_screen_log
clear_on_screen_log
show_toast
cancel_toast
```

Input aliases normalized by Node before validation:

| Alias | Canonical type |
| --- | --- |
| `open_url` | `open_uri` |
| `tap` | `click` |
| `press` | `click` |
| `wait_for`, `find`, `find_node` | `wait_for_node` |
| `read` | `read_text` |
| `snapshot_ui` | `snapshot` |
| `screenshot`, `capture_screenshot` | `take_screenshot` |
| `type_text`, `text_entry`, `input_text` | `enter_text` |
| `key_press` | `press_key` |
| `on_screen_log_set` | `set_on_screen_log` |
| `on_screen_log_clear` | `clear_on_screen_log` |

Common payload-key aliases also accepted on input:

- top-level execution keys: `command_id`, `task_id`, `expected_format`, `timeout_ms`
- app/package fields: `package`, `package_id`, `application_id`, `app`, `app_id` -> `applicationId`
- URI field: `url` -> `uri`
- matcher fields: `selector`, `node`, `element` -> `matcher`
- raw matcher-object fields: `id`, `resource_id`, `text`, `text_contains`, `content_desc`, `content_desc_contains`, `description`, `description_contains`, `accessibility_label`, `accessibility_label_contains`
- text-entry field: `value` -> `text`
- screenshot path fields: `file`, `filePath`, `output_path` -> `path`
- navigation fields: `expected_package`, `expected_node`, `timeout_ms`
- open_app fields: `skip_navigation_wait`, `navigation_timeout_ms`
- label selector fields: `label_matcher`, `label_selector`

The on-screen log actions have a deliberately narrow input-alias rule:

- Stored payloads and result `actionType` values use canonical `set_on_screen_log` and `clear_on_screen_log`.
- At the Node input boundary, exact lower-case `on_screen_log_set` and `on_screen_log_clear` normalize to those canonical types before validation and dispatch.
- Case changes and surrounding whitespace are rejected for both canonical types and aliases.
- Their `params` objects accept only the fields documented below and do not translate generic keys such as `value` to `text`.

<a id="action-query-ui"></a>
## `query_ui`

Read-only structured inspection from one fresh Android tree capture. The CLI is
`androperator query`; the named MCP tool is `query_ui`. All use the Android resolver
shared with existing node-targeted actions.

| Parameter | Default | Contract |
| --- | --- | --- |
| `matcher` | omitted | Optional [NodeMatcher](selectors.md); omit to match all eligible nodes. An explicit empty object is invalid. |
| `visibility` | `"on_screen"` | `"on_screen"` or `"all"` |
| `limit` | `100` | Integer from `1` through `1000` |

Queries do not wait for navigation to settle. After a navigation action, use
`androperator wait` with the expected destination selector (MCP: `wait`; raw:
`wait_for_node`), then query. Zero matches describe that capture only; they do not
prove that a destination has finished loading. A wait is also a separate capture,
so callers must still inspect the subsequent query result.

If Android supplies no hierarchy, the envelope fails with
`errorCode="UI_TREE_UNAVAILABLE"`. Completed steps and the failed `query_ui` step
are retained, and later actions do not run. Failed-step data contains `errorCode`,
a human-readable `error`, and serialized JSON `diagnostics` with
`serviceAvailable`, `rootAvailable`, `windowCount`, and `foregroundPackage`.
Unknown facts are `null`; `rootAvailable` is `false` for the failed capture.
No `data.query` is emitted. A screenshot can remain available when accessibility
hierarchy access is unavailable. This error does not identify the platform cause
or promise that retrying will expose a restricted screen. Named MCP returns the
same error code and envelope.

Zero, one, or multiple matches all succeed. `data.query` is a serialized JSON
string with this shape:

```json
{
  "schemaVersion": 1,
  "snapshotId": "observation-local-id",
  "capturedAt": "2026-01-01T00:00:00Z",
  "totalMatches": 1,
  "returnedCount": 1,
  "truncated": false,
  "nodes": [{
    "nodePath": "0.2",
    "parentPath": "0",
    "resourceId": "example:id/switch",
    "className": "android.widget.Switch",
    "role": "switch",
    "label": "",
    "contentDescription": null,
    "bounds": {"left": 10, "top": 30, "right": 110, "bottom": 130},
    "visibleToUser": true,
    "onScreen": true,
    "enabled": true,
    "clickable": true,
    "checkable": true,
    "checked": false,
    "selected": false,
    "scrollable": false,
    "accessibilityDataSensitive": false
  }]
}
```

`totalMatches` counts nodes before the limit, including nodes with blank labels.
`returnedCount` is the array length. `truncated` means the limit omitted whole
nodes. Unavailable state stays `null`, distinct from `false`. `clickable` reports
the platform node's clickability when captured, rather than inherited ancestor
clickability used by legacy action dispatch.

`accessibilityDataSensitive` reports Android's per-node accessibility-data flag
at capture time. The flag is available on Android 14 (API 34) and later:

| Value | Meaning |
| --- | --- |
| `true` | Android reports the node's accessibility data as sensitive. |
| `false` | Android reports the node's accessibility data as non-sensitive. |
| `null` | The device runs an earlier Android version, the node is a fallback, or the flag could not be read. |

Queries emit this field even when it is null. When consuming a payload with the
field absent, treat it as unknown. Queries and XML capture do not require API 34;
only this flag does. A filtered query reports only its returned nodes, so use an
unfiltered query to inspect root sensitivity.

Raw XML emits `accessibility-data-sensitive="true"` or `"false"` when known,
and omits the attribute when unknown. XML and queries capture independently;
compare stable fixture nodes, not observation paths. Sensitivity does not change
matching, success, redaction, or export behavior. It does not establish private
browsing, screenshot protection, password status, or whether content is safe to
share. Verify browser-mode indicators and behavior separately.

Nodes are in preorder. Paths use child indices in the captured `UiNode` tree,
rooted at `"0"`, and retain their original indices across visibility filtering.
The root's `parentPath` is `null`. Paths and snapshot IDs are observation-local;
they are neither stable cross-capture IDs nor valid action targets. `capturedAt`
is the APK's UTC timestamp immediately after tree capture. XML is a separate
capture with no guaranteed shared node identity.

`visibleToUser` is the platform flag. `onScreen` follows the existing action
eligibility rule: positive normalized bounds, platform visibility, screen
intersection, and ancestor pruning. The existing root-retention exception remains:
the root is retained even when ineligible, with its descendants pruned. Neither
flag proves visual non-occlusion. `all` includes offscreen and hidden captured
nodes; their `onScreen` value still reports the same action eligibility.

A UTF-8 `data.query` payload above 256 KiB fails with `PAYLOAD_TOO_LARGE`; JSON is
never cut to fit. Reduce `limit` or narrow the matcher. This response guard is
separate from the execution request size limit. Raw XML snapshots remain
available and add `visible-to-user` without restructuring the hierarchy.

```bash
androperator query --device <device_serial> --operator-package com.androperator.operator.dev --visibility all --limit 100
androperator query --matcher-json '{"descendant":{"textEquals":"Display"}}'
```

The CLI accepts each of `--limit` and `--visibility` at most once. Repeating
either flag, even with the same value, returns a structured `USAGE` error and
exit code `1` before device execution.

### Runnable Node consumer

From a repository checkout, build and run the tested
[query consumer example](https://github.com/androperator/androperator/blob/main/apps/node/src/examples/query-consumer.ts):

```bash
npm --prefix apps/node ci
npm --prefix apps/node run build
node apps/node/dist/examples/query-consumer.js --device <device_serial> --operator-package com.androperator.operator.dev --visibility all --limit 1000
```

The example invokes the CLI built in that checkout. It accepts query flags and
omits the matcher by default for all-node discovery. An explicit
`--matcher-json '{}'` (or `--selector '{}'`) is invalid; remove that flag and its
value to discover all eligible nodes. Other node-targeted actions still require
an appropriate [selector](selectors.md).

Before returning an inventory, the consumer checks the process exit, signal and
spawn error; canonical terminal evidence; successful envelope and every step;
and exactly one `query_ui` step with ID `query`. It parses that step's string
`data.query`, validates schema version 1 and node field types, checks count
consistency, and rejects truncation. `consumeQuery(output, queryStepId)` can
select an explicitly named step when adapting the local example to a multi-step
response. It is example-local validation, not an exported SDK accessor.

Success prints `commandId`, `taskId`, the decoded `query`, and the original
process output in `diagnostics`. Failure exits with code 1 and prints a message
and the original output to stderr, including any available envelope and IDs.
Preserve those diagnostics when investigating failures. Unknown nullable states
remain null; an omitted `accessibilityDataSensitive` remains unknown.

To observe refusal of a partial inventory on a screen with multiple nodes:

```bash
node apps/node/dist/examples/query-consumer.js --device <device_serial> --operator-package com.androperator.operator.dev --visibility all --limit 1
```

A truncated inventory cannot prove absence or uniqueness. Increase the limit
(up to 1000) or narrow the matcher, recognizing that a filtered result only
covers that filter. Even a complete result describes one capture and its
visibility scope, not future state or completion of navigation. Zero matches
are valid for that capture. The original response remains available on both
success and failure; the canonical envelope and string payload are unchanged.

`--matcher-json` and `--selector` name the same JSON input and are mutually
exclusive with simple selector flags (`--text`, `--text-contains`, `--id`, `--desc`,
`--desc-contains`, `--role`). Omitting all selector flags matches all eligible nodes.

## Full Payload Example

```json
{
  "commandId": "open-settings-and-snapshot",
  "taskId": "open-settings-and-snapshot",
  "source": "agent-loop",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    {
      "id": "open-1",
      "type": "open_app",
      "params": {
        "applicationId": "com.android.settings"
      }
    },
    {
      "id": "wait-1",
      "type": "wait_for_navigation",
      "params": {
        "expectedPackage": "com.android.settings",
        "timeoutMs": 5000
      }
    },
    {
      "id": "snap-1",
      "type": "snapshot"
    }
  ],
  "mode": "direct"
}
```

Success condition for that payload:

- `envelope.status == "success"`
- every `envelope.stepResults[i].success == true`
- `envelope.stepResults[2].actionType == "snapshot"`
- `"text" in envelope.stepResults[2].data`

## Action Reference

Non-strict first-match selection adds `data.selection_warning` when duplicate
candidates are observed, with a hint to use `--strict` (`params.strict=true`).
This advisory field does not change action success. See
[duplicate-selection hints](selectors.md#duplicate-selection-hints).

All node-targeted actions below support optional boolean `params.strict` and an
optional `params.container` matcher: `click`, `enter_text`, `read_text`,
`wait_for_node`, `scroll`, `scroll_until`, and `scroll_and_click`. See
[strict selection](selectors.md#strict-action-selection) for action-specific
absence, ambiguity, container, and compatibility rules. Coordinate clicks cannot
use strict mode or a container. Strict failures return string-valued
`data.error`, `data.candidate_count`, and serialized JSON in `data.candidates`.

<a id="action-click"></a>
### `click`

| Field | Valid values |
| --- | --- |
| Required | exactly one of `params.matcher` or `params.coordinate` |
| `matcher` | any non-empty `NodeMatcher` |
| `coordinate` | `{ "x": <int >= 0>, "y": <int >= 0> }` |
| `clickType` | optional string; CLI builders use `"default"`, `"long_click"`, or `"focus"` |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `UiReadiness` |

Rules:

- `matcher` and `coordinate` are mutually exclusive.
- `clickType = "focus"` is invalid with `coordinate`.
- CLI defaults to `"default"` and omits the field from the payload.

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for missing selector, dual selector modes, invalid coordinates, or unsupported `clickType` combinations
- runtime step failures such as `NODE_NOT_FOUND`, `NODE_NOT_CLICKABLE`, `GESTURE_FAILED`

Example:

```json
{
  "id": "click-1",
  "type": "click",
  "params": {
    "matcher": { "textEquals": "Settings" },
    "clickType": "long_click"
  }
}
```

<a id="action-swipe"></a>
### `swipe`

Move one finger immediately along a straight line between two screen coordinates,
then release. This does not require a UI node or scrollable container. It has no
initial hold and does not perform drag and drop. Use [drag](#action-drag) when
the app needs a long press before movement.

| Field | Valid values |
| --- | --- |
| `start` | required object with only integer `x` and `y`, each in `[0, 2147483647]` |
| `end` | required object with only integer `x` and `y`, each in `[0, 2147483647]`; must differ from `start` |
| `durationMs` | required integer in `[1, 10000]`; no default |

Coordinates are physical screen pixels on the default display in its current
orientation, with origin at the top left. Both endpoints must be inside the
current display (`x < width`, `y < height`); Android checks these bounds before
dispatch. The action accepts no selector, container, retry, or additional params.
Gesture injection requires Android 7.0 (API 24) or later and an available
accessibility service.

```bash
androperator swipe --start 100 500 --end 800 500 --duration-ms 300
```

Raw execution action (also usable through HTTP `POST /execute`):

```json
{
  "id": "swipe-1",
  "type": "swipe",
  "params": {
    "start": { "x": 100, "y": 500 },
    "end": { "x": 800, "y": 500 },
    "durationMs": 300
  }
}
```

Success means Android's gesture completion callback fired. It does not prove
that a snackbar was dismissed or content moved; inspect the resulting app state
with a query or snapshot. The action dispatches once without automatic replay.

Successful step data includes `start` and `end` as JSON-encoded coordinate
objects, `duration_ms` as a string, and the standard `dispatch_method`,
`dispatch_accepted`, and `elapsed_ms` receipt fields. A dispatched swipe uses
`dispatch_method: "coordinate_gesture"`.

Missing, invalid, or extra parameters fail Node validation with
`EXECUTION_VALIDATION_FAILED`. Android reports `GESTURE_FAILED` if coordinates
are outside the display, gesture injection is unavailable, or the gesture is
rejected or cancelled. A gesture accepted and later cancelled retains
`dispatch_accepted: "true"` on the failed step. Command timeout/cancellation
retains dispatch evidence and does not replay the gesture; a gesture already
accepted by Android may finish after the caller stops waiting.

<a id="action-drag"></a>
### `drag`

Press at a screen coordinate, hold without moving, move in a straight line while
keeping the same pointer down, then release. Requires Android 8 (API 26) or later
and an available accessibility service. Unlike `swipe`, this action has an
explicit initial hold. Choose a hold long enough for the target app to enter
its drag state. The required hold duration depends on the target app.

| Field | Valid values |
| --- | --- |
| `start` | required object with only integer `x` and `y`, each in `[0, 2147483647]` |
| `end` | required object with only integer `x` and `y`, each in `[0, 2147483647]`; must differ from `start` |
| `holdDurationMs` | required integer in `[1, 10000]`; no default |
| `moveDurationMs` | required integer in `[1, 10000]`; no default |

Coordinates are physical screen pixels on the current default display, with
origin at the top left. Android rejects endpoints outside its bounds before
dispatch. No selector, grid position, path waypoints, retry, or extra params are
accepted. Find the source item with a snapshot and start inside its bounds.
Choosing a destination and interpreting the result belong in the agent or
app-specific skill.

```bash
androperator drag --start 600 1600 --end 200 1000 \
  --hold-duration-ms 1200 --move-duration-ms 800 --device <device_serial>
```

The flat CLI defaults to a 30000 ms execution budget; `--timeout <ms>` overrides
it. Budget for the hold, movement, and scheduling overhead. In a multi-action
execution, `timeoutMs` covers the entire sequence, not each gesture separately.
For a local development Operator, also pass
`--operator-package com.androperator.operator.dev` consistently on every command.

Raw execution action, also usable through HTTP `POST /execute` and the MCP
`drag` tool with the same four parameter fields:

```json
{
  "id": "drag-1",
  "type": "drag",
  "params": {
    "start": { "x": 600, "y": 1600 },
    "end": { "x": 200, "y": 1000 },
    "holdDurationMs": 1200,
    "moveDurationMs": 800
  }
}
```

Success means Android completed the gesture, including pointer release.
It does not prove a successful drop. Query or snapshot the resulting app state;
check that the intended item reached the destination. This action provides a
straight same-screen gesture; app-specific drop behavior is not guaranteed.

Successful step data includes JSON-encoded `start` and `end`, string-valued
`hold_duration_ms` and `move_duration_ms`, plus `dispatch_method`,
`dispatch_accepted`, and `elapsed_ms`. A dispatched drag uses
`dispatch_method: "coordinate_gesture"`. Once the hold is accepted,
`dispatch_accepted` stays `"true"` even if movement fails.

Invalid parameters produce `EXECUTION_VALIDATION_FAILED` at the Node boundary.
Android reports `GESTURE_UNSUPPORTED` below API 26, or `GESTURE_FAILED` for
out-of-display coordinates, an unavailable service, rejection, or platform
cancellation. The execution deadline bounds missing or delayed callbacks and
reports `COMMAND_TIMEOUT`.

The action is never automatically replayed. On cancellation before movement,
Android attempts to release the held pointer without moving it. Cleanup is best
effort if the service or platform is unavailable. An already accepted movement
can finish and release at its endpoint after command cancellation. Timeout and
cancellation do not undo application effects; inspect current state before
deciding whether to act again.

<a id="action-scroll"></a>
### `scroll`

| Field | Valid values |
| --- | --- |
| Required | none |
| `direction` | optional string in `down`, `up`, `left`, `right` |
| `container` | optional `NodeMatcher` |
| `distanceRatio` | optional number in `[0.0, 1.0]` |
| `settleDelayMs` | optional number in `[0, 10000]` |
| `findFirstScrollableChild` | optional boolean in raw `exec` JSON; Android defaults to `true` |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `None` for plain scroll |

Semantics:

- if `direction` is omitted in raw JSON, Node validation allows omission
- Android defaults omitted `direction` to `down`
- the flat CLI always sets a direction explicitly
- `container` scopes the scroll to a matched scrollable container
- `distanceRatio` and `settleDelayMs` are advanced tuning fields for raw JSON execution
- if `findFirstScrollableChild == true` and the matched container is not itself scrollable, Android walks down to the first scrollable descendant; strict mode requires that eligible descendant to be unique
- `retry` covers pre-dispatch container resolution; an exception after dispatch does not replay the gesture

Success and progress data:

- `scroll_outcome`, `direction`, `distance_ratio`, `settle_delay_ms`, and optional
  `resolved_container` retain their existing names; dispatch receipts are described above.
- `progress` is serialized JSON with `beforeSignature`, `afterSignature`,
  `comparable`, and `reason`. Available signatures are bounded SHA-256 hashes;
  raw node text is not included. Missing signatures are `null`.
- Comparison re-resolves the same scoped container. Ambiguous or changed identity
  is not comparable, even if the screen appears to have moved. A container that
  remains identifiable but stops reporting `scrollable` can still produce
  comparable progress; eligibility loss alone is not `container_lost`.

| `scroll_outcome` | Observation | Step success |
| --- | --- | --- |
| `moved` | Comparable signatures changed | `true` |
| `no_movement` | Comparable signatures are unchanged | `true` |
| `unknown` | Missing signatures or an ambiguous/incomparable container | `true` |
| `container_lost` | Container or hierarchy disappeared after the gesture | `false` |
| `gesture_failed` | Gesture was rejected or did not complete successfully | `false` |
| `edge_reached` | Reserved for explicitly instrumented platform boundary evidence; the current runtime does not emit it | n/a |

An accepted gesture may later be cancelled by Android. In that case
`dispatch_accepted` remains `"true"`, while `scroll_outcome` is `gesture_failed`.
Neither `no_movement` nor `unknown` proves the container is at an edge.

Common failures:

- `EXECUTION_VALIDATION_FAILED` for invalid `direction`, `distanceRatio`, or `settleDelayMs`
- runtime step failures such as `CONTAINER_NOT_FOUND`, `CONTAINER_NOT_SCROLLABLE`, `GESTURE_FAILED`

Example:

```json
{
  "id": "scroll-1",
  "type": "scroll",
  "params": {
    "direction": "down",
    "container": { "resourceId": "android:id/list" },
    "distanceRatio": 0.7,
    "settleDelayMs": 250
  }
}
```

<a id="action-scroll-until"></a>
### `scroll_until`

| Field | Valid values |
| --- | --- |
| Required | none at schema level; `matcher` becomes required when `clickAfter == true` |
| `direction` | optional string in `down`, `up`, `left`, `right` |
| `matcher` | optional `NodeMatcher` |
| `container` | optional `NodeMatcher` |
| `clickAfter` | optional boolean |
| `distanceRatio` | optional number in `[0.0, 1.0]` |
| `settleDelayMs` | optional number in `[0, 10000]` |
| `maxScrolls` | optional integer in `[1, 200]` |
| `maxDurationMs` | optional number in `[0, 120000]` |
| `noPositionChangeThreshold` | optional integer in `[1, 20]` |
| `findFirstScrollableChild` | optional boolean in raw `exec` JSON; Android defaults to `true` |
| `clickType` | optional string in raw `exec` JSON; Android parses the same click types used by `click` |

Semantics:

- without `clickAfter`, the action scrolls until the target becomes visible or the loop terminates
- with `clickAfter: true`, the same action requires `matcher` and turns into “scroll then click”
- the flat CLI exposes only the core controls; advanced tuning requires raw JSON via `androperator exec`
- Android defaults omitted `direction` to `down`, `distanceRatio` to `0.7`, `settleDelayMs` to `250`, `maxScrolls` to `20`, `maxDurationMs` to `10000`, `noPositionChangeThreshold` to `3`, and `findFirstScrollableChild` to `true`
- `maxScrolls` is the hard cap on how many scroll steps Android will attempt
- `maxDurationMs` is checked against monotonic elapsed time before each gesture; the current gesture and bounded settle/target checks may finish after that threshold, while the command timeout cancels execution
- `noPositionChangeThreshold` stops the loop after that many consecutive `no_movement`, signature-only `unknown`, or rejected gestures; loss of the original container identity terminates with `CONTAINER_LOST`
- after choosing a scroll container, target observations and the requested click stay within that original container's descendants, including for legacy unscoped searches; an exhausted search cannot be changed to success by a target outside that scope
- an identifiable container that stops reporting `scrollable` still allows a revealed target to satisfy the search and the requested click to run once; if the target remains absent after bounded observation, the search terminates with `CONTAINER_NOT_SCROLLABLE` without scrolling a different container
- initially visible targets retain legacy unscoped matching when neither strict selection nor a container is requested

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for invalid direction or out-of-range tuning fields
- runtime step failures such as `NODE_NOT_FOUND`, `CONTAINER_NOT_FOUND`, `CONTAINER_NOT_SCROLLABLE`

Example:

```json
{
  "id": "scroll-until-1",
  "type": "scroll_until",
  "params": {
    "direction": "down",
    "matcher": { "textEquals": "About phone" },
    "maxScrolls": 25,
    "maxDurationMs": 10000,
    "noPositionChangeThreshold": 3
  }
}
```

<a id="action-scroll-and-click"></a>
### `scroll_and_click`

| Field | Valid values |
| --- | --- |
| Required | `matcher` |
| `direction` | optional string in `down`, `up`, `left`, `right` |
| `matcher` | required `NodeMatcher` |
| `container` | optional `NodeMatcher` |
| `clickAfter` | optional boolean in raw `exec` JSON; Android defaults it to `true` |
| `maxSwipes` | optional integer in raw `exec` JSON; Android defaults it to `10` and clamps it to `[1, 50]` |
| `distanceRatio` | optional number in raw `exec` JSON; Android defaults it to `0.7` and clamps it to `[0.0, 1.0]` |
| `settleDelayMs` | optional number in raw `exec` JSON; Android defaults it to `250` and clamps it to `[0, 10000]` |
| `findFirstScrollableChild` | optional boolean in raw `exec` JSON; Android defaults it to `true` |
| `clickType` | optional string in raw `exec` JSON; Android parses the same click types used by `click` |
| `scrollRetry` | optional retry object in raw `exec` JSON; Android defaults to `UiScroll` |
| `clickRetry` | optional retry object in raw `exec` JSON; Android defaults to `UiReadiness` |

Semantics:

- this is the canonical action type produced by `scroll-until --click` and `scroll-and-click`
- unlike raw `scroll_until`, this action is optimized for “scroll to target, then click target”
- `maxSwipes` is the safety cap on how many swipes Android performs before failing
- scroll and view refresh remain bounded by `maxSwipes`; mutations are not replayed after a post-dispatch failure
- target observation, eligibility transitions, and final click scoping follow the same rules as [`scroll_until`](#action-scroll-until)
- `clickRetry` applies only to the final click after the target is visible
- setting `clickAfter: false` is accepted in raw `exec` JSON and makes Android stop after revealing the target, but the flat CLI does not emit that variant for `scroll_and_click`

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` if `matcher` is absent
- runtime scroll or click failures, including `NODE_NOT_FOUND`

Example:

```json
{
  "id": "scroll-click-1",
  "type": "scroll_and_click",
  "params": {
    "matcher": { "textEquals": "Submit" },
    "direction": "down"
  }
}
```

<a id="action-read-text"></a>
### `read_text`

| Field | Valid values |
| --- | --- |
| Required | `matcher` |
| `matcher` | required `NodeMatcher` |
| `all` | optional boolean; when `true`, request all matches instead of the first match |
| `container` | optional `NodeMatcher` |
| `validator` | optional string; current validation adds special behavior only for `"regex"` |
| `validatorPattern` | required non-empty valid regex string when `validator == "regex"` |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `UiReadiness` |

Semantics:

- if `validator` is omitted, no validator-specific Node rule runs
- if `validator == "regex"`, `validatorPattern` must exist and compile as a regex
- other validator strings are accepted by the current Node schema, but this repo does not add extra Node-side validation semantics for them
- current Android parser accepts only `temperature`, `version`, and `regex`; any other validator string is rejected at runtime
- `all: true` asks Android to return all matching text values instead of only the first match

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for missing `matcher` or invalid regex configuration
- runtime failures such as `NODE_NOT_FOUND`

Example:

```json
{
  "id": "read-1",
  "type": "read_text",
  "params": {
    "matcher": { "textContains": "Order" },
    "validator": "regex",
    "validatorPattern": "^ORD-[0-9]{6}$",
    "all": false
  }
}
```

<a id="action-read-key-value-pair"></a>
### `read_key_value_pair`

| Field | Valid values |
| --- | --- |
| Required | `labelMatcher` |
| `labelMatcher` | required `NodeMatcher` |
| `all` | optional boolean |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `UiReadiness` |

Semantics:

- built by the flat `read-value` CLI command
- uses a label matcher rather than a generic element matcher

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` when `labelMatcher` is absent

Example:

```json
{
  "id": "read-value-1",
  "type": "read_key_value_pair",
  "params": {
    "labelMatcher": { "textEquals": "Battery" },
    "all": false
  }
}
```

<a id="action-enter-text"></a>
### `enter_text`

| Field | Valid values |
| --- | --- |
| Required | `matcher`, `text` |
| `matcher` | required `NodeMatcher` |
| `text` | required non-empty string |
| `clear` | optional boolean |
| `submit` | optional boolean |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `UiReadiness` |

Semantics:

- `submit` defaults to `false` in the built-in CLI builders
- `clear` defaults to `false` in the built-in CLI builders
- Android uses an internal first-match-wins text-entry ladder while keeping the public `enter_text` shape unchanged
- Android prefers the editable node `ACTION_SET_TEXT` route when it is available because that path already matches current replace-text semantics
- on that `ACTION_SET_TEXT` route, `clear == true` first dispatches `ACTION_SET_TEXT("")`, then dispatches `ACTION_SET_TEXT` with the requested `text`
- on that same `ACTION_SET_TEXT` route, `clear == false` or omitted keeps the existing single `ACTION_SET_TEXT` behavior
- if the requested clear step fails on the `ACTION_SET_TEXT` route, Android stops before the real text set for that legacy strategy; on Android 13+ it can still continue to the accessibility input-connection fallback when that route is available, otherwise the action fails
- on Android 13+ (`Build.VERSION_CODES.TIRAMISU`) when the legacy `ACTION_SET_TEXT` route is unavailable or does not complete successfully, Android can fall back to the accessibility input-connection path for custom editors
- that API 33 fallback still preserves replace-style behavior by moving the cursor to the end, deleting preceding text, then committing the replacement text
- that API 33 replace sequence also preserves `clear == true` semantics even though there is no separate public strategy flag
- `submit == true` is best effort after successful text entry
- on the legacy route, Android prefers `ACTION_IME_ENTER` when the node exposes it and falls back to a click when it does not
- on the API 33 input-connection route, Android prefers `performEditorAction(...)`
- if text entry succeeds but no truthful submit action is available, the step still succeeds and `submit` does not become a new hard-failure condition

Success data:

- Node does not declare a richer static schema here
- `data.text`, `data.clear`, and `data.submit` retain the requested values; `submit` is a request, not an outcome
- `data.text_entry` is `"accepted"` after Android accepts text entry
- `data.submission` is `"not_requested"`, `"accepted"`, or `"unavailable"`
- `data.submit_method` is `"not_requested"`, `"ime_action"`, `"click_fallback"`, or `"submit_unavailable"`

`submission: "accepted"` pairs with `ime_action` or `click_fallback` and means
Android accepted that action. A fallback click can merely focus the field.
`submission: "unavailable"` pairs with `submit_unavailable` when no supported
submission path succeeds, including rejected actions; text entry still succeeds.
No submission request produces `not_requested` in both fields.

These fields report action acceptance, not read-back verification of text or
proof of navigation. After typing a URL or search query, the agent or browser
skill must observe the destination before declaring navigation complete. Do not
repeat text entry solely because submission is unavailable. Older Operators
may omit these additive fields; absence means unknown, not submission success.

Common failures:

- `EXECUTION_VALIDATION_FAILED` for missing matcher or blank text
- runtime failures such as `NODE_NOT_FOUND`
- Android task-status failure payloads use `failure_point = set_text_failed` when the clear or text-set step cannot be completed

Example:

```json
{
  "id": "type-1",
  "type": "enter_text",
  "params": {
    "matcher": { "resourceId": "com.example:id/search" },
    "text": "hello world",
    "clear": true,
    "submit": false
  }
}
```

Verification pattern:

```bash
androperator type "battery" --id "com.android.settings:id/search_src_text" --clear
```

Success conditions:

- exit code `0`
- `envelope.status == "success"`
- `envelope.stepResults[0].actionType == "enter_text"`
- `envelope.stepResults[0].success == true`
- `envelope.stepResults[0].data.clear == "true"`

Android live-route verification:

- when validating against the debug operator on device, operator logs include
  `enter_text strategy=<strategy_name> submit_method=<submit_method>`
- on the API 33 route, warning-level logs can also include
  `enter_text strategy=api33_input_connection partial_failure reason=<reason>`
  when the fallback delete step succeeds but the final `commitText(...)` does
  not
- current shipped strategy names are `legacy_action_set_text` and
  `api33_input_connection`

<a id="action-press-key"></a>
### `press_key`

| Field | Valid values |
| --- | --- |
| Required | `key` |
| `key` | case-insensitive string in `back`, `home`, `recents`, `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right`, `dpad_center`, `bookmark`, `profile`, `settings`, `tv`, `aaos_rotary_clockwise`, `aaos_rotary_counterclockwise`, `aaos_rotary_nudge_up`, `aaos_rotary_nudge_down`, `aaos_rotary_nudge_left`, `aaos_rotary_nudge_right`, `aaos_rotary_center`, `android_auto_rotary_clockwise`, `android_auto_rotary_counterclockwise`, `android_auto_rotary_nudge_up`, `android_auto_rotary_nudge_down`, `android_auto_rotary_nudge_left`, `android_auto_rotary_nudge_right`, `android_auto_rotary_center`, `android_auto_back`, `android_auto_home`, `wear_rotary_clockwise`, `wear_rotary_counterclockwise`, `wear_stem_primary`, `wear_stem_1`, `wear_stem_2`, `wear_stem_3` |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `None` |

Back, Home, and Recents retain Android accessibility global actions.
TV remote buttons, AAOS inputs, Android Auto inputs, and Wear OS inputs execute through the Node bridge, including CLI `press`, raw
`exec`, HTTP `/execute`, MCP `press`/`execute`, and daemon execution. They run in
order with surrounding Android actions under the same device lock. A failed
button stops the remaining sequence. The returned envelope keeps the caller's
`commandId`, `taskId`, and action IDs; internal runtime segments use distinct
transport command IDs to avoid stale result reuse.

The icon buttons match the Android Emulator remote, as verified against its
[remote implementation](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-master-dev/android/android-ui/modules/aemu-ext-pages/tv-remote/src/android/skin/qt/extended-pages/tv-remote-page.cpp)
and [button layout](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-master-dev/android/android-ui/modules/aemu-ext-pages/tv-remote/src/android/skin/qt/extended-pages/tv-remote-page.ui).

| Button value | Android dispatch | Meaning |
| --- | --- | --- |
| `dpad_up` | `KEYCODE_DPAD_UP` (19) | Move focus up |
| `dpad_down` | `KEYCODE_DPAD_DOWN` (20) | Move focus down |
| `dpad_left` | `KEYCODE_DPAD_LEFT` (21) | Move focus left |
| `dpad_right` | `KEYCODE_DPAD_RIGHT` (22) | Move focus right |
| `dpad_center` | `KEYCODE_DPAD_CENTER` (23) | Select the focused item |
| `bookmark` | `KEYCODE_BOOKMARK` (174) | Watchlist/bookmark icon |
| `profile` | `KEYCODE_NOTIFICATION` (83) | Person icon opens the emulator dashboard; not `KEYCODE_PROFILE_SWITCH` |
| `settings` | Start `com.android.tv.settings/com.android.tv.settings.MainSettings` | Settings icon launches an activity; not `KEYCODE_SETTINGS` |
| `tv` | Start `com.android.tv/com.android.tv.MainActivity` on API 34+, or `com.google.android.tv/com.android.tv.MainActivity` below API 34 | TV icon opens Live Channels; not `KEYCODE_TV` |

These activities must be installed on the target. Key dispatch acceptance does
not prove focus moved, a watchlist changed, or a dashboard opened. Android TV
images and apps may ignore keys. Use a fresh snapshot to verify the intended
screen or focused item. Buttons are single presses, with no hold or repeat
parameter.

Car-specific controller keys use explicit platform prefixes: `aaos_rotary_*`
for AAOS and `android_auto_rotary_*` for Android Auto. Ordinary Android keys such
as `back`, `home`, and `dpad_right` retain their device-level meanings. These car
keys do not imply Wear OS crown or bezel support.

Migration: replace the former unprefixed `rotary_*` keys with `aaos_rotary_*`,
and replace `android_auto_nudge_*` / `android_auto_center` with
`android_auto_rotary_nudge_*` / `android_auto_rotary_center`. The old spellings
are rejected; there are no compatibility aliases. Android Auto rotation,
`android_auto_back`, and `android_auto_home` retain their existing names.

#### Wear OS controls

Select a Wear OS device or emulator explicitly with `--device <watch_serial>`.
The Node bridge checks `android.hardware.type.watch` before any action in an
execution containing `wear_*` keys runs. Rotation also requires the device shell
command `input rotaryencoder scroll --axis SCROLL,<value>`; older watch images
may lack it. There is no swipe fallback or phone-to-watch forwarding.

| Key | Shell input | Meaning |
| --- | --- | --- |
| `wear_rotary_clockwise` | `rotaryencoder scroll --axis SCROLL,-1` | One clockwise rotary scroll unit |
| `wear_rotary_counterclockwise` | `rotaryencoder scroll --axis SCROLL,1` | One counterclockwise rotary scroll unit |
| `wear_stem_primary` | `keyevent KEYCODE_STEM_PRIMARY` (264) | Short primary system-button press |
| `wear_stem_1` | `keyevent KEYCODE_STEM_1` (265) | Short first multifunction-button press |
| `wear_stem_2` | `keyevent KEYCODE_STEM_2` (266) | Short second multifunction-button press |
| `wear_stem_3` | `keyevent KEYCODE_STEM_3` (267) | Short third multifunction-button press |

```bash
androperator press wear_rotary_clockwise --device <watch_serial>
androperator press wear_stem_primary --device <watch_serial>
```

Rotary motion uses Android's rotary-encoder input source and `AXIS_SCROLL`, not
DPAD focus navigation. A unit is not a guaranteed pixel distance or physical
crown detent. The focused app determines scrolling, zoom, volume, or other
behavior. The primary stem is a system button, not a center-selection key.
Multifunction buttons may be absent, unassigned, or intercepted by the watch
system; accepted injection does not guarantee an app callback or visible effect.
Only single short presses are exposed, without long-press or double-press options.
See Android's [rotary input](https://developer.android.com/training/wearables/compose/rotary-input)
and [physical button](https://developer.android.com/training/wearables/user-input/physical-buttons)
guidance for app behavior.

Success returns `key`, `dispatchSource: "host"`, and `inputCommand` in the step
result. It means the shell accepted dispatch. Verify the intended effect with a
fresh snapshot or screenshot. A non-watch or unreachable feature check returns
`WEAR_DEVICE_REQUIRED`; missing rotary shell support returns
`WEAR_ROTARY_UNSUPPORTED`. A rejected dispatch produces a failed step with
`WEAR_INPUT_FAILED` and stops subsequent actions. Direct Android-runtime dispatch
without the Node bridge returns `UNSUPPORTED_RUNTIME_WEAR_INPUT`.

Live verification on the Wear OS 5.1 API 35 emulator confirmed clockwise and
counterclockwise scrolling in Recents and Settings, and primary-stem navigation
from the watch face to Recents. All three multifunction stems were accepted but
had no visible effect on the tested screens. Their app-specific effects remain
unverified; this is not a claim of physical-watch coverage.

#### Automotive rotary controller

Automotive inputs target the main car display through AAOS `car_service`.
They require an Android Automotive OS emulator or development device with
shell input injection available and its rotary service enabled. They do not
control Android Auto projection or vehicle properties.

| Key | `cmd car_service` command | Input |
| --- | --- | --- |
| `aaos_rotary_clockwise` | `inject-rotary -c true` | One clockwise detent |
| `aaos_rotary_counterclockwise` | `inject-rotary` | One counterclockwise detent |
| `aaos_rotary_nudge_up` | `inject-key 280` | Nudge up between focus areas |
| `aaos_rotary_nudge_down` | `inject-key 281` | Nudge down between focus areas |
| `aaos_rotary_nudge_left` | `inject-key 282` | Nudge left between focus areas |
| `aaos_rotary_nudge_right` | `inject-key 283` | Nudge right between focus areas |
| `aaos_rotary_center` | `inject-key 23` | Click the controller center button |

Use existing `back` and `home` inputs for navigation. Rotation and nudges are
separate operations; D-pad keys do not substitute for rotary navigation.
For multiple detents, submit multiple rotation actions. There is no hold,
repeat-count, seat, or display-selection parameter.

A successful result requires exit code zero and the car service's explicit
success acknowledgement. It confirms injection, not a focus or screen change.
Observe the focused item or resulting screen after each action. The first
rotation after touch input may enter rotary mode without advancing focus.
Missing car services, denied injection, and unrecognized responses fail the
step and stop the sequence.

The mappings were verified on the API 35 Automotive Google APIs arm64 emulator
using Settings: rotation moved between rows, left/right nudges moved between
panes, up/down nudges moved between the list and toolbar, and center opened
the focused category. Other images and apps may handle focus differently.

<a id="android-auto-inputs"></a>
#### Android Auto Desktop Head Unit

Android Auto uses an explicitly started Google Desktop Head Unit (DHU) session
on the host. It is separate from AAOS `car_service`; the `aaos_rotary_*` keys above
retain their AAOS behavior. This interface does not control arbitrary physical
head units. The implementation targets DHU 2.0's console interface.

Install Google's DHU using Android SDK Manager. On the selected phone or a
compatible Google Play phone emulator, install/update the full Android Auto
app, enable its developer mode, and start its head unit server. A preinstalled
Android Auto stub is insufficient. Complete any sign-in and projection setup
prompts yourself. Install and enable the Operator as usual for execution.
See [Google's DHU setup](https://developer.android.com/training/cars/testing/dhu).

Run this in a terminal on the ADB host:

```bash
androperator android-auto start --device <phone_serial>
```

`start` runs in the foreground, reserves a local per-device control socket,
creates an owned ADB forward to the phone's port 5277, and launches DHU in rotary
mode. It reports `ready: true` only after DHU produces a complete projection
frame. Keep this process running. Use `--dhu-path <binary>` if DHU is outside
`ANDROID_HOME`/`ANDROID_SDK_ROOT`; on macOS the usual SDK location is also tried.
Use `--timeout <ms>` to set a 1000-120000ms startup budget (default 30000).

From another terminal, with the same device selected:

```bash
androperator press android_auto_rotary_clockwise --device <phone_serial>
androperator press android_auto_rotary_center --device <phone_serial>
androperator android-auto status --device <phone_serial>
androperator android-auto stop --device <phone_serial>
```

| Key | DHU console command |
| --- | --- |
| `android_auto_rotary_clockwise` | `dpad rotate right` |
| `android_auto_rotary_counterclockwise` | `dpad rotate left` |
| `android_auto_rotary_nudge_up` | `dpad up` |
| `android_auto_rotary_nudge_down` | `dpad down` |
| `android_auto_rotary_nudge_left` | `dpad left` |
| `android_auto_rotary_nudge_right` | `dpad right` |
| `android_auto_rotary_center` | `dpad click` |
| `android_auto_back` | `dpad back` |
| `android_auto_home` | `keycode home` |

Each rotation is one detent. CLI, raw executions, HTTP, MCP, and daemon callers
use the session for the resolved device. One caller reserves it through the
whole execution, including intervening phone actions. Competing Android Auto
executions fail instead of interleaving. Inputs are followed by a private DHU
frame barrier; success confirms console processing with a live video frame,
not that the intended control moved or activated. Check the DHU window for the
result. A frame barrier does not wait for Android Auto animations or focus
changes to finish; observe the settled display before choosing a dependent
action. Ordinary snapshots and screenshots still observe the phone screen.

Live validation used DHU 2.0 on macOS arm64 with a Pixel 10 Pro running Android
Auto 17.7.663654. All nine commands returned the expected DHU command evidence.
Visible checks confirmed clockwise and counterclockwise movement in the app
launcher, down/up focus movement between the launcher and taskbar, center
selection opening the highlighted app, Back returning from a nested Settings
page, and Home opening the launcher. Left/right nudges were accepted, but the
tested screens did not demonstrate a horizontal focus transition; their visible
effect remains unverified. Nudges move between available focus areas and can
have no effect at a boundary.

Stopping closes DHU and removes the owned ADB forward. A disconnect, failed
barrier, or cancellation during input terminates the session because delivery
may be uncertain. Do not automatically retry an input; inspect the screen and
restart the session. After a host process is forcibly killed, a stale local
socket may need removal before restarting; never remove an active session's
socket. DHU startup and shutdown do not change the phone's developer settings.

Success data:

- `key`: canonical button name
- TV remote buttons also return `dispatchSource: "host"` and either `keyCode`
  or `activity`
- Android Auto inputs return `dispatchSource: "dhu"` and `dhuCommand`
- Automotive inputs return `dispatchSource: "host"` and `carCommand`, such as
  `"inject-rotary -c true"`

Common failures:

- `EXECUTION_VALIDATION_FAILED` for missing or unsupported key
- failed `press_key` step with `TV_REMOTE_KEY_FAILED` or
  `TV_REMOTE_ACTIVITY_FAILED` when host dispatch fails, including unresolved
  activities even when Android's `am start` exits with code zero
- failed `press_key` step with `AUTOMOTIVE_INPUT_FAILED` when AAOS does not
  acknowledge injection
- `UNSUPPORTED_RUNTIME_AUTOMOTIVE_INPUT` for Automotive inputs sent directly
  to the APK without the Node bridge
- `ANDROID_AUTO_SESSION_UNAVAILABLE` when no DHU session is reachable
- `ANDROID_AUTO_SESSION_CLOSED` or `ANDROID_AUTO_INPUT_UNCONFIRMED` on lost
  transport or an unconfirmed input; preceding confirmed steps are preserved
- `UNSUPPORTED_RUNTIME_ANDROID_AUTO_INPUT` for Android Auto inputs sent directly
  to the APK without the Node bridge
- `UNSUPPORTED_RUNTIME_TV_REMOTE` for TV buttons sent directly to the APK
  without the Node bridge

CLI examples:

```bash
androperator press aaos_rotary_clockwise --device <device_serial>
androperator press aaos_rotary_nudge_right --device <device_serial>
androperator press aaos_rotary_center --device <device_serial>
androperator press dpad_up --device <device_serial>
androperator press --key dpad_center --device <device_serial>
androperator press profile --device <device_serial>
androperator press settings --device <device_serial>
```

Example:

```json
{
  "id": "press-1",
  "type": "press_key",
  "params": {
    "key": "back"
  }
}
```

<a id="action-wait-for-node"></a>
### `wait_for_node`

| Field | Valid values |
| --- | --- |
| Required | `matcher` |
| `matcher` | required `NodeMatcher` |
| `timeoutMs` | optional number; the current Android parser clamps a provided value to `1..120000`; when built by the CLI, it comes from `--timeout` |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `UiReadiness` |

Semantics:

- the action-level `timeoutMs` is distinct from the execution-level `timeoutMs`
- current Node validation does not add a stricter positivity check for this field
- the builder inflates the execution timeout to `max(actionTimeout + 5000, 30000)` so the envelope does not expire before the wait finishes

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` when `matcher` is missing
- runtime failure when the target never appears

Example:

```json
{
  "id": "wait-1",
  "type": "wait_for_node",
  "params": {
    "matcher": { "textEquals": "Settings" },
    "timeoutMs": 5000
  }
}
```

<a id="action-wait-for-navigation"></a>
### `wait_for_navigation`

| Field | Valid values |
| --- | --- |
| Required | at least one of `expectedPackage` or `expectedNode`, plus `timeoutMs` |
| `expectedPackage` | optional non-empty string up to matcher-length limits |
| `expectedNode` | optional `NodeMatcher` |
| `timeoutMs` | required number in `(0, 30000]` |

Semantics:

- at least one navigation target must be present
- the CLI builder inflates execution timeout to `max(timeoutMs + 5000, 30000)`

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for missing target, missing timeout, or timeout above `30000`

Example:

```json
{
  "id": "wait-nav-1",
  "type": "wait_for_navigation",
  "params": {
    "expectedPackage": "com.android.settings",
    "timeoutMs": 5000
  }
}
```

<a id="action-snapshot"></a>
### `snapshot`

| Field | Valid values |
| --- | --- |
| Required | none |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `UiReadiness` |

Semantics:

- the old `format` parameter is explicitly rejected as removed
- built-in builders set execution timeout to `30000` unless overridden
- snapshots carry XML in canonical result step data with verified chunk transport for large envelopes; older Operators use command-tagged log extraction as described in [Snapshot Format](snapshot.md)

Success data:

- `data.text` contains the extracted XML hierarchy
- `data.warn` may be added when a snapshot immediately follows `click` or `scroll_and_click` without an intervening sleep

Common failures:

- `SNAPSHOT_EXTRACTION_FAILED`
- `RESULT_ENVELOPE_TIMEOUT`

Example:

```json
{
  "id": "snap-1",
  "type": "snapshot"
}
```

<a id="action-show-toast"></a>
### `show_toast`

Request a native Android text toast from the Operator. Use it for brief announcements
such as starting a test run. Each call cancels the previous API-requested toast before
submitting its replacement. The current API toast is shared across callers for that
Operator instance and is separate from incidental Operator messages.

| Parameter | Accepted values | Default |
| --- | --- | --- |
| `text` | Required string, 1-2048 UTF-16 code units, including a non-whitespace character | None |
| `duration` | Exactly `"short"` or `"long"` | `"short"` |

Text is preserved verbatim. Unknown fields, parameter aliases, blank text, null values,
and numeric durations are rejected with `EXECUTION_VALIDATION_FAILED` at the Node boundary.
There are no toast IDs, queue controls, custom styles, positions, buttons, or millisecond
durations. Use [on-screen logs](on-screen-logs.md) for persistent information.

```json
{
  "id": "announce-start",
  "type": "show_toast",
  "params": {
    "text": "Starting test run",
    "duration": "short"
  }
}
```

Success means the Operator submitted the request to Android on its main thread. It
does not prove visibility and does not wait for dismissal. Success step data contains
exactly `{"submitted":"true","duration":"short"}` (or `"long"`), without echoing text.
An Android submission exception fails the action with `ACTION_FAILED`.

Android controls the actual duration, layout, and display. Background toasts are
rate-limited; on Android 12 and newer with current target SDKs, text toasts show the
app icon and at most two lines. Long input may be truncated. See the
[Android Toast reference](https://developer.android.com/reference/android/widget/Toast)
and [toast guidance](https://developer.android.com/guide/topics/ui/notifiers/toasts).

CLI examples:

```bash
androperator toast "Starting test run"
androperator toast "Test run complete" --duration long
androperator toast --cancel
```

Common flags include `--device <device_serial>`, `--operator-package <package>`,
`--timeout <ms>`, `--output json|pretty`, and `--no-daemon`. For local development,
use `--operator-package com.androperator.operator.dev`. To send text beginning with
`-`, put options first and use `toast -- "--literal text"`. The CLI validates before
dispatch and does not automatically replay an uncertain dispatch.

Raw `exec`, HTTP `/execute`, and MCP `execute` accept these actions in the usual
execution envelope, retaining `commandId`, `taskId`, and action IDs. A toast can be
the first action in a test sequence; later actions do not wait for it to disappear.

<a id="action-cancel-toast"></a>
### `cancel_toast`

Cancel the current API-requested toast, including one pending display. Omit `params`
or pass exactly `{}`. `null` and all parameter fields are invalid. Cancellation is
idempotent and succeeds when no API toast exists. It does not cancel another app's
toast or an incidental Operator message. API toast ownership lasts for the Operator
process; it does not survive a process restart.

```json
{ "id": "dismiss-announcement", "type": "cancel_toast" }
```

The CLI form is `androperator toast --cancel`, exclusive with text and `--duration`.
Success step data is exactly `{"submitted":"true"}`. This acknowledges completion
of the cancellation request, not observation that the toast has disappeared.

<a id="action-set-on-screen-log"></a>
### `set_on_screen_log`

Use this raw action to show one noninteractive diagnostic panel owned by the connected Operator accessibility service. Supply literal `text` or a live Android-resolved `template`. CLI conveniences are `on-screen-log set --text <text>` and `on-screen-log set --template <template>`. See [On-screen logs](on-screen-logs.md) for lifecycle, capture, and transport details.

| Field | Valid values | Default / meaning |
| --- | --- | --- |
| Required | Exactly one of `text` or `template` | Literal label or live metadata template. |
| `text` | String with `1..2048` UTF-16 code units, at least one non-whitespace character | Literal text. LF and TAB are allowed; other control characters are rejected. |
| `template` | Same input bounds as `text`; only the nine documented placeholders | See [template vocabulary, escaping and expansion bounds](on-screen-logs.md#live-templates). Mutually exclusive with `text`. |
| `anchor` | Exact `left` or `right` | `left`; physical display edge. |
| `textAlign` | Exact `left` or `right` | `left`; alignment inside the panel. |
| `topOffsetDp` | Integer-valued JSON number `0..1000` | `8`; from the usable top edge. |
| `edgeOffsetDp` | Integer-valued JSON number `0..1000` | `8`; inward from the selected usable horizontal edge. |
| `widthDp` | Integer-valued JSON number `80..600` | `280`; full panel width including padding. |
| `fontSizeSp` | Integer-valued JSON number `8..24` | `12`; follows Android font scale. |
| `textColor` | Exact `#RRGGBB` or `#AARRGGBB` | `#FFFFFFFF`. |
| `backgroundColor` | Exact `#RRGGBB` or `#AARRGGBB` | `#B3000000`. |
| `ttlMs` | Integer-valued JSON number `1000..3600000` | `300000`; local stale-label expiry. |

Rules:

- only the fields in this table are accepted
- do not use named colors, fractional numbers, numeric strings, `null`, parameter aliases, or unknown keys
- six-digit colors normalize to uppercase opaque eight-digit colors, for example `#a1b2c3` becomes `#FFA1B2C3`
- every successful set replaces the whole existing panel using supplied values and defaults, rather than patching existing state
- malformed input is rejected before dispatch and cannot modify a currently visible panel

Success data has the exact string-valued keys `visible`, `rendered`, `truncated`, `anchor`, `text_align`, `top_offset_dp`, `edge_offset_dp`, `width_dp`, `font_size_sp`, `text_color`, `background_color`, `ttl_ms`, and `bounds`. The result does not echo caller text or resolved metadata. Bounds and truncation describe the initial draw; live refreshes preserve the original TTL.

Common failures:

- `EXECUTION_VALIDATION_FAILED` before dispatch for malformed raw input
- `ON_SCREEN_LOG_SERVICE_UNAVAILABLE`, `ON_SCREEN_LOG_LAYOUT_INVALID`, `ON_SCREEN_LOG_RENDER_FAILED`, or `ON_SCREEN_LOG_RENDER_TIMEOUT` from the runtime

Example:

```json
{
  "id": "set-panel",
  "type": "set_on_screen_log",
  "params": {
    "text": "FLOW-001: Observe settings",
    "anchor": "right",
    "textAlign": "left",
    "topOffsetDp": 0,
    "edgeOffsetDp": 12,
    "widthDp": 320,
    "fontSizeSp": 16,
    "textColor": "#a1b2c3",
    "backgroundColor": "#7f0a0b0c",
    "ttlMs": 12000
  }
}
```

<a id="action-clear-on-screen-log"></a>
### `clear_on_screen_log`

Remove the current Operator-owned on-screen log panel. It accepts omitted `params` or exactly `{}`. Any other value, including `null` or a nonempty object, is rejected.

Success data is exactly:

```json
{
  "visible": "false"
}
```

Clear succeeds while the panel is already hidden. It does not include a `rendered` field.

Example:

```json
{
  "id": "clear-panel",
  "type": "clear_on_screen_log",
  "params": {}
}
```

<a id="action-take-screenshot"></a>
### `take_screenshot`

| Field | Valid values |
| --- | --- |
| Required | none |
| `path` | optional non-empty string |
| `scale` | optional number: `100`, `50`, or `25`, percentage per dimension |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `None` |

Semantics:

- if `path` is present, it must not be blank
- built-in builders set execution timeout to `30000` unless overridden

Success data:

- `data.path` after Node verifies and writes the host screenshot
- `data.captureSource: "host"` and `data.persistedAt` (host ISO timestamp after the PNG file write completes)
- `data.captureWidthPx` and `data.captureHeightPx`: original, decoded PNG dimensions in pixels, encoded as decimal strings like other step data
- `data.coordinateSpace: "screenshot_pixels"` and `data.origin: "top_left"`

Migration: screenshot step `data.capturedAt` has been replaced by
`data.persistedAt`; no compatibility alias is emitted. Update screenshot
consumers to read the new field. It marks host file-write completion, not the
exact instant Android captured the screen. The separate `query_ui` payload
`capturedAt` field is unchanged.

These dimensions describe the saved image, not a resized preview or Android dp.
The x axis runs right and the y axis runs down. Pixel indices range from zero to
`captureWidthPx - 1` and `captureHeightPx - 1`. Metadata is published only after PNG validation and
successful persistence. Older captures may omit it; read the original image's
dimensions instead of guessing from its preview.

For an uncropped preview rendered at `previewWidthPx` by `previewHeightPx`, map a
point inside the image to the original with
`captureXpx = floor(previewXpx * captureWidthPx / previewWidthPx)` and
`captureYpx = floor(previewYpx * captureHeightPx / previewHeightPx)`. For example, a 1080 x 2400 PNG
shown at 360 x 800 maps preview point (120, 200) to image point (360, 600).
Measure preview coordinates relative to the image itself: remove padding or
letterboxing first. This formula is not sufficient for cropped or rotated previews.

Image coordinates are not a guarantee about the device's current input space.
Before clicking or swiping, verify that the current display orientation and
coordinate dimensions match the capture; recapture after rotation, display
changes, or navigation. Do not use density scaling to convert pixels to dp.
Prefer a fresh semantic selector when available.

The host capture occurs after the runtime envelope, not at the runtime step's
exact instant. A successful fallback clears the superseded
`UNSUPPORTED_RUNTIME_SCREENSHOT` error, errorCode, and message while preserving
other metadata. A failed capture or artifact write produces
`EVIDENCE_CAPTURE_FAILED`; it does not become success or expose a stale path.

Common failures:

- `EXECUTION_VALIDATION_FAILED` for blank path
- timeout or runtime screenshot capture failures

Example:

```json
{
  "id": "shot-1",
  "type": "take_screenshot",
  "params": {
    "path": "/tmp/settings.png"
  }
}
```

Explicit `scale` prefers the persistent shell capture helper, with stock capture
and resize when helper setup is unavailable. Omission preserves the
existing ordinary full-resolution ADB capture. The CLI spelling is
`androperator screenshot --scale 25 --path /tmp/screen.png`. The Node
`observeScreenshot({ scale: 25 })` helper and HTTP `POST /screenshot` accept the
same numeric values. Numeric strings, arbitrary percentages and empty values are
invalid. A scaled screenshot must be the only screenshot and the final action
in its execution; use separate executions for intermediate observations.

All successful captures also report `data.captureMethod` (`adb_screencap`,
`shell_hardware_buffer`, or `adb_screencap_resize`), `data.requestedScale`, and `data.appliedScale` as strings.
A helper capture additionally reports:

- `nativeWidthPx`, `nativeHeightPx`: full display coordinate extent in its current
  rotation, before scaling; these are logical display pixels, not panel hardware
  mode dimensions or Android dp.
- `rotation`: Android quarter-turn rotation, `0` through `3`; `logicalDisplayId`
  is `0`, and `physicalDisplayId` remains a decimal string without numeric rounding.
- `captureId`, `captureSessionId`, `captureSequence`: request and session
  correlation, independent of the unchanged command/task IDs in the envelope.
- `deviceCaptureNanos`: a monotonic device timestamp, never a host UTC timestamp.

Dimensions are floored per axis: 1080 x 2410 at 25% produces 270 x 602. Convert
image coordinates to the current full display using each actual ratio, for
example `floor(imageX * nativeWidthPx / captureWidthPx)`. Verify that display
geometry and content still match before acting. Image capture does not establish
that an app destination has finished rendering.

The helper is deployed automatically from the Node package; consumers need ADB,
not Java or an Android SDK. A long-lived Node process or the existing CLI daemon
reuses its session. Direct one-shot CLI invocations pay setup/startup costs.
Sessions expire after 30 seconds idle and are discarded after acquisition
failure or cancellation. Retry only the screenshot; never repeat preceding
navigation to recover capture. See [setup](../setup.md#optional-reduced-screenshot-capture) for prerequisites.

`doctor` reports the direct helper in `capture.reduced` as supported, unavailable
or incompatible; unavailable/incompatible helper setup can use the resize fallback.
This probes APIs with a temporary helper deployment, without acquiring an image.
Supported capability does not prove that the current screen can be captured.

**Compatibility and fallback:** direct scaled capture supports both the older
Android 15/16 capture interface and the newer interface used by Android 17.
Missing protected GPU composition does not block screenshots. Direct capture
has been verified at 100/50/25 on an API 37.1 physical phone and API 35, 36.0 and
37.2 emulators. Other manufacturers and builds still need live validation.

All successful screenshots report `data.protectedContent`:

| Value | Meaning |
| --- | --- |
| `absent` | The helper's compositor capability and returned buffer establish that no protected buffer was included. |
| `unknown` | Protected content may have been redacted by Android; this does not prevent ordinary capture. Always used for stock/resize and omitted-scale stock capture. |
| `present` | A protected hardware buffer was detected and rejected before pixel readback. This value appears on a failed capture, never an exported protected image. |

This describes protected hardware buffers, not app rendering readiness. Secure
windows are checked separately: the direct helper rejects Android's secure-layer
flag. Android's normal redaction remains in force on stock capture. An unknown
state is not a claim that the screenshot is complete or free of redacted regions.
No path bypasses Android protection or reads a protected buffer.

If helper initialization fails as `incompatible` or `unavailable`, Node makes one
ordinary full-resolution capture and resizes its decoded pixels to the requested
scale. The method is `adb_screencap_resize`, with `fallbackAttempted: "true"` and
`fallbackReason` identifying the helper setup failure. Even explicit 100% uses
this method label when selected through fallback, although no resize is needed.
It reports native and returned dimensions, plus rotation/display identity when
Android exposes them. The fallback reduces output dimensions; it does not have
the direct helper's acquisition-speed advantage. It adds no public backend option.

Fallback checks device interactivity and display geometry before and after
capture and shares the original timeout/cancellation budget. It does not run
after protected/secure rejection, stale output, transport interruption, timeout,
cancellation or an uncertain acquired frame. No device action is replayed.
Omitted scale retains the existing full-resolution behavior and method.

Failed scaled acquisition returns `EVIDENCE_CAPTURE_FAILED` on the screenshot step,
with `data.captureFailureReason`, `data.protectedContent` and
`data.fallbackAttempted` (`"true"` or `"false"`). Reasons are `incompatible`,
`unavailable`, `rejected`, `protocol`, `transport`, `cancelled`, `timeout`,
`busy`, or `publication`. Publication means image acquisition succeeded but the
host could not save the image. Publication failures retain `requestedScale`,
`protectedContent`, `captureMethod`, `fallbackAttempted` and, when applicable,
`fallbackReason`. Cancellation and deadline exhaustion during publication retain
their `cancelled` or `timeout` reason. No successful path or persisted timestamp
is returned, and a pre-existing destination is preserved when publication is
interrupted before its atomic rename.

If fallback also fails, check the reported stock/resize error and ADB
readiness. Use an ordinary unprotected screen for direct content rejection;
unlock/stabilize the display for state/geometry failures. Protocol/transport
failure discards the session; a new read-only screenshot request starts a new
one. Timeout needs sufficient remaining budget; busy means await the prior
capture. Never treat a failure or an old file at the requested path as a new
observation.

<a id="action-close-app"></a>
### `close_app`

| Field | Valid values |
| --- | --- |
| Required | `applicationId` |
| `applicationId` | required non-empty package id string |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `AppClose` |

Semantics:

- built-in builders default execution timeout to `30000`
- Node runs a pre-flight adb force-stop and may normalize an Android-side unsupported close into success

Success data:

- `data.application_id` when pre-flight close succeeded

Common failures:

- `EXECUTION_VALIDATION_FAILED` for missing `applicationId`
- adb force-stop failure or package/runtime failures

Example:

```json
{
  "id": "close-1",
  "type": "close_app",
  "params": {
    "applicationId": "com.android.settings"
  }
}
```

<a id="action-sleep"></a>
### `sleep`

| Field | Valid values |
| --- | --- |
| Required | `durationMs` |
| `durationMs` | required number `>= 0` and `<=` the maximum execution timeout constant |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `None` |

Semantics:

- builder sets execution timeout to `max(durationMs + 5000, globalTimeout, 30000)`

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for negative or oversized duration

Example:

```json
{
  "id": "sleep-1",
  "type": "sleep",
  "params": {
    "durationMs": 1500
  }
}
```

<a id="action-open-app"></a>
### `open_app`

| Field | Valid values |
| --- | --- |
| Required | `applicationId` |
| `applicationId` | required non-empty package id string |
| `skipNavigationWait` | optional boolean, defaults to `false` |
| `navigationTimeoutMs` | optional integer in `[1000, 120000]`, defaults to `15000` |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `AppLaunch` |

Semantics:

- `open_app` dispatches the launch intent, then waits until the launched package is the active foreground accessibility package before returning success.
- set `skipNavigationWait: true` only when you intentionally want the older fire-and-forget behavior.
- `navigationTimeoutMs` controls the readiness wait only. It does not change the execution-level timeout.
- already-foreground launches succeed without a package-transition race.
- callers that need content to be present after the package is foreground should follow with `wait_for_node`.
- the `androperator open` CLI exposes `--skip-navigation-wait` and `--navigation-timeout-ms` for package targets only; URI targets reject both flags with `EXECUTION_VALIDATION_FAILED`.

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for missing `applicationId`
- runtime step failures such as `NAVIGATION_TIMEOUT` when the launched package does not reach the foreground within the wait budget

Example:

```json
{
  "id": "open-1",
  "type": "open_app",
  "params": {
    "applicationId": "com.android.settings",
    "skipNavigationWait": false,
    "navigationTimeoutMs": 15000
  }
}
```

<a id="action-open-uri"></a>
### `open_uri`

| Field | Valid values |
| --- | --- |
| Required | `uri` |
| `uri` | required non-empty string, max length enforced by `MAX_URI_LENGTH` |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `AppLaunch` |

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for missing or blank `uri`

Example:

```json
{
  "id": "open-uri-1",
  "type": "open_uri",
  "params": {
    "uri": "https://androperator.com"
  }
}
```

<a id="action-start-recording"></a>
### `start_recording`

| Field | Valid values |
| --- | --- |
| Required | none |
| `sessionId` | optional non-blank string |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `None` |

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for blank `sessionId`
- recording-state runtime errors such as `RECORDING_ALREADY_IN_PROGRESS`

Example:

```json
{
  "id": "record-start-1",
  "type": "start_recording",
  "params": {
    "sessionId": "session-001"
  }
}
```

<a id="action-stop-recording"></a>
### `stop_recording`

| Field | Valid values |
| --- | --- |
| Required | none |
| `sessionId` | optional non-blank string |
| `retry` | optional retry object in raw `exec` JSON; Android defaults to `None` |

Success data:

- no Node-guaranteed success keys

Common failures:

- `EXECUTION_VALIDATION_FAILED` for blank `sessionId`
- recording-state runtime errors such as `RECORDING_NOT_IN_PROGRESS`

Example:

```json
{
  "id": "record-stop-1",
  "type": "stop_recording",
  "params": {
    "sessionId": "session-001"
  }
}
```

## CLI To Action Mapping

| CLI command | Canonical action type | Notes |
| --- | --- | --- |
| `click` | `click` | `tap` is a CLI synonym |
| `swipe` | `swipe` | explicit endpoints and `--duration-ms`; no initial hold |
| `drag` | `drag` | explicit endpoints, `--hold-duration-ms`, and `--move-duration-ms` |
| `type` | `enter_text` | built from selector + text |
| `read` | `read_text` | supports optional container matcher |
| `read-value` | `read_key_value_pair` | built from label selector flags |
| `wait` | `wait_for_node` | action timeout comes from `--timeout` |
| `wait-for-nav` | `wait_for_navigation` | requires `--timeout` |
| `snapshot` | `snapshot` | no action params |
| `screenshot` | `take_screenshot` | optional `path` |
| `close` | `close_app` | `close-app` is a CLI synonym |
| `sleep` | `sleep` | duration is positional |
| `toast <text>` | `show_toast` | optional `--duration short\|long` |
| `toast --cancel` | `cancel_toast` | no text or duration |
| `open` | `open_app` or `open_uri` | dispatch depends on target string |
| `press`, `back` | `press_key` | `back` hardcodes `key = "back"` |
| `scroll` | `scroll` | container flags optional |
| `scroll-until` | `scroll_until` or `scroll_and_click` | `--click` switches to `scroll_and_click` |
| `scroll-and-click` | `scroll_and_click` | alias that implies click-after |

`on-screen-log set --text <text>` and `on-screen-log clear` map to `set_on_screen_log` and `clear_on_screen_log`. See [On-screen logs](on-screen-logs.md#cli-commands) for the flags and separate-execution capture sequence. Raw `androperator exec` and existing generic execute transports remain supported.

## Result Data You Can Rely On

| Action type | Success keys exposed by the current execution runtime |
| --- | --- |
| `snapshot` | `data.text`; optional `data.warn` |
| `drag` | JSON-encoded `start` and `end`; string-valued `hold_duration_ms`, `move_duration_ms`, `dispatch_method`, `dispatch_accepted`, and `elapsed_ms`; see [drag](#action-drag) |
| `take_screenshot` | `data.path` |
| `close_app` | `data.application_id` when Node pre-flight succeeded |
| `set_on_screen_log` | `visible`, `rendered`, `truncated`, normalized style values, and `bounds`; all values are strings and caller text is omitted |
| `clear_on_screen_log` | `visible` with value `"false"` |
| `show_toast` | `submitted` with value `"true"`, and `duration` with value `"short"` or `"long"` |
| `cancel_toast` | `submitted` with value `"true"` |
| all others | no fixed success keys guaranteed by Node |

Concrete success example for `take_screenshot`:

```json
{
  "id": "shot-1",
  "actionType": "take_screenshot",
  "success": true,
  "data": {
    "path": "/tmp/settings.png"
  }
}
```

Concrete success example for `snapshot`:

```json
{
  "id": "snap-1",
  "actionType": "snapshot",
  "success": true,
  "data": {
    "text": "<hierarchy rotation=\"0\">...</hierarchy>",
    "warn": "snapshot captured without a preceding sleep step; UI may not have settled - consider adding a sleep step between click and snapshot"
  }
}
```

For failures, inspect:

- `envelope.status`
- first failed `stepResults[i].success == false`
- `stepResults[i].data.error`
- `stepResults[i].data.message`

## Related Pages

- [Selectors](selectors.md)
- [Errors](errors.md)
- [API Overview](overview.md)
- [Snapshot Format](snapshot.md)

## Notification and media actions

See [notifications](notifications.md) for list_notifications, dismiss_notification and invoke_notification_action; see
[media sessions](media.md) for list_media_sessions, get_media_status, media_pause,
media_play and media_seek. These share canonical execution and result correlation across CLI,
HTTP and MCP. Nonempty lists containing only notification/media reads and media pause/play/seek
bypass interactive readiness without waking the device. Notification mutations
and UI-containing lists retain whole-execution interactive readiness.
