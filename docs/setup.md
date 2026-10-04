# Setup

## Purpose

Get from an empty host to a first successful `androperator snapshot` with one deterministic path and machine-checkable success conditions.

## Prerequisites

| Requirement | Minimum | Machine check |
| --- | --- | --- |
| Node.js | v24+ | `node -v` |
| Java | 17 or 21 | `java -version` |
| adb | On `PATH` | `adb version` |
| Android target | One device or emulator visible to adb | `androperator devices` |

**Java note:** The installer provisions Java 17 automatically on supported platforms (macOS with Homebrew, Ubuntu/Debian, Arch). Java 17 or 21 is required as the host JDK for Android builds (AGP 8.x requirement). The Android Gradle build compiles Java and Kotlin with Java 17 settings; device compatibility is handled by Android's DEX pipeline, not by targeting an older bytecode level.

## Agent-directed setup

When a user wants an outside agent to install, repair, verify, and orient
Androperator, give the agent this prompt:

```text
Read https://androperator.com/skill.md and get me set up with Androperator.
```

`https://androperator.com/skill.md` is the public setup skill for agents. It is
the pre-install entrypoint that tells an agent when to use the shell installer,
when to use direct npm install, when to run `androperator install`, which
readiness checks prove setup, and which human approval boundaries must stop the
agent.

The public skill does not replace `androperator install`. It points the agent to
`androperator install` as the canonical post-bootstrap route after the CLI
exists. After install, local host-specific orientation moves to:

| Path | Use |
| --- | --- |
| `~/.androperator/AGENTS.md` | Local guide written by host setup for the current machine. |
| `~/.androperator/install-state.json` | Install metadata, APK version, and last device serial when known. |
| `~/.androperator/mcp-config-snippet.json` | Generated stdio MCP configuration for hosts that choose `androperator mcp serve`. |

Machine-checkable verification after an agent-directed setup:

```bash
androperator doctor
androperator devices
androperator snapshot --device <device_serial>
test -f ~/.androperator/AGENTS.md
test -f ~/.androperator/mcp-config-snippet.json
```

Continue only when `androperator doctor` exits `0`, `criticalOk` is `true`, and
the snapshot command returns a successful result envelope. Human action can
still be required for OS prompts, Developer Options, USB debugging
authorization, Android accessibility permission, notification permission, app
installation, app sign-in, and choosing the correct device when multiple
targets are connected.

<a id="setup-step-install-cli"></a>
## 1. Install the CLI

Recommended - the installer handles Node, Java 17, adb, CLI bootstrap, and the delegated `androperator install` flow in one step:

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

When bootstrapping nvm, the installer downloads version 0.40.1 over HTTPS and
verifies its pinned SHA-256 checksum with `sha256sum` or `shasum` before running
it. A missing checksum tool, failed download, or checksum mismatch stops setup.

If the installer succeeds, skip to [5. Verify readiness with doctor](#5-verify-readiness-with-doctor).

When more than one adb-visible device is present, the installer reports each
detected device, runs `doctor` against each ready `adb` device, installs the
current release APK on any ready device that is missing or incompatible, and
then finishes with explicit `--device <serial>` guidance for later commands.

Alternatively, install the CLI only via npm (Node.js 24+ required):

```bash
npm install -g @androperator/cli
```

Then run the canonical post-bootstrap install flow:

```bash
androperator install
```

Success conditions:

- `androperator version` exits `0` and prints a version string.
- If you used `install.sh`, the delegated install flow downloads the current release APK when remediation needs setup and no reusable local copy is already in place. For later manual setup or recovery, redownload from `https://androperator.com/operator.apk` or use `androperator operator download`.

### Durable host-agent artifacts from `androperator install`

After shell bootstrap succeeds, `install.sh` delegates to `androperator install`.
That CLI-owned post-bootstrap flow runs operator remediation, bundled-skills
install, and `androperator host setup`, then writes
these durable onboarding files under `~/.androperator/`:

| Path | Meaning | When to read it |
| --- | --- | --- |
| `~/.androperator/AGENTS.md` | Local Androperator guide with agent control-loop guidance and current bundled-skills status | First stop for a host agent that needs to discover what Androperator can do on this machine |
| `~/.androperator/install-state.json` | Durable install metadata written by `androperator host setup` during install | Use when you need the last known install facts without rerunning `doctor` |
| `~/.androperator/mcp-config-snippet.json` | Paste-ready MCP config for Claude Desktop, Codex, and a generic stdio MCP consumer | Use when the host should connect through `androperator mcp serve` instead of shelling out to the CLI |

Shell prerequisite failures exit before these files are written. After
`install.sh` delegates to `androperator install`, later remediation or device
readiness failures can still leave these files behind because host setup runs
before the CLI returns its final install status.

Bundled host guidance has a canonical store at `~/.androperator/bundled-skills/`.
Claude receives managed links in `~/.claude/skills/`. Codex and other shared
consumers use managed directory copies in `~/.agents/skills/`. Aliased discovery
locations share the generic managed copies. Conflicting user-owned content is
preserved and reported as an install warning, never silently overwritten.
Use `androperator bundled-skills list` to inspect installed instructions and
[host orientation](host-agents.md) to choose execution and evidence tools.

## 2. Prepare the Android target

Required device state:

1. Enable Developer options (Settings > About phone > tap Build Number 7 times).
2. Enable USB debugging (Settings > Developer options > USB debugging).
3. Connect the device via USB, or boot an emulator via Android Studio or `androperator emulator create`.
4. Accept the adb authorization prompt if Android shows one.

Emulators have USB debugging enabled by default. Physical devices require steps 1-2 and the RSA key acceptance in step 4.

Success condition:

```bash
androperator devices
```

Expected output shape:

```json
{"devices":[{"serial":"<device_serial>","state":"device"}]}
```

If state is `unauthorized`, unlock the device and accept the USB debugging prompt. If state is `offline`, restart adb:

```bash
adb kill-server && adb start-server
```

If more than one target is connected, record the serial you will use and pass `--device <serial>` on every later command.

<a id="setup-step-install-operator-apk"></a>
## 3. Install the Operator APK

To avoid stale cached copies, always refresh the stable release APK before
running setup or reinstall:

```bash
mkdir -p ~/.androperator/downloads
curl -fsSL https://androperator.com/operator.apk -o ~/.androperator/downloads/operator.apk
```

Canonical public APK URL: `https://androperator.com/operator.apk`

Keep the CLI and Operator APK on matching releases. Run `androperator doctor`
to check version compatibility and device readiness before issuing UI commands.

```bash
androperator operator setup --apk ~/.androperator/downloads/operator.apk
```

With explicit device targeting:

```bash
androperator operator setup --apk ~/.androperator/downloads/operator.apk --device <device_serial>
```

For a local debug APK instead of the release APK:

```bash
androperator operator setup \
  --apk <local_debug_apk_path> \
  --device <device_serial> \
  --operator-package com.androperator.operator.dev
```

| Variant | Package name | When to use |
| --- | --- | --- |
| Release | `com.androperator.operator` | Default. Installed by the installer. |
| Debug | `com.androperator.operator.dev` | Local development, built from source. |

The CLI auto-detects which variant is installed when exactly one is present. If both are installed, pass `--operator-package` explicitly.

Behavior:

- Installs the APK on the device via adb.
- Grants accessibility and notification permissions.
- Verifies that the package is visible to the package manager.

Success condition:

- Command exits without a structured error object.
- A follow-up `androperator doctor` no longer reports `OPERATOR_NOT_INSTALLED` for `readiness.apk.presence`.

Do not use raw `adb install` for setup. The CLI setup command is the only path that performs install, permission grant, and verification as one operation.

<a id="setup-step-regrant-permissions"></a>
## 4. Re-grant permissions (recovery only)

```bash
androperator grant-device-permissions --device <device_serial>
```

Use this only after the Operator APK crashes or Android revokes accessibility / notification permissions. For the first install, use `androperator operator setup`.

If you force-stop the Operator package during debugging and the next handshake
or snapshot stops working, use this same recovery step before trusting the
runtime again, then re-run `androperator doctor`.

## Optional video recording tools

Video recording additionally requires separately installed scrcpy 3.0 or newer,
ffprobe, and ffmpeg 6.1 or newer with the libx264 encoder on the host PATH. Androperator does
not bundle or install them. On macOS: `brew install scrcpy ffmpeg`.
`doctor` warns under `host.video.dependencies` when they are unavailable; this
advisory does not block ordinary device readiness. Screenshots still require
only ADB. See [video dependency setup and recovery](api/evidence.md#video-dependencies)
for CLI, Node, and MCP error details.

<a id="setup-step-verify-readiness-with-doctor"></a>
## 5. Verify readiness with doctor

```bash
androperator doctor
```

With explicit targeting:

```bash
androperator doctor --device <device_serial>
```

### Doctor checks

Doctor checks host prerequisites, adb/device discovery, Operator APK presence,
version compatibility, handshake readiness, and interactive device state. The
full check order, `DoctorReport` shape, `checks[]` fields, `nextActions`
behavior, and `--fix` semantics are owned by [Doctor](api/doctor.md#doctor-report-contract).

### Success conditions

- Exit code `0` means all critical checks passed.
- JSON has `"criticalOk": true`.
- `checks[]` contains only `"pass"` or non-critical `"warn"` statuses.

### Doctor flags

- `doctor --fix` can execute shell-type remediation steps from failed checks.
- `doctor --check-only` uses the same readiness exit status as plain doctor: `0` only when required checks pass, otherwise `1`. Inspect `skippedChecks` when prerequisites prevent verification.

See [Doctor](api/doctor.md) for the full report contract and [Errors](api/errors.md) for recovery by code.

<a id="setup-step-run-first-command"></a>
## 6. Run the first command

```bash
androperator snapshot
```

With explicit targeting:

```bash
androperator snapshot --device <device_serial>
```

Success conditions:

- Exit code `0`.
- `envelope.status` is `"success"`.
- `envelope.stepResults[0].actionType` is `"snapshot"`.
- `envelope.stepResults[0].success` is `true`.
- `envelope.stepResults[0].data.text` contains the XML hierarchy.

If the snapshot step succeeds but `data.text` is missing, Node converts that step into `SNAPSHOT_EXTRACTION_FAILED`.

## Agent sequence

### Brain / hand model

Androperator is the hand. The agent is the brain. The agent decides what to do, then calls the Node CLI or the local serve API with explicit commands and waits for a structured result envelope.

### Programmatic first-run sequence

1. Run `androperator doctor [--device <serial>] [--operator-package <pkg>]`.
2. If `readiness.apk.presence` fails, run `androperator operator setup --apk <path> ...`.
3. If `readiness.handshake` fails after a known-good install, run `androperator grant-device-permissions ...`.
4. For multiple failures, `androperator doctor --fix ...` auto-executes shell remediation steps.
5. Re-run `androperator doctor ...` and require `criticalOk: true`.
6. Run `androperator snapshot ...`.
7. Branch only on structured fields: `criticalOk`, `checks[].code`, `envelope.status`, `envelope.errorCode`, `stepResults[].success`.

### How to confirm success without a human

- Treat `doctor` as ready only when `criticalOk` is `true`.
- Treat a device command as successful only when `envelope.status` is `"success"` and every `stepResults[].success` is `true`.
- Prefer exact codes over message matching. Examples: `NO_DEVICES`, `OPERATOR_NOT_INSTALLED`, `RESULT_ENVELOPE_TIMEOUT`.

### Common first-run failures and recovery

| Code | Meaning | Recovery |
| --- | --- | --- |
| `NO_DEVICES` | No adb target in state `device` | Connect or boot a target, rerun `androperator devices` then `doctor`. |
| `DEVICE_UNAUTHORIZED` | adb key prompt not accepted | Accept the prompt on the device screen, rerun `doctor`. |
| `DEVICE_OFFLINE` | Device unreachable | `adb kill-server && adb start-server`, rerun `doctor`. |
| `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED` | More than one target connected | Pick a serial from `androperator devices`, pass `--device <serial>` to all commands. |
| `OPERATOR_NOT_INSTALLED` | Expected package missing | `androperator operator setup --apk <path> [--device <serial>]`. |
| `OPERATOR_VARIANT_MISMATCH` | Release/debug package mismatch | Pass `--operator-package <installed-package>` or reinstall the intended APK. |
| `DEVICE_ACCESSIBILITY_NOT_RUNNING` | Handshake returned a runtime failure | `androperator grant-device-permissions [--device <serial>]`, rerun `doctor` and `snapshot`. |
| `RESULT_ENVELOPE_TIMEOUT` | Broadcast sent, no result envelope arrived | If no correlated log lines were captured, run `doctor` to check version compatibility and accessibility; otherwise re-grant permissions, rerun `snapshot --timeout 5000 --verbose`, and verify `--operator-package`. |
| `VERSION_INCOMPATIBLE` | CLI and APK version mismatch | Reinstall CLI (`npm install -g @androperator/cli@latest`) or APK to align versions. |

### When to pass `--device` and `--operator-package`

- `--device <serial>`: required when more than one target is connected.
- `--operator-package <package>`: required when both release and debug variants are installed on the same device.

For deterministic automation, always pass both flags explicitly.

## Debugging setup issues

If setup fails, use `androperator logs` to inspect what happened:

```bash
# Stream logs in one terminal
androperator logs

# Run the failing command in another terminal
androperator doctor --device <device_serial> --operator-package <package>
```

Log file location: `~/.androperator/logs/androperator-YYYY-MM-DD.log`

Key events to look for:

- `doctor.check` - Individual doctor check results
- `adb.command` / `adb.complete` - ADB operations
- `preflight.apk.pass` / `preflight.apk.missing` - APK presence checks

See [Logging](api/logging.md) for complete documentation.

## Related pages

- [Host Agent Orientation](host-agents.md)
- [Quickstart](quickstart.md)
- [API Overview](api/overview.md)
- [Devices](api/devices.md)
- [Doctor](api/doctor.md)
- [Errors](api/errors.md)
- [Environment Variables](api/environment.md)
- [Troubleshooting](troubleshooting/operator.md)
- [Logging](api/logging.md)

## Caller-Controlled Default Application Preparation

Some flows require a default browser before automation starts. Doctor verifies
the selected Operator; it does not assign Android application roles or choose a
default application. Provision roles separately on a dedicated test device.

Inspect the shell capabilities and read the current role holder first:

```bash
DEVICE_ID=<device_serial>
APPLICATION_ID=<application_id>
adb -s "$DEVICE_ID" shell cmd role help
adb -s "$DEVICE_ID" shell cmd role get-role-holders --user 0 android.app.role.BROWSER
```

Only if the device supports these commands and changing that default is intended,
assign the role and read it back:

```bash
adb -s "$DEVICE_ID" shell cmd role add-role-holder --user 0 android.app.role.BROWSER "$APPLICATION_ID"
adb -s "$DEVICE_ID" shell cmd role get-role-holders --user 0 android.app.role.BROWSER
```

A nonzero assignment status or a readback that does not contain the intended
application is preparation failure. Do not continue on the strength of command
acceptance alone. Shell role capabilities vary by Android version and device;
inspect `help` on the actual target. This recipe's read-only capability checks
were verified on an API 35 emulator. That emulator printed the supported commands
but returned a nonzero status for `help`; the role-holder read returned zero.
Role assignment and physical-device behavior are not part of the readiness proof.

## Sensitive hierarchy access

The Operator can read views Android marks as accessibility-data sensitive.
Both development and release APKs declare `android:isAccessibilityTool="true"`.
Android [defines this declaration](https://developer.android.com/reference/android/accessibilityservice/AccessibilityServiceInfo#attr_android:isAccessibilityTool)
as identifying services used to assist users with disabilities. Androperator is
distributed outside Google Play.

Install the matching APK using `androperator operator setup --apk <apk_path>`
with the explicit device and Operator package. Wait for setup to succeed before
issuing UI commands. If the accessibility service is unavailable, enable the
selected Operator in Android accessibility settings and run `androperator doctor`.
If it is already enabled but remains unavailable, turn it off and back on, then
rerun doctor.

Queries and XML snapshots work on supported Android versions. The
[per-node sensitivity flag](api/actions.md#action-query-ui) is available on
Android 14 (API 34) and later. On earlier versions, queries report
`accessibilityDataSensitive: null` and XML omits `accessibility-data-sensitive`.
This API requirement applies to the flag, not to queries or XML capture.

Applications can still have no accessible hierarchy. Sensitivity metadata does
not change screenshot capture, redaction, or logging behavior.

For screen-off notification/media observation, use
`androperator doctor --capability background-observation` after setup. The default
interactive doctor can fail on a locked screen while these reads remain available.
See [background readiness](api/doctor.md#background-observation-readiness).
