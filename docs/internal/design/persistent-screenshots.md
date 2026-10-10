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
length. Startup confirms the session UUID, selected capture API and protected GPU
composition capability. Each
request has a new UUID and scale. Each response echoes that UUID/session and
supplies a strictly increasing sequence and device monotonic capture time.
Unsolicited bytes, unknown framing, wrong IDs and mismatched geometry poison the
session. Node never substitutes a cached frame.

The helper reads primary logical display 0's local physical identity, logical
pixel extent and rotation for each capture. It checks interactivity/keyguard and
geometry before capture, after readback and after encoding. Hardware buffers
must have the requested floored dimensions. Before readback, the helper rejects
secure-layer results and any hardware buffer whose usage includes
`USAGE_PROTECTED_CONTENT`. See the safety mechanism below. Hardware buffers and
both bitmaps are freed in `finally`, including rejection paths.

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

The helper selects `android.window.ScreenCaptureInternal` when available,
otherwise `android.window.ScreenCapture`. It never falls back to another API
following failed/uncertain acquisition. Both variants use the same owned
session, correlation, geometry, image validation and cleanup rules.

| Requirement | Older API | Newer API |
| --- | --- | --- |
| Builder/listener/result | `ScreenCapture` nested classes | `ScreenCaptureInternal` nested classes |
| Secure pixels | `setCaptureSecureLayers(false)` | `SECURE_CONTENT_POLICY_REDACT` |
| Protected composition | `setAllowProtected(true)` | `PROTECTED_CONTENT_POLICY_CAPTURE` |
| Pixel rejection | Secure result flag and protected buffer usage | Same |
| Display readback optimization | Not requested | Capture mode NONE; window layer-capture path |

Both require `SurfaceControl.getProtectedContentSupport()` to return true. A
false result is an actionable `incompatible` capability, not a temporary failure
to hide with stock capture. The capability is checked at setup, before capture,
before readback and before publishing. Service/query uncertainty fails closed.
The helper runs as shell UID 2000; Operator APK identity is not a replacement.

The required methods include crop, two-axis frame scale, pixel format,
`IWindowManager.captureDisplay` accepting the selected argument/listener types,
and result accessors. Newer builders also include system overlays explicitly;
the older window-layer path captures them without that setter. Every image
requires an unlocked, interactive primary logical display 0 with `local:<digits>`
identity and stable logical dimensions/rotation/physical identity.

Verified compatibility is specific to builds and graphics capabilities:

- Android 17/API 37.1 physical phone: ordinary images and independent secure and
  protected-buffer rejection passed at 100/50/25 percent.
- Android 15/API 35 and Android 16/API 36 emulators: older adapter initialization
  passed, then protected GPU composition correctly blocked capture.
- Android 17/API 37.2 emulator: newer adapter initialization passed, then the same
  safety capability blocked capture. Earlier successful emulator images used
  the old insufficient guard and do not establish current safe support.
- Android 16 QPR2 source has the newer interface, but runtime support is untested.
  Other older physical hardware, API 37.0, OEMs and future builds need evidence.

Doctor probes APIs and compositor capability without taking an image. It cannot
prove current screen state or visual contents. Graphics capability, not an OS
allowlist or a blanket emulator rule, decides whether capture can proceed.

Omitted scale preserves ordinary full-resolution screencap with standard
Android redaction behavior. There is no automatic stock fallback. A safe future
fallback must establish the same properties for the actual returned image.

## Protected-buffer safety mechanism

The source audit found that throw-policy API presence was insufficient. On the
inspected Android 16 QPR2 and Android 17 paths, WindowManager's `captureDisplay`
turns into internal layer capture. JNI forwards policy integers, but
`SurfaceFlinger::captureLayers` reduces them to capture/not-capture booleans.
The Error enum value does not survive as a distinct rejection condition.

The maintained helper instead uses the compositor's protected-output invariant.
For the layer snapshots used to render the screenshot, SurfaceFlinger checks
for visible protected buffers. When protected composition is supported and
requested, it allocates the screenshot output with `GRALLOC_USAGE_PROTECTED`.
The helper rejects that output using `HardwareBuffer.USAGE_PROTECTED_CONTENT`
**before** `asBitmap`, software copy or PNG encoding. A protected GPU output may
be allocated and delivered to the shell helper, but it is closed without pixel
readback or publication. Ordinary outputs use the existing PNG pipeline.

Protected and secure are separate properties. The helper never requests secure
pixels and still rejects `containsSecureLayers()`, even when those regions
would otherwise be redacted. This result describes the captured layer snapshots;
a separate window scan would be racy and is not a substitute.

The compositor-capability prerequisite is essential. When protected composition
is unsupported, Android may silently redact a protected layer into an ordinary
output, so testing only the returned usage bit would be insufficient. The source
explicitly allows hardware display/codec protection without GPU protection.
Do not special-case emulators or infer safety from the absence of a secure flag.

`validation/persistent-screenshots/protection.mjs` drives a first-party EGL
protected-buffer fixture, independent of FLAG_SECURE, and tests every scale plus
ordinary recovery. The physical test confirmed actual protected buffer usage in
SurfaceFlinger, a non-secure fixture window, and rejection before readback.
`CaptureSafetyTest.java` exercises the production readback callback boundary,
including combined usage flags and failure propagation, without Android pixel
access. Java fixtures and those checks run in the shared Android CI suite;
physical fixtures require explicit opt-in. These tests cover protected buffers,
not the behavior of every commercial DRM service or every OEM compositor.

## Source history and evidence limits

Android 15 and initial Android 16/QPR1 already provide scaled hardware-buffer
capture and secure-layer result flags. Android 16 QPR2 source contains the newer
class layout and policy API, also used in Android 17. This is a comparison of
inspected release branches, not a first-introducing-commit claim.

PNG validity, correlation and geometry establish acquisition evidence, not
app-specific rendering completion or quarter-resolution visual adequacy. Those
judgments remain with agents/skills. Screenshots and accessibility trees are
separate observations. OEM/older physical coverage, HDR/color fidelity,
fold/unfold/multi-display changes and image-consuming agent accuracy remain
limited. No model calls are part of capture validation.

Primary sources (read for analysis, not incorporated into the implementation):

- [Android 15 capture API](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/core/java/android/window/ScreenCapture.java)
- [Android 15 protected output allocation and secure metadata](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/android15-release/services/surfaceflinger/SurfaceFlinger.cpp)
- [Android 16 QPR2 capture API](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-qpr2-release/core/java/android/window/ScreenCapture.java)
- [Android 17 WindowManager capture route](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android17-release/services/core/java/com/android/server/wm/WindowManagerService.java)
- [Android 17 compositor capability and protected output allocation](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/android17-release/services/surfaceflinger/SurfaceFlinger.cpp)
