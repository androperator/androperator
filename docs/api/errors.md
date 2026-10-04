# Errors

## Purpose

Document the public error-code contract, show where failures appear in CLI
output versus [result envelopes](overview.md#result-envelope), and give
concrete recovery steps for the most common host, validation, and runtime
failures.

## Sources

- Public error-code enum: `apps/node/src/contracts/errors.ts`
- Result envelope shape: `apps/node/src/contracts/result.ts`
- Execution validation: `apps/node/src/domain/executions/validateExecution.ts`
- CLI formatting: `apps/node/src/cli/output.ts`

## Runtime action diagnostics

Prefer top-level `errorCode`, then failed-step `data.errorCode`. For older or
returned-step failures, `data.error` can still contain the code. Thrown failures
preserve the original message in `data.error` and top-level `error`, the failed
step identity, and preceding steps.

| Code | Meaning |
| --- | --- |
| `UI_TREE_UNAVAILABLE` | An action could not obtain an application hierarchy; inspect `data.diagnostics` for root-independent service/window facts. |
| `SNAPSHOT_HIERARCHY_UNAVAILABLE` | Snapshot hierarchy capture failed; retains this more specific existing snapshot code and adds diagnostics. |
| `WAIT_TIMEOUT` | The node wait's own time budget expired. |
| `ACTION_FAILED` | An otherwise unclassified action exception; the original message is retained. |
| `COMMAND_TIMEOUT` | Android's command budget expired, including queue wait. Collected steps are retained. |
| `COMMAND_CANCELLED` | Execution was cancelled; collected steps are retained and cancellation propagates. |
| `CONTAINER_LOST` | The original scroll container disappeared or could no longer be identified during a bounded search. |

Existing selector, gesture, and `ON_SCREEN_LOG_*` codes remain available. A
failed returned step still permits subsequent steps to execute; a thrown failure
stops the sequence. [Action receipts](actions.md#action-receipts-and-failure-evidence)
describe dispatch evidence, not a verified application outcome. Do not replay an
uncertain mutation automatically.

## Notification and media controls

See [notifications](notifications.md) for expired keys/actions, non-dismissible
notifications, canceled PendingIntents, unsupported input/authentication and
listener access/query failures. See [media seeking](media.md#seeking) for invalid
or out-of-range positions, unsupported controls, expired/ambiguous sessions and
postcondition timeouts. These controls retain dispatch evidence on failed waits
and execution cancellation. A missing receipt remains transport uncertainty;
never infer that an action was not sent or automatically replay it.

## Video dependency failures

Video start returns `HOST_DEPENDENCY_MISSING` when scrcpy, ffmpeg, or ffprobe is
missing, fails to run, or lacks required capture capabilities. Inspect
`details.dependencies` for each executable, reason, and requirement; follow
`hint` to repair the host PATH or installation before retrying. No recorder or
output bundle is created. This is an optional `host.video.dependencies` warning
in doctor, not a failure of normal device readiness. See
[video prerequisites](evidence.md#video-dependencies) for the full error contract.

## Evidence storage failures

`EVIDENCE_STORAGE_UNWRITABLE` means an evidence destination or the fixed host
video lock directory failed a required filesystem operation. CLI/Node and MCP
errors include the absolute `path`, underlying `causeCode` (or null), `message`,
and a `recovery` action. Choose a writable `ANDROPERATOR_EVIDENCE_DIR` and new
output directory, and ensure the host lock directory is accessible. Video
preflight fails before any recorder is spawned; no permission changes or
stale-owner takeover occurs. See [evidence storage configuration](evidence.md#evidence-storage-configuration).

## Two Failure Shapes

Androperator surfaces failures in two main shapes.

### 1. Top-level CLI error object

This appears when Node fails before it can return an execution envelope, for example during argument parsing, payload validation, device selection, or host checks.

Example:

```json
{
  "code": "EXECUTION_VALIDATION_FAILED",
  "message": "open_uri requires params.uri",
  "details": {
    "path": "actions.0.params.uri",
    "actionId": "open-1",
    "actionType": "open_uri"
  }
}
```

Success condition for recovery:

- you change the command or payload
- rerunning no longer returns a top-level `{ "code": ... }` object

### 2. Result envelope failure

This appears when Node successfully sends the command but the execution still fails at dispatch time or during one of the steps.

Per-step example:

```json
{
  "envelope": {
    "commandId": "read-1",
    "taskId": "read-1",
    "status": "failed",
    "error": "Step a1 (read_text) failed: NODE_NOT_FOUND",
    "stepResults": [
      {
        "id": "a1",
        "actionType": "read_text",
        "success": false,
        "data": {
          "error": "NODE_NOT_FOUND",
          "message": "No matching node found"
        }
      }
    ]
  },
  "deviceId": "emulator-5554",
  "terminalSource": "androperator_result",
  "isCanonicalTerminal": true
}
```

Envelope-level example with `errorCode`:

```json
{
  "envelope": {
    "commandId": "snapshot-1",
    "taskId": "snapshot-1",
    "status": "failed",
    "stepResults": [],
    "error": "Accessibility service is not available",
    "errorCode": "SERVICE_UNAVAILABLE",
    "hint": "Accessibility service not running. Run 'androperator doctor --fix --device emulator-5554' to diagnose and repair, or 'androperator operator setup --apk <path-to-apk> --device emulator-5554' to reinstall."
  },
  "deviceId": "emulator-5554",
  "terminalSource": "androperator_result",
  "isCanonicalTerminal": true
}
```

Success condition for recovery:

- `envelope.status == "success"`
- every `stepResults[i].success == true`

## Public Error Codes

Only the codes defined in `apps/node/src/contracts/errors.ts` are part of the public error-code contract documented on this page.

<!-- CODE-DERIVED: error-codes -->

## Fast Triage

1. If the output is a top-level object with `code`, treat it as a Node-side failure before or outside the Android result envelope.
2. If `envelope.status == "failed"` and `stepResults` is empty, treat it as a dispatch, service, or envelope failure.
3. If `envelope.status == "failed"` and one step has `success == false`, branch on the first failed step's `data.error`.
4. Prefer exact codes over string-matching the human-readable `message` or `error`.

## What To Trust

Use these fields in order:

| Situation | Fields to inspect first |
| --- | --- |
| Top-level CLI error object | `code`, then `details`, then `message` |
| Envelope-level runtime failure | `envelope.errorCode`, then `envelope.hint`, then `envelope.error` |
| Per-step action failure | `stepResults[i].data.error`, then `stepResults[i].data.message` |

Notes:

- `errorCode` is optional on the envelope. When it is absent, inspect `error` and the failed step for details.
- envelope `errorCode` may contain Android-emitted values such as `SERVICE_UNAVAILABLE` that are not part of Node's public `errors.ts` enum
- per-step failures do not use the envelope `errorCode`; they usually expose the actionable code in `stepResults[i].data.error`
- Android `StepResult.data` values are strings, including `data.error` and `data.message`. Host-added `data.extractionDiagnostics` is a structured object
- Node post-processing can turn some Android-internal failure markers into success results, for example normalizing `UNSUPPORTED_RUNTIME_CLOSE` into a successful `close_app` step when adb pre-flight already succeeded

## Recovery Patterns

| Family | Typical codes | What to do next |
| --- | --- | --- |
| Device targeting | `NO_DEVICES`, `DEVICE_NOT_FOUND`, `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED` | Run `androperator devices`, pick one device, and retry with `--device <serial>` |
| Interactive readiness | `DEVICE_NOT_INTERACTIVE` | Wake or unlock the target, rerun `androperator doctor`, and confirm the interactive-state check passes |
| Operator setup | `OPERATOR_NOT_INSTALLED`, `OPERATOR_VARIANT_MISMATCH`, `OPERATOR_INSTALL_FAILED`, `OPERATOR_GRANT_FAILED`, `OPERATOR_VERIFY_FAILED` | Install or repair the expected Operator APK, then rerun the command |
| Host tooling | `ADB_NOT_FOUND`, `ADB_SERVER_FAILED`, `HOST_DEPENDENCY_MISSING`, `ANDROID_SDK_TOOL_MISSING`, `SCRCPY_NOT_FOUND` | Repair the host environment before retrying |
| Daemon lifecycle and proxy | `DAEMON_START_FAILED`, `DAEMON_STOP_FAILED`, `DAEMON_PROXY_ERROR` | Inspect the daemon log and metadata files under `~/.androperator/`. For `DAEMON_PROXY_ERROR`, inspect device state before retrying because the action may already have executed |
| Payload or flag validation | `MISSING_ARGUMENT`, `EXECUTION_VALIDATION_FAILED`, `EXECUTION_ACTION_UNSUPPORTED`, `PAYLOAD_TOO_LARGE` | Change the command or payload. Do not retry unchanged |
| Dispatch or service availability | `RESULT_ENVELOPE_TIMEOUT`, `RESULT_ENVELOPE_MALFORMED`, `BROADCAST_FAILED`, `DEVICE_ACCESSIBILITY_NOT_RUNNING`, `DEVICE_SHELL_UNAVAILABLE` | Run `androperator doctor`, repair the reported issue, then retry |
| UI lookup or gesture | `NODE_NOT_FOUND`, `NODE_AMBIGUOUS`, `NODE_NOT_CLICKABLE`, `CONTAINER_NOT_FOUND`, `CONTAINER_AMBIGUOUS`, `CONTAINER_NOT_SCROLLABLE`, `GESTURE_FAILED`, `SECURITY_BLOCK_DETECTED` | Refresh state with `snapshot`, wait for UI readiness, or adjust selectors and scroll strategy |
| Unsupported gesture platform | `GESTURE_UNSUPPORTED` | `drag` requires Android API 26 or newer. Use a supported device; retrying or increasing the timeout cannot enable continued-pointer gestures on an older platform. |
| On-screen log panel | `ON_SCREEN_LOG_SERVICE_UNAVAILABLE`, `ON_SCREEN_LOG_LAYOUT_INVALID`, `ON_SCREEN_LOG_RENDER_FAILED`, `ON_SCREEN_LOG_RENDER_TIMEOUT` | Repair the Operator service or supplied layout, then issue a replacement `set_on_screen_log` or `clear_on_screen_log` action as appropriate. |
| Recording state | `RECORDING_ALREADY_IN_PROGRESS`, `RECORDING_NOT_IN_PROGRESS`, `RECORDING_SESSION_NOT_FOUND`, `RECORDING_PULL_FAILED`, `RECORDING_PARSE_FAILED`, `RECORDING_SCHEMA_VERSION_UNSUPPORTED` | Repair recording state or use the right session before retrying |

## Key Cases

### `EXECUTION_VALIDATION_FAILED`

Use this when the command or payload is structurally wrong before Android execution starts.

Common triggers:

- missing required action fields such as `open_uri.params.uri`
- invalid ranges such as `scroll_until.maxScrolls > 200`
- selector parser violations such as mixing `--selector` with shorthand flags
- invalid JSON payloads for `androperator exec`

Typical output:

```json
{
  "code": "EXECUTION_VALIDATION_FAILED",
  "message": "scroll_until params.maxScrolls must be an integer in [1, 200]",
  "details": {
    "path": "actions.0.params.maxScrolls",
    "actionId": "scroll-1",
    "actionType": "scroll_until"
  }
}
```

Recovery:

- fix the payload
- rerun validation
- do not retry unchanged

### `MISSING_ARGUMENT`

Use this for CLI commands that are missing a required positional argument or required flag value.

Common triggers:

- `exec` without a payload
- `wait-for-nav` without `--timeout`
- `read-value` without any label selector flags

Example:

```json
{
  "code": "MISSING_ARGUMENT",
  "message": "wait-for-nav requires --timeout <ms>."
}
```

Recovery:

- add the missing argument or flag
- rerun the command

### Result transport failures

These errors describe the host's inability to obtain a terminal Android result.
They do not prove that an accepted action failed or that replay is safe.

| Code | Meaning |
| --- | --- |
| `RESULT_TRANSPORT_SPAWN_FAILED` | The result reader process could not start. A missing ADB executable retains `ADB_NOT_FOUND`. |
| `RESULT_TRANSPORT_EXITED` | The reader closed before a complete correlated terminal result. |
| `RESULT_TRANSPORT_CANCELLED` | The host cancelled its result wait. This does not cancel an already dispatched Android action. |
| `RESULT_TRANSPORT_FAILED` | Fallback for an unclassified host transport failure; error prose is never a code. |
| `RESULT_ENVELOPE_MALFORMED` | Correlated framing, chunk metadata, ordering, size, checksum or envelope parsing failed. |

`details` preserves `commandId`, `taskId`, `deviceId`, `operatorPackage`,
`broadcastDispatchStatus`, `dispatchAttempted`, and `executionPosition: "unknown"`.
`dispatchAttempted: true` means the dispatch boundary was entered, not that
Android acknowledged or completed the action. A reader that dies during
preflight prevents the deferred broadcast from dispatching, including the interval
between process exit and output-pipe closure. Already dispatched output is drained
before classifying closure; a complete validated result remains authoritative.
Draining keeps the existing result deadline, or starts the configured wait budget
at exit if dispatch never began. If output pipes remain open at that deadline,
`RESULT_TRANSPORT_EXITED` includes `outputDrainIncomplete: true`, the observed
exit status and collected diagnostics; the host closes its remaining pipe handles.

`stdoutObserved` reports whether any reader stdout bytes arrived, including
bytes first received after broadcast dispatch. It does not prove receipt of a
terminal result; use the correlated events and chunk diagnostics separately.

`details.reader` adds a metadata-only lifecycle snapshot: host/reader PIDs,
wall-clock `startedAt`, monotonic elapsed times, `stdoutBytes`, `stderrBytes`,
`lastStdoutElapsedMs`, `lastStderrElapsedMs`, and at most 32 events with a `droppedEvents` count. Missing
reader PID or stream output time is `null`. Events distinguish dispatch,
process exit/close, settlement and cleanup requests; a cleanup request is not
proof that a signal was delivered. No stdout/stderr contents or UI payloads
are added to this timeline.

A failed reader emits `result_reader.failure` through the existing host logger
at warning level, with command/task/device correlation and the snapshot in its
JSON `message`. Later process events emit `result_reader.exit` and
`result_reader.close` at warning level for failed waits and debug level for
successful waits. The returned snapshot is taken at settlement; later logger
records can therefore contain exit/close evidence it lacks. Existing log-level
and file-routing settings apply. The reader does not wait longer for logging.

Process failures include `exitCode` and `signal` when known, or
`processErrorCode` and `originalMessage` for spawn errors. Diagnostics retain a
stderr tail of at most 8,192 characters and bounded correlated log lines.
Partial chunk diagnostics
report received/expected chunks and bytes; incomplete chunks are not action
receipts. MCP preserves classification and correlation while applying its
existing raw-stderr redaction.

CLI execution failures exit nonzero. Serve returns a non-success HTTP status
and the same structured execution failure; daemon routing does not retry an
uncertain dispatch. SSE subscribers must consume `androperator:execution` for
host failures. Such failures no longer synthesize a `androperator:result`
terminal Android envelope. Inspect observed application state before deciding
whether another mutation is appropriate.

### `RESULT_ENVELOPE_TIMEOUT`

Use this when Node dispatched the command but did not receive a valid `[Androperator-Result]` envelope before the execution timeout expired.

Typical fields:

```json
{
  "code": "RESULT_ENVELOPE_TIMEOUT",
  "message": "Timed out waiting for [Androperator-Result]",
  "details": {
    "commandId": "snapshot-1",
    "taskId": "snapshot-1",
    "lastActionId": "a1",
    "lastActionType": "snapshot",
    "lastActionCaveat": "payload-last only; Android execution position is unknown",
    "elapsedMs": 30000,
    "timeoutMs": 30000
  },
  "hint": "No correlated Android log lines were captured. This often indicates an APK/CLI version mismatch or an accessibility service issue. Run 'androperator doctor --device emulator-5554 --operator-package com.androperator.operator.dev' to diagnose."
}
```

Recovery:

- run `androperator doctor`
- if `hint` mentions no correlated Android log lines, treat it as a compatibility or accessibility diagnostic path rather than a generic retry
- confirm the accessibility service and operator package are healthy
- increase timeout only if the action legitimately needs more wall-clock time

### On-screen log panel failures

Malformed templates, unknown placeholders, and both or neither of `text` and
`template` produce `EXECUTION_VALIDATION_FAILED` before dispatch. Unavailable
application metadata uses the documented fallback values, not an execution
failure. Refresh failures after initial acknowledgement hide the panel without
emitting a second execution result. See [live templates](on-screen-logs.md#live-templates).

The on-screen log actions can return these exact per-step failure codes. When
one of these codes is the first failed step, Node also copies it to
`envelope.errorCode` during result reconciliation. The
[`on-screen-log set` and `clear` commands](on-screen-logs.md#cli-commands)
return the same execution errors. CLI syntax failures use structured `USAGE`
errors; canonical panel validation uses `EXECUTION_VALIDATION_FAILED`.
Neither command replays a mutation after an uncertain daemon dispatch.

| Code | Meaning | Recovery |
| --- | --- | --- |
| `ON_SCREEN_LOG_SERVICE_UNAVAILABLE` | The Operator-owned panel controller is not available. | Repair or restart the expected Operator accessibility service, then rerun the action. |
| `ON_SCREEN_LOG_LAYOUT_INVALID` | Android rejected the resolved panel geometry or layout. | Inspect the requested offsets and width. Retry with an in-range replacement payload. |
| `ON_SCREEN_LOG_RENDER_FAILED` | The controller could not install or replace the panel. | Retry with a replacement `set_on_screen_log` payload after confirming the service is healthy. |
| `ON_SCREEN_LOG_RENDER_TIMEOUT` | Android did not acknowledge a draw before the controller deadline. | Treat visibility as unconfirmed. Inspect a new `snapshot` and retry only if needed. |

`rendered: "true"` means Android acknowledged a panel draw. It does not prove
that a later compositor capture, screenshot, or external screen recorder will
include the panel.

### `OPERATOR_NOT_INSTALLED`

Execution reports this only after successful package queries establish absence of
both the requested Operator package and its alternate variant. The error includes
an installation command. A failed query does not establish absence.

Typical recovery:

```bash
androperator operator setup --apk <path-to-apk> --device <device_serial> --operator-package <package_name>
```

If you are doing local branch validation, prefer the debug package:

- `com.androperator.operator.dev`

### `DEVICE_SHELL_UNAVAILABLE`

When an installed-package query fails, execution preserves this code and the
readiness check's summary, detail and evidence (queried package and exit code,
when available). It does not recommend installation. Inspect the device shell
failure and run `androperator doctor` before retrying.

Package-presence failures in direct execution and daemon responses retain
`phase=readiness`, `dispatchState=not_dispatched`, command/task correlation and
logging diagnostics. Logs use `preflight.apk.failed` for query failures and
variant mismatches; `preflight.apk.missing` is reserved for confirmed absence.

### `OPERATOR_VARIANT_MISMATCH`

Execution preserves this code and the check's variant-selection guidance in
`error.details.fix`. Doctor reports this as a failed selected-package check, skips the handshake, and
returns false readiness. It never switches packages implicitly.

Use this when the device has an installed Operator APK, but it is the other known package variant than the one requested.

Recovery options:

- pass the installed package via `--operator-package`
- or reinstall the intended APK variant

### `LOG_DIRECTORY_UNWRITABLE`

Doctor could not create or open the resolved daily log destination. Inspect
`host.logs.writable.evidence` for `logDir`, `logPath`, and `writable=false`.
Set `ANDROPERATOR_LOG_DIR` to a writable directory. This is advisory and does not
fail otherwise healthy device readiness. See [Logging](logging.md).

### `BROADCAST_FAILED`

Use this when Node could not dispatch the execution payload broadcast to the
selected Operator package.

Common triggers:

- wrong `--operator-package` for the installed APK variant
- device shell transport failure
- the Operator package is missing or not reachable through Android broadcast
  delivery

Recovery:

- run `androperator doctor --device <serial> --operator-package <package>`
- verify package presence and variant compatibility
- rerun the failing command only after doctor reports the target ready

### `PAYLOAD_TOO_LARGE`

Use this when a CLI, Serve, or execution payload exceeds a configured size
limit before dispatch. Android also returns this code in a failed `query_ui`
step when serialized UTF-8 `data.query` exceeds 256 KiB. The query result is not
partially serialized or cut to fit.

Recovery:

- for `query_ui`, lower `limit` or narrow `matcher`
- split long action lists into smaller executions
- move large inline data into files or skill artifacts where the command
  supports that pattern
- for Serve requests, keep the JSON body under the documented `100kb` limit

### `DEVICE_NOT_INTERACTIVE`

Current shipped surface:

- the doctor check `readiness.device.interactive`
- direct execution preflight before dispatch
- high-level skill-wrapper pre-spawn checks in:

Meaning:

- the target device is not currently ready for interactive automation
- the doctor check reports structured evidence telling you why:
  - `screenOn`
  - `deviceLocked`
  - `userUnlocked`
- execution and skill-wrapper failures use a generic top-level error message rather
  than exposing lock-state evidence on the public execution surface
- direct execution and high-level skill wrappers may make a bounded host-side
  wake attempt first when the screen is off
- if the device remains asleep, is still locked, or still requires post-boot
  unlock, the runtime returns this error instead of proceeding

Typical recovery:

- wake the device if `screenOn == false`
- unlock the device if `deviceLocked == true`
- complete the post-boot unlock if `userUnlocked == false`
- rerun `androperator doctor` and require
  `readiness.device.interactive.status == "pass"`

### `NODE_AMBIGUOUS` and `CONTAINER_AMBIGUOUS`

A strict action resolved multiple targets or containers. The runtime stops before
the next dispatch and does not retry ambiguity. The failed step has `data.error`
set to the code, `data.candidate_count` as a decimal string, and `data.candidates`
as serialized query-result JSON containing at most 10 node summaries. Candidate
strings are capped at 512 characters. Prior completed steps are retained and later
steps are skipped. A search may already have performed earlier scroll gestures.

Inspect the candidates with `query`, narrow the matcher or container (including
relational predicates), and submit a new action only after deciding which node is
intended. See [strict action selection](selectors.md#strict-action-selection).

### `NODE_NOT_FOUND`

This usually appears as a per-step failure in `stepResults[i].data.error`, not as the top-level CLI `code`.

Common triggers:

- the selector never matched
- the app navigated somewhere unexpected
- the UI had not settled before the action ran
- the target was inside a different scroll container

Recovery:

- run `snapshot` or `read` to inspect current UI state
- add `wait` or `sleep` before the failing action when appropriate
- tighten or loosen the selector based on what the snapshot actually shows
- add a container selector or a scroll step if the target is off-screen

### `DEVICE_ACCESSIBILITY_NOT_RUNNING`

This is a doctor- and readiness-related failure indicating the Operator accessibility service is not active.

Recovery:

- run `androperator doctor --fix --device <serial>`
- if needed, reinstall the Operator package and re-enable accessibility access

## Legacy CLI Usage Objects

Some CLI handlers and tests still emit usage-style objects with string codes that are not part of `apps/node/src/contracts/errors.ts`. Treat those as command-line usage failures, not as public stable error codes.

What this means for agents:

- if the code is in `errors.ts`, you can branch on it as part of the public contract
- if the code is not in `errors.ts`, treat it as a CLI-specific usage object and prefer fixing the command shape rather than building long-term logic around that string
- similarly, Android may emit envelope `errorCode` values outside the Node enum; branch on them when present in the envelope, but do not confuse them with the documented Node-side top-level `code` contract

## Related Pages

- [API Overview](overview.md)
- [Actions](actions.md)
- [Selectors](selectors.md)
- [Setup](../setup.md)
- [Devices](devices.md)
- [Doctor](doctor.md)
- [Androperator Operator App Troubleshooting](../troubleshooting/operator.md)

### Query hierarchy unavailable

`UI_TREE_UNAVAILABLE` is a failed `query_ui` capture, not a successful query with
zero matches. The envelope and failed step carry the code; completed steps are
preserved and subsequent actions do not run. Inspect the failed step's serialized
`diagnostics` for service availability, the missing root, and available window
facts. Unknown facts remain `null`. See [query_ui](actions.md#action-query-ui).

The Operator requests access to Android-marked sensitive hierarchies, but an
application can still have no accessible root. If the accessibility service is
unavailable, follow [setup](../setup.md#sensitive-hierarchy-access) to enable it.
A visible screenshot does not guarantee an accessible hierarchy. Do not infer
that another window is the requested application or repeatedly retry a
persistently unavailable screen.

## Execution failure evidence

Host execution errors add evidence in `details` without fabricating an Operator
result envelope. Command/task correlation and the `[Androperator-Result]` wire
format remain compatible. When a received envelope fails host snapshot extraction
or screenshot capture, Node adds the same evidence as `envelope.failureEvidence`;
the affected step also retains its string-valued `failurePhase` and `dispatchState`.
Successful envelopes do not gain this field.

| Field | Meaning |
| --- | --- |
| `phase` | `readiness` (validation, preflight, or probe), `dispatch` (requested broadcast), `result_wait` (waiting for a result), or `post_processing` (processing received evidence) |
| `commandId`, `taskId` | Requested execution identifiers, when validated and allocated |
| `dispatchState` | `not_dispatched`, `dispatched`, or `unknown` for requested work |
| `probeCommandId`, `probeTaskId` | Separate readiness probe identifiers, when allocated; `probeDispatchState` distinguishes whether dispatch occurred |
| `probeDispatchState` | The same three-state vocabulary for the probe |
| `earlierEffects` | Confirmed host effects, currently `{ actionId, effect: "force_stop" }` |
| `startedAt`, `completedAt` | Host ISO timestamps for the operation reporting the failure |
| `dispatchStartedAt` | Requested broadcast attempt timestamp, when attempted |
| `probeStartedAt`, `probeCompletedAt` | Probe timestamps |
| `logPath` | Local diagnostic log reference, when logging is available |
| `transport` | Retained bounded probe transport diagnostics, when available |
| `wakeAttempts` | Attempted wake methods and their transport exit codes |

`dispatched` means the broadcast was acknowledged or a correlated terminal result
arrived. It does not by itself establish action success or the desired app state.
`unknown` means the caller lacks conclusive requested-command dispatch evidence.
`not_dispatched` does not mean safe to retry: host `close_app` preflight may already
have force-stopped an app, and readiness may have attempted to wake the device.
After uncertain mutation results, observe and verify state before repeating them.
CLI JSON, HTTP execution responses, daemon parsing, skill-result envelopes, and
execution events preserve these fields. MCP preserves correlation and evidence while continuing to omit
local paths, raw stdout/stderr, and other sensitive diagnostic keys. Use command
and probe IDs to locate logs when a path is omitted.

Readiness wrappers retain the final probe's evidence rather than substituting the
requested command's identity. This includes successful probes that leave the
device asleep or locked: `DEVICE_NOT_INTERACTIVE` preserves probe correlation
and attempted wake methods while omitting the internal state booleans. A successful
fresh probe is also retained if requested dispatch, result waiting, or host
post-processing subsequently fails. A readiness cache hit does not invent a new
probe or relabel an old probe as belonging to this execution. Existing failures
and validation errors retain their codes.

`earlierEffects` lists confirmed successful force-stops, including those preceding
a later preflight exception. It is not a complete side-effect audit: an
unacknowledged force-stop can itself have taken effect. Missing effects or probe
fields mean no such evidence was retained, not proof that no effects occurred.

A lost daemon response reports `DAEMON_PROXY_ERROR`, `phase: "result_wait"`, and
`dispatchState: "unknown"`. This phase describes the caller waiting for the daemon;
the daemon's internal phase, probe identity, and earlier effects are unknown.
Sending an HTTP request does not prove that the Android command was dispatched.
Snapshot presentation or artifact-write errors report `post_processing` in
`details` and retain the real envelope. Their timestamps cover presentation, not
the earlier execution, and they do not reconstruct unavailable preflight evidence.

Snapshot extraction failures carry string-valued `failurePhase: "post_processing"`
and `dispatchState: "dispatched"` on the affected step. Inspect the actual failed
step and retained evidence rather than assuming the Android action itself failed.


### Snapshot source failure diagnostics

`SNAPSHOT_EXTRACTION_FAILED` retains exit code 1 and the existing extraction
reasons. Failed source steps omit `data.text` and add safe structured
`data.extractionDiagnostics`; received envelopes carry
`diagnostics.logging`. Pre-envelope host errors carry `diagnostics.logging`
on the error itself. Logging failures remain secondary, including for a successful
device operation. See [snapshot diagnostics and recovery](snapshot.md#extraction-diagnostics-and-recovery)
for exact fields, bounds, unavailable values, and artifact guarantees. Inspect
earlier effects and separate probe identity before deciding on recovery; malformed
XML alone does not establish a transport, serializer, or compatibility cause.
