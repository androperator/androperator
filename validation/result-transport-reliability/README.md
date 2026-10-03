# Result transport reliability series

This manual harness runs exactly 20 immediate Settings open/query cycles and
20 full Internet queries on one explicit API-35 English device. Install the
matching APK and activate only its accessibility service first. It uses the
branch-local CLI with daemon routing disabled. It never retries an attempt. A failed open stops the series so a later cycle
cannot replay an uncertain mutation; remaining declared attempts are unrun.
Failed read-only queries are retained while the fixed series continues.

```sh
python3 validation/result-transport-reliability/run.py \
  --device <device_serial> --operator-package com.androperator.operator.dev \
  --trace-adb-shell \
  --apk apps/android/app/build/outputs/apk/debug/app-debug.apk \
  --out /tmp/result-transport-debug
```

Repeat separately for the release package and APK. Each output directory must
be new. The harness takes the shared device lock and verifies API, language and
selected service. The caller must install the supplied APK first; its hash is
recorded alongside installed package metadata, the source commit and built CLI
hashes. Raw command output and a bounded independent logcat tail are private
artifacts. Every attempt records identity, output size, duration and outcome;
failed attempts remain in the report. `summary.json` records completed, failed and
unrun counts and whether the independent reader exited before cleanup. Timeouts
are failures, not retries.

Delivery is counted separately in `canonicalEnvelopesReceived`. Each attempt
records `canonicalEnvelopeReceived` and a `failureCategory`: `android_action`
for a delivered failed action, `fixture` for a successful action that misses the
fixture, `host_exit` for a delivered successful result with a nonzero process
exit, or `host_or_transport` when no canonical result was delivered. The latter
does not imply device execution occurred; inspect the retained public code,
command correlation and raw stderr to distinguish preflight/host errors.

Before the next attempt after any failure, the harness saves a bounded device
log-buffer dump, host and device process lists, and device connection state.
Each observation keeps its invocation, timestamp, exit status, stdout/stderr
and truncation flags. Observation errors, including permission denial, are
retained without replacing the original failure or stopping safe read-only
attempts. Independent-reader exit is recorded per attempt as well as at cleanup.

`--trace-adb-shell` sets `ADB_TRACE=shell` only for the series children. The
runtime preserves its bounded stderr tail on failure; this is diagnostic
context, not a complete wire capture. Observations occur after the failure and
cannot prove that no brief interruption occurred. Keep these private artifacts
outside Git. Serialize builds and live runs: rebuilding Node removes `dist/`
and can prevent a concurrent CLI attempt from starting.

The Internet fixture is prepared using `android.settings.WIFI_SETTINGS`, then
verified through the full query's heading, sensitive root and Wi-Fi switch.
This focused transport check does not replace the hierarchy regression or its
homepage preparation and scrolling assertions. Run the combined hierarchy
[harness](../sensitive-hierarchy-access/README.md) with the integrated homepage
preparation and scroll handling before declaring release readiness.

Offline tests are included in `validation/test_all.sh --suite
validation`. Live runs are explicit only. See the [causal findings and recorded
limits](../../docs/internal/design/result-transport-reliability.md).
