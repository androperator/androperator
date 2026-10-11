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
No app navigation is replayed and no model calls are made. Run live measurements
separately from the full Node suite: its MCP integration tests can select a
connected device and send actions. Finish that suite before restoring device
state or collecting final image evidence.

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
older capture interface from the newer policy interface without acquiring
images. Compile against SDK 35, convert with build-tools 35.0.0 `d8`, push the DEX
to a uniquely owned temporary device path, and run
`CLASSPATH=<remote_dex> app_process /system/bin CaptureApiProbe` through explicit
`adb -s <device_serial> shell`. Remove only that owned DEX afterward. The probe
prints UID, OS build, full SDK version, classes, policy constants, signatures and
protected GPU composition support. That capability informs protected-content
metadata; its absence does not block ordinary capture.
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

## Secure-window and protected-buffer fixture

`secure-fixture/` is a first-party, local-only APK with ordinary, FLAG_SECURE and
independent EGL protected-buffer states. It uses synthetic colored pixels, no
DRM media, private content or external dependencies. Build with:

```sh
bash validation/persistent-screenshots/secure-fixture/build.sh /tmp/capture-policy-fixture.apk
```

The fixture requires JDK, SDK platform 35 and build-tools 35.0.0, and uses an
ephemeral test signing key. `check-fixtures.sh` compiles the API probe, runs five
checks against the production helper's readback boundary, and builds/verifies
the APK in the shared Android CI suite without contacting a device.

On an explicitly selected device, first check that
`com.androperator.capturefixture` is not already installed. Install this fixture
APK with `adb -s <device_serial> install /tmp/capture-policy-fixture.apk`; the
Operator itself must still use canonical `operator setup`. Run:

```sh
node validation/persistent-screenshots/protection.mjs <device_serial> /tmp/new-capture-protection-evidence
```

The harness opens the fixture, checks ordinary images at 100/50/25, enables the
protected buffer, and requires rejection at every scale. It then removes that
buffer, verifies recovery, and repeats rejection/recovery with FLAG_SECURE.
Before each negative capture, it verifies the fixture foreground and state.
Each rejection must report `rejected`, `fallbackAttempted: "false"`, the specific
secure/protected reason, and no PNG at the new path. Inspect the ordinary and
recovery images; successful decoding alone does not prove correct contents.

The protected fixture requires `EGL_EXT_protected_content`, queries the surface's
protected attribute, and repeatedly presents a synthetic buffer from a protected
context. Independently inspect SurfaceFlinger layer/buffer usage to confirm the
fixture's buffer has the protected bit, and window state to confirm its window
is not FLAG_SECURE. This distinguishes the two guards. An unsupported fixture
reports an error; it must not count as a passing rejection test.

The tested API 35, 36 and 37 emulators lack protected GPU composition but now
support direct capture at every scale with `protectedContent: "unknown"`.
Android may redact protected areas without reporting them. The phone reports
`absent` for ordinary direct captures and `present` when a protected buffer is
rejected. Stock and resize fallback always report `unknown`.

The harness restores ordinary fixture state if it is still foreground, without
reopening it after an external navigation. After inspection, uninstall only the
fixture installed by this run, restore the prior foreground app, and stop only
test-owned daemons/emulators. Protected GPU buffer evidence does not establish
the behavior of every commercial DRM service or OEM compositor.

## Settings compatibility and live resize fallback

```sh
node validation/persistent-screenshots/compatibility.mjs <device_serial> /tmp/new-settings-evidence <local_ocr_executable>
```

This opt-in harness opens Settings, performs two rounds of direct CLI capture at
100/50/25, exercises the complete Node resize fallback at all three scales, and
checks omitted-scale full-size capture. It verifies actual PNG dimensions,
method, protection metadata and current FRAME text in every image. It restores
the prior foreground app (using Home for launchers) and clears its own overlay.
Only the first direct image is necessarily cold; the other sizes share the CLI
daemon's helper. Stop test-owned daemons after validation.

Fallback is exercised by a local ProcessRunner that rejects only helper DEX
pushes. Real screencap, interactivity checks, decoding, resizing and publication
still run. This validates actual fallback behavior without damaging installed
files, adding a product backend flag, or claiming the tested devices lack direct
capture support. Failure evidence is retained; a 500 ms lab presentation delay
is excluded from timing, and freshness mismatch fails rather than retries.
