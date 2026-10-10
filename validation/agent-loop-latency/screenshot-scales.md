# Device-side screenshot scaling experiment

This low-level measurement compares stock `screencap -p` with a small shell-side
Java helper at 100%, 50% and 25% of both dimensions. It is not a production
screenshot API and does not change Operator behavior. UI navigation and readiness
must use the branch-local Androperator interface before running this benchmark.
Use one controller, an explicit device and a stable, verified screen.

The helper captures full-resolution raw pixels with `screencap`, constructs an
Android bitmap, downsizes with filtered platform scaling, and encodes PNG before
transferring it to the host. It saves encoding/transfer work, not the original
full-size capture. No third-party code or dependencies are added. The raw format
is intentionally limited to API 26 or API 36+, RGBA/RGBX pixels, and recognized
color spaces. API 26 on an emulator and API 37 on a physical phone have been
exercised; other devices must pass a pilot and visual comparison before measurement.
The API 26 raw format does not
report a color space; this experiment assumes sRGB for that legacy emulator.

## Build and run

Build Node first. Compile the Java file using the installed JDK and Android SDK,
then use the installed build-tools `d8` to produce `classes.dex`. Example paths
below are placeholders; select installed SDK versions and a private local output
directory. Keep all images, raw outputs and device identifiers out of Git.

```sh
npm --prefix apps/node run build
mkdir -p /absolute/private/output/classes /absolute/private/output/dex
javac --release 8 -classpath /absolute/sdk/platforms/android-36/android.jar \
  -d /absolute/private/output/classes validation/agent-loop-latency/ScaleCapture.java
/absolute/sdk/build-tools/36.0.0/d8 \
  --lib /absolute/sdk/platforms/android-36/android.jar \
  --output /absolute/private/output/dex /absolute/private/output/classes/ScaleCapture.class
adb -s <device_serial> push /absolute/private/output/dex/classes.dex /data/local/tmp/androperator-scale-experiment.dex
node apps/node/dist/cli/index.js doctor --device <device_serial> --operator-package com.androperator.operator.dev
# Prepare and verify the target screen through Androperator before continuing.
node validation/agent-loop-latency/screenshot-scales.cjs <device_serial> /absolute/private/output/new-fresh-trial
node validation/agent-loop-latency/screenshot-scales.cjs <device_serial> /absolute/private/output/new-persistent-trial --persistent
adb -s <device_serial> shell rm /data/local/tmp/androperator-scale-experiment.dex
```

Each new trial directory must not exist, and its parent must exist. One warmup
per variant precedes eight measured samples per variant with rotating order.
The stock variant always starts a fresh `screencap` process. Fresh helper mode
also starts `app_process` for each capture. Persistent mode keeps one Java process
and a bidirectional, non-PTY ADB shell open; every request still captures new raw
pixels. Its first warmup includes session startup. No cached frames are returned.
Each trial also runs branch-local doctor and stops before capture if readiness
fails. The readiness results and logs are retained in the private trial directory.

## Direct reduced-buffer backend

Compile `DirectCapture.java` alongside `ScaleCapture.java`, include both class
files in the dex build, and run the same harness with `--direct`. This always
uses a persistent session. Stock PNG capture remains a full-size control.

This backend has been exercised only on the tested physical API 37 build. It
uses the device's internal `IWindowManager.captureDisplay` and
`ScreenCaptureInternal.CaptureArgs` APIs, with a full-display source crop and
frame scale calculated from the requested output dimensions. The returned
HardwareBuffer dimensions are verified before readback. No bitmap resize occurs;
only that returned buffer is copied into a software bitmap and PNG-encoded.
The host validates buffer dimensions, PNG dimensions, rotation, response sequence
and phase timings. Source geometry is obtained from logical display 0, which
must correspond to the host-selected primary display.

These are internal interfaces, not a portable public Android screenshot API.
The earlier `ScreenCapture.DisplayCaptureArgs` API was absent on this device.
Do not silently fall back to full-size capture or claim equivalent performance
on other Android builds. This experiment adds no dependencies or platform code.

The helper checks display geometry, rotation, awake state and keyguard before
capture and again before publishing. Any discrepancy ends the session. This
closes a live-discovered failure where rotation could leave a requested-size
buffer with an outdated crop. Checks bracket capture; they are not an atomic
display-state transaction and cannot rule out every change-and-change-back race.
Secure/protected content policies request an error, and an unexpected returned
secure-content flag is rejected. Secure/HDR behavior has not been validated with
such content. The test uses ordinary Settings screens and includes system overlays.

`deviceCaptureMs` includes the initial state check, capture request and wait for
the hardware buffer. `readbackMs` includes wrapping/copying it and the second
state check. `encodeAndWriteMs` includes PNG encoding and output backpressure.
All overlap host `captureMs`; do not add them to the host total. Warmup and session
startup remain separate from the eight measured samples per variant.

## Evidence and interpretation

- Host `captureMs` includes request/process overhead, capture, encoding and
  transfer; `firstByteMs` does not isolate capture from encoding.
- `verifyMs` fully decodes the PNG with CRC validation; `persistMs` writes it.
  `totalMs` sums those three phases. It excludes display selection, CLI readiness,
  UI navigation, metadata-file writes and any model requests.
- Device `rawCaptureAndBitmapMs` includes subprocess startup, raw acquisition,
  local pipe transfer and bitmap construction. `scaleMs` covers bitmap scaling.
  `encodeAndWriteMs` includes PNG encoding and pipe backpressure. These overlap
  host capture time; never add them to it or subtract unsynchronized clocks.
- The capture packet contains a PNG followed by one timing line. Parse PNG chunk
  boundaries, reject unexpected bytes and verify the PNG. This matters because
  `adb exec-out` merges remote stderr into stdout. Persistent mode uses `shell -T`
  because `exec-out` did not deliver interactive requests on the tested emulator.
- Actual dimensions must match the source viewport and floor-rounded scale.
  Display geometry is checked before/after each trial. Keep the device stable;
  this does not detect every transient rotation or prove scene stability.
- Retain failed attempts. Inspect `completed`, `failure` and sample failures,
  not only successful aggregates. A timeout poisons the persistent session.
- Check full-size helper pixels against stock and visually inspect reduced images.
  Small-text inspection is qualitative, not a model accuracy benchmark. The Jev
  Settings loop never consumes PNGs, so its success would not validate visual
  accuracy. Model preprocessing is outside this experiment.
- A production scaled screenshot must expose original dimensions, actual output
  dimensions, rotation/crop transforms and freshness. Existing helper code assumes
  PNG dimensions equal the device viewport; do not feed scaled images to it.

Tests: `node --test validation/agent-loop-latency/screenshot-scales.test.cjs`.
The suite is included in `validation/test_runner.py` after the Node build.
