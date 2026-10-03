---
name: test-io-speeds
description: Measure Androperator snapshot and daemon latency for selected Android devices and app screens.
---

# Test I/O Speeds

Measure repeated `snapshot` latency with the branch-local Node CLI, a locally
built Operator APK, and explicit device selection.

## Inputs

Ask for or infer these inputs:

- target device serial, after running `adb devices -l`
- Operator variant, usually release package `com.androperator.operator`
- app list, each with:
  - `id`
  - `name`
  - `packageName`
  - optional `allowedForegroundPackages` for apps that legitimately hand off to
    another foreground package during launch
  - optional screen-prep notes to perform manually before measurement
- output directory for local artifacts, defaulting to
  `~/.androperator/timings/YYYY-MM-DD/<device_serial>`

Use the requested devices. For a requested emulator-versus-physical comparison,
run the timing set on both with the emulator as baseline. For a single-device
measurement, do not expand the run to every connected device. Always pass
`--device <device_serial>`.

If the caller does not specify apps, use this default app list:

- Android Settings: `com.android.settings`
- YouTube: `com.google.android.youtube`
- Google Play Store: `com.android.vending`

For other requested apps, resolve `id`, `name`, and `packageName` from the
request and device. Ask only if the target is ambiguous. Pass the list with
`--apps-file` or `--apps-json`; app IDs must be safe filename segments.

The harness first closes each target app through branch-local Androperator
`close <package>`, then opens it through `open <package>`. Do not hardcode
Android activity names in the default app set; let the device resolve the
launch activity from a clean app start.

## Required Method

1. Check devices first.

   ```bash
   adb devices -l
   node apps/node/dist/cli/index.js devices --format json
   ```

2. Build branch-local Node before using `dist/`.

   ```bash
   npm --prefix apps/node run build
   ```

3. Build the APK variant being tested.

   For release timing:

   ```bash
   ./gradlew :app:assembleRelease
   ```

4. Install and grant the matching Operator package.

   For release timing:

   ```bash
   adb -s <device_serial> install apps/android/app/build/outputs/apk/release/app-release.apk
   ./scripts/androperator_grant_android_permissions.sh --release --serial <device_serial>
   ```

   If signature mismatch blocks install, uninstall only the target Operator
   package after confirming the package is the one being tested.

5. Enable Android timing logs only for the measurement run.

   ```bash
   adb -s <device_serial> shell setprop log.tag.ClawpSnapshotTiming DEBUG
   ```

6. Run the harness from the repo root.

   For a requested device comparison, run once for each selected serial.

   ```bash
   node .agents/skills/test-io-speeds/scripts/measure-snapshot-latency.mjs \
     --device <device_serial> \
     --operator-package com.androperator.operator \
     --warmups 3 \
     --measured 10
   ```

   To provide a custom app list:

   ```bash
   node .agents/skills/test-io-speeds/scripts/measure-snapshot-latency.mjs \
     --device <device_serial> \
     --apps-file /path/to/apps.json
   ```

7. Confirm every measured result contains a valid snapshot text payload. Do not
   rely on exit code alone. The harness also verifies that the snapshot
   foreground package matches the requested app package or one of the app
   spec's `allowedForegroundPackages`.

8. Summarize the JSON outputs into a markdown report. Do not commit raw artifact
   JSON, logcat captures, host logs, screen text, or local device serials.

## Harness Output

For each app, the harness writes:

- `<app-id>.json`
- `<app-id>-direct-daemon.json`

By default, these files are written under
`~/.androperator/timings/YYYY-MM-DD/<device_serial>`. Pass `--out-dir <path>`
only when the caller explicitly wants another local artifact directory.

The normal mode removes raw host logs after extracting summary timing. Passing
`--keep-raw-logs` keeps host logs and logcat captures locally for debugging;
those files must not be committed.

## What To Report

Report:

- commit and version tested
- APK variant, package id, and sha256
- device serial redacted if the report will be committed
- emulator or physical model and Android version
- app package and screen context
- warmup count and measured count
- per-call wall time, payload bytes, node count
- mean, median, min, max, and p95
- direct daemon mean and median
- Android operator snapshot timing when `ClawpSnapshotTiming` logs are present
- failed runs, timeouts, app readiness issues, and instrumentation caveats

## Interpretation Rules

- Fresh CLI timing includes process startup, CLI parsing, daemon discovery,
  daemon proxying, result parsing, and output formatting.
- Direct daemon timing removes fresh CLI startup and is the better proxy for a
  future persistent client.
- Release APK timing is the product baseline. Debug APK timing is useful only
  for local development diagnostics.
- Emulator and physical-device results are not interchangeable. Record both
  when comparing them.
