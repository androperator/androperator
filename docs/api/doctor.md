# Doctor

For a complete discovery, strict selection, scroll, assertion, and capture workflow,
see [scoped selection walkthrough](scoped-selection.md).

## Purpose

Define the `androperator doctor` report contract, the exact check sequence, critical-versus-advisory behavior, exit-code rules, and the remediation fields an agent can execute directly.

## Sources

- Report contract: `apps/node/src/contracts/doctor.ts`
- CLI behavior and pretty output: `apps/node/src/cli/commands/doctor.ts`
- Check sequencing and `nextActions`: `apps/node/src/domain/doctor/DoctorService.ts`
- Critical check list: `apps/node/src/domain/doctor/criticalChecks.ts`
- Check implementations: `apps/node/src/domain/doctor/checks/`

## Command

```bash
androperator doctor [--device <serial>] [--operator-package <pkg>] [--fix] [--full] [--check-only]
```

Flags:

| Flag | Valid values | Effect |
| --- | --- | --- |
| `--device` | adb serial | targets one device explicitly |
| `--operator-package` | package name string | overrides the default operator package for package checks, launch, and handshake |
| `--fix` | flag | attempts shell remediation once, then reruns checks before reporting readiness |
| `--full` | flag | adds Java/build/install/launch/smoke checks |
| `--check-only` | flag | accepted for compatibility; uses the same readiness exit status as plain doctor |
| `--output` | `json`, `pretty` | selects the output renderer; use `--output json` when you want to request JSON explicitly |
| `--format` | `json`, `pretty` | alias for `--output` |

Defaults:

- without `--operator-package`, doctor uses `process.env.ANDROPERATOR_OPERATOR_PACKAGE` when it is non-blank, otherwise the runtime default package
- without `--device`, doctor tries discovery first and may auto-resolve one connected device
- without `--full`, doctor skips Java/build/install/launch/smoke checks
- without `--fix`, doctor reports remediation steps but does not run them
- output defaults to the full `DoctorReport` JSON object
- use `--output json` when you want to request JSON explicitly

<a id="doctor-report-contract"></a>
## `DoctorReport` Contract

`DoctorReport` is:

```json
{
  "ok": true,
  "criticalOk": true,
  "deviceId": "optional string",
  "operatorPackage": "optional string",
  "checks": [
    {
      "id": "host.node.version",
      "status": "pass",
      "code": "optional string",
      "summary": "summary string",
      "detail": "optional detail",
      "fix": {
        "title": "fix title",
        "platform": "mac",
        "steps": [
          { "kind": "shell", "value": "command" },
          { "kind": "manual", "value": "instruction" }
        ],
        "docsUrl": "optional URL"
      },
      "deviceGuidance": {
        "screen": "screen name",
        "steps": ["manual on-device step"]
      },
      "evidence": {}
    }
  ],
  "skippedChecks": [],
  "nextActions": ["optional command or instruction"]
}
```

Field meaning:

| Field | Meaning |
| --- | --- |
| `ok` | currently the same value as `criticalOk`; true only when every required check for the selected mode ran and passed |
| `criticalOk` | true when every required check for the selected mode has status `pass` |
| `deviceId` | resolved device serial, if doctor could determine one |
| `operatorPackage` | package used for doctor checks |
| `checks` | ordered list of `DoctorCheckResult` entries |
| `skippedChecks` | required checks omitted because prerequisite verification stopped; entries contain `id`, `reason`, and `blockedBy` check IDs; empty on success |
| `nextActions` | deduplicated shell commands or manual instructions collected from failing/warning checks, plus a success hint when everything passed |

## How `nextActions` Is Built

The report lists deduplicated shell commands and manual guidance from non-passing
checks. When all checks pass, it includes the setup documentation and a suggested
snapshot command. An empty `nextActions` list does not prove readiness.

With `--fix`, doctor attempts shell steps once and then reruns the selected mode
without another automatic repair pass. The returned checks, skipped checks, and
next actions describe that fresh verification. Failed repairs remain failures
unless the new checks independently verify readiness.

<a id="doctor-check-result-contract"></a>
## `DoctorCheckResult` Contract

Each entry in `checks[]` has:

| Field | Valid values | Meaning |
| --- | --- | --- |
| `id` | string | stable check identifier such as `device.discovery` |
| `status` | `pass`, `warn`, `fail` | check outcome |
| `code` | optional error code or runtime string | machine-usable reason for warnings or failures |
| `summary` | string | one-line status summary |
| `detail` | optional string | longer explanation or stderr |
| `fix.title` | string | remediation summary |
| `fix.platform` | `mac`, `linux`, `win`, `any` | host platform scope for remediation |
| `fix.steps[].kind` | `shell`, `manual` | whether the step can be executed directly or requires human action |
| `fix.steps[].value` | string | command or manual instruction |
| `fix.docsUrl` | optional URL | direct docs link for that failure family |
| `deviceGuidance.screen` | string | Android screen where the user should go |
| `deviceGuidance.steps[]` | string array | manual on-device guidance |
| `evidence` | optional object | structured proof such as versions, serials, or display metrics |

## Passing JSON Example

Excerpt; advisory checks are omitted.

```json
{
  "ok": true,
  "criticalOk": true,
  "deviceId": "<device_serial>",
  "operatorPackage": "com.androperator.operator.dev",
  "checks": [
    {
      "id": "host.node.version",
      "status": "pass",
      "summary": "Node version v24.14.1 is compatible."
    },
    {
      "id": "host.adb.presence",
      "status": "pass",
      "summary": "adb is installed.",
      "evidence": {
        "version": "Android Debug Bridge version 1.0.41"
      }
    },
    {
      "id": "host.adb.server",
      "status": "pass",
      "summary": "adb server is healthy."
    },
    {
      "id": "device.discovery",
      "status": "pass",
      "summary": "Device <device_serial> is connected and reachable.",
      "evidence": {
        "serial": "<device_serial>"
      }
    },
    {
      "id": "device.capability",
      "status": "pass",
      "summary": "Device shell is available.",
      "evidence": {
        "sdk": "34",
        "wmSize": "Physical size: 1080x2400",
        "wmDensity": "Physical density: 420"
      }
    },
    {
      "id": "readiness.apk.presence",
      "status": "pass",
      "summary": "Operator APK (com.androperator.operator.dev) is installed."
    },
    {
      "id": "readiness.version.compatibility",
      "status": "pass",
      "summary": "CLI 0.1.0 is compatible with installed APK 0.1.0.",
      "evidence": {
        "cliVersion": "0.1.0",
        "apkVersion": "0.1.0",
        "apkVersionCode": 1,
        "operatorPackage": "com.androperator.operator.dev"
      }
    },
    {
      "id": "readiness.handshake",
      "status": "pass",
      "summary": "Handshake successful.",
      "detail": "Node successfully dispatched a command and received a valid result envelope."
    },
    {
      "id": "readiness.device.interactive",
      "status": "pass",
      "summary": "Device is interactive.",
      "evidence": {
        "deviceLocked": false,
        "screenOn": true,
        "userUnlocked": true
      }
    }
  ],
  "skippedChecks": [],
  "nextActions": [
    "Docs: https://docs.androperator.com/getting-started/first-time-setup/",
    "Try: androperator snapshot --device <device_serial>"
  ]
}
```

Success conditions:

- exit code is `0`
- `criticalOk == true`
- every required check for the selected mode ran with `status == "pass"`

## Failing JSON Example

```json
{
  "ok": false,
  "criticalOk": false,
  "deviceId": "<device_serial>",
  "operatorPackage": "com.androperator.operator.dev",
  "checks": [
    {
      "id": "readiness.device.interactive",
      "status": "fail",
      "code": "DEVICE_NOT_INTERACTIVE",
      "summary": "Device is not interactive.",
      "detail": "Interactive automation requires an awake, usable device state. screenOn=false deviceLocked=true userUnlocked=false",
      "evidence": {
        "deviceLocked": true,
        "screenOn": false,
        "userUnlocked": false
      }
    }
  ],
  "nextActions": [
    "On device, wake and unlock the target before rerunning doctor."
  ]
}
```

Failure conditions:

- exit code is `1`, including with `--check-only`
- `criticalOk == false`
- at least one required check failed, warned, or was not run

## Warning JSON Example

Multiple connected devices without `--device` retain a warning diagnostic but fail readiness. This report excerpt shows the discovery result and one skipped check:

```json
{
  "ok": false,
  "criticalOk": false,
  "checks": [
    {
      "id": "device.discovery",
      "status": "warn",
      "code": "MULTIPLE_DEVICES_DEVICE_ID_REQUIRED",
      "summary": "Multiple devices connected.",
      "detail": "Specify --device to target a single device.",
      "evidence": {
        "devices": ["<device_serial>", "<other_device_serial>"]
      }
    }
  ],
  "skippedChecks": [
    {
      "id": "readiness.handshake",
      "reason": "Required check was not run because prerequisite verification did not complete.",
      "blockedBy": ["device.discovery"]
    }
  ]
}
```

Meaning:

- `ok` and `criticalOk` are `false`; the command exits `1`
- doctor still cannot continue into device-specific checks without an explicit target
- the next deterministic step is to rerun doctor with `--device <serial>`

## Check Sequence

Doctor runs checks in this order:

| Order | Check IDs | When they run |
| --- | --- | --- |
| 0 (advisory) | `host.logs.writable` | first; probes the daily log destination without truncating it |
| 1 | `host.node.version`, `host.adb.presence` | always |
| 1 (advisory) | `host.video.dependencies`, `host.skill-agent-cli.default`, `host.skill-agent-cli.skills`, `host.bundled-skills.staleness` | after `host.adb.presence` passes; advisory only, never halt on failure |
| 1 | `host.adb.server` | after `host.adb.presence` passes |
| 2 | `host.java.version`, `build.android.assemble` | only with `--full` |
| 3 | `device.discovery` | always |
| 4 | device resolution via `resolveDevice.ts` | after discovery when doctor still needs a target device |
| 5 | `build.android.install`, `build.android.launch` | only with `--full` and after device resolution |
| 6 | `device.capability` | after device resolution |
| 7 | `readiness.apk.presence` | after device capability |
| 8 | `readiness.version.compatibility` | only if APK presence passed |
| 9 | `readiness.settings.dev_options`, `readiness.settings.usb_debugging` | after version compatibility passes |
| 10 | `readiness.handshake` | only if APK presence passed and version compatibility passed |
| 11 | `readiness.device.interactive` | only if handshake passed |
| 12 | `readiness.smoke` | only with `--full`, and only if handshake and interactive-state checks passed |

Halting rule:

- doctor stops the required sequence when a required check does not pass
- omitted required checks appear in `skippedChecks`, with the blocking check ID
- optional host-agent, log-path, and settings warnings remain advisory
- normal mode does not require or list full-only checks as skipped

## Critical Vs Advisory

Critical checks are any checks whose ID starts with one of these prefixes:

```text
host.node.version
host.adb.presence
host.adb.server
host.java.version
device.discovery
device.capability
build.android.assemble
build.android.install
build.android.launch
readiness.apk.presence
readiness.version.compatibility
readiness.handshake
readiness.device.interactive
readiness.smoke
```

Advisory behavior:

- checks not matching those prefixes can still appear as `warn`
- advisory warnings remain in `checks[]` but do not set `criticalOk` to `false`
- in current code, `readiness.settings.*` checks are warn-only when they fail

Important special case:

- `device.discovery` with `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED` is a `warn`, not a `fail`
- readiness is false because the selected target has not been verified; pass `--device` and rerun doctor

## Exit Codes

`cmdDoctor` sets the exit code like this:

| Condition | Exit code |
| --- | --- |
| all required checks pass, with or without `--check-only` | `0` |
| otherwise | `1` |

Machine-checkable success gate:

- require exit code `0`
- require `criticalOk == true`
- require the reported device and Operator package to be the intended target

## `--fix` Behavior

`--fix` attempts shell remediation steps once. It never changes the selected
Operator package, uninstalls an alternate variant, or assigns default application
roles. Manual steps remain caller-owned. After any shell attempt, doctor reruns
the selected mode, including prerequisites, version verification, and handshake
when reachable. The returned report contains only the fresh check results.

A shell command exiting successfully is not proof of readiness. The new checks
must pass. If prerequisites still fail, downstream checks remain explicitly
skipped, and the command exits `1`. Another repair attempt requires a new call.

### Migration from earlier doctor behavior

`--check-only` no longer forces exit `0`. Callers that need to collect a failed
report should explicitly handle a nonzero status and inspect its JSON. A missing
selected APK with an alternate variant installed now has status `fail` and code
`OPERATOR_VARIANT_MISMATCH`. Multiple unselected devices retain their warning
code but now produce `ok=false` and `criticalOk=false`. Consumers must allow the
additive `skippedChecks` field. No device or package is switched implicitly.

## Pretty Output

Pretty output is grouped into:

- critical checks
- advisory checks
- count of additional passed non-critical checks
- skipped required checks and their blocking IDs
- final summary line
- `Next actions:` section

For a failing check, pretty output includes:

- `summary`
- `detail` when present
- `fix.title`
- each `fix.steps[].value`, with shell commands wrapped in Markdown backticks
- `Docs: <fix.docsUrl>` when present
- on-device guidance grouped under `On device (<screen>):`

The `Next actions:` section also wraps shell commands in backticks. JSON output
keeps executable shell step values unchanged so callers can use them directly.

## Optional video dependencies

`host.video.dependencies` probes scrcpy, ffmpeg, and ffprobe on the host PATH.
FFmpeg must be 6.1 or newer and successfully encode two synthetic frames with
libx264 and the actual passthrough/demux timing options before this check passes.
Missing, unusable, or unsupported tools produce a warning; normal readiness and
its exit status still depend on the required checks. `evidence.capability` is
`video-recording`, and `evidence.dependencies` lists the unmet dependencies with
`dependency`, `reason`, and `requirement`. An empty list means the host probes
passed, not that device recording has been verified.

Remediation is manual: `doctor --fix` does not install these optional tools.
[Video prerequisites and recovery](evidence.md#video-dependencies) describe the
required capabilities and structured video-start error. Still screenshots use
ADB and do not require these tools.

## Check Reference

| Check ID | Statuses seen in current code | Typical codes | What it verifies |
| --- | --- | --- | --- |
| `host.logs.writable` | `pass`, `warn` | `LOG_DIRECTORY_UNWRITABLE` | actual daily log file can be opened for append; evidence includes `logDir`, `logPath`, `writable`; advisory only |
| `host.node.version` | `pass`, `fail` | `NODE_TOO_OLD` | Node.js major version is at least 24 |
| `host.adb.presence` | `pass`, `fail` | `ADB_NOT_FOUND` | adb exists and can report a version |
| `host.video.dependencies` | `pass`, `warn` | `HOST_DEPENDENCY_MISSING` | optional video host tools: scrcpy capture-orientation support, FFmpeg 6.1+ with a working libx264/timing capability probe, and runnable ffprobe; advisory only |
| `host.adb.server` | `pass`, `fail` | `ADB_SERVER_FAILED` | adb server can start |
| `host.skill-agent-cli.default` | `pass`, `warn` | `HOST_DEPENDENCY_MISSING` | default orchestrated-skill agent CLI is a valid executable name and exists on PATH |
| `host.skill-agent-cli.skills` | `pass`, `warn` | `HOST_DEPENDENCY_MISSING` | all installed orchestrated skills can resolve their configured agent CLI executable |
| `host.bundled-skills.staleness` | `pass`, `warn` | `AGENT_SKILLS_STALE` | when bundled skills are present, the canonical install store is readable, packaged skills are present, managed Claude discovery links point at the canonical store, and shared `~/.agents/skills/` discovery entries are managed real directory copies; Codex-specific links are not required |
| `host.java.version` | `pass`, `fail` | `HOST_DEPENDENCY_MISSING` or no explicit code | Java 17 or 21 is available for full Android build checks |
| `build.android.assemble` | `pass`, `fail` | `ANDROID_BUILD_FAILED` | `./gradlew :app:assembleDebug` succeeds |
| `device.discovery` | `pass`, `warn`, `fail` | `NO_DEVICES`, `DEVICE_UNAUTHORIZED`, `DEVICE_OFFLINE`, `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`, `DEVICE_NOT_FOUND` | device discovery succeeded and the environment is targetable, or explains why explicit `--device` selection is still required |
| `build.android.install` | `pass`, `fail` | `ANDROID_INSTALL_FAILED` | `./gradlew :app:installDebug` succeeds |
| `build.android.launch` | `pass`, `fail` | `ANDROID_APP_LAUNCH_FAILED` | Operator main activity launches |
| `device.capability` | `pass`, `fail` | `DEVICE_SHELL_UNAVAILABLE` or no explicit code | shell access, SDK version, screen size, and density are readable |
| `readiness.apk.presence` | `pass`, `fail` | `DEVICE_SHELL_UNAVAILABLE`, `OPERATOR_VARIANT_MISMATCH`, `OPERATOR_NOT_INSTALLED` | requested operator package is installed |
| `readiness.version.compatibility` | `pass`, `fail` | `VERSION_INCOMPATIBLE`, `APK_VERSION_UNREADABLE`, `APK_VERSION_INVALID`, `CLI_VERSION_INVALID` | CLI and installed APK are compatible |
| `readiness.settings.dev_options` | `pass`, `warn` | `DEVICE_DEV_OPTIONS_DISABLED` | developer options setting is enabled |
| `readiness.settings.usb_debugging` | `pass`, `warn` | `DEVICE_USB_DEBUGGING_DISABLED` | USB debugging setting is enabled |
| `readiness.handshake` | `pass`, `fail` | `DEVICE_ACCESSIBILITY_NOT_RUNNING`, `RESULT_ENVELOPE_TIMEOUT`, `BROADCAST_FAILED`, `OPERATOR_NOT_INSTALLED` | Node receives a successful result envelope containing a successful `doctor_ping` step |
| `readiness.device.interactive` | `pass`, `fail` | `DEVICE_NOT_INTERACTIVE`, or the underlying probe failure code if state could not be verified | the target is awake enough for interactive automation, with evidence fields `deviceLocked`, `screenOn`, and `userUnlocked` |
| `readiness.smoke` | `pass`, `fail` | `SMOKE_OPEN_SETTINGS_FAILED` | smoke execution returns terminal success and successful close, open, and snapshot steps with the requested IDs |

## Common Failure Recovery

### `NO_DEVICES`

Meaning:

- `checkDeviceDiscovery` saw no adb entries at all

Recovery:

- connect a device or boot an emulator
- rerun `androperator devices`
- rerun `androperator doctor`

### `DEVICE_UNAUTHORIZED`

Meaning:

- the target device is visible to adb but waiting for RSA authorization

Recovery:

- unlock the device
- accept the USB debugging prompt
- rerun doctor

### `DEVICE_OFFLINE`

Meaning:

- adb sees the device but it is not currently usable

Recovery:

```bash
adb kill-server
adb start-server
```

Then rerun doctor.

### `OPERATOR_NOT_INSTALLED`

Meaning:

- the requested package was not found by `pm list packages`

Recovery:

- if using release APKs, install the exact version doctor points to
- run the generated `androperator operator setup --apk ...` command from `nextActions`

### `OPERATOR_VARIANT_MISMATCH`

Meaning:

- the requested package is missing, but the alternate known package variant is installed

Recovery:

- either pass `--operator-package` for the installed variant
- or reinstall the intended variant

### `RESULT_ENVELOPE_TIMEOUT`

Meaning:

- handshake broadcast was sent, but no `[Androperator-Result]` envelope arrived within 7000ms

Recovery:

- run `androperator grant-device-permissions --device <serial> [--operator-package <pkg>]`
- rerun `androperator snapshot --device <serial> [--operator-package <pkg>] --timeout 5000 --verbose`
- verify accessibility service is enabled

### `DEVICE_ACCESSIBILITY_NOT_RUNNING`

Meaning:

- handshake returned an envelope, but the runtime reported an accessibility-related failure

Recovery:

- run `androperator grant-device-permissions ...`
- follow `deviceGuidance.screen == "Accessibility Settings"`
- rerun doctor

### `DEVICE_NOT_INTERACTIVE`

Meaning:

- handshake succeeded, so the runtime is reachable
- the follow-up interactive-state probe reported that the target is not ready
  for interactive automation
- inspect the check evidence:
  - `screenOn`
  - `deviceLocked`
  - `userUnlocked`

Recovery:

- wake the device if `screenOn == false`
- unlock the device if `deviceLocked == true`
- complete the post-boot unlock if `userUnlocked == false`
- rerun `androperator doctor` and require:
  - exit code `0`
  - `criticalOk == true`
  - `readiness.device.interactive.status == "pass"`

## Agent Sequence

Recommended doctor loop:

1. Run `androperator doctor [--device <serial>] [--operator-package <pkg>]`.
2. Require exit code `0` and `criticalOk == true` before treating the environment as ready.
3. If `criticalOk == false`, iterate through `checks[]` in order and inspect the first non-passing required check and `skippedChecks`.
4. If `fix.steps[].kind == "shell"` and you trust the environment, either execute them yourself or rerun doctor with `--fix`.
5. If `deviceGuidance` is present, surface `deviceGuidance.screen` and `deviceGuidance.steps[]` to the human operator.
6. Rerun `doctor` after remediation and require `criticalOk == true`.
7. Only then move on to device commands such as `snapshot`.

## Related Pages

- [Setup](../setup.md)
- [Devices](devices.md)
- [Errors](errors.md)
- [Operator App Troubleshooting](../troubleshooting/operator.md)
- [Version Compatibility](../troubleshooting/compatibility.md)

## Background observation readiness

Use `androperator doctor --capability background-observation` to verify notification
and media queries without waking the display, dismissing keyguard, requiring
accessibility, clearing logs or launching an app. The selected capability appears
in JSON output. Failure returns a nonzero exit; an empty successful query is ready.
This mode rejects --full and --fix before side effects. Default doctor (or explicit
--capability interactive) retains interactive readiness requirements. An interactive
doctor failure alone does not veto [background observations](notifications.md).

Before first unlock after reboot, the background query check reports
`DEVICE_USER_NOT_UNLOCKED` when Android exposes the locked user state. This is
distinct from an ordinary keyguard lock after the user has unlocked once. No
automatic unlock or permission repair occurs.
