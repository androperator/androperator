# Navigation Patterns

## Purpose

Show how agents compose `open_app`, `open_uri`, `wait_for_navigation`, and `snapshot` into deterministic navigation workflows.

This page focuses on composition. For full per-action parameter rules, use [Actions](actions.md).

## Sources

- Builders: `apps/node/src/domain/actions/openApp.ts`, `apps/node/src/domain/actions/openUri.ts`, `apps/node/src/domain/actions/waitForNav.ts`
- Validation: `apps/node/src/domain/executions/validateExecution.ts`
- Shared contract: `apps/node/src/contracts/execution.ts`
- Limits: `apps/node/src/contracts/limits.ts`
- CLI command surface: `apps/node/src/cli/registry.ts`
- Selector parsing: `apps/node/src/cli/selectorFlags.ts`

## Choose a readiness condition

`open_app` waits for its package to be foreground by default, including an
already-foreground app. It does not prove destination content is loaded.
`open_uri` dispatches the URI without that content guarantee. Observe the result;
if a known destination element is still loading, wait for that node and observe
again. Do not append a package-only `wait_for_navigation` after a completed
launch or a same-package click.

```bash
androperator open com.android.settings --device <device_serial>
androperator snapshot --device <device_serial>
# For a justified destination selector, only when content readiness is needed:
androperator wait --text "About phone" --timeout 5000 --device <device_serial>
```

Labels vary by device; derive selectors from evidence for the workflow. A node
already present before the action does not prove that navigation occurred.

## Launcher And Home-Screen Navigation

Treat the launcher as a special-case navigation surface.

Practical rules:

- prefer direct `open_app` for installed apps instead of trying to traverse the
  home screen first
- do not assume a paged launcher workspace is a generic scrollable container
- use `snapshot` to confirm what surface is actually visible before choosing
  the next action

Why this matters:

- launcher pages may appear in the snapshot XML even when the visible workspace
  does not expose a container that Androperator can drive with `scroll`
- a home-screen attempt that looks swipeable to a human can still fail with a
  container-level error such as `CONTAINER_NOT_SCROLLABLE`
- chooser windows, permission prompts, and other overlays can complicate
  `wait_for_navigation` even when the target package ultimately reaches the
  foreground

If the app is already installed and you know the package ID, `open_app` plus `snapshot` is usually a more deterministic route
than launcher traversal.

## `open_app`

`open_app` requires:

- `params.applicationId`

Accepted raw JSON parameter aliases for `open_app`:

- `application_id`
- `app`
- `app_id`
- `appId`
- `package`
- `package_id`
- `packageId`

Validation rule:

- blank or missing `applicationId` fails with `EXECUTION_VALIDATION_FAILED`

CLI routing pattern:

```bash
androperator open com.android.settings
```

The `open` command treats a non-URI target as an app package and dispatches to `open_app`.

Accepted CLI aliases for the same intent:

- `androperator open-app com.android.settings`
- `androperator open_app com.android.settings`
- `androperator open --package com.android.settings`

Exact classification rule from `isOpenCliUriTarget()`:

- `open` routes to `open_uri` only when the target matches `[a-z][a-z0-9+\\-.]*://`
- otherwise `open` treats the target as an app package and routes to `open_app`

Verification:

```bash
androperator open com.android.settings
```

Success excerpt (correlation and other fields omitted):

```json
{
  "envelope": {
    "status": "success",
    "stepResults": [
      {
        "id": "a1",
        "actionType": "open_app",
        "success": true,
        "data": {
          "application_id": "com.android.settings"
        }
      }
    ]
  }
}
```

What to verify after `open_app`:

- do not rely on the open action alone
- use a destination-specific `wait_for_node` only when content readiness needs a wait
- then confirm the target screen with `snapshot` or another read action

Error cases:

- missing or blank `applicationId` in raw JSON: `EXECUTION_VALIDATION_FAILED`
- missing `open` target on the CLI: `MISSING_ARGUMENT`
- both positional target and `--app` on the CLI: `EXECUTION_VALIDATION_FAILED`

## `open_uri`

`open_uri` requires:

- `params.uri`

Accepted raw JSON parameter alias for `open_uri`:

- `url`

Validation rules:

- blank or missing `uri` fails
- maximum length is `2048` characters (`LIMITS.MAX_URI_LENGTH`)

CLI routing pattern:

```bash
androperator open https://androperator.com
```

The `open` command uses `isOpenCliUriTarget()` and routes to `open_uri` when the target matches a URI-with-scheme pattern.

Accepted CLI aliases for the same intent:

- `androperator open --url https://androperator.com`
- `androperator open --uri https://androperator.com`

Verification:

```bash
androperator open https://androperator.com
```

Success excerpt (correlation and other fields omitted):

```json
{
  "envelope": {
    "status": "success",
    "stepResults": [
      {
        "id": "a1",
        "actionType": "open_uri",
        "success": true,
        "data": {
          "uri": "https://androperator.com"
        }
      }
    ]
  }
}
```

What Node validates versus what it does not:

- Node validates presence and max length
- Node does not enforce a URI scheme whitelist in `validateExecution.ts`

What to verify after `open_uri`:

- wait for a justified destination node when needed; package-only waits require transition evidence
- use `snapshot` to confirm the actual screen reached

Error cases:

- blank or missing URI in raw JSON: `EXECUTION_VALIDATION_FAILED`
- URI longer than `2048` characters: `EXECUTION_VALIDATION_FAILED`
- missing `open` target on the CLI: `MISSING_ARGUMENT`

<a id="wait-for-navigation"></a>
## `wait_for_navigation`

`wait_for_navigation` is a transition/node wait. A package already foreground
when the wait begins does not satisfy a package-only wait without an observed
package change. A matching `expectedNode` independently satisfies the wait;
package and node are OR conditions, not a combined assertion. For in-app content
readiness, prefer `wait_for_node`.

CLI aliases accepted for agent-first ergonomics:

- command alias: `wait_for_navigation`
- target-package flags: `--package`, `--package-id`, `--application-id`
- selector flags from [Selectors](selectors.md): `--id`, `--desc`, `--desc-contains`

Current public parameters:

| Field | Valid values | Meaning |
| --- | --- | --- |
| `expectedPackage` | optional non-blank string, `<= 512` characters | wait for evidence of transition to that foreground package |
| `expectedNode` | optional `NodeMatcher` | wait until a target node is present |
| `timeoutMs` | required number, `> 0`, `<= 30000` | wait window for navigation confirmation |

Validation rules:

- at least one of `expectedPackage` or `expectedNode` is required
- `timeoutMs` is required
- `timeoutMs` must be positive
- `timeoutMs` must not exceed `30000`

Accepted raw JSON parameter aliases for `wait_for_navigation`:

- `expected_package` -> `expectedPackage`
- `expected_node` and `wait_for` -> `expectedNode`
- `timeout_ms` -> `timeoutMs`

Builder inflation rule:

- execution timeout becomes `max(timeoutMs + 5000, 30000)`

Example action fragment (either condition may satisfy it):

```json
{
  "id": "wait-for-nav",
  "type": "wait_for_navigation",
  "params": {
    "expectedPackage": "com.android.settings",
    "expectedNode": {
      "textEquals": "Connected devices"
    },
    "timeoutMs": 5000
  }
}
```

CLI rule for `wait-for-nav`:

- `--timeout` is required
- at least one of `--app` or a selector is required

CLI validation failures:

- missing `--timeout`: `MISSING_ARGUMENT`
- non-finite `--timeout` or `--timeout <= 0`: `EXECUTION_VALIDATION_FAILED`
- `--timeout > 30000`: `EXECUTION_VALIDATION_FAILED`
- blank `--app` value: `EXECUTION_VALIDATION_FAILED`
- no `--app` and no selector: `MISSING_ARGUMENT`

Verification:

```bash
androperator wait-for-nav --app com.android.settings --timeout 5000 --validate-only
```

Validated execution excerpt (no device dispatch):

```json
{
  "ok": true,
  "validated": true,
  "execution": {
    "source": "androperator-action",
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

Standalone navigation-wait success excerpt (when its transition or node condition
was satisfied):

```json
{"id":"wait-for-nav","actionType":"wait_for_navigation","success":true,"data":{"resolved_package":"com.android.settings","elapsed_ms":"412"}}
```

## Common Navigation Sequence

The recommended pattern for deterministic app navigation is:

1. `open_app` (includes package readiness)
2. `snapshot`, followed by a content wait and another observation only if needed

Example payload:

```json
{
  "commandId": "settings-nav-1",
  "taskId": "settings-nav-1",
  "source": "agent",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    {
      "id": "open",
      "type": "open_app",
      "params": {
        "applicationId": "com.android.settings"
      }
    },
    {
      "id": "snap",
      "type": "snapshot"
    }
  ]
}
```

Machine-checkable success conditions:

- `envelope.status == "success"`
- `stepResults[0].actionType == "open_app"` and `stepResults[0].success == true`
- `stepResults[0].data.application_id == "com.android.settings"`
- `stepResults[1].actionType == "snapshot"` and `stepResults[1].success == true`
- `stepResults[1].data.text` exists

Verification command:

```bash
androperator exec --execution '{"commandId":"settings-nav-1","taskId":"settings-nav-1","source":"docs","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"open","type":"open_app","params":{"applicationId":"com.android.settings"}},{"id":"snap","type":"snapshot"}]}' --device <device_serial>
```

## Synthetic response example

The hierarchy below is abbreviated. Package/timing metadata may also be present.

```json
{
  "envelope": {
    "commandId": "settings-nav-1",
    "taskId": "settings-nav-1",
    "status": "success",
    "stepResults": [
      {
        "id": "open",
        "actionType": "open_app",
        "success": true,
        "data": {
          "application_id": "com.android.settings"
        }
      },
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

## Common Failure Modes

### App not installed

There is no dedicated Node validation code for "target app is missing" on `open_app`. This is a runtime problem and usually surfaces as a failed step or unexpected navigation result.

What to do:

- inspect `stepResults[0]`
- obtain a fresh `snapshot` to see where the device actually landed; do not replay the launch blindly
- if the Operator package itself is missing instead of the target app, the execution fails earlier with `OPERATOR_NOT_INSTALLED`

### Navigation timeout

When `wait_for_navigation` never sees the expected package or node inside its timeout:

- the wait step fails at runtime
- the overall envelope becomes `status: "failed"`

Recovery:

- preserve the failed result and observe current state before repeating any mutation
- increase the action timeout only if the app truly needs more time
- verify the expectation is correct
- use [Snapshot Format](snapshot.md) or [Selectors](selectors.md) to inspect the actual screen

Typical failure branch:

```json
{
  "envelope": {
    "status": "failed",
    "stepResults": [
      {
        "actionType": "wait_for_navigation",
        "success": false,
        "data": {
          "error": "NAVIGATION_TIMEOUT",
          "last_package": "com.android.settings"
        }
      }
    ]
  }
}
```

Runtime detail:

- `wait_for_navigation` timeout failures use `data.error: "NAVIGATION_TIMEOUT"`
- when the runtime observed a foreground package before the timeout expired, it may also include `data.last_package`
- on success, `data.resolved_package` is present when the runtime had a foreground package value to report

### Wrong package on screen

If `open_uri` hands off to a chooser, browser, or another app, `expectedPackage` may not match what actually reached the foreground.

Recovery:

- use `expectedNode` when package alone is too coarse
- capture a snapshot and branch on the observed foreground UI

### Envelope timeout during navigation

A received Android deadline failure has a failed envelope with `COMMAND_TIMEOUT`.
When no terminal envelope arrives before the host deadline, the result is a
host `RESULT_ENVELOPE_TIMEOUT` error. Preserve collected steps and
[dispatch evidence](errors.md#execution-failure-evidence); observe current state
before retrying any mutation. See [timeout outcomes](timeouts.md#timeout-outcomes).

Recovery:

- check whether the execution-level timeout was budgeted correctly
- use the builder rule `max(actionTimeout + 5000, 30000)` as the minimum
- verify device health with [Doctor](doctor.md) if the timeout is unexpected

## Related Pages

- [Actions](actions.md)
- [Snapshot Format](snapshot.md)
- [Timeouts](timeouts.md)
- [Selectors](selectors.md)
- [Errors](errors.md)
