# Device Prep and Runtime

## Purpose

Define what must be true before a skill run is reliable: device readiness, wrapper environment, timeout behavior, multi-device targeting, and output capture.

## Sources

- Skill runtime: `apps/node/src/domain/skills/runSkill.ts`
- Skill config: `apps/node/src/domain/skills/skillsConfig.ts`
- CLI skill wrapper: `apps/node/src/cli/commands/skills.ts`
- Environment variables overview: `docs/api/environment.md`

## Device Prep Checklist

Before `androperator skills run`, the target should already satisfy the normal Androperator readiness path:

1. device visible to adb
2. expected Operator package installed
3. accessibility service running
4. version compatibility healthy
5. interactive device state healthy

Recommended verification:

```bash
androperator doctor --device <device_serial>
```

Treat the device as ready only when:

- exit code `0`
- `criticalOk == true`
- `checks` includes `readiness.device.interactive` with `status: "pass"`

Verification pattern:

- run `androperator doctor --device <device_serial> --operator-package <package>`
- confirm `report.operatorPackage` matches the package you plan to use inside the skill
- confirm the doctor report is for the same `deviceId` you plan to pass to `skills run`

High-level wrapper enforcement now matches that readiness contract:

- `androperator skills run` resolves the target tuple, checks the requested Operator package first, and when the target is asleep it makes a bounded host-side wake attempt before failing with `DEVICE_NOT_INTERACTIVE`
- `POST /skills/:skillId/run` in serve performs the same pre-spawn readiness preparation

Current bounded wake behavior:

- if the device is already awake and ready, the wrapper proceeds immediately
- if the screen is off, the wrapper tries host-side wake in the internal retry
  order and then re-checks readiness
- if the device is awake but still locked, or Android still reports
  `userUnlocked == false`, the wrapper fails with `DEVICE_NOT_INTERACTIVE`
- the wrapper does not attempt credential entry or secure-keyguard bypass

Wrapper-level non-interactive failure shape:

```json
{
  "code": "DEVICE_NOT_INTERACTIVE",
  "message": "Device is not interactive. Interactive automation requires an awake, usable device state."
}
```

Use `androperator doctor` when you need the structured evidence fields
(`screenOn`, `deviceLocked`, `userUnlocked`) that explain why the device is not
ready.

For first-time setup, use [Setup](../setup.md). For runtime recovery, use [Operator App](../troubleshooting/operator.md).

## Runtime Environment Passed To Skill Scripts

The wrapper injects these environment variables:

| Variable | Meaning |
| --- | --- |
| `ANDROPERATOR_BIN` | command the skill should use when it needs to invoke Androperator |
| `ANDROPERATOR_OPERATOR_PACKAGE` | Operator package the skill should target on its internal CLI calls |
| `ANDROPERATOR_DEVICE_ID` | explicit device selection only; present only when the caller passed `--device` or serve `deviceId` |

Resolution behavior:

- `ANDROPERATOR_BIN` uses explicit env override first, then a local sibling build, then global `androperator`
- `ANDROPERATOR_OPERATOR_PACKAGE` uses the explicit wrapper flag first, then environment, then `com.androperator.operator`

The wrapper preserves the rest of `process.env` when spawning the child process, but it explicitly clears inherited `ANDROPERATOR_DEVICE_ID` unless the caller passed an explicit device selection.

The exact `ANDROPERATOR_BIN` resolution order from `resolveSkillBin()` is:

1. non-empty `ANDROPERATOR_BIN`
2. branch-local sibling build at `apps/node/dist/cli/index.js` when it exists
3. global `androperator`

The exact `ANDROPERATOR_OPERATOR_PACKAGE` resolution order from `cmdSkillsRun()` plus `resolveOperatorPackage()` is:

1. `--operator-package <pkg>` on `androperator skills run`
2. non-empty `ANDROPERATOR_OPERATOR_PACKAGE`
3. `com.androperator.operator`

Verification pattern:

```bash
ANDROPERATOR_OPERATOR_PACKAGE=com.androperator.operator.dev \
androperator skills run com.android.settings.capture-overview

ANDROPERATOR_OPERATOR_PACKAGE=com.androperator.operator.dev \
androperator skills run com.android.settings.capture-overview --operator-package com.androperator.operator
```

Then verify the skill's internal `androperator` calls behave against the intended package. When you need stronger confirmation, add a deliberate internal probe inside the skill script and inspect the raw `output`.

## How Device Id Is Passed

`runSkill()` itself does not invent a device id. The CLI wrapper decides argument passing.

Current high-level wrapper behavior:

- both CLI `skills run` and serve `POST /skills/:skillId/run` may resolve a target device for readiness preflight even when the caller omitted explicit device selection
- that implicit resolution is preflight-only
- if `--device <serial>` or serve `deviceId` is present, the wrapper writes that explicit value into `ANDROPERATOR_DEVICE_ID`
- for script-driven skills, `runSkill()` then prepends `ANDROPERATOR_DEVICE_ID` as the first child argument
- then the wrapper appends any forwarded args after `--`

That means most scripts should expect:

```text
argv[2] = <device_serial>
```

when they are run through the wrapper with explicit device targeting.

Verification pattern:

```bash
androperator skills run com.example.app.do-thing --device <device_serial> -- --mode smoke
```

Confirm that your script receives:

- first positional child argument: `<device_serial>`
- remaining forwarded args after that: `--mode`, `smoke`

If `--device` is omitted, the wrapper still may resolve a single connected device for preflight, but it passes no synthetic device argument into the child process.

## Timeout Behavior

Default skill timeout:

- `120000` milliseconds

This comes from `runSkill.ts` and applies to the subprocess wrapper, not to any single Androperator action inside the skill.

Override it with:

```bash
androperator skills run <skill_id> --timeout 90000
```

If the child does not exit in time:

- the wrapper sends `SIGTERM`
- the command fails with <code>SKILL_EXECUTION_&#x54;IMEOUT</code>

Top-level timeout parsing failures happen before the skill starts:

```json
{
  "code": "EXECUTION_VALIDATION_FAILED",
  "message": "timeoutMs must be a finite number"
}
```

```json
{
  "code": "USAGE",
  "message": "--timeout requires a value"
}
```

Verification pattern:

```bash
androperator skills run com.android.settings.capture-overview --timeout 3210
```

Check:

- `timeoutMs` is `3210` in the success payload
- if you omit `--timeout`, the JSON payload does not echo `timeoutMs`, but the wrapper still uses the internal default `120000`

## Multi-Device Skill Execution

When more than one device is connected:

- always pass `--device <serial>`

Example:

```bash
androperator skills run com.android.settings.capture-overview --device <device_serial>
```

Why:

- the wrapper uses the resolved target device for pre-spawn readiness
- the wrapper forwards only explicit caller-supplied device selection into the child script
- the child script can then pass that same serial into its internal Androperator calls

Without explicit targeting, skill behavior depends on what the script itself does. The wrapper does not auto-add a device argument unless one was provided.

Related failure mode:

- if the child script later invokes Androperator without a device while multiple devices are connected, the nested call can fail with `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`

Recovery:

- pass `--device <serial>` on the outer `skills run`
- ensure the child script forwards that positional device id into its own internal Androperator calls

## Output and Logging

`runSkill()` captures:

- stdout
- stderr
- exit code
- total duration

Success JSON exposes the parsed `SkillResult` and timing:

| Field | Meaning |
| --- | --- |
| `skillResult` | parsed structured skill result |
| `durationMs` | total wrapper runtime |

Default **JSON** success responses include wrapper `status` and omit `skillId`, `exitCode`, and
`output` at the top level and expose the answer under `skillResult.result` (see
the table in [Skill result trust order and JSON wrapper
policy](#skill-result-trust-order-and-json-wrapper-policy)).

Failure wrapper fields may also include:

| Field | Meaning |
| --- | --- |
| `stdout` | partial stdout captured before failure |
| `stderr` | partial stderr captured before failure |
| `exitCode` | non-zero child exit code when available |

JSON responses for `androperator skills run` include a `logs` object. The CLI
creates it before validation and readiness preflight, so early failures can
still be correlated with the daily log when file logging is available:

| Field | Meaning |
| --- | --- |
| `logs.skillRunId` | correlation id for this invocation |
| `logs.path` | daily NDJSON log file path |
| `logs.tailCommand` | ready-to-run command for observing that log file |

The same `skillRunId` is also available to the skill script as
`ANDROPERATOR_SKILL_RUN_ID`. Nested Androperator CLI calls inherit it. When those
calls use the daemon, the id is sent on the individual daemon request so
request-specific execution logs can correlate to the skill run without making
the long-lived daemon process inherit stale per-run state.

In pretty mode, the CLI also prints a one-line banner with:

- CLI version
- APK status
- log path
- docs hint

That banner is a convenience layer from `cmdSkillsRun()`, not part of the JSON wrapper contract.

The pretty banner contains these exact components:

- CLI version from `getCliVersion()`
- APK status derived from `checkApkPresence()`
- log path, defaulting to `~/.androperator/logs/androperator-YYYY-MM-DD.log` when `logger.logPath()` did not supply an override
- hint: `tail -f <logPath>`
- docs hint: `https://docs.androperator.com/llms.txt`

Verification pattern:

- use the default JSON output when another tool needs parseable output
- use pretty mode when a human operator wants the banner plus streamed skill output
- if pretty mode shows an APK warning or failure, fix the package/device setup before assuming the skill logic is wrong

## Skill result trust order and JSON wrapper policy

**Trust order (not the same as JSON key order):**

1. Branch on the **top-level** wrapper `status` and `code` (and HTTP `ok` for serve) first. When the wrapper is `indeterminate` or `failed`, do not treat nested `skillResult.status` as the primary success signal.
2. After the wrapper is `success` (or you are intentionally reading child state), inspect nested `skillResult.status` as **child-authored** reported state. The runtime may still mark the wrapper `indeterminate` if declared verification is not proved while the child reported success.
3. Read the **domain answer** from **`skillResult.result`**. Use `result: null` only when no truthful domain value exists.
4. Use **`checkpoints`**, **`terminalVerification`**, and **`execEnvelopes`** as proof and audit, not as the default answer path. **Do not** direct agents to discover the primary return value only through checkpoint ids, `terminalVerification`, or `diagnostics`.
5. **`diagnostics`** is for runtime health, warnings, hints, timings, and debug detail only, not a second copy of the answer.

**Nested field order in examples and emitted JSON (human and agent scanability):** inside the nested `skillResult` object, **`result` first**, then **`status`**, then the remaining proof and metadata fields. Object key order is not required for parsers, but it is the documented authoring convention.

**Default JSON for `androperator skills run` and `POST /skills/:skillId/run`:**

| Wrapper path | `skillResult` | Top-level `status` | `skillId` | `exitCode` | `output` |
| --- | --- | --- | --- | --- | --- |
| **Success** | not `null` | `success` | omitted | omitted | omitted |
| **Indeterminate** (verification not proved) | not `null` | present | omitted | omitted | omitted |
| **SKILL_OUTPUT_ASSERTION_FAILED** | may be not `null` | error shape | present in error | n/a for success | **present** (diagnostic; shows what the skill printed) |
| **Execution / parse / other failures** | often `null` | error | varies | in error when relevant | n/a; failures use `stdout` and `stderr` for process streams |

The additive `logs` object is present alongside these wrappers when a skill run
was started. It is not a second output channel and does not change the daily log
file location.

Pretty mode can show `skillId`, `exitCode`, and streamed output for operators;
the JSON deduplication policy applies when `--output json` or the serve JSON
body for skill runs is used.

Debugging skill runs with logs:

```bash
# Stream logs in real time while a skill runs
androperator logs

# In another terminal:
androperator skills run <skill_id> --device <device_serial> --operator-package <package>
```

The unified logger captures skill output as `skills.run.output` events, enabling post-timeout diagnostics. See [Logging](../api/logging.md) for details. Each run also emits a `skills.run.log_location` event with the same `logs.skillRunId` and daily file path.

## Runtime success examples

**Success (default JSON):** top level has only the nested object plus timing;
wrapper `status: "success"` and **no** duplicate `skillId`, `exitCode`, or `output`. The domain
answer is under `skillResult.result`.

```json
{
  "skillResult": {
    "result": {
      "kind": "text",
      "text": "ok"
    },
    "status": "success",
    "contractVersion": "1.0.0",
    "skillId": "com.example.app.read-metric",
    "goal": { "kind": "read_metric" },
    "inputs": {},
    "checkpoints": [],
    "terminalVerification": { "status": "verified" },
    "diagnostics": { "runtimeState": "healthy" },
    "source": { "kind": "script" }
  },
  "logs": {
    "skillRunId": "skillrun_1777600000000_00000000-0000-4000-8000-000000000000",
    "path": "/home/user/.androperator/logs/androperator-2026-03-28.log",
    "tailCommand": "tail -f '/home/user/.androperator/logs/androperator-2026-03-28.log'"
  },
  "durationMs": 15321
}
```

## Runtime indeterminate example

When verification is not proved, default JSON **omits**
`skillId`, `exitCode`, and `output` at the top level. Wrapper `status`, `code`,
and `message` stay because they carry distinct wrapper state.

```json
{
  "status": "indeterminate",
  "code": "SKILL_VERIFICATION_INDETERMINATE",
  "message": "Declared verification was not proved.",
  "skillResult": {
    "result": { "kind": "json", "value": { "note": "example" } },
    "status": "success",
    "contractVersion": "1.0.0",
    "skillId": "com.android.settings.capture-overview",
    "checkpoints": [],
    "source": { "kind": "script" }
  },
  "durationMs": 15321
}
```

This wrapper-level `indeterminate` state means the skill process ran without an
upstream runtime failure, but the declared `skill.json` verification contract
was not proved. The parsed `skillResult` is returned **verbatim**; the wrapper
does not rewrite it.

## Runtime Failure Example

<pre><code>{
  "status": "failed",
  "code": "SKILL_EXECUTION_&#x54;IMEOUT",
  "message": "Skill com.android.settings.capture-overview timed out after 120000ms",
  "skillId": "com.android.settings.capture-overview",
  "stdout": "RESULT|status=partial\n",
  "stderr": "still waiting for target node\n",
  "skillResult": null
}</code></pre>

Another common failure is a bad registry or missing script:

```json
{
  "code": "REGISTRY_READ_FAILED",
  "message": "Invalid skill manifest: /tmp/workspace/skills/com.example.task/skill.json"
}
```

```json
{
  "code": "SKILL_SCRIPT_NOT_FOUND",
  "message": "Script not found: /abs/path/to/skills/com.android.settings.capture-overview/scripts/run.js",
  "skillId": "com.android.settings.capture-overview"
}
```

```json
{
  "code": "SKILL_NOT_FOUND",
  "message": "Skill not found: com.android.settings.capture-overview",
  "skillId": "com.android.settings.capture-overview"
}
```

Recovery patterns:

- `REGISTRY_READ_FAILED`: repair the selected local directory, manifest, or optional index; an absent default collection is valid.
- `SKILL_NOT_FOUND`: confirm the exact registry `id` with `androperator skills list`
- `SKILL_SCRIPT_NOT_FOUND`: repair the registry entry or restore the script file on disk
- `SKILL_EXECUTION_FAILED`: inspect `exitCode`, `stdout`, and `stderr`
- <code>SKILL_EXECUTION_&#x54;IMEOUT</code>: inspect partial `stdout` and only then consider increasing `--timeout`
- `SKILL_RESULT_PARSE_FAILED`: fix malformed framed output or unreadable trusted source metadata in `skill.json`

## Practical Runtime Rules

- gate device readiness with `doctor` before blaming the skill
- pass `--device` explicitly in multi-device environments
- pass `--operator-package com.androperator.operator.dev` for local debug APK workflows
- prefer default JSON output for machine-consumed skill runs so the pretty banner does not pollute stdout
- inspect partial stdout and stderr on failures before rerunning blindly

## Related Pages

- [Host Agent Orientation](../host-agents.md)
- [Setup](../setup.md)
- [Doctor](../api/doctor.md)
- [Devices](../api/devices.md)
- [Skills Overview](overview.md)
- [Development Workflow](development.md)
