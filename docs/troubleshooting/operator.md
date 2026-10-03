# Operator App

## Purpose

Diagnose installation, permission, handshake, and crash-recovery problems involving the Androperator Operator APK.

## Sources

- Setup command: `apps/node/src/cli/commands/operatorSetup.ts`
- Setup phases: `apps/node/src/domain/device/setupOperator.ts`
- Permission grants: `apps/node/src/domain/device/grantPermissions.ts`
- Readiness checks: `apps/node/src/domain/doctor/checks/readinessChecks.ts`
- Error codes: `apps/node/src/contracts/errors.ts`

## Operator Setup Phases

`androperator operator setup` is a three-phase workflow:

1. install APK
2. grant accessibility and notification permissions
3. verify the package is installed

Failures are surfaced with distinct structured codes:

| Phase | Code |
| --- | --- |
| local APK path missing | `OPERATOR_APK_NOT_FOUND` |
| adb install failed | `OPERATOR_INSTALL_FAILED` |
| permission grant failed | `OPERATOR_GRANT_FAILED` |
| post-install verification failed | `OPERATOR_VERIFY_FAILED` |

Successful setup returns all three phase objects plus a follow-up message:

```json
{
  "operatorPackage": "com.androperator.operator.dev",
  "install": {
    "ok": true
  },
  "permissions": {
    "accessibility": {
      "ok": true
    },
    "notification": {
      "ok": true,
      "skipped": false
    },
    "notificationListener": {
      "ok": true
    }
  },
  "verification": {
    "ok": true,
    "packageInstalled": true
  },
  "message": "Operator installed and ready. Run androperator doctor to verify."
}
```

Verification pattern after any repair:

```bash
androperator operator setup --apk <path> --device <device_serial> --operator-package <package>
androperator doctor --device <device_serial> --operator-package <package>
androperator snapshot --device <device_serial> --operator-package <package>
```

Treat the repair as complete only when:

- `operator setup` returns `install.ok: true`, successful permission objects, and `verification.ok: true`
- doctor reports `criticalOk: true`
- `readiness.apk.presence` and `readiness.handshake` are both passing checks
- `snapshot` returns a success envelope

## Installation Failures

### `OPERATOR_APK_NOT_FOUND`

Meaning:

- the local file given to `--apk` does not exist

Fix:

- verify the path on disk
- rerun `androperator operator setup --apk <path>`

Exact failure shape:

```json
{
  "code": "OPERATOR_APK_NOT_FOUND",
  "message": "APK file not found: /abs/path/to/operator.apk",
  "operatorPackage": "com.androperator.operator.dev",
  "install": {
    "ok": false,
    "error": "APK file not found: /abs/path/to/operator.apk"
  }
}
```

### `OPERATOR_INSTALL_FAILED`

Meaning:

- `adb install -r <apkPath>` returned non-zero

The error payload includes the install phase details from `setupOperator()`.

Typical fixes:

- confirm the device is connected and in adb state `device`
- rerun with the intended package variant
- verify the APK itself is buildable or downloadable

Exact failure shape:

```json
{
  "code": "OPERATOR_INSTALL_FAILED",
  "message": "adb: failed to install /abs/path/to/operator.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
  "operatorPackage": "com.androperator.operator.dev",
  "install": {
    "ok": false,
    "error": "adb: failed to install /abs/path/to/operator.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
    "exitCode": 1
  }
}
```

### `OPERATOR_VERIFY_FAILED`

Meaning:

- install completed, but `pm list packages` could not confirm the expected package afterward

Typical causes:

- multiple variants installed and package selection ambiguous
- wrong package expected after install

Exact failure shape:

```json
{
  "code": "OPERATOR_VERIFY_FAILED",
  "message": "Package com.androperator.operator.dev was not found after install.",
  "operatorPackage": "com.androperator.operator.dev",
  "install": {
    "ok": true
  },
  "verification": {
    "ok": false,
    "packageInstalled": false,
    "error": "Package com.androperator.operator.dev was not found after install."
  }
}
```

## Permission Issues

### `OPERATOR_GRANT_FAILED`

Meaning:

- one of the permission grant steps failed after install

Current permission steps are:

- accessibility service enablement
- notification permission grant
- notification listener enablement

Important implementation details:

- notification permission grant may be marked as skipped but still treated as okay for known Android responses like "already granted", "unknown permission", or "not a changeable permission type"
- accessibility and notification listener grants must succeed

Exact failure shape:

```json
{
  "code": "OPERATOR_GRANT_FAILED",
  "message": "Could not set accessibility_enabled",
  "operatorPackage": "com.androperator.operator.dev",
  "install": {
    "ok": true
  },
  "permissions": {
    "accessibility": {
      "ok": false,
      "error": "Could not set accessibility_enabled"
    },
    "notification": {
      "ok": true,
      "skipped": false
    },
    "notificationListener": {
      "ok": true
    }
  }
}
```

### `DEVICE_ACCESSIBILITY_NOT_RUNNING`

This usually appears from doctor or handshake flows when the APK is installed but the accessibility service is not active.

Recovery:

```bash
androperator grant-device-permissions --device <device_serial> --operator-package <package>
androperator doctor --device <device_serial> --operator-package <package>
```

Check the doctor response for:

- `checks[].id == "readiness.handshake"`
- `checks[].code == "DEVICE_ACCESSIBILITY_NOT_RUNNING"` when accessibility is still the problem
- `nextActions` including `androperator grant-device-permissions --device <device_serial> --operator-package <package>`

If that does not recover the device:

- reopen Android Accessibility Settings
- ensure the Androperator accessibility service is enabled
- rerun `doctor`

## Variant Mismatch

### `OPERATOR_VARIANT_MISMATCH`

Meaning:

- the device has one known Operator package installed, but it is not the package currently requested

Typical cases:

| Requested | Installed | Fix |
| --- | --- | --- |
| `com.androperator.operator` | `com.androperator.operator.dev` | pass `--operator-package com.androperator.operator.dev` or reinstall release |
| `com.androperator.operator.dev` | `com.androperator.operator` | pass `--operator-package com.androperator.operator` or reinstall debug |

Use `androperator doctor` to confirm which variant the readiness check found.

The readiness check emits a warning, not a hard setup failure:

```json
{
  "id": "readiness.apk.presence",
  "status": "warn",
  "code": "OPERATOR_VARIANT_MISMATCH",
  "summary": "Wrong Operator variant installed.",
  "detail": "Expected com.androperator.operator.dev but found com.androperator.operator.",
  "fix": {
    "title": "Switch variant"
  }
}
```

## Handshake Failures

### `RESULT_ENVELOPE_TIMEOUT`

Meaning:

- Node sent the command, but no `[Androperator-Result]` envelope was received before the timeout

The doctor handshake check uses:

- Android payload timeout: `5000`
- envelope wait timeout: `7000`

Exact doctor failure shape:

```json
{
  "id": "readiness.handshake",
  "status": "fail",
  "code": "RESULT_ENVELOPE_TIMEOUT",
  "summary": "Handshake timed out.",
  "detail": "No [Androperator-Result] envelope received within 7000ms. Broadcast dispatch: sent. Operator package: com.androperator.operator.dev. Device: <device_serial>. No correlated Android log lines were captured. This often indicates an APK/CLI version mismatch or an accessibility service issue. Run 'androperator doctor --device <device_serial> --operator-package <package>' to diagnose."
}
```

The trailing `Re-run with --verbose to inspect correlated Android log lines.` sentence is conditional and still appears when correlated Android log lines were captured. When no correlated log lines were captured, the timeout detail now points toward version compatibility or accessibility setup.

Recommended recovery:

```bash
androperator grant-device-permissions --device <device_serial> --operator-package <package>
androperator snapshot --device <device_serial> --operator-package <package> --timeout 5000 --verbose
androperator doctor --device <device_serial> --operator-package <package>
```

### `BROADCAST_FAILED`

Meaning:

- adb broadcast dispatch to the Operator package failed before a result envelope could be read

This is different from envelope timeout:

- timeout means dispatch happened but result was missing
- broadcast failure means the dispatch itself failed

If the broadcast diagnostics show the package is missing, the code can be `OPERATOR_NOT_INSTALLED` instead of `BROADCAST_FAILED`.

Typical failure shape:

```json
{
  "code": "BROADCAST_FAILED",
  "message": "Failed to dispatch broadcast to Operator package.",
  "details": {
    "broadcastDispatchStatus": "failed",
    "operatorPackage": "com.androperator.operator.dev",
    "deviceId": "<device_serial>"
  }
}
```

Recovery pattern:

- if the package is missing, reinstall with `androperator operator setup --apk <path> ...`
- if the package is present, rerun `doctor --verbose` and inspect the handshake detail plus `adb logcat`

## Crash Recovery

There is no dedicated "operator crashed" error code in the Node API. In practice, a crash often looks like one of these:

- `RESULT_ENVELOPE_TIMEOUT`
- `DEVICE_ACCESSIBILITY_NOT_RUNNING`
- handshake fails after a previously healthy setup

Recovery sequence:

1. rerun `androperator doctor --device <serial> --operator-package <pkg>`
2. if accessibility is down, run `androperator grant-device-permissions ...`
3. if package presence is wrong or missing, rerun `androperator operator setup --apk <path> ...`
4. rerun `doctor`
5. confirm with `androperator snapshot ...`

The runtime hint generated by execution failures also points here. When accessibility is down, `runExecution.ts` adds a hint like:

- `androperator doctor --fix --device <device_id>`
- `androperator operator setup --apk <path-to-apk> --device <device_id>`

If you need a fresh stable release APK outside `install.sh`, always redownload
it from the canonical public URL before rerunning setup:

- `https://androperator.com/operator.apk`

## Crash Logs Access

The Node CLI does not currently expose a dedicated crash-log command. Use adb logcat directly.

Useful commands:

```bash
adb -s <device_serial> logcat
adb -s <device_serial> logcat | rg 'androperator|AndroidRuntime|FATAL EXCEPTION'
adb -s <device_serial> logcat -d
```

For command-specific correlation, also use:

```bash
androperator snapshot --device <device_serial> --operator-package <package> --verbose
```

That helps line up CLI execution with Android-side logging.

Verification pattern:

- clear or dump logcat close to the failing command
- rerun one failing command such as `snapshot --verbose`
- search for `androperator`, `AndroidRuntime`, and `FATAL EXCEPTION`
- correlate the timestamp with the CLI command that failed

## Recommended Recovery Order

Use this order for a broken Operator state:

1. verify device connectivity with `androperator devices`
2. run `androperator doctor --device <serial> --operator-package <pkg>`
3. fix permissions with `androperator grant-device-permissions ...` if accessibility is the problem
4. rerun `androperator operator setup --apk <path> ...` if install or variant state is wrong
5. rerun `doctor`
6. confirm with `androperator snapshot ...`

## What Success Looks Like

Treat the Operator as recovered only when:

- `doctor` returns `criticalOk: true`
- `checks` includes a passing `readiness.apk.presence`
- `checks` includes a passing `readiness.handshake`
- a follow-up `snapshot` returns `envelope.status == "success"`

## Diagnostics and Logging

Use `androperator logs` to stream the log file in real time:

```bash
# In Terminal 1: start streaming logs
androperator logs

# In Terminal 2: run the failing command
androperator snapshot --device <device_serial> --operator-package <package>
```

The logs command dumps all existing log entries then streams new ones as they arrive. Press Ctrl+C to stop.

Log file location: `~/.androperator/logs/androperator-YYYY-MM-DD.log`

Useful patterns:

```bash
# Check for skill lifecycle events
grep '"event":"skills.run.start"' ~/.androperator/logs/androperator-$(date +%F).log

# Parse events with jq
jq -c 'select(.event | startswith("skills.run."))' ~/.androperator/logs/androperator-$(date +%F).log

# Follow logs in real time
tail -f ~/.androperator/logs/androperator-$(date +%F).log
```

See [Logging](../api/logging.md) for complete documentation.

## Related Pages

- [Setup](../setup.md)
- [Doctor](../api/doctor.md)
- [Devices](../api/devices.md)
- [Errors](../api/errors.md)
- [Version Compatibility](compatibility.md)
- [Logging](../api/logging.md)
