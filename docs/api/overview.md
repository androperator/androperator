# API Overview

## Purpose

Define the smallest end-to-end contract an agent needs to use Androperator correctly: the execution payload, the CLI success wrapper, the `[Androperator-Result]` envelope, and the exact fields to branch on.

## What Androperator Is

Androperator is a deterministic Android actuator. The agent is the planner. Androperator accepts an explicit execution payload, validates it, resolves one target device and Operator package, dispatches the actions, and returns a structured result.

This page is intentionally narrow:

- Use [Actions](actions.md) for action-by-action parameter semantics
- Use [Selectors](selectors.md) for `NodeMatcher` and selector flags
- Use [Errors](errors.md) for exact error codes and recovery
- Use [Devices](devices.md) for target selection rules
- Use [Daemon](daemon.md) for background daemon lifecycle commands
- Use [Rendering verification](evidence.md#optional-post-action-rendering-verification-node) for opt-in Node checks of semantic evidence and screenshot pixels after an action

## Surface Terminology

Androperator exposes several public surfaces. Use the precise surface name when
you document, call, or parse behavior:

| Surface | What it is | Canonical owner |
| --- | --- | --- |
| CLI command | A top-level shell command such as `snapshot`, `click`, or `recording`. | [CLI Reference](cli.md) for command lookup; behavior lives on the linked owner page. |
| CLI subcommand | A nested shell command such as `recording export` or `emulator provision`. | The subsystem page, such as [Recording](recording.md). |
| Execution action | A JSON action inside `ExecutionInput.actions[]`, such as `click` or `open_app`. | [Actions](actions.md). |
| Node contract | A TypeScript-backed data shape accepted or returned by the Node package. | This page for execution payload and [result envelope](#result-envelope); feature pages for narrower contracts. |
| Serve endpoint | An HTTP or SSE route exposed by `androperator serve`, such as `POST /execute`. | [Serve API](serve.md). |
| MCP tool | A stdio MCP tool exposed by `androperator mcp serve`, such as `snapshot` or `execute`. | [MCP Server](mcp.md). |
| Selector | A `NodeMatcher` object or CLI selector flags used to find UI nodes. | [Selectors](selectors.md). |
| Error code | A stable Node-side code from `apps/node/src/contracts/errors.ts`, or a documented feature-specific code. | [Errors](errors.md) for Node codes; feature pages for feature-specific codes. |
| Result envelope | The `[Androperator-Result]` terminal envelope emitted by the Operator and wrapped by Node. | [Result Envelope](#result-envelope). |

## CLI Output Format

CLI commands return JSON by default. Agents should parse stdout directly with
`JSON.parse()` unless they intentionally requested `--output pretty` for a
human-readable rendering.

Accepted output-format forms:

| Form | Behavior |
| --- | --- |
| no output flag | JSON output |
| `--output json` | preferred explicit JSON output |
| `--format json` | alias for `--output json` |
| `--json` | alias for `--output json` |
| `--output pretty` | pretty-printed human-readable output |

## Readiness Gate

Before treating a target as ready for interactive automation, use
[Doctor](doctor.md) and require:

- exit code `0`
- `criticalOk == true`
- `readiness.device.interactive.status == "pass"`

That doctor check exposes structured evidence:

- `deviceLocked`
- `screenOn`
- `userUnlocked`

If doctor reports `DEVICE_NOT_INTERACTIVE`, recover the device state first and
rerun doctor before moving on to execution commands.

<a id="execution-payload"></a>

## Execution Payload

Authoritative source: `apps/node/src/contracts/execution.ts`

Top-level execution fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `commandId` | `string` | Caller-generated correlation id for the whole run. |
| `taskId` | `string` | Caller-generated task id. |
| `source` | `string` | Caller label, such as `serve-api` or `androperator-action`. |
| `expectedFormat` | `"android-ui-automator"` | Required constant. |
| `timeoutMs` | `number` | Execution-level timeout for the whole payload. Current Node limits require `1000 <= timeoutMs <= 120000`. |
| `actions` | `ExecutionAction[]` | Ordered action list. |
| `mode` | `"direct"` | Optional runtime mode marker. |

Each action has:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Step correlation id. |
| `type` | `string` | Canonical action type such as `click` or `snapshot`. |
| `params` | `ActionParams` | Optional action-specific parameters. |

Minimum valid payload example:

```json
{
  "commandId": "cmd-001",
  "taskId": "task-001",
  "source": "agent-loop",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    {
      "id": "snap-1",
      "type": "snapshot"
    }
  ],
  "mode": "direct"
}
```

Success conditions for a valid payload before dispatch:

- `expectedFormat` is exactly `"android-ui-automator"`
- `timeoutMs` is between `1000` and `120000` milliseconds
- `actions` is non-empty
- every `actions[i].type` is a supported canonical action type after alias
  normalization; the only accepted on-screen log aliases are exact lower-case
  `on_screen_log_set` and `on_screen_log_clear`
- on a live execution path, `commandId` and `taskId` are echoed back in the result envelope for correlation

## Input Normalization

Stored payloads should use canonical field names and canonical action types. On input, Node normalizes a small alias set before schema validation.

Accepted top-level execution key aliases:

| Alias | Canonical field |
| --- | --- |
| `command_id` | `commandId` |
| `task_id` | `taskId` |
| `expected_format` | `expectedFormat` |
| `timeout_ms` | `timeoutMs` |

For action-type aliases and parameter aliases such as `package` ->
`applicationId`, `url` -> `uri`, and `selector` -> `matcher`, use
[Actions](actions.md). The Node input boundary accepts exact lower-case
`on_screen_log_set` and `on_screen_log_clear` aliases for the canonical
on-screen log action types, but does not accept case or whitespace variants or
parameter aliases for those actions. For raw matcher-field aliases such as
`resource_id` and `content_desc`, use [Selectors](selectors.md).

Verification pattern:

```bash
androperator exec --validate-only --payload '{"command_id":"cmd-001","task_id":"task-001","source":"docs","expected_format":"android-ui-automator","timeout_ms":30000,"actions":[{"id":"snap-1","type":"snapshot"}]}'
```

Success condition:

- exit code `0`
- top-level `ok == true`
- `execution.commandId == "cmd-001"`
- `execution.taskId == "task-001"`
- `execution.expectedFormat == "android-ui-automator"`
- `execution.timeoutMs == 30000`
- `execution.actions[0].type == "snapshot"`

CLI payload-source aliases accepted by `androperator exec`:

- `--payload` is canonical
- `--execution`, `--input`, and `--file` are accepted aliases for the same argument

## Execution Limits

Current Node-side validation limits are:

- at most `50` actions per execution
- at most `64000` serialized payload bytes
- `timeoutMs` must stay in `1000..120000`

If validation fails on limits, shorten the action list, split a large workflow into multiple executions, or avoid embedding oversized inline artifacts in the payload.

<a id="result-envelope"></a>

## Result Envelope

Authoritative source: `apps/node/src/contracts/result.ts`

The Android runtime emits a `[Androperator-Result]` envelope. The Node CLI wraps that envelope in a top-level success object for most device commands:

```json
{
  "envelope": {
    "commandId": "cmd-001",
    "taskId": "task-001",
    "status": "success",
    "stepResults": [
      {
        "id": "snap-1",
        "actionType": "snapshot",
        "success": true,
        "data": {
          "text": "<hierarchy/>"
        }
      }
    ],
    "error": null
  },
  "deviceId": "<device_serial>",
  "terminalSource": "androperator_result",
  "isCanonicalTerminal": true
}
```

Inside that wrapper, the canonical envelope shape is:

```json
{
  "commandId": "<command_id>",
  "taskId": "<task_id>",
  "status": "success",
  "stepResults": [
    {
      "id": "<step_id>",
      "actionType": "<action_type>",
      "success": true,
      "data": {}
    }
  ],
  "error": null,
  "errorCode": null,
  "hint": "<optional_hint>"
}
```

Field meanings:

Stable field anchors:

- <a id="result-envelope-command-id"></a>`commandId`
- <a id="result-envelope-task-id"></a>`taskId`
- <a id="result-envelope-status"></a>`status`
- <a id="result-envelope-step-results"></a>`stepResults`
- <a id="result-envelope-step-results-id"></a>`stepResults[].id`
- <a id="result-envelope-step-results-action-type"></a>`stepResults[].actionType`
- <a id="result-envelope-step-results-success"></a>`stepResults[].success`
- <a id="result-envelope-step-results-data"></a>`stepResults[].data`
- <a id="result-envelope-error"></a>`error`
- <a id="result-envelope-error-code"></a>`errorCode`
- <a id="result-envelope-hint"></a>`hint`

| Field | Meaning |
| --- | --- |
| `status` | Top-level outcome after Node post-processing. `"failed"` means at least one step failed or the runtime returned a top-level failure. |
| `stepResults[].success` | Per-step success bit. |
| `stepResults[].data` | Action-specific fields remain strings. Host-added `extractionDiagnostics` is a bounded structured object; see [snapshot diagnostics](snapshot.md#extraction-diagnostics-and-recovery). |
| `error` | Human-readable top-level failure summary. |
| `errorCode` | Stable top-level code when available. Prefer this over matching `error`. Current runtime envelopes may also surface Android-emitted strings such as `SERVICE_UNAVAILABLE`, so do not assume this field is limited to the Node enum in `errors.ts`. |
| `hint` | Optional recovery hint injected by Node. |

Failure wrapper example from the CLI:

```json
{
  "code": "EXECUTION_VALIDATION_FAILED",
  "message": "wait_for_navigation requires params.timeoutMs > 0",
  "details": {
    "path": "actions.0.params.timeoutMs",
    "actionId": "wait-1",
    "actionType": "wait_for_navigation"
  }
}
```

Non-runtime success wrappers from `androperator exec`:

```json
{
  "ok": true,
  "validated": true,
  "execution": {
    "commandId": "cmd-001",
    "taskId": "task-001",
    "source": "agent-loop",
    "expectedFormat": "android-ui-automator",
    "timeoutMs": 30000,
    "actions": [
      { "id": "snap-1", "type": "snapshot" }
    ]
  }
}
```

```json
{
  "ok": true,
  "dryRun": true,
  "plan": {
    "commandId": "cmd-001",
    "timeoutMs": 30000,
    "actionCount": 1,
    "actions": [
      { "id": "snap-1", "type": "snapshot" }
    ]
  }
}
```

## Wrapper Differences

Use the wrapper shape that matches the surface you called:

| Surface | Success shape | Result-envelope rule |
| --- | --- | --- |
| CLI device execution command | `{ "envelope": ..., "deviceId": "...", "terminalSource": "androperator_result", "isCanonicalTerminal": true }` | Read `envelope` with the [result-envelope](#result-envelope) rules. |
| `androperator exec --validate-only` | `{ "ok": true, "validated": true, "execution": ... }` | Pre-dispatch only; no result envelope exists. |
| `androperator exec --dry-run` | `{ "ok": true, "dryRun": true, "plan": ... }` | Pre-dispatch only; no result envelope exists. |
| Serve execution endpoint | `{ "ok": true, "deviceId": "...", "terminalSource": "...", "envelope": ... }` | Read `envelope` with the same [result-envelope](#result-envelope) rules. |
| MCP execution-backed tool | Tool-specific `structuredContent` containing action output and usually `envelope`. | When present, read `envelope` with the same [result-envelope](#result-envelope) rules. |

`isCanonicalTerminal` is a CLI wrapper field. HTTP serve execution responses do not include it.

## How To Branch On Results

Branch in this order:

1. If the CLI returned a top-level object with `code` and no `envelope`, treat it as a host-side failure. Do not retry unchanged.
2. If `envelope.status == "failed"` and `envelope.errorCode` is present, branch on `envelope.errorCode`.
3. If `envelope.status == "failed"` and `envelope.stepResults` contains a failed step, branch on the first `stepResults[i].success == false` and inspect `stepResults[i].data.errorCode`, falling back to the legacy `data.error` code.
4. If `envelope.status == "success"` and every `stepResults[i].success == true`, treat the command as successful.
5. If the top-level object is `{ ok: true, validated: true, ... }` or `{ ok: true, dryRun: true, ... }`, treat it as a pre-dispatch contract success, not a device execution result.

Exact machine-checkable success condition for most CLI device commands:

- process exit code `0`
- top-level JSON contains `envelope`
- `envelope.status == "success"`
- every `envelope.stepResults[i].success == true`
- `terminalSource == "androperator_result"`
- `isCanonicalTerminal == true`

## How `status` and `stepResults` Relate

- A typed runtime terminal failure is authoritative. Node preserves its status, error code, original message, and collected steps, including a timeout between steps.
- Otherwise, if any `stepResults[].success` is `false`, Node reconciles `status` to `"failed"` and sets `error` from the first failed step.
- Otherwise, if all steps succeed, Node reconciles `status` to `"success"`, clears top-level error state, and removes `hint`.
- Thrown failures stop the sequence and retain prior steps plus the failed step. Returned failed steps preserve the existing continue-sequence policy.
- [Action receipts](actions.md#action-receipts-and-failure-evidence) report dispatch acceptance. Verify application postconditions with separate observations.
- A top-level failure can also arrive with zero steps, for example when Android returns a failure envelope before a normal step list exists, such as `SERVICE_UNAVAILABLE`.
- Android command timeout returns a failed envelope with `COMMAND_TIMEOUT` and collected steps. If Node cannot obtain that terminal envelope, the host may instead return `RESULT_ENVELOPE_TIMEOUT`; that transport uncertainty does not prove whether a mutation occurred.
- Node may modify step data after the runtime returns. Examples:
  - `snapshot` success steps get `data.text` attached from extracted log output
  - missing snapshot text is converted into `SNAPSHOT_EXTRACTION_FAILED`
  - successful `take_screenshot` steps get `data.path`
  - successful pre-flight `close_app` steps are normalized to `data.application_id`

## Execution Flow

1. Agent constructs an execution payload with stable `commandId`, `taskId`, and ordered `actions`.
2. Node validates the payload size and action schema before any adb dispatch.
3. Node resolves one target device and one Operator package.
4. Node sends the payload to Android and waits for a `[Androperator-Result]` envelope.
5. Node post-processes known cases such as snapshot extraction, screenshot capture, settle warnings, and `close_app` normalization.
6. CLI commands return a JSON wrapper containing the envelope, `deviceId`, `terminalSource`, and `isCanonicalTerminal`.

## Worked Example

Command:

```bash
androperator snapshot --device <device_serial>
```

Success output shape:

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
          "text": "<hierarchy rotation=\"0\">...</hierarchy>"
        }
      }
    ],
    "error": null
  },
  "deviceId": "<device_serial>",
  "terminalSource": "androperator_result",
  "isCanonicalTerminal": true
}
```

Agent-side success test:

- `envelope.status == "success"`
- `envelope.stepResults[0].actionType == "snapshot"`
- `envelope.stepResults[0].success == true`
- `"text" in envelope.stepResults[0].data`

## Related Pages

- [Actions](actions.md)
- [Selectors](selectors.md)
- [Errors](errors.md)
- [Devices](devices.md)
- [Doctor](doctor.md)
- [Serve API](serve.md)
- [Setup](../setup.md)
