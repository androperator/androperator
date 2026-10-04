---
name: androperator-upgrade
description: Upgrade an existing Androperator installation when the user or authorized workflow requests a whole-product refresh.
---

# Upgrade Androperator

Complete the requested upgrade and verify host/device readiness, or report the
concrete blocker and supported repair. An upgrade request authorizes routine
steps in this workflow; passive diagnosis, inventory or suspected staleness does
not authorize installation. Do not start host mutations without upgrade intent.

## Choose the route

Check `androperator --version`, then `node -v`, `npm -v` and `java -version`.
The CLI-first route requires Node 24 or newer, reachable npm, and Java 17 or 21.
If a command is missing, use [PATH recovery](references/path-recovery.md) before
concluding it is absent or installing replacements.

When the CLI and prerequisites are viable, run in order:

```bash
npm uninstall -g androperator
npm install -g @androperator/cli@latest
androperator install
androperator doctor
```

Check each result before continuing. `androperator install` owns Operator
remediation, bundled instructions and host setup; do not reproduce that logic.
There is no top-level `androperator upgrade` command. JSON is the default output.

If the CLI remains unreachable after PATH recovery, prerequisites need bootstrap
repair, or the npm update fails, use the recovery installer:

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

Check its result, recheck CLI reachability and prerequisites, then verify with
`androperator doctor`. The installer already delegates post-bootstrap setup to
`androperator install`; do not repeat the upgrade loop after successful recovery.
If recovery fails, report the failed stage and existing repair route.

Use the renamed command, package and URLs throughout. Do not substitute an old
`clawperator` binary or app when Androperator is unavailable, copy old state, or
invent compatibility aliases. An old installation alone does not establish
readiness for the current CLI and Operator pair.

## Verify readiness

Keep `doctor` as the health authority. If install reports
`deviceSelectionRequired: true`, use `steps.operatorRemediation.devices` or
`androperator devices` to identify connected targets. If doctor reports
`MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`, check each connected device explicitly:

```bash
androperator doctor --device <device_id>
```

Claim whole-host readiness only when every connected device's doctor exits `0`
and reports `criticalOk: true`. A multi-device selection warning is expected
once those checks pass; future actions still need `--device`. A nonzero exit or
`criticalOk: false` is blocked readiness, even if package installation succeeded.

Use doctor-provided fixes or [setup](https://docs.androperator.com/setup/) for
in-scope repair. Continue routine authorized repairs; ask only when a missing
decision or additional authority genuinely blocks progress. Do not invent a
second health checker or widen the task into unrelated repair.

Report CLI/prerequisite status, upgrade or recovery outcome, per-device readiness
and one concrete next action. For a ready unfamiliar host, use orientation; for
an Android goal, use the control loop. For a blocker, name the first actionable
doctor fix or canonical repair link without claiming success.
