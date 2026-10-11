# Persistent screenshot acquisition

Public options and result fields are owned by [take_screenshot](../../api/actions.md#action-take-screenshot).

Node adds `data.hint` only after validating and publishing the PNG. This
host-authored advice describes file access and exact CLI/Node scale arguments,
based on the actual applied scale for both direct capture and resize fallback.
It is advisory, not a machine-parsed contract or an interpretation of screen
contents. The same result flows through the Node API, CLI and HTTP endpoint;
none embeds PNG bytes. The full-resolution default remains unchanged.

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
length. Startup confirms the session UUID and capture API availability. Each
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
dispatch; cancellation discards the session and interrupts deployment
subprocesses. Fallback probes, their broadcasts and display queries receive the same cancellation and
an absolute deadline signal, including time spent attaching the result reader.
The process runner reports its own timeout with `ProcessResult.timedOut`.
Helper setup preserves that reason before considering setup unavailable: timer
delivery can precede the fractional-clock deadline check. A timed-out setup
never enables fallback, even if that check still shows remaining time. Explicit
caller cancellation takes precedence. Ordinary deployment failures remain
eligible for the documented setup fallback.
Fallback likewise treats its aborted deadline signal as authoritative, even if
the clock still shows remaining time. It reports timeout and stops further work
whether the interrupted probe throws or returns; caller cancellation still wins.
Failed setup launches best-effort removal of only its owned directory with a
250 ms process bound; that cleanup does not delay the failed request.
A unique sibling temporary file is renamed into the destination only after
validation. Storage failure does not
recapture. Publication cancellation, timeout and storage failure retain the
acquired image's protection/backend/fallback metadata, with failure reasons
`cancelled`, `timeout` and `publication` respectively. File writes receive the
cancellation/deadline signal, and the budget is checked again before rename.
Existing command/task correlation, paths, envelope source and earlier
action outcomes remain intact.

A failed or dead helper is removed from the session registry. The next explicit
read-only screenshot request redeploys it. No execution, tap, navigation or
capture attempt is automatically replayed after uncertain output. A scaled
screenshot is restricted to one final screenshot action to avoid implying
intermediate capture timing from execution post-processing.

## Compatibility and resize fallback

The helper selects `android.window.ScreenCaptureInternal` when available,
otherwise `android.window.ScreenCapture`. Both share ownership, correlation,
geometry, pixel validation and cleanup. Older builders use
`setCaptureSecureLayers(false)` and `setAllowProtected(true)`; newer builders use
`SECURE_CONTENT_POLICY_REDACT`, `PROTECTED_CONTENT_POLICY_CAPTURE`, capture mode
NONE and explicit system overlays. Scaling/crop/listener/result methods are
resolved before the helper advertises readiness.

Protected GPU composition is an information source, not a prerequisite for
ordinary capture. Direct capture at 100/50/25 is verified on the API 37.1 phone
and API 35/36.0/37.2 emulators. The phone can establish absence of protected
buffers; these emulators report unknown. Android 16 QPR2 source has the newer
interface but that runtime and older physical/OEM hardware remain untested.

`scaledScreenshot.ts` calls the direct helper first. Only initialization failures
classified as unavailable/incompatible permit one stock capture and host resize.
The setup-only eligibility is set before any capture request is written. A
capture rejection, stale frame, transport interruption, cancellation, timeout or
busy session never triggers fallback. No action is replayed. There is no public
force-backend flag or extra host daemon.

The fallback uses the existing targeted screencap, independently decodes its PNG,
checks display identity/rotation/extent before and after, and checks interactivity
through the existing read-only Operator probe. On older display dumps with no
viewport activity field, returned PNG dimensions are available but rotation and
physical identity are omitted rather than invented. The original deadline and
cancellation govern acquisition and publication. Invalid output never replaces
the requested destination.

A first-party area-average resize uses the existing PNG library, with no new
dependency. It floors dimensions per axis (minimum one pixel), validates the
result, and reports `adb_screencap_resize`, applied/requested scale, native and
returned dimensions, `fallbackAttempted: "true"` and the setup failure reason.
Explicit 100% fallback preserves the full-size PNG but keeps that method label.
Stock acquisition followed by resize saves output size, not acquisition work.
Omitted scale remains ordinary full-resolution `adb_screencap`.

Doctor tests direct-helper APIs, not image contents or fallback success. It warns
when that helper cannot initialize and explains the resize path. It must not
recommend another device merely because protection state is unknown.

## Protected-content evidence

The earlier blanket composition gate prevented ordinary emulator use and has
been removed. `protectedContent` is now evidence with three values:

- `absent`: direct capture had protected-composition support before acquisition
  and after encoding, and the returned buffer was not protected.
- `unknown`: composition support is missing/uncertain, or capture used stock
  screencap. Android may redact protected regions. Ordinary capture still succeeds.
- `present`: the helper received a protected buffer and rejected it before any
  pixel readback. This is failure metadata, never an exported protected image.

The source audit remains relevant: newer throw-policy constants do not preserve
a distinct rejection mode on the inspected WindowManager layer-capture path.
The helper requests protected composition and examines HardwareBuffer usage.
Where supported, SurfaceFlinger derives protected output allocation from the
same layer snapshots used to compose. Any output marked USAGE_PROTECTED_CONTENT
is rejected before asBitmap, software copy or PNG encoding, regardless of whether
composition support could be queried. The buffer is closed in all cases.

Secure-layer metadata is independently rejected; the helper never requests secure
pixels. Stock capture retains Android's normal secure/protected redaction. It
cannot certify absence, so it always reports unknown. This does not circumvent
Android protection or equate black pixels with a detected protected region.

The first-party EGL fixture tests actual protected buffers separately from
FLAG_SECURE. Host tests exercise the production readback callback boundary,
including combined usage flags and exception propagation. The compatibility
harness checks fresh Settings images through real direct CLI capture and the
complete stock/resize Node path after an injected helper deployment failure.
The injection changes only setup, never captured bytes or reported image metadata.

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
