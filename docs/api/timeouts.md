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

Those values come from:

- minimum execution timeout constant: `1000`
- maximum execution timeout constant: `120000`

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
- live execution that runs too long: top-level `RESULT_ENVELOPE_TIMEOUT`
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

The flat CLI builders intentionally inflate execution timeouts so the wait action has room to finish.

### `wait_for_node`

`buildWaitExecution()` uses:

- default execution timeout: `30000`
- if `waitTimeoutMs` is provided: `max(waitTimeoutMs + 5000, 30000)`

So:

- `androperator wait --text "Done" --timeout 5000` becomes execution timeout `30000`
- `androperator wait --text "Done" --timeout 45000` becomes execution timeout `50000`

Exact builder literals:

- `source: "androperator-action"`
- action id: `wait`
- action type: `wait_for_node`

### `wait_for_navigation`

`buildWaitForNavExecution()` uses the same pattern:

- default execution timeout: `30000`
- if `navTimeoutMs` is provided: `max(navTimeoutMs + 5000, 30000)`

So:

- `androperator wait-for-nav --app com.android.settings --timeout 5000` gets execution timeout `30000`
- `androperator wait-for-nav --app com.android.settings --timeout 25000` gets execution timeout `30000`
- `androperator wait-for-nav --app com.android.settings --timeout 30000` gets execution timeout `35000`

Exact builder literals:

- `source: "androperator-action"`
- action id: `wait-for-nav`
- action type: `wait_for_navigation`

### `sleep`

`buildSleepExecution()` uses:

- `max(durationMs + 5000, globalTimeoutMs ?? 0, 30000)`

This is the same design principle: the whole execution must last longer than the single action's internal work.

Exact builder literals:

- `source: "androperator-action"`
- action id: `sleep`
- action type: `sleep`

### `snapshot`

`buildSnapshotExecution()` defaults to `30000`. It has no separate action-level timeout field.

Exact snapshot builder literals:

- `source: "androperator-observe"`
- action id: `snap`
- action type: `snapshot`
- `mode: "direct"`

## Best-Effort Runtime Ceiling

`LIMITS.MAX_BEST_EFFORT_RUNTIME_MS` is `180000`.

This constant exists in `apps/node/src/contracts/limits.ts`, but the current CLI `exec best-effort` path is still `NOT_IMPLEMENTED` and returns:

```json
{
  "code": "NOT_IMPLEMENTED",
  "message": "exec best-effort is Stage 1 limited; use snapshot + agent reasoning for now"
}
```

What is implemented today:

- normal direct executions validate `execution.timeoutMs` inside `1000..120000`
- `validateExecution()` only accepts `mode: "direct"` or `mode: "artifact_compiled"`
- `MAX_BEST_EFFORT_RUNTIME_MS` is a defined constant, not an active public execution contract for the current CLI path

Agent guidance:

- do not plan around `exec best-effort` yet
- do not assume `timeoutMs > 120000` becomes valid because the constant exists

## Concrete Budget Examples

### Example 1: Simple snapshot

```json
{
  "commandId": "snap-1",
  "taskId": "snap-1",
  "source": "androperator-observe",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    { "id": "snap", "type": "snapshot" }
  ]
}
```

Good budget because:

- single cheap action
- no action-level timeout
- `30000` is the literal default used by `buildSnapshotExecution()`
- the runtime still gets its separate `+5000` envelope buffer internally

### Example 2: Navigation wait

```json
{
  "commandId": "nav-1",
  "taskId": "nav-1",
  "source": "androperator-action",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 35000,
  "actions": [
    {
      "id": "open",
      "type": "open_app",
      "params": {
        "applicationId": "com.android.settings"
      }
    },
    {
      "id": "wait",
      "type": "wait_for_navigation",
      "params": {
        "expectedPackage": "com.android.settings",
        "timeoutMs": 30000
      }
    }
  ]
}
```

Why `35000` is the right budget here:

- the wait action itself is allowed to wait for up to `30000`
- the builder rule adds a `5000` cushion
- keeping execution timeout equal to `30000` would be too tight for open-app dispatch plus navigation wait plus envelope return

### Example 3: Multi-step read after click

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

- rerun once to rule out transient logcat noise
- if it repeats, check CLI and APK compatibility with `androperator version --check-compat`
- rerun the failing command with `--verbose` and inspect Android-side logs

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
