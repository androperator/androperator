---
name: androperator-upgrade
description: Androperator first-party bundled skill. Whole-product upgrade route for Androperator. Checks CLI reachability and host prerequisites, uses the CLI-first upgrade sequence when the host is already viable, and falls back to install.sh when the CLI is not reachable or the bootstrap prerequisites need repair.
---

# Androperator Upgrade

Use this skill only when the current machine already has Androperator and the
user or calling workflow has explicitly chosen a whole-product upgrade.

This is a thin packaged host-agent skill. It should route through the canonical
CLI surfaces that Androperator already ships. It must not re-implement install
logic inside the skill body.

## What This Skill Owns

- check `androperator --version` before mutating the host
- check the host prerequisites that the installer owns before choosing the CLI-first path:
  - `node -v` must report Node 24 or newer
  - `npm -v` must be reachable
  - `java -version` must report Java 17 or 21
- run the CLI-first upgrade sequence when the CLI is reachable and the host prerequisites are already viable:
  - `npm install -g androperator@latest`
  - `androperator install`
  - `androperator doctor`
- use `curl -fsSL https://androperator.com/install.sh | bash` as recovery when `androperator --version` is not reachable or the bootstrap prerequisites are not already satisfied
- verify the resulting install with `androperator doctor`
- when multiple devices are connected, verify each connected device with
  `androperator doctor --device <device_id>` before claiming the whole
  host is ready
- report whether the host is ready, or which existing repair route is still
  blocking readiness
- keep upgrade guidance aligned with the installed first-party host-agent docs
- require explicit upgrade intent before any host mutation begins

## What This Skill Does Not Own

- do not make `install.sh` the primary path
- do not skip the `androperator --version` reachability check
- do not use the CLI-first upgrade sequence when Node, npm, or Java still needs to be repaired by the installer
- do not invent a second upgrade-health checker beyond `androperator doctor`
- do not add or imply a top-level `androperator upgrade` command
- do not restate all setup or repair docs from memory
- do not turn passive diagnosis into an implicit upgrade
- do not keep using `install.sh` after the CLI-first path is reachable

## Workflow

### 1. Confirm explicit upgrade intent first

Only continue when the user or calling workflow has already chosen upgrade as
the next step.

Valid triggers:

- the user explicitly asked to upgrade, update, refresh, or reinstall
  Androperator
- the calling workflow explicitly selected `androperator-upgrade`
  as an opt-in route

Stop and do not run any host mutations yet when:

- you are still diagnosing a problem
- you are only checking readiness or inventory
- you merely suspect the install might be stale

If explicit upgrade intent is missing, stop and say that upgrade is an opt-in
host mutation.

### 2. Check CLI reachability first

Run:

```bash
androperator --version
```

If this succeeds, skip to the host prerequisite checks below and continue.

If this fails, run the PATH discovery gate before routing to `install.sh`.
Exit code `127` means the command was not found in the current shell; it is
not proof the tool is absent from the machine. Capture the shell resolution
context first:

```bash
printf 'PATH=%s\n' "$PATH"
command -v androperator || true
command -v node || true
command -v npm || true
command -v java || true
command -v adb || true
command -v brew || true
```

On macOS, probe the common Homebrew locations before concluding Homebrew is
absent:

```bash
/opt/homebrew/bin/brew --version
/usr/local/bin/brew --version
```

If a Homebrew binary is found outside `PATH`, activate its environment for
the current command sequence before retrying bare commands:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Use `/usr/local/bin/brew shellenv` instead when that is the discovered path.

Retry the bare commands after any PATH repair. If `androperator` becomes
reachable, continue with the repaired environment. Only route to `install.sh`
when the tool is still not reachable after PATH classification:

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

After recovery, re-run `androperator --version`. If the CLI is still not
reachable, stop and report the recovery failure.

If `androperator --version` succeeds (original or after PATH repair), verify
the host prerequisites the installer owns:

```bash
node -v
npm -v
java -version
```

Continue only when Node is 24 or newer, `npm` is reachable, and Java is 17
or 21. If any check fails, run the same PATH discovery gate for that tool
before deciding whether to use the recovery installer.

### 3. Run the CLI-first upgrade sequence

When `androperator --version` succeeds and the host prerequisites (Node, npm, Java) are already viable, run these commands in order:

```bash
npm install -g androperator@latest
androperator install
androperator doctor
```

Rules:

- use `androperator install` as the CLI-owned post-bootstrap route
- do not re-implement multi-device policy, runtime-skills install, bundled-skills install, or host-artifact sequencing inside the skill
- use the structured CLI results rather than guessing about state
- keep `androperator doctor` as the readiness check after the sequence
- if the install result has `deviceSelectionRequired: true`, collect the
  connected `deviceId` values from `steps.operatorRemediation.devices` and run
  `androperator doctor --device <device_id>` for each connected device
- if `androperator doctor` returns `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`,
  run `androperator devices` or use the install result's device list, then run
  `androperator doctor --device <device_id>` for each connected device
- treat a warning-only multi-device doctor result as ready only after every
  per-device doctor check exits `0` and reports `criticalOk: true`
- if `npm install -g androperator@latest` fails, fall back to the recovery installer and re-check reachability before continuing

### 4. Decide between ready and blocked

Use this decision table:

| Doctor result | Outcome |
| --- | --- |
| single-device doctor exits `0` and reports `criticalOk: true` | Report that Androperator is ready and name the next truthful front door for the user’s task. |
| top-level doctor exits `0` with `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`, and every per-device doctor check exits `0` with `criticalOk: true` | Report that Androperator is ready and mention that future device commands need `--device`. |
| non-zero exit code or `criticalOk: false` | Summarize the failing checks and point to the existing repair route already named by doctor or the setup docs. |

Rules:

- do not invent a custom remediation tree inside this skill
- do not claim success when doctor still reports blocking issues
- do not claim success until every connected device has been checked with doctor
  and every connected device reports `criticalOk: true`
- do not treat `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED` as a blocker when the
  per-device doctor checks all pass; report it as the expected follow-up rule
  for future device commands
- if doctor indicates setup is incomplete, keep the next step grounded in the
  real failing surface
- if recovery was needed, report the recovery outcome before the doctor result
- do not ask the user whether to proceed with the doctor-reported repair path
  or the next command; pick the explicit next action from doctor or the setup
  docs and state it directly

### 5. Name the next truthful action

After a successful upgrade:

- if the host is unfamiliar, suggest `androperator-agent-orientation`
- if the goal is runtime-skill discovery, suggest
  `androperator skills for-app <package_id>` or
  `androperator skills search --keyword <text>`
- if the user explicitly needs repair after doctor failure, point at the
  existing setup or repair guidance instead of widening scope

After a blocked upgrade:

- do not ask a follow-up question
- surface the first concrete doctor fix or nextActions item
- if doctor provides multiple fix steps, keep the response to the first
  actionable repair step and the canonical docs URL

### 6. End with a short status summary

Finish with:

- the CLI reachability result in one sentence
- whether the installer-owned prerequisites were already satisfied in one sentence
- the upgrade result in one sentence
- one explicit next command or one canonical doc URL

Examples:

- "Androperator was reachable, the CLI-first upgrade sequence completed, and doctor reports `criticalOk: true` for every connected device. Future device commands need `--device`; your next step is `androperator-agent-orientation`."
- "Androperator was reachable, but Node, npm, or Java was not yet healthy enough for the CLI-first path, so I used `install.sh` as recovery only. Follow the setup guidance at `https://docs.androperator.com/setup/` and then rerun this skill."
- "Androperator was not reachable, so I used `install.sh` as recovery only. The CLI is still not ready, so follow the recovery guidance or finish setup at `https://docs.androperator.com/setup/`."
- "Upgrade intent is not explicit yet, so I stopped before running any host mutations."

## Output Style

Be concise. Treat `androperator --version` as the reachability gate, host
prerequisites as the CLI-first viability gate, and `install.sh` as recovery
when either gate fails. End with one explicit next step. Name the
upgrade-intent gate explicitly when you decline to run the installer. Never
ask the user to choose the next repair step after doctor has already named it.
JSON is already the CLI default; do not add `--output json` to command
snippets.
