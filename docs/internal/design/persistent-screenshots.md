# Persistent screenshot acquisition

Public options and result fields are owned by [take_screenshot](../../api/actions.md#action-take-screenshot).

## Identity and ownership

`apps/capture-helper/CaptureHelper.java` is a first-party shell-only helper.
Node deploys the packaged DEX to a random, mode-0700 directory under
`/data/local/tmp/androperator-capture-<session UUID>`, checks its SHA-256 and runs
it with `adb shell -T ... app_process`. It does not run in the Operator APK,
require root/platform signing, disable hidden-API restrictions, or expose a
network listener. The shell UID must be 2000. Node checks the bundled manifest
before deployment and never adopts another process's helper or directory.

One Node process owns one session per ADB path/device. One outstanding capture
is allowed; concurrent callers receive `busy` rather than entering an unbounded
queue. Existing execution serialization still applies to the canonical Node
API and daemon. There is no second host daemon. The existing CLI daemon keeps
sessions across commands; standalone CLI processes do not share helpers.

Normal EOF, helper exit and idle expiration remove the owned deployment. A
60-second helper watchdog bounds a stranded process even if host connectivity
is lost. Abrupt device/process termination can prevent removal of its temporary
directory; no unrelated directory or process is swept. A new session uses a new
UUID and redeploys, so leftover files cannot become stale capture results.

Build with `bash apps/capture-helper/build.sh`: JDK with Java 8 target, Android
SDK platform 36 and build-tools 36.0.0. Commit the maintained source, DEX and
manifest together. The manifest hashes source and DEX; package validation is
wired into the shared validation runner and checks the actual npm file list.
Consumers need only the packaged Node CLI and ADB.

## Protocol and acquisition invariants

Protocol 1 uses a bounded JSON line followed by exactly the declared PNG byte
length. Startup confirms the session UUID and strict policy capability. Each
request has a new UUID and scale. Each response echoes that UUID/session and
supplies a strictly increasing sequence and device monotonic capture time.
Unsolicited bytes, unknown framing, wrong IDs and mismatched geometry poison the
session. Node never substitutes a cached frame.

The helper reads primary logical display 0's local physical identity, logical
pixel extent and rotation for each capture. It checks interactivity/keyguard and
geometry before capture, after readback and after encoding. Hardware buffers
must have the requested floored dimensions. The helper requests strict secure
and protected content policies and separately rejects secure-layer results
before publication. Policy API presence does not establish enforcement on the
selected Android capture path; see the source audit below for the unresolved
protected-buffer safety gap. Hardware buffers and both bitmaps are freed in
`finally`.

Node bounds headers to 4 KiB, encoded images to 64 MiB and decoded images to
32 million pixels. It decodes PNG data with CRC validation and checks its actual
dimensions. Capture and publication use the remaining execution budget from
dispatch; cancellation discards the session. A unique sibling temporary file is
renamed into the destination only after validation. Storage failure does not
recapture. Existing command/task correlation, paths, envelope source and earlier
action outcomes remain intact.

A failed or dead helper is removed from the session registry. The next explicit
read-only screenshot request redeploys it. No execution, tap, navigation or
capture attempt is automatically replayed after uncertain output. A scaled
screenshot is restricted to one final screenshot action to avoid implying
intermediate capture timing from execution post-processing.

## Compatibility and safe full-resolution choice

The tested Android 17 phone (API 37.1) and Android 17 emulator (API 37.2)
support the maintained backend. Both expose the same required internal capture
classes, policy constants and method signatures. This is not an emulator versus
physical-device restriction. The tested Android 15/API 35 and Android 16/API 36
emulators instead expose the older `ScreenCapture.CaptureArgs` interface.
They already have `setFrameScale`, but lack `ScreenCaptureInternal` and
`ScreenCapture.ScreenCaptureParams`, including the strict exception policies.
The helper intentionally does not adapt to those older interfaces.

The current runtime requirements are:

1. Authorized ADB shell identity (UID 2000), `app_process`, writable owned
   deployment storage and checksum verification. Operator APK identity is not
   a supported replacement for shell identity.
2. `android.window.ScreenCaptureInternal` and its capture argument builder,
   listener and hardware-buffer result classes. `IWindowManager.captureDisplay`
   must accept those exact argument/listener classes. The builder must expose
   crop, two-axis scale, pixel-format and system-overlay controls.
3. `ScreenCapture.ScreenCaptureParams.SECURE_CONTENT_POLICY_THROW_EXCEPTION`
   and `PROTECTED_CONTENT_POLICY_THROW_EXCEPTION`, plus both corresponding
   builder setters. Older `setCaptureSecureLayers`/`setAllowProtected` booleans
   are not the setters this implementation currently requires. An older adapter
   would need to establish safe rejection independently.
4. An unlocked, interactive primary logical display 0 whose identity matches
   `local:<digits>`. Logical dimensions, rotation and physical identity must
   remain unchanged during acquisition. Foldables can work in a stable state;
   this does not establish correctness during fold/unfold or display handover.
5. Successful capture, hardware-buffer CPU readback and PNG encoding with the
   expected dimensions, followed by Node correlation/geometry/PNG validation.

Android API level alone does not establish these requirements. API 37.0 and
other manufacturers' builds remain untested; use `doctor` for the capability
probe and an actual screenshot for acquisition verification. Reflection success
is not proof of a live image; doctor labels that distinction explicitly.
Capture errors remain failures even if ordinary `screencap` succeeds. The
read-only `validation/persistent-screenshots/CaptureApiProbe.java` records the
old/new interface distinction without capturing pixels.

The original requirement for automatic full-resolution fallback is constrained
by safety evidence: ordinary screencap can redact protected pixels without a
machine-readable failure. The implementation therefore follows the agreed
fail-closed policy on unverifiable builds. Omitted scale preserves the existing
stock full-resolution path; it does not acquire the helper's stricter policy
guarantees. Do not add a broad catch-and-screencap fallback. A future automatic
fallback requires a backend that can certify the same safety properties for
the image actually returned.

PNG validity, correlation and stable geometry establish acquisition evidence,
not app-specific rendering completion or visual adequacy at quarter resolution.
Those judgments remain with agents/skills. Screenshots and accessibility trees
are separate observations. HDR/color fidelity, OEM coverage and image-consuming
agent accuracy need additional evidence; no model calls are part of validation.


## Android source audit and earlier-version scope

Source inspection on 2026-10-11 corrects two earlier assumptions:

- This backend is our `CaptureHelper.java` implementation and Node session
  manager, not an external service. Its hard dependency on the new class layout
  is an implementation choice; native buffer scaling already exists in older
  Android. The protocol, persistence and Node/CLI contracts could be retained
  while adding an adapter for the older capture classes.
- The new class layout and exception-policy constants appear in the inspected
  `android16-qpr2-release` source, not only Android 17. They are absent from the
  inspected Android 15, Android 16 initial-release and Android 16 QPR1 branches.
  This narrows the source transition to QPR1/QPR2 in those branches; it is not a
  claim about the first introducing commit or every shipping vendor build.
  Android 16 QPR2 runtime support has not been tested locally.

The new API surface consists of `ScreenCaptureInternal` retaining the low-level
capture builders/listeners, a `ScreenCapture.ScreenCaptureParams` system API,
and secure/protected policies with redact, capture and throw choices. Android
15 already has two-axis `setFrameScale`, `setCaptureSecureLayers(boolean)`,
`setAllowProtected(boolean)` and `ScreenshotHardwareBuffer.containsSecureLayers`.
The older compositor records visible secure layers in the returned result, so
rejecting that flag is a plausible older-version secure-window check. It still
requires a live fixture against the selected old API path.

**Open safety gap:** merely finding the new throw-policy constants is not proof
that the path we call enforces them. In the inspected Android 16 QPR2 and Android
17 AOSP source, `IWindowManager.captureDisplay` builds layer-capture arguments
and calls `ScreenCaptureInternal.captureLayers`. JNI forwards policy integers,
but `SurfaceFlinger::captureLayers` converts them into `isSecure` and
`includeProtected` booleans by comparing only with the Capture enum value.
The Error value is not preserved as a separate rejection condition in that
conversion. Protected layers can then be blacked out during composition.

The successful FLAG_SECURE fixture is consistent with our separate
`containsSecureLayers()` rejection; it does not prove enforcement of either
throw-policy constant. No corresponding protected-layer indicator is returned
in the inspected screenshot result. Therefore the current implementation does
not yet establish the requested fail-closed guarantee for hardware-protected
DRM content, even on a build where doctor reports supported. This source-path
finding is not a live reproduction of a protected-buffer failure on the tested
phone. Do not describe reduced capture as certified against silent DRM redaction.

Before widening support or claiming that guarantee, trace and test protected
buffer handling with a first-party fixture. Investigate whether protected-buffer
usage and capture-composition capability can provide a reliable rejection path;
reject uncertain configurations. Preserve secure-window checks, correlation,
geometry validation, bounded recovery and the prohibition on navigation replay.
Do not replace the missing guarantee with a non-atomic pre-capture window scan.

Primary sources (read for analysis, not incorporated into the implementation):

- [Android 15 ScreenCapture](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/core/java/android/window/ScreenCapture.java)
- [Android 16 QPR1 ScreenCapture](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-qpr1-release/core/java/android/window/ScreenCapture.java)
- [Android 16 QPR2 ScreenCapture](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-qpr2-release/core/java/android/window/ScreenCapture.java)
- [Android 16 QPR2 ScreenCaptureInternal](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-qpr2-release/core/java/android/window/ScreenCaptureInternal.java)
- [Android 17 WindowManagerService](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android17-release/services/core/java/com/android/server/wm/WindowManagerService.java)
- [Android 17 SurfaceFlinger](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/android17-release/services/surfaceflinger/SurfaceFlinger.cpp)
- [Android 16 QPR2 layer composition](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/android16-qpr2-release/services/surfaceflinger/LayerFE.cpp)
