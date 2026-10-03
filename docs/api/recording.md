# Recording Format

For MP4 screen recordings, use [managed video evidence](evidence.md#managed-video).
The commands on this page record accessibility events.

## Purpose

Document the current recording workflow, the raw NDJSON schema written by the
Operator app, the parsed step-log format produced by `androperator record parse`,
the agent-context export produced by `androperator recording export`. Recording start
and stop commands are execution-backed and return the shared
[result envelope](overview.md#result-envelope) wrapper.

## Sources

- Raw event schema: `apps/node/src/domain/recording/recordingEventTypes.ts`
- Parser behavior: `apps/node/src/domain/recording/parseRecording.ts`
- Pull behavior: `apps/node/src/domain/recording/pullRecording.ts`
- CLI commands: `apps/node/src/cli/commands/record.ts`, `apps/node/src/cli/registry.ts`
- Export builder: `apps/node/src/domain/recording/exportRecording.ts`
- Shared validation: `apps/node/src/domain/recording/recordingValidation.ts`
- Public error codes: `apps/node/src/contracts/errors.ts`

## Recording As Evidence

Recordings are evidence for later authoring and debugging. They
are not executable skills.

Current durable rules:

- retain the pulled NDJSON as the raw capture
- retain `androperator recording export` output as the canonical structured
  artifact for authoring
- use `androperator record parse` as lossy human inspection only
- do not treat a recording export or parsed step log as a reusable skill with
  only light cleanup

What the retained export gives you:

- the raw event timeline
- package-transition evidence
- candidate selectors, text, and timing
- optional preserved XML snapshots when `--snapshots include` is used

What it does not give you:

- the final reusable control flow for a skill
- the final selector strategy for every tap
- terminal verification policy
- a guarantee that the recorded visible label was the real clickable node

Practical evidence quality rules:

- start the recording from a fresh app state whenever possible
- if the author already explored the target app manually, close the target app
  or apps before recording so the capture reflects a reusable path rather than
  a half-completed mid-flow state
- a recording is optional evidence; request one only when it adds missing knowledge
- when the first recording looks exploratory, sparse, or branch-dependent,
  capture another pass rather than pretending one shaky run is authoritative

## Recording Lifecycle

The current flow is:

1. `androperator record start [--session-id <id>]`
2. interact with the device
3. `androperator record stop [--session-id <id>]`
4. `androperator record pull [--session-id <id>] [--out <dir>]`
5. `androperator recording export --input <file|directory> [--out <file>] [--snapshots <omit|include>]`
6. `androperator record parse --input <file> [--out <file>]`

Notes:

- `record` is a top-level alias for `recording`
- `pull` defaults to `./recordings/` when `--out` is omitted
- the practical authoring order is `pull`, then `export`, then optional `parse`
  or other human inspection
- do not treat `parse` as the only retained baseline artifact; it intentionally
  drops event detail that `export` preserves
- do not run `export` or `parse` against a recording directory until `pull`
  has finished writing the local NDJSON file you plan to keep
- `parse` writes `<input without .ndjson>.steps.json` when the input ends with `.ndjson`, otherwise `<input>.steps.json`
- `record start` builder timeout is `10000`
- `record stop` builder timeout is `15000`
- `recording export` defaults to `--snapshots omit`
- if `recording export --input` points at a file and `--out` is omitted, the output path is `<input without .ndjson>.export.json` when the input ends with `.ndjson`, otherwise `<input>.export.json`
- if `recording export --input` points at a directory, the command picks the newest `*.ndjson` file in that directory and derives the default export path from that resolved file
Recommended pre-recording reset:

- ask which target app or apps the user intends to record
- close those apps through Androperator before `recording start`
- do not rely on the user manually swiping apps away unless the workflow makes
  that explicit
- for a single app reset, prefer the flat CLI:
  `androperator close --app <application_id> --device <device_id> --operator-package <operator_package>`
- for multiple app resets, use a small `androperator exec` with one or more
  `close_app` actions before you start recording
- the underlying API action is `close_app`, which Node executes as an adb
  `am force-stop` pre-flight and normalizes to a successful close only when
  that force-stop actually succeeded

Recommended recording-count stance:

- default to one recording for a first pass
- recommend a second recording when the first pass looks exploratory,
  state-dependent, or unusually sparse
- use a third recording only when the flow is especially flaky or divergent
- do not silently average multiple recordings; explain what the extra pass is
  meant to confirm

## CLI Commands

<a id="command-recording-start"></a>
### Start

```bash
androperator record start [--session-id <id>] [--device <serial>] [--operator-package <pkg>]
```

Current builder payload:

```json
{
  "commandId": "start_recording_1700000000000",
  "taskId": "cli-record-start",
  "source": "androperator-cli",
  "timeoutMs": 10000,
  "expectedFormat": "android-ui-automator",
  "actions": [
    {
      "id": "a1",
      "type": "start_recording",
      "params": {
        "sessionId": "optional-session-id"
      }
    }
  ]
}
```

Exact builder literals:

- `taskId: "cli-record-start"`
- `source: "androperator-cli"`
- `timeoutMs: 10000`
- action id: `a1`

Verification:

```bash
androperator record start --session-id demo-session --device <device_serial>
```

Expected success wrapper shape:

```json
{
  "envelope": {
    "status": "success",
    "stepResults": [
      {
        "actionType": "start_recording",
        "success": true,
        "data": {
          "sessionId": "demo-session",
          "filePath": "/sdcard/Android/data/com.androperator.operator.dev/files/recordings/demo-session.ndjson"
        }
      }
    ]
  },
  "deviceId": "<device_serial>",
  "terminalSource": "androperator_result",
  "isCanonicalTerminal": true
}
```

<a id="command-recording-stop"></a>
### Stop

```bash
androperator record stop [--session-id <id>] [--device <serial>] [--operator-package <pkg>]
```

Current builder payload:

```json
{
  "commandId": "stop_recording_1700000000000",
  "taskId": "cli-record-stop",
  "source": "androperator-cli",
  "timeoutMs": 15000,
  "expectedFormat": "android-ui-automator",
  "actions": [
    {
      "id": "a1",
      "type": "stop_recording",
      "params": {
        "sessionId": "optional-session-id"
      }
    }
  ]
}
```

Exact builder literals:

- `taskId: "cli-record-stop"`
- `source: "androperator-cli"`
- `timeoutMs: 15000`
- action id: `a1`

Verification:

```bash
androperator record stop --session-id demo-session --device <device_serial>
```

Expected success wrapper shape:

```json
{
  "envelope": {
    "status": "success",
    "stepResults": [
      {
        "actionType": "stop_recording",
        "success": true,
        "data": {
          "sessionId": "demo-session",
          "filePath": "/sdcard/Android/data/com.androperator.operator.dev/files/recordings/demo-session.ndjson",
          "eventCount": "17"
        }
      }
    ]
  }
}
```

<a id="command-recording-pull"></a>
### Pull

```bash
androperator record pull [--session-id <id>] [--out <dir>] [--device <serial>] [--operator-package <pkg>]
```

Successful response shape:

```json
{
  "ok": true,
  "localPath": "recordings/demo-session.ndjson",
  "sessionId": "demo-session"
}
```

Exact default:

- if `--out` is omitted, `registry.ts` sets `outputDir` to `./recordings/`

Verification:

```bash
androperator record pull --session-id demo-session --device <device_serial>
```

Check:

- `ok == true`
- `sessionId == "demo-session"`
- `localPath` ends with `/demo-session.ndjson`

<a id="command-recording-parse"></a>
### Parse

```bash
androperator record parse --input <file> [--out <file>]
```

Successful response shape:

```json
{
  "ok": true,
  "outputFile": "./recordings/demo-session.steps.json",
  "stepCount": 2,
  "warnings": [
    "seq 3: scroll event dropped (not extracted in v1)"
  ]
}
```

Exact default output-file rule from `cmdRecordParse()`:

- if input ends with `.ndjson`, output is `<input without .ndjson>.steps.json`
- otherwise output is `<input>.steps.json`

Verification:

```bash
androperator record parse --input ./recordings/demo-session.ndjson
```

Check:

- `ok == true`
- `outputFile == "./recordings/demo-session.steps.json"`
- `stepCount` matches the parsed `steps.length`
- `stdout` contains the JSON result, while `stderr` also receives a human-readable step summary from `printStepSummary()`

<a id="command-recording-export"></a>
### Export

```bash
androperator recording export --input <file|directory> [--out <file>] [--snapshots <omit|include>] [--output <json|pretty>]
androperator record export --input <file|directory> [--out <file>] [--snapshots <omit|include>] [--output <json|pretty>]
```

What the command does:

- reads a local NDJSON recording file
- validates it with the shared recording validator
- preserves every supported raw event type in a richer JSON artifact
- writes the export to disk
- returns a compact success wrapper with the export path and summary counts
- does not derive skills, selectors, parameters, or plans

Snapshot mode:

- `omit` is the default
- `include` preserves the raw XML string in `snapshot.xml`
- both modes always preserve `snapshot.present`
- `omit` is usually the right authoring default because it preserves event evidence without embedding the raw XML snapshots
- `include` is better when an external agent or human needs the full hierarchy snapshots for detailed manual review

Output-path rule:

- if `--out` is omitted and the input is a file ending with `.ndjson`, the output path is `<input without .ndjson>.export.json`
- if `--out` is omitted and the input is a file without a trailing `.ndjson`, the output path is `<input>.export.json`
- if `--out` is omitted and the input is a directory, the command first resolves the newest `*.ndjson` file in that directory and then applies the same default-path rule to that resolved file
- if `--out` is provided, that path is used as-is

Success wrapper shape:

```json
{
  "ok": true,
  "outputFile": "./recordings/demo-session.export.json",
  "sessionId": "demo-session",
  "eventCount": 5,
  "packageTransitionCount": 2,
  "byType": {
    "window_change": 1,
    "click": 1,
    "scroll": 1,
    "press_key": 1,
    "text_change": 1
  }
}
```

Verification:

```bash
androperator recording export --input ./recordings/export-demo.ndjson
```

Check:

- `ok == true`
- `outputFile` ends with `.export.json`
- `eventCount` matches `counts.totalEvents` inside the written file
- `packageTransitionCount` matches the number of computed package transitions
- `byType` matches the event-type counts inside the written file

Practical size tradeoff:

- on a real small emulator capture, an export written with `--snapshots omit` was about `2 KB`
- the same recording written with `--snapshots include` was about `165 KB`
- the raw pulled NDJSON was about `164 KB`

This is why `omit` is the default for agent-context export.

Export file contract:

```json
{
  "exportVersion": 1,
  "session": {
    "sessionId": "demo-session",
    "schemaVersion": 1,
    "startedAt": 1710000000000,
    "operatorPackage": "com.androperator.operator.dev"
  },
  "snapshotMode": "omit",
  "events": [
    {
      "seq": 0,
      "ts": 1710000000000,
      "deltaMsSincePrevious": null,
      "type": "window_change",
      "packageName": "com.android.settings",
      "className": "com.android.settings.Settings",
      "title": "Settings",
      "snapshot": {
        "present": true,
        "xml": null
      }
    }
  ],
  "counts": {
    "totalEvents": 1,
    "byType": {
      "window_change": 1
    }
  },
  "packageTransitions": [],
  "timeline": {
    "firstEventTs": 1710000000000,
    "lastEventTs": 1710000000000,
    "durationMs": 0
  }
}
```

Exported event types:

| Type | Preserved fields |
| --- | --- |
| `window_change` | `seq`, `ts`, `deltaMsSincePrevious`, `type`, `packageName`, `className`, `title`, `snapshot` |
| `click` | `seq`, `ts`, `deltaMsSincePrevious`, `type`, `packageName`, `resourceId`, `text`, `contentDesc`, `bounds`, `snapshot` |
| `scroll` | `seq`, `ts`, `deltaMsSincePrevious`, `type`, `packageName`, `resourceId`, `scrollX`, `scrollY`, `maxScrollX`, `maxScrollY`, `snapshot` |
| `press_key` | `seq`, `ts`, `deltaMsSincePrevious`, `type`, `key`, `snapshot` |
| `text_change` | `seq`, `ts`, `deltaMsSincePrevious`, `type`, `packageName`, `resourceId`, `text`, `snapshot` |

## NDJSON Format

A recording file is newline-delimited JSON with:

1. one header line
2. zero or more event lines

The first non-empty line must be a `recording_header`.

Verification pattern - minimum valid file skeleton:

```json
{"type":"recording_header","schemaVersion":1,"sessionId":"demo-session","startedAt":1710000000000,"operatorPackage":"com.androperator.operator.dev"}
{"ts":1710000000001,"seq":0,"type":"window_change","packageName":"com.android.settings","className":"com.android.settings.Settings","title":"Settings","snapshot":"<hierarchy .../>"}
```

### Header Line

Current header schema:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `"recording_header"` | fixed discriminator |
| `schemaVersion` | `number` | current parser supports only `1` |
| `sessionId` | `string` | recording id |
| `startedAt` | `number` | epoch milliseconds |
| `operatorPackage` | `string` | Operator package that produced the recording |

Example:

```json
{"type":"recording_header","schemaVersion":1,"sessionId":"demo-session","startedAt":1710000000000,"operatorPackage":"com.androperator.operator.dev"}
```

### Event Types

Current raw event union:

- `window_change`
- `click`
- `scroll`
- `press_key`
- `text_change`

Every event must include:

- `ts`
- `seq`
- `type`

### `window_change`

| Field | Type |
| --- | --- |
| `ts` | `number` |
| `seq` | `number` |
| `type` | `"window_change"` |
| `packageName` | `string` |
| `className` | `string \| null` |
| `title` | `string \| null` |
| `snapshot` | `string \| null \| undefined` |

Example:

```json
{"ts":1710000000000,"seq":0,"type":"window_change","packageName":"com.android.settings","className":"com.android.settings.Settings","title":"Settings","snapshot":"<hierarchy .../>"}
```

### `click`

| Field | Type |
| --- | --- |
| `ts` | `number` |
| `seq` | `number` |
| `type` | `"click"` |
| `packageName` | `string` |
| `resourceId` | `string \| null` |
| `text` | `string \| null` |
| `contentDesc` | `string \| null` |
| `bounds.left` | `number` |
| `bounds.top` | `number` |
| `bounds.right` | `number` |
| `bounds.bottom` | `number` |
| `snapshot` | `string \| null \| undefined` |

Example:

```json
{"ts":1710000000800,"seq":1,"type":"click","packageName":"com.android.settings","resourceId":"android:id/title","text":"Connected devices","contentDesc":null,"bounds":{"left":216,"top":1503,"right":661,"bottom":1573},"snapshot":"<hierarchy .../>"}
```

### `scroll`

| Field | Type |
| --- | --- |
| `ts` | `number` |
| `seq` | `number` |
| `type` | `"scroll"` |
| `packageName` | `string` |
| `resourceId` | `string \| null` |
| `scrollX` | `number` |
| `scrollY` | `number` |
| `maxScrollX` | `number` |
| `maxScrollY` | `number` |
| `snapshot` | `string \| null \| undefined` |

### `press_key`

| Field | Type |
| --- | --- |
| `ts` | `number` |
| `seq` | `number` |
| `type` | `"press_key"` |
| `key` | `"back"` |
| `snapshot` | `string \| null \| undefined` |

Important:

- the current schema only allows `key: "back"`
- any other `key` value causes `RECORDING_PARSE_FAILED`

### `text_change`

| Field | Type |
| --- | --- |
| `ts` | `number` |
| `seq` | `number` |
| `type` | `"text_change"` |
| `packageName` | `string` |
| `resourceId` | `string \| null` |
| `text` | `string` |
| `snapshot` | `string \| null \| undefined` |

## Parse Output Shape

`record parse` does not replay the whole NDJSON one-to-one. It normalizes it into a smaller step log:

```json
{
  "sessionId": "demo-session",
  "schemaVersion": 1,
  "steps": [
    {
      "seq": 0,
      "type": "open_app",
      "packageName": "com.android.settings",
      "uiStateBefore": "<hierarchy .../>"
    },
    {
      "seq": 1,
      "type": "click",
      "packageName": "com.android.settings",
      "resourceId": "android:id/title",
      "text": "Connected devices",
      "contentDesc": null,
      "bounds": {
        "left": 216,
        "top": 1503,
        "right": 661,
        "bottom": 1573
      },
      "uiStateBefore": "<hierarchy .../>"
    }
  ],
  "_warnings": [
    "seq 3: scroll event dropped (not extracted in v1)"
  ]
}
```

Important:

- `parse` is intentionally lossy and step-oriented
- `export` is intentionally evidence-preserving and event-oriented
- the same recording can produce a small parsed step log while the export still contains multiple raw events such as `scroll`, `window_change`, or `text_change`

Current parsed step types:

- `open_app`
- `click`

Current normalization rules in `parseRecording.ts`:

- the first `window_change` becomes one `open_app` step
- every `click` becomes one `click` step
- `scroll` events are dropped and produce warnings
- `text_change` events are dropped silently
- `press_key` events are dropped silently, but they do affect subsequent `window_change` handling

Verification:

```bash
androperator record parse --input ./recordings/demo-session.ndjson
```

Then open the written `.steps.json` file and confirm:

- `schemaVersion == 1`
- `steps[0].type == "open_app"` when the first raw event was `window_change`
- `_warnings` is present only when parser warnings were generated

## Parser Warnings

The parser currently emits warnings for:

- `window_change` or `click` events missing `snapshot`
- dropped `scroll` events

Warnings are written into `_warnings` in the parsed step log and also surfaced by `record parse` in its success wrapper when present.

This is an exact optional-field rule:

- if there are no warnings, `_warnings` is omitted from the parsed JSON
- if there are warnings, `_warnings` is present and `record parse` also copies them into the top-level `warnings` array of its success wrapper

## Pull Semantics

`pullRecording()` determines the session id like this:

1. use `--session-id` if provided
2. otherwise read `/sdcard/Android/data/<operatorPackage>/files/recordings/latest`

Session ids are accepted only if they match:

```text
^[a-zA-Z0-9_-]+$
```

This is the exact safe session-id pattern from `pullRecording.ts`.

The pulled file path is:

```text
/sdcard/Android/data/<operatorPackage>/files/recordings/<sessionId>.ndjson
```

Error cases:

- invalid `--session-id` format: `RECORDING_SESSION_NOT_FOUND`
- no `latest` pointer file or empty pointer file: `RECORDING_SESSION_NOT_FOUND`
- adb pull failure: `RECORDING_PULL_FAILED`

## Error Codes

Only document codes that exist in `apps/node/src/contracts/errors.ts`.

| Code | When it happens |
| --- | --- |
| `RECORDING_ALREADY_IN_PROGRESS` | runtime rejected `record start` because a session is already active |
| `RECORDING_NOT_IN_PROGRESS` | runtime rejected `record stop` because no session is active |
| `RECORDING_SESSION_NOT_FOUND` | `record pull` could not resolve a session id or the provided id was invalid |
| `RECORDING_PULL_FAILED` | adb pull failed |
| `RECORDING_PARSE_FAILED` | malformed file, invalid header, bad event fields, bad NDJSON, or unknown event type |
| `RECORDING_EXPORT_FAILED` | recording export input could not be inspected/read, or the output file could not be written |
| `RECORDING_SCHEMA_VERSION_UNSUPPORTED` | header schema version was not `1` |

Related CLI usage error:

- `record parse` without `--input` returns a top-level `USAGE` object from `registry.ts`, not a `RECORDING_PARSE_FAILED` error code

## Common Failure Modes

### `RECORDING_SESSION_NOT_FOUND`

Typical causes:

- no `latest` file on device
- invalid `--session-id` characters
- trying to pull before a recording was started

Typical failure shape:

```json
{
  "code": "RECORDING_SESSION_NOT_FOUND",
  "message": "No recording session found on device. Start a recording first."
}
```

Recovery:

- run `androperator record start --session-id <id>` before trying to pull
- if you expected the latest pointer to exist, stop the active recording first so the device writes the finished session metadata
- if you passed `--session-id`, confirm it matches `^[a-zA-Z0-9_-]+$`

### `RECORDING_ALREADY_IN_PROGRESS`

Typical cause:

- `record start` was called while the Operator runtime already had an active recording session

Typical failure shape:

```json
{
  "code": "RECORDING_ALREADY_IN_PROGRESS",
  "message": "Recording is already in progress",
  "sessionId": "record-123",
  "filePath": "/storage/emulated/0/Android/data/com.androperator.operator.dev/files/recordings/record-123.ndjson",
  "hint": "Run 'androperator recording stop --session-id record-123 --device <device_serial> --operator-package <package>' before starting a new recording."
}
```

Recovery:

- run `androperator recording stop --session-id <active_session_id> --device <device_serial> --operator-package <package>`
- then pull or parse the finished session before starting a new one
- if your workflow uses explicit session ids, reuse the active session id instead of starting a second overlapping recording
- use the `sessionId` and `filePath` fields in the error payload to target the exact session that is still active
- the CLI also surfaces the same hint inside the failed `start_recording` step and the top-level envelope for easy copy/paste

Verification pattern:

```bash
androperator record stop --device <device_serial>
androperator record pull --device <device_serial>
```

### `RECORDING_NOT_IN_PROGRESS`

Typical cause:

- `record stop` was called when no recording session was active on the device

Typical failure shape:

```json
{
  "code": "RECORDING_NOT_IN_PROGRESS",
  "message": "Recording is not in progress"
}
```

Recovery:

- start a recording first with `androperator record start --session-id <id> --device <device_serial>`
- only call `record stop` after the session has actually started

Verification pattern:

```bash
androperator record start --session-id demo-session --device <device_serial>
androperator record stop --session-id demo-session --device <device_serial>
```

### `RECORDING_PULL_FAILED`

Typical causes:

- adb transport failure during `adb pull`
- disconnected device
- remote recording file missing even though the session id resolved

Typical failure shape:

```json
{
  "code": "RECORDING_PULL_FAILED",
  "message": "Failed to pull recording from device: adb: error: failed to stat remote object '/sdcard/Android/data/com.androperator.operator.dev/files/recordings/demo-session.ndjson': No such file or directory"
}
```

Recovery:

- confirm the device is still visible in `androperator devices`
- rerun `androperator record stop --session-id <id>` if the session may still be open
- retry `record pull` with the exact `--session-id` you just stopped
- if adb itself is failing, fix the transport problem before retrying

Verification pattern:

```bash
androperator devices
androperator record pull --session-id demo-session --device <device_serial>
```

## Runtime Step Errors Outside The Public Node Error Enum

`record start` and `record stop` can also surface Android runtime step errors that are not part of `apps/node/src/contracts/errors.ts`.

Current examples from `RecordingManager.kt` and `UiActionEngine.kt`:

- `RECORDING_STORAGE_UNAVAILABLE`
- `RECORDING_START_FAILED`
- `RECORDING_STOP_FAILED`

These values appear inside `envelope.stepResults[].data.error`, not as top-level Node `code` values.

Branching rule:

- top-level `code` is the public Node error contract documented in `contracts/errors.ts`
- `stepResults[].data.error` may also contain Android runtime-specific strings that are useful for recovery but are not part of the public top-level enum

Typical recovery:

- `RECORDING_STORAGE_UNAVAILABLE`: verify the Operator app can access its external files directory, then retry `record start`
- `RECORDING_START_FAILED`: check the supplied `sessionId` and retry with a safe id matching `^[a-zA-Z0-9_-]+$`
- `RECORDING_STOP_FAILED`: retry `record stop`, then inspect device state if finalization keeps timing out

### `RECORDING_PARSE_FAILED`

Typical causes:

- empty file
- missing header
- malformed JSON on any line
- event object missing required fields
- unsupported event `type`

Typical failure shape:

```json
{
  "code": "RECORDING_PARSE_FAILED",
  "message": "Malformed NDJSON at line 3"
}
```

### `RECORDING_SCHEMA_VERSION_UNSUPPORTED`

The parser is strict:

- only `schemaVersion: 1` is accepted

Agents should branch on this code and stop rather than trying to guess how to parse a newer schema.

Typical failure shape:

```json
{
  "code": "RECORDING_SCHEMA_VERSION_UNSUPPORTED",
  "message": "Unsupported recording schema version: 2"
}
```

## What Agents Should Rely On

- raw recording files are NDJSON, header first
- `record parse` currently extracts only `open_app` and `click` steps
- warnings are significant because they explain dropped or degraded data
- use parsed output as a deterministic summary, not as a promise that every raw event was preserved
- verify recording state with the returned JSON wrappers instead of assuming `record start` or `record stop` worked from exit code alone

## Related Pages

- [API Overview](overview.md)
- [Errors](errors.md)
- [Serve API](serve.md)
- [Skills Authoring](../skills/authoring.md)
