# Persistent screenshot validation

Off-device package/CLI regression checks run through the shared validation suite:

```sh
npm --prefix apps/node run build
node --test validation/persistent-screenshots/package.test.mjs
node --test apps/node/dist/test/unit/captureHelper.test.js
```

The helper's source and packaged artifact are rebuilt with
`bash apps/capture-helper/build.sh`. See the
[durable design](../../docs/internal/design/persistent-screenshots.md) and
[public contract](../../docs/api/actions.md#action-take-screenshot).

## Explicit live runs

Select a physical device with `adb devices -l`; install the matching development
Operator through branch-local `operator setup` and use its development package.
No device work runs in CI. These commands deliberately display changing
on-screen diagnostic labels, capture images, then clear the labels. The fault
harness changes/restores rotation, kills its exact owned helper process and
forces an ADB transport reconnect. Do not run another controller concurrently.
No app navigation is replayed and no model calls are made.

```sh
node validation/persistent-screenshots/live.mjs <device_serial> /tmp/capture-backend <local_ocr_executable> backend
node validation/persistent-screenshots/live.mjs <device_serial> /tmp/capture-api <local_ocr_executable> api
node validation/persistent-screenshots/live.mjs <device_serial> /tmp/capture-cli <local_ocr_executable> cli
node validation/persistent-screenshots/faults.mjs <device_serial> /tmp/capture-faults
```

The optional local OCR executable receives one PNG path and emits JSON rows
`[{"text":"FRAME 10"}]`. It is a laboratory verifier, not shipped runtime code
or a product dependency. A 20-second timeout bounds it. Retain the PNGs and
JSON privately; they may contain personal screen content. Never commit them.
A capture passes freshness only when its current marker is present in pixels.
The scripts decode PNGs independently and keep timing outside OCR verification.

Four rounds run at explicit 100/50/25 and omitted scale (stock). Round zero is
excluded from warm aggregates. Backend/API round zero deliberately closes the
helper before each explicit scale; subsequent rounds reuse one session. CLI
round zero is a first-use pass through the existing daemon; only its first
helper capture is cold. `cold` records a new helper session, not every startup
cost of the full command. The CLI daemon may already be started by setting the
marker, so this is not a measurement of daemon startup itself.

Failure evidence is retained. Helpers are closed and the current overlay is
cleared even if validation fails. The fault runner restores both rotation
settings in `finally`. A transport reconnect is not a physical USB unplug or
Android reboot. See [findings](findings.md) for measured results and limits.

## Emulator and interface comparisons

Use the same explicit-device commands on an emulator. The maintained backend
has no physical-device-only requirement. Record the exact build and full SDK
version, not just the major API number. `CaptureApiProbe.java` distinguishes the
older scaling interface from the newer strict-policy interface without acquiring
images. Compile against SDK 35, convert with build-tools 35.0.0 `d8`, push the DEX
to a uniquely owned temporary device path, and run
`CLASSPATH=<remote_dex> app_process /system/bin CaptureApiProbe` through explicit
`adb -s <device_serial> shell`. Remove only that owned DEX afterward. The probe
prints UID, OS build, full SDK version, classes, policy constants and signatures.
It does not replace the maintained doctor probe or a successful live image.

`overlay-ocr.cjs` is an optional verifier for the exact overlay layout used by
`live.mjs`. It crops, inverts and enlarges that rectangle before invoking an
already-installed `tesseract` executable (`TESSERACT_PATH` can override its path).
It never modifies the saved evidence image or receives the expected label.
This avoids whole-image OCR skipping white text on a black rectangle. It is a
local test aid, not a shipped dependency or a general screenshot OCR API.

On a fast emulator, an overlay update can acknowledge before its next frame is
presented. Set `ANDROPERATOR_CAPTURE_MARKER_SETTLE_MS=500` for a laboratory
presentation delay before each timed capture. The default is zero; accepted
values are 0-5000 milliseconds. The delay is recorded in each measurement and
excluded from timings. Exact-marker verification still runs and fails the batch
on mismatch; it never retries a failed sample. This delay does not claim that
production capture waits for app rendering.

For persistent CLI measurements, verify `daemon status` is running and the
results reuse `captureSessionId` with increasing `captureSequence`. A sandbox
that cannot access the socket can fall back to direct CLI execution; those
samples must not be called warm persistent captures.

## Secure-window fixture

`secure-fixture/` is a first-party, local-only APK with ordinary and FLAG_SECURE
window states. It has no private content or external dependencies. Build with:

```sh
bash validation/persistent-screenshots/secure-fixture/build.sh /tmp/capture-policy-fixture.apk
```

The fixture requires JDK, SDK platform 35 and build-tools 35.0.0, and uses an
ephemeral test signing key. `check-fixtures.sh` compiles the API probe and builds
and verifies the APK in the shared Android CI suite without contacting a device.

On an explicitly selected test emulator, first check that
`com.androperator.capturefixture` is not already installed. Install this fixture
APK with `adb -s <device_serial> install /tmp/capture-policy-fixture.apk`; the
Operator itself must still use canonical `operator setup`. Through the
branch-local CLI with explicit device and development Operator package:

1. `open com.androperator.capturefixture`, then `screenshot --scale 25` to a new
   evidence path. Decode and inspect the ordinary fixture image.
2. `click --text 'ENABLE SECURE WINDOW'`; confirm the action succeeded and
   `dumpsys window windows` reports SECURE on the fixture window before capture.
3. Capture to a new path with `--scale 25`: require `EVIDENCE_CAPTURE_FAILED`,
   `captureFailureReason: rejected`, `fallbackAttempted: "false"`, and no file.
4. Omit scale for a separate explicit stock capture. On the tested API 37.2
   emulator, stock succeeds with the fixture area blacked out. Decode and
   visually inspect it; successful PNG encoding does not prove unredacted content.
5. `click --text 'DISABLE SECURE WINDOW'`, then verify a new quarter-size image
   shows `ORDINARY WINDOW RESTORED`. Uninstall only the fixture installed by this
   run and stop the test-owned daemon/emulator when finished.

This exercises secure windows, not hardware-protected DRM buffers. Do not treat
FLAG_SECURE evidence as proof of the separate protected-buffer policy.
