# Timeouts

## Purpose

Define the timeout budgeting model for Androperator executions: execution-level timeout, action-level timeout on wait actions, builder inflation rules, and the runtime's best-effort ceiling.

## Sources

- Limits: `apps/node/src/contracts/limits.ts`
- Validation: `apps/node/src/domain/executions/validateExecution.ts`
- Runtime enforcement: `apps/node/src/domain/executions/runExecution.ts`
- Wait builders: `apps/node/src/domain/actions/wait.ts`, `apps/node/src/domain/actions/waitForNav.ts`
- Snapshot builder: `apps/node/src/domain/observe/snapshot.ts`
- Sleep builder: `apps/node/src/domain/actions/sleep.ts`
- `exec` validation and override path: `apps/node/src/cli/commands/execute.ts`
- `exec best-effort` CLI routing: `apps/node/src/cli/registry.ts`

## Two Timeout Levels

Androperator currently has two timeout layers that matter to agents:

| Level | Field | Scope |
| --- | --- | --- |
| execution-level | top-level `execution.timeoutMs` | whole payload |
| action-level | `params.timeoutMs` on some actions | one action's internal wait window |

The key rule is:

- the action-level timeout must fit inside the execution-level timeout
- builder helpers intentionally inflate the execution-level timeout above the action-level wait so Node does not kill the whole run before the wait action has a chance to finish

## CLI Timeout Mapping

The `--timeout` flag does not land in the same place on every command.

Current CLI mappings:

| Command | CLI flag | Where it ends up |
| --- | --- | --- |
| `androperator wait --timeout <ms>` | global `--timeout` parsed into `ctx.timeoutMs` | `wait_for_node.params.timeoutMs`, with `buildWaitExecution()` inflating top-level `execution.timeoutMs` |
| `androperator wait-for-nav --timeout <ms>` | global `--timeout` parsed into `ctx.timeoutMs` | `wait_for_navigation.params.timeoutMs`, with `buildWaitForNavExecution()` inflating top-level `execution.timeoutMs` |
| `androperator exec --timeout <ms>` | `cmdExecute()` override | replaces top-level `execution.timeoutMs` after validation |

Use `--validate-only` or `--dry-run` when you need to confirm which layer a CLI flag changed.

## Execution-Level Timeout

The execution-level timeout is always the top-level `timeoutMs` on the execution payload.

Current hard limits:

- minimum: `1000`
- maximum: `120000`

If the caller provides a non-finite timeout or a value outside that range, Node returns a top-level validation failure:

```json
{
  "code": "EXECUTION_VALIDATION_FAILED",
  "message": "timeoutMs must be between 1000 and 120000"
}
```

At runtime, `runExecution()` waits for the Android result envelope using:

- `execution.timeoutMs + 5000`

That extra `5000` milliseconds is a buffer for envelope write. It does not change the documented execution budget. Agents should still reason from the top-level `execution.timeoutMs`.

If the runtime exceeds the budget and Node never receives a valid result envelope, the caller gets a top-level `RESULT_ENVELOPE_TIMEOUT` error, not a normal success wrapper.

Verification pattern - confirm a timeout value was accepted without dispatching:

```bash
androperator exec --validate-only --execution '{"commandId":"timeout-check","taskId":"timeout-check","source":"docs","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"snap","type":"snapshot"}]}'
```

Expected success shape:

```json
{
  "ok": true,
  "validated": true,
  "execution": {
    "commandId": "timeout-check",
    "taskId": "timeout-check",
    "source": "docs",
    "expectedFormat": "android-ui-automator",
    "timeoutMs": 30000,
    "actions": [
      {
        "id": "snap",
        "type": "snapshot"
      }
    ]
  }
}
```

Error cases for execution-level timeout:

- non-finite timeout: `EXECUTION_VALIDATION_FAILED` with `message: "timeoutMs must be a finite number"`
- timeout below `1000` or above `120000`: `EXECUTION_VALIDATION_FAILED` with `message: "timeoutMs must be between 1000 and 120000"`
- no terminal result by the host deadline: top-level `RESULT_ENVELOPE_TIMEOUT`
- received Android command deadline: failed envelope with `COMMAND_TIMEOUT`
- malformed terminal envelope during a live run: top-level `RESULT_ENVELOPE_MALFORMED`

## Action-Level Timeout

Only some actions use `params.timeoutMs` today. The main public case is `wait_for_navigation`, and the flat CLI `wait` builder also carries a wait-specific timeout value in `params.timeoutMs` for `wait_for_node`.

Current validated action-level rules:

| Action | Field | Valid values |
| --- | --- | --- |
| `wait_for_navigation` | `params.timeoutMs` | required, `> 0`, `<= 30000` |
| `wait_for_node` via CLI builder | `params.timeoutMs` | optional in raw schema, set by `buildWaitExecution()` when `--timeout` is passed |

Important boundary:

- `validateExecution.ts` does not currently enforce a numeric range for `wait_for_node.params.timeoutMs`
- the current public timeout contract for `wait_for_node` comes from the CLI builder in `apps/node/src/domain/actions/wait.ts`, not from a dedicated `waitForNode.ts` module

For `wait_for_navigation`, invalid values fail validation before dispatch:

```json
{
  "code": "EXECUTION_VALIDATION_FAILED",
  "message": "wait_for_navigation params.timeoutMs must not exceed 30000",
  "details": {
    "path": "actions.0.params.timeoutMs",
    "actionId": "wait-for-nav",
    "actionType": "wait_for_navigation"
  }
}
```

Relationship between the two levels:

- action-level timeout controls how long the wait action should keep waiting for its condition
- execution-level timeout controls how long the full payload is allowed to exist
- when the action timeout is close to or greater than the execution timeout, the execution may fail early at the envelope layer

Verification pattern - confirm `wait-for-nav` action timeout is encoded:

```bash
androperator wait-for-nav --app com.android.settings --timeout 5000 --validate-only
```

Expected validated execution shape:

```json
{
  "ok": true,
  "validated": true,
  "execution": {
    "timeoutMs": 30000,
    "actions": [
      {
        "id": "wait-for-nav",
        "type": "wait_for_navigation",
        "params": {
          "expectedPackage": "com.android.settings",
          "timeoutMs": 5000
        }
      }
    ]
  }
}
```

For `wait`, the equivalent CLI mapping is:

```bash
androperator wait --text "Done" --timeout 5000 --validate-only
```

Expected shape:

```json
{
  "ok": true,
  "validated": true,
  "execution": {
    "timeoutMs": 30000,
    "actions": [
      {
        "id": "wait",
        "type": "wait_for_node",
        "params": {
          "matcher": {
            "textEquals": "Done"
          },
          "timeoutMs": 5000
        }
      }
    ]
  }
}
```

## Builder Inflation Rules

| Builder | Execution timeout |
| --- | --- |
| `wait`, `wait-for-nav` | `max(actionTimeout + 5000, 30000)` when supplied; otherwise `30000` |
| `sleep` | `max(durationMs + 5000, globalTimeoutMs ?? 0, 30000)` |
| `snapshot` | `30000` unless overridden; no action-specific wait timeout |

The action rules still apply: `wait-for-nav` requires `--timeout` and caps it at
30000; `wait --timeout 45000` builds a 50000 execution budget. Raw multi-action
payloads must budget for all actions, not just the longest wait. Generated
command IDs are opaque; retain them for correlation instead of constructing
strings from the builder's current naming pattern.

## Supported execution mode

Use direct execution with `timeoutMs` in `1000..120000`. `exec best-effort`
returns `NOT_IMPLEMENTED`; the internal 180000 ms constant does not extend the
public execution budget.

```json
{"code":"NOT_IMPLEMENTED","message":"exec best-effort is Stage 1 limited; use snapshot + agent reasoning for now"}
```

## Concrete Budget Example

### Multi-step read after click


```json
{
  "commandId": "read-after-click",
  "taskId": "read-after-click",
  "source": "androperator-action",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 45000,
  "actions": [
    {
      "id": "click-1",
      "type": "click",
      "params": {
        "matcher": { "textEquals": "Settings" }
      }
    },
    {
      "id": "sleep-1",
      "type": "sleep",
      "params": {
        "durationMs": 1500
      }
    },
    {
      "id": "wait-1",
      "type": "wait_for_node",
      "params": {
        "matcher": { "textEquals": "Connected devices" },
        "timeoutMs": 10000
      }
    },
    {
      "id": "snap-1",
      "type": "snapshot"
    }
  ]
}
```

Reasonable because:

- the action-level wait is `10000`
- the click and sleep consume part of the same overall budget
- the final snapshot still needs time for extraction and envelope return

Verification pattern - inspect the plan without dispatching:

```bash
androperator exec --dry-run --execution '{"commandId":"read-after-click","taskId":"read-after-click","source":"docs","expectedFormat":"android-ui-automator","timeoutMs":45000,"actions":[{"id":"click-1","type":"click","params":{"matcher":{"textEquals":"Settings"}}},{"id":"sleep-1","type":"sleep","params":{"durationMs":1500}},{"id":"wait-1","type":"wait_for_node","params":{"matcher":{"textEquals":"Connected devices"},"timeoutMs":10000}},{"id":"snap-1","type":"snapshot"}]}'
```

Expected success shape:

```json
{
  "ok": true,
  "dryRun": true,
  "plan": {
    "commandId": "read-after-click",
    "timeoutMs": 45000,
    "actionCount": 4,
    "actions": [
      {
        "id": "click-1",
        "type": "click",
        "params": {
          "matcher": {
            "textEquals": "Settings"
          }
        }
      },
      {
        "id": "sleep-1",
        "type": "sleep",
        "params": {
          "durationMs": 1500
        }
      },
      {
        "id": "wait-1",
        "type": "wait_for_node",
        "params": {
          "matcher": {
            "textEquals": "Connected devices"
          },
          "timeoutMs": 10000
        }
      },
      {
        "id": "snap-1",
        "type": "snapshot"
      }
    ]
  }
}
```

If a live run returns `RESULT_ENVELOPE_MALFORMED`, treat it as a transport-contract failure rather than a normal action timeout. Recovery:

- preserve the original failure, command/task IDs and dispatch/earlier-effects evidence
- observe current state before deciding whether a mutation still needs execution
- check CLI/APK compatibility with `androperator version --check-compat` and inspect logs
- use a bounded fresh observation for diagnosis; do not replay a preceding mutation to repair missing evidence

<a id="timeout-outcomes"></a>
## Timeout outcomes

| Outcome | Parse | Next step |
| --- | --- | --- |
| Action wait exhausts its window | Failed step, such as `data.error: "NAVIGATION_TIMEOUT"` | Observe state and check the expectation before increasing time |
| Android command reaches its deadline and returns | Failed envelope with `errorCode: "COMMAND_TIMEOUT"` and collected steps | Preserve earlier effects; inspect state before retrying |
| Host gets no terminal envelope by its deadline | Host error `code: "RESULT_ENVELOPE_TIMEOUT"` | Completion is uncertain; inspect dispatch evidence and current state |
| Caller cancels/stops waiting | Caller-owned cancellation may provide no terminal result | Do not infer Android cancellation or absence of effects |

Synthetic received envelope excerpt:

```json
{"commandId":"timeout-example","taskId":"timeout-example","status":"failed","stepResults":[],"errorCode":"COMMAND_TIMEOUT","error":"Command execution timed out"}
```

Host error excerpt (diagnostic evidence may also be present):

```json
{"code":"RESULT_ENVELOPE_TIMEOUT","message":"Timed out waiting for result envelope"}
```

Branch on codes rather than these illustrative message strings. An empty
`stepResults` list does not establish that no effect occurred. See
[execution failure evidence](errors.md#execution-failure-evidence).

## Common Mistakes

### Execution timeout too close to wait timeout

Bad:

- `wait_for_navigation.params.timeoutMs = 30000`
- `execution.timeoutMs = 30000`

Risk:

- the envelope wait can expire before the action has enough time to finish cleanly

Better:

- use the builder pattern: `max(actionTimeout + 5000, 30000)`

### Forgetting multi-step cost

A `click -> sleep -> wait -> snapshot` workflow needs more than the wait action's own timeout. Budget for the whole sequence, not just the longest single step.

### Treating the `+5000` buffer as extra application time

The builder cushion is there to stop the envelope layer from killing the run too early. It is not a guarantee that Android will continue useful work for exactly 5 extra seconds.

### Passing out-of-range values

- execution timeout above `120000` fails validation
- execution timeout below `1000` fails validation
- `wait-for-nav --timeout` above `30000` fails validation
- `wait-for-nav` without `--timeout` fails with `MISSING_ARGUMENT`
- non-finite values fail validation

## Practical Rules

- default to `30000` for simple one-step or two-step payloads
- for `wait_for_navigation`, set `execution.timeoutMs` to at least `actionTimeout + 5000`
- for multi-step flows, add budget for earlier actions and the final envelope
- if you hit `RESULT_ENVELOPE_TIMEOUT`, verify health with [Doctor](doctor.md) before only increasing the timeout
- use `--validate-only` or `--dry-run` to confirm the final timeout value before you spend a live device run

## Related Pages

- [API Overview](overview.md)
- [Actions](actions.md)
- [Errors](errors.md)
- [Doctor](doctor.md)
- [Navigation Patterns](navigation.md)
