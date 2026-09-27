# Snapshot Format

## Purpose

Define what `snapshot` returns, where the XML hierarchy is attached in the
[result envelope](overview.md#result-envelope), what extraction failures look
like, and what parts of the snapshot contract an agent can rely on.

## Sources

- Snapshot extraction: `apps/node/src/domain/executions/snapshotHelper.ts`
- Snapshot post-processing: `apps/node/src/domain/executions/runExecution.ts`
- Hard limits: `apps/node/src/contracts/limits.ts`
- Snapshot builder: `apps/node/src/domain/observe/snapshot.ts`
- Action contract summary: `docs/api/actions.md`

## What `snapshot` Returns

`snapshot` is the canonical read-only UI observation action. The Android runtime
returns the XML as `data.text` in the canonical result envelope. By default, large envelopes
travel over logcat in paced chunks with command/task identity, ordered indices,
byte length and SHA-256 verification. Node validates the complete XML before
returning raw or compact output.

The built-in `clawperator snapshot` command constructs a one-step execution with these exact defaults:

- `source: "clawperator-observe"`
- `expectedFormat: "android-ui-automator"`
- `timeoutMs: 30000` when `buildSnapshotExecution()` is called without an override
- one action with `id: "snap"` and `type: "snapshot"`
- `mode: "direct"`
- `commandId` is generated as `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
- `taskId` equals the generated `commandId`

For default raw CLI `snapshot`, machine-checkable success means:

- exit code `0`
- top-level JSON has `envelope`
- `envelope.status == "success"`
- `envelope.stepResults[0].actionType == "snapshot"`
- `envelope.stepResults[0].success == true`
- `envelope.stepResults[0].data.text` is present

Example one-step payload from the `clawperator snapshot` builder:

```json
{
  "commandId": "snapshot-1700000000000-abcd123",
  "taskId": "snapshot-1700000000000-abcd123",
  "source": "clawperator-observe",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    {
      "id": "snap",
      "type": "snapshot"
    }
  ],
  "mode": "direct"
}
```

## Compact Output and Raw Artifacts

Use compact output to bound the hierarchy returned to an agent while retaining
containers, state, and ancestry:

```bash
clawperator snapshot --device <device_serial> --operator-package com.clawperator.operator.dev --compact --max-nodes 20 --raw-path ./hierarchy.xml
```

| CLI option | Behavior |
| --- | --- |
| `--compact` | Opt in to a JSON projection; default raw output is unchanged |
| `--max-nodes <n>` | Requires compact; integer `1..1000`, default `100` |
| `--max-text-chars <n>` | Requires compact; integer `1..4096`, default `256` Unicode code points per text/description field |
| `--raw-path <file>` | Nonblank host path, valid with either mode; parent must exist and file must not exist |

Compact success adds `compact` alongside `envelope`, `deviceId`, and terminal
metadata. Only snapshot `data.text` is omitted from the returned envelope copy;
other step metadata, including `operator_overlay_visible`, remains. The canonical
execution envelope is unchanged internally.

`compact` contains `schemaVersion: 1`, the capture's `commandId` and `taskId`,
optional `rawArtifactPath`, `totalNodes`, `returnedNodes`, `omittedNodes`,
`truncated`, and a `nodes` array. The full XML is parsed and counted even when
only a prefix is returned. `truncated` is true when nodes are omitted or a
returned text/description field is shortened.

Each node retains:

- `nodePath` and `parentPath`: XML child-index paths such as `0`, `0.0`, and
  `0.0.1`; root nodes have a null parent. These describe this capture only, not
  persistent handles or guaranteed query IDs. They cannot target actions.
- `resourceId`, `className`, `text`, `contentDescription`, and `bounds`: decoded
  strings, or null when absent. Bounds retain XML's `[x1,y1][x2,y2]` string form.
  Empty strings remain distinct from absent attributes. Text and descriptions
  preserve literal newlines, carriage returns, and tabs from the snapshot.
- `checked`, `checkable`, `selected`, `enabled`, `clickable`, `scrollable`,
  `visibleToUser`, and `accessibilityDataSensitive`: native booleans, or null
  when unavailable or not a recognized boolean value.
- `textTruncated` and `contentDescriptionTruncated`: explicit booleans. Text
  limits count Unicode code points, preserving supplementary characters.

Nodes are a whole-node preorder prefix, so included parents precede children.
Unlabeled containers and offscreen nodes are retained in that order; Node does
not perform semantic matching or visibility filtering. Unknown XML attributes
remain available in the raw artifact but are not projected.

`--raw-path` exclusively creates a file containing the exact extracted XML
string, before compact parsing. It never overwrites an existing file. In raw
mode, `rawArtifactPath` is top-level; in compact mode, it is inside `compact`.
An artifact write failure returns `SNAPSHOT_ARTIFACT_WRITE_FAILED`. Malformed XML,
DTD declarations, external entities, or a non-hierarchy document return
`SNAPSHOT_EXTRACTION_FAILED`. Both errors exit nonzero and retain the original
execution envelope. If parsing fails after saving, the error also returns the
saved `rawArtifactPath`. A successful capture verdict does not imply that
formatting or artifact writing succeeded.

[MCP snapshot](mcp.md#mcp-tool-snapshot) uses the same projection with
`compact`, `maxNodes`, and `maxTextChars`. It accepts `saveRaw: true` to create
an exclusive runtime-owned temporary file; caller-provided `rawPath` is rejected.
Compact mode cannot be combined with MCP `maxChars`. Raw MCP `maxChars` behavior
is unchanged. Temporary artifacts are host-local and subject to host temporary
file cleanup; copy evidence you need to retain.

These limits bound nodes and fields, not exact tokens or bytes. Projection does
not reduce Android capture cost. A full compact projection can exceed raw XML
size for short or sparse nodes; choose a node limit appropriate to the task.

## How Snapshot Data Flows

The default CLI, MCP and Serve flow is:

1. Node dispatches the canonical `snapshot` action using its Android-compatible action name.
2. Android captures XML and places it in that action's `data.text` in the canonical result envelope.
3. The Operator publishes the envelope over logcat. Large envelopes use the existing paced result chunks, carrying command/task identity, ordered indices, total bytes and SHA-256.
4. Node reconstructs and verifies the complete envelope before exposing any snapshot from it. Missing tail chunks remain incomplete and time out; missing middle chunks, inconsistent metadata and checksum failures return `RESULT_ENVELOPE_MALFORMED`.
5. Node validates each successful snapshot's XML. Missing or invalid XML fails that step with `SNAPSHOT_EXTRACTION_FAILED` even when transport integrity passed.
6. Compact presentation, optional artifact writing and settle warnings use the validated snapshot.

A closing XML tag alone does not prove complete delivery. A transport failure
retains command correlation and dispatch evidence, and does not return partial
XML as a selector source. Pacing reduces publication pressure; it is not a
guarantee that logcat cannot lose records. Compact limits do not reduce source
capture or transfer cost.

Node retains legacy extraction for Operators that publish XML separately using
`[TaskScope] UI Hierarchy [commandId=<command_id>]:`. That compatibility path
matches the command and attaches captures to successful snapshot steps in
reverse occurrence order. It never replaces an explicitly supplied `data.text`,
including an empty string; empty sources must fail validation. Legacy text does
not acquire the new chunk integrity guarantees. Use a matching updated Operator
and CLI to obtain the repaired capture path.

Multiple current snapshots stay attached to their own action IDs inside the
verified envelope. For direct `clawperator snapshot`, the step ID remains
`"snap"`. CLI arguments, compact output, raw XML and the public result envelope
shape are unchanged. No socket, file-transfer service or new device connection
is required.

## Envelope Placement

In default raw CLI output, successful `snapshot` XML lives inside the step result:

```json
{
  "envelope": {
    "commandId": "snapshot-1700000000000-abcd123",
    "taskId": "snapshot-1700000000000-abcd123",
    "status": "success",
    "stepResults": [
      {
        "id": "snap",
        "actionType": "snapshot",
        "success": true,
        "data": {
          "text": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><hierarchy rotation=\"0\">...</hierarchy>"
        }
      }
    ],
    "error": null
  },
  "deviceId": "<device_serial>",
  "terminalSource": "clawperator_result",
  "isCanonicalTerminal": true
}
```

Verification pattern - confirm the snapshot contract is active:

```bash
clawperator snapshot --device <device_serial>
```

Check these exact fields:

```json
{
  "envelope": {
    "status": "success",
    "stepResults": [
      {
        "actionType": "snapshot",
        "success": true,
        "data": {
          "text": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><hierarchy rotation=\"0\">...</hierarchy>"
        }
      }
    ]
  }
}
```

## The XML Format

Node's contract is that `data.text` contains the raw XML hierarchy string. Node does not validate individual XML attributes, but the extracted content follows Android UI Automator style hierarchy dumps with a `<hierarchy>` root and nested `<node>` elements.

Typical node attributes visible in current snapshots include:

| XML attribute | Meaning | Related selector field |
| --- | --- | --- |
| `resource-id` | Android resource id, often `package:id/name` | `resourceId` |
| `text` | visible text | `textEquals`, `textContains` |
| `content-desc` | accessibility label | `contentDescEquals`, `contentDescContains` |
| `class` | widget class name such as `android.widget.TextView` | none |
| `bounds` | screen rectangle in `"[x1,y1][x2,y2]"` form | none |
| `package` | package name for the node | none |
| `clickable` | `"true"` or `"false"` | none |
| `enabled` | `"true"` or `"false"` | none |
| `scrollable` | `"true"` or `"false"` | none |

Important limits on what to infer:

- `data.text` is the only Node-guaranteed snapshot success field today.
- `NodeMatcher.role` is a Clawperator selector concept documented in [Selectors](selectors.md), not a direct XML attribute.
- A node appearing in the XML does not guarantee it is currently reachable on screen. Use `bounds`, scrolling, and follow-up actions to confirm reachability.

Current runtime note:

- Android-side code currently also emits keys such as `actual_format`, `foreground_package`, `has_overlay`, `overlay_package`, and `window_count`
- `operator_overlay_visible` is the separately documented status field for an Operator-owned on-screen log panel; see [On-screen logs](on-screen-logs.md)
- the other Android metadata keys are not documented as Node-guaranteed success fields in the current Node contract
- agents should rely on `data.text` first and treat other snapshot metadata as opportunistic runtime data

## Realistic XML Fragment

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node
    index="0"
    text=""
    resource-id="com.android.settings:id/recycler_view"
    class="androidx.recyclerview.widget.RecyclerView"
    package="com.android.settings"
    content-desc=""
    clickable="false"
    enabled="true"
    scrollable="true"
    bounds="[0,884][1080,2196]">
    <node
      index="0"
      text="Connected devices"
      resource-id="android:id/title"
      class="android.widget.TextView"
      package="com.android.settings"
      content-desc=""
      clickable="false"
      enabled="true"
      bounds="[216,1503][661,1573]" />
  </node>
</hierarchy>
```

## Annotated Live-Device Example

Full `clawperator snapshot` output from an Android emulator running
Android 15 (API 35) with the Settings app open. This example uses the emulator
because it produces reproducible results that any device can create and run.

### Envelope

```json
{
  "envelope": {
    "commandId": "snapshot-1774926121032-v6kvd37",
    "taskId": "snapshot-1774926121032-v6kvd37",
    "status": "success",
    "stepResults": [
      {
        "id": "snap",
        "actionType": "snapshot",
        "success": true,
        "data": {
          "actual_format": "hierarchy_xml",
          "foreground_package": "com.android.settings",
          "has_overlay": "false",
          "operator_overlay_visible": "false",
          "window_count": "2",
          "text": "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<hierarchy rotation=\"0\">...</hierarchy>"
        }
      }
    ],
    "error": null
  },
  "deviceId": "emulator-5554",
  "terminalSource": "clawperator_result",
  "isCanonicalTerminal": true
}
```

Fields to note:

- `actual_format`, `foreground_package`, `has_overlay`, and `window_count` appear
  in the `data` object alongside `text`. They are runtime-detail fields emitted
  by the Android side and are not part of the Node-guaranteed contract. An
  agent may read them opportunistically (for example, confirming
  `foreground_package` before proceeding), but must not depend on them being
  present in all environments or versions.
- `operator_overlay_visible` is always the string `"true"` or `"false"` on a
  successful Android snapshot. It reports only whether the Operator-owned
  on-screen log panel is visible. It does not replace `has_overlay`,
  `overlay_package`, or `window_count`, which retain their raw runtime meaning.
  This is also the visibility check after the [CLI set/clear commands](on-screen-logs.md#cli-commands);
  it does not verify screenshot pixels.
- `terminalSource: "clawperator_result"` and `isCanonicalTerminal: true`
  are outer-envelope fields added by the terminal output layer; they are not
  part of the `envelope` sub-object.

### Annotated XML Fragment

The full hierarchy is trimmed to show the structurally important layers.
Omitted attributes (checkable, checked, focused, long-clickable, password,
selected) are present in real output but rarely useful for targeting.

This example was captured on an emulator running Android 15 with a
1080 x 2400 pixel display.

```xml
<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<!--
  rotation="0" - device is portrait. Bounds coordinates use portrait dimensions.
  On this emulator: 1080 x 2400 pixels.
-->
<hierarchy rotation="0">

  <!-- Main scrollable container for Settings homepage -->
  <node
    resource-id="com.android.settings:id/settings_homepage_container"
    class="android.widget.ScrollView"
    package="com.android.settings"
    clickable="false"
    enabled="true"
    scrollable="true"
    bounds="[0,136][1080,2337]">

    <!-- Toolbar containing the Settings title -->
    <node
      resource-id="com.android.settings:id/settings_toolbar"
      class="android.widget.LinearLayout"
      package="com.android.settings"
      clickable="false"
      bounds="[0,136][1080,292]">

      <!--
        The visible screen title. Use text="Settings" to confirm the active screen.
        clickable="false" - this is a label, not a tap target.
      -->
      <node
        text="Settings"
        resource-id="com.android.settings:id/action_bar"
        class="android.widget.TextView"
        package="com.android.settings"
        clickable="false"
        enabled="true"
        bounds="[48,185][267,243]" />

      <!--
        Search button. Use resource-id to target.
        clickable="true" - this is a tap target.
      -->
      <node
        text=""
        resource-id="com.android.settings:id/search_action_bar"
        class="android.widget.Button"
        package="com.android.settings"
        content-desc="Search settings"
        clickable="true"
        enabled="true"
        bounds="[912,136][1080,292]" />
    </node>

    <!--
      Main content list container.
      Use resourceId selector with value "com.android.settings:id/main_content".
    -->
    <node
      resource-id="com.android.settings:id/main_content"
      class="android.widget.LinearLayout"
      package="com.android.settings"
      clickable="false"
      bounds="[0,292][1080,2337]">

      <!--
        A settings list row. The row container is clickable.
        Target by the child title text.
      -->
      <node
        text=""
        resource-id=""
        class="android.widget.LinearLayout"
        package="com.android.settings"
        clickable="true"
        enabled="true"
        bounds="[0,315][1080,483]">

        <node
          text="Network &amp; internet"
          resource-id="android:id/title"
          class="android.widget.TextView"
          package="com.android.settings"
          clickable="false"
          enabled="true"
          bounds="[144,351][579,447]" />

        <!--
          Summary text node showing current state.
          resource-id="android:id/summary" shows current Wi-Fi status.
        -->
        <node
          text="Wi-Fi"
          resource-id="android:id/summary"
          class="android.widget.TextView"
          package="com.android.settings"
          clickable="false"
          enabled="true"
          bounds="[144,351][936,447]" />
      </node>

      <!-- Second row follows the same pattern -->
      <node
        text=""
        resource-id=""
        class="android.widget.LinearLayout"
        package="com.android.settings"
        clickable="true"
        enabled="true"
        bounds="[0,483][1080,651]">

        <node
          text="Connected devices"
          resource-id="android:id/title"
          class="android.widget.TextView"
          package="com.android.settings"
          clickable="false"
          enabled="true"
          bounds="[144,519][621,615]" />

        <node
          text="Bluetooth"
          resource-id="android:id/summary"
          class="android.widget.TextView"
          package="com.android.settings"
          clickable="false"
          enabled="true"
          bounds="[144,519][936,615]" />
      </node>

    </node>
  </node>
</hierarchy>
```

### Targeting Patterns from This Example

| Goal | Selector approach |
| --- | --- |
| Confirm Settings is open | `textEquals: "Settings"` on a TextView |
| Tap a named settings row | `resourceId: "android:id/title"` + `textEquals: "Network & internet"` to locate, then click parent row |
| Read current state of a row | `resourceId: "android:id/summary"` + nearby `textEquals` for the row title |
| Tap the search button | `contentDescEquals: "Search settings"` or `resourceId: "com.android.settings:id/search_action_bar"` |
| Scroll the list | `resourceId: "com.android.settings:id/settings_homepage_container"` as scroll target |

## Extraction Failure

If a `snapshot` step initially succeeds but Node cannot attach `data.text`, Node rewrites that step into a failure:

```json
{
  "id": "snap",
  "actionType": "snapshot",
  "success": false,
  "data": {
    "error": "SNAPSHOT_EXTRACTION_FAILED",
    "message": "UI hierarchy extraction produced missing or invalid XML for this step. Check clawperator version compatibility and logcat extraction health."
  }
}
```

This is not just a warning. It changes the step to `success: false`, and later envelope reconciliation can change the whole execution to `status: "failed"`.

Typical recovery:

1. Run `clawperator version --check-compat`.
2. Run `clawperator doctor`.
3. Use `--verbose` for a bounded read-only observation when you need result-transport correlation and chunk diagnostics. The `[TaskScope] UI Hierarchy [commandId=<command_id>]:` marker applies only to legacy extraction.

Verification pattern - confirm extraction failure handling:

```bash
clawperator snapshot --device <device_serial>
```

If extraction failed, branch on `data.error`:

```json
{
  "envelope": {
    "status": "failed",
    "stepResults": [
      {
        "actionType": "snapshot",
        "success": false,
        "data": {
          "error": "SNAPSHOT_EXTRACTION_FAILED"
        }
      }
    ]
  }
}
```

Related error case:

- if the command never returns an envelope at all, the caller gets a top-level `RESULT_ENVELOPE_TIMEOUT` error instead of a snapshot step result
- if Node sees legacy untagged snapshot logs from a mismatched APK, the snapshot step can fail with `VERSION_INCOMPATIBLE`

## Settle Warning

Node also adds a best-effort warning to successful snapshots when the immediately preceding action was `click` or `scroll_and_click`:

```json
{
  "warn": "snapshot captured without a preceding sleep step; UI may not have settled - consider adding a sleep step between click and snapshot"
}
```

This warning appears only when:

- the snapshot step is successful
- Node can map the step id back to the original action order
- the previous action in that execution was `click` or `scroll_and_click`

Any intervening action such as `sleep`, `wait_for_node`, or `read_text` suppresses this warning because it may already provide settling time.

## Snapshot Line Limit

`LIMITS.MAX_SNAPSHOT_LINES` is `2000`.

This constant is defined in `apps/node/src/contracts/limits.ts`, but the current Node extraction path in `snapshotHelper.ts` does not actively clamp snapshots to 2000 lines. Treat it as a documented size-limit constant, not as a currently enforced truncation rule in extraction.

The same limits file also defines:

- `MAX_SNAPSHOT_BYTES = 262144`

Operationally:

- do not assume Node will truncate at 2000 lines today
- do assume very large hierarchies are higher risk across extraction, payload handling, and downstream consumers
- keep large XML payloads within the documented size constants when possible

## Successful Step Example

```json
{
  "id": "snap",
  "actionType": "snapshot",
  "success": true,
  "data": {
    "text": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><hierarchy rotation=\"0\"><node index=\"0\" text=\"Settings\" resource-id=\"com.android.settings:id/action_bar\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" clickable=\"false\" enabled=\"true\" bounds=\"[0,0][1080,176]\" /></hierarchy>"
  }
}
```

## What To Rely On

- rely on `stepResults[i].data.text` as the canonical snapshot payload
- rely on `SNAPSHOT_EXTRACTION_FAILED` when text extraction failed after execution and no more specific diagnostic code applies
- rely on `RESULT_ENVELOPE_TIMEOUT` when no usable result envelope returned at all
- treat `data.warn` as advisory only
- treat Android-emitted metadata fields beyond `text` as runtime details, not as Node-guaranteed contract fields
- use [Selectors](selectors.md) to map XML attributes into actionable selector objects

## Related Pages

- [Still Evidence Bundles](evidence.md): save screenshot, raw XML, metadata, and correlated capture receipts together

- [API Overview](overview.md)
- [Actions](actions.md)
- [Selectors](selectors.md)
- [Errors](errors.md)
- [Navigation Patterns](navigation.md)

## Source completeness

Raw and compact consumers receive the same source validation before presentation.
Node accepts one well-formed `hierarchy` XML document, including an empty
`<hierarchy/>`. Missing payloads, unfinished documents, malformed nesting,
multiple roots, DTD declarations, and unknown entities fail extraction. Validation
is limited to 8 MiB of UTF-8 source and 256 nested elements; it never resolves
external entities.

The affected step has `success: false`, `data.error: "SNAPSHOT_EXTRACTION_FAILED"`,
and no `data.text`. `data.extractionReason` is one of `missing_payload`,
`malformed_xml`, `invalid_root`, `doctype_forbidden`, `payload_limit`, or
`depth_limit`. The envelope becomes failed and the CLI exits 1. Command IDs and
invalid occurrence positions are retained. Current captures carry their XML in
the identified action step. In legacy extraction only, a missing entire marker
has no independent step identifier; attachment uses positional ordering.

For legacy log extraction, when file logging is enabled, `snapshot.extraction.failed` retains the command,
task, zero-based occurrence, reason, safe extraction facts, and at most 1024 UTF-8
source bytes locally (without splitting a Unicode code point).
The failed step includes `data.diagnosticLogPath` only after a successful log
write and while the logger has not encountered a write failure.
The partial tree is never returned as valid observation text. A deliberate
compact presentation limit applies only after valid source capture; it is not an
extraction failure.

Compatibility correction: raw consumers that previously accepted incomplete XML
must now handle failed steps and exit code 1. Switching to compact output is not
required for this protection. Query JSON remains serialized inside string-valued
step data.


### Extraction diagnostics and recovery

Failed source extraction adds the object `data.extractionDiagnostics`. Unlike
Android string-valued step fields, this is a host-added structured object:

| Field | Meaning |
| --- | --- |
| `receivedBytes` | UTF-8 byte count of the reconstructed, trimmed XML input, before validation; zero for missing input. This is not transport wire size. |
| `sourceValidationCategory` | The same source category as `data.extractionReason`. |
| `line`, `column`, `position` | Parser location at rejection, when available. Line is one-based, column is zero-based in Unicode characters, and position is a zero-based UTF-16 offset. Omitted for pre-parser size/empty checks and invalid-root checks. |
| `closingHierarchySeen` | Whether the reconstructed source contains a closing `hierarchy` marker. This does not establish well-formedness; a self-closing root needs no closing marker. Omitted when no extraction record exists. |
| `terminationReason` | `closing_hierarchy` for a standalone closing line, `same_tag_event` for an intervening bracketed event on the same log tag, `next_snapshot` for a new capture marker, or `end_of_capture` for the end of supplied log lines. Omitted when no extraction record exists. |

Retained SkillResult `execEnvelopes` preserve this diagnostic object and envelope
logging status rather than coercing them into strings.

Positions are nonnegative safe integers. No parser message, tag name, or source
excerpt appears in these public facts. Missing fields mean unavailable, not zero.
An unfinished source or absent closing marker does not establish truncation,
serialization failure, a transport fault, or version incompatibility.

`envelope.diagnostics.logging` reports `status: available`, `disabled`,
or `write_failed`. Available means the file sink is enabled and has
not failed; it does not prove a write has occurred. `logPath` appears only after
successful persistence. Disabled means intentionally disabled or no logger was
supplied. Write-failed includes the safe code `LOGGING_WRITE_FAILED` and no path.
Every logger implements the status contract. MCP retains the status
and extraction facts but strips local log paths through its existing privacy filter. Child loggers share
persistence and failure state. Logging failure never replaces the primary
execution outcome, and warnings remain on stderr. A configured destination alone
is not a diagnostic artifact. Local previews may contain private UI text.

For recovery, an orchestrator should:

1. Inspect the failed step, failure phase, requested/probe dispatch evidence, and
   earlier action effects. A successful preceding scroll or click remains an
   effect even when its subsequent observation fails.
2. Retain the original failure and invalidate actionable stale candidates,
   including nested adapter candidates. Keep prior values only as historical
   evidence until independently verified.
3. If eligible and within an explicit budget, acquire a fresh read-only
   observation. Never replay the preceding mutation or mixed execution payload.
4. Verify the destination and task evidence after acquisition. A valid new capture
   alone does not prove task completion.
5. On recurrence, inspect extraction diagnostics and logging availability;
   investigate readiness or compatibility only when supported by evidence, and
   return a truthful failure if recovery is exhausted.

The Settings example orchestrators implement one recovery per run for a retained
`snapshot` failure with `malformed_xml`, `post_processing`, and `dispatched`,
within ten seconds and the remaining run/delegation budget. Unknown dispatch,
DTD rejection, size/depth limits, compatibility and host setup errors do not use
that policy. Core does not retry. Compact projection failures remain host
presentation failures with their original envelope retained, distinct from
invalid source capture and Android action failure. These diagnostics do not
prevent malformed source or identify the incident's underlying cause.
