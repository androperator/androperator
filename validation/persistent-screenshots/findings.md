# Maintained screenshot capture findings

Date: 2026-10-11. Implementation branch: `feat/persistent-reduced-screenshots`,
based on main `6cff9182`. Capture implementation first committed as `5b99728d`;
subsequent startup capability/packaging refinements received focused regression
checks and a final physical CLI smoke, not a new timing batch.

## Environment and method

Physical Pixel 10 Pro, Android API 37, 1080 x 2410 portrait; macOS and Node
24.11.1; matching 1.1.0 development Operator (installed APK SHA-256 matched the branch build). The visible browser page was
example.com. No navigation was needed for measurement. Every capture followed a
separate successful Operator overlay update with a new `FRAME NN` label. Each
PNG was decoded/CRC-checked and local OCR had to find that exact marker. Actual
images were also visually inspected, including landscape and quarter-size
frames. Small-text readability or model accuracy was not asserted.

Three measured rounds followed a startup round, alternating 100%, 50%, 25%, and
ordinary stock capture. The backend measurement includes capture, decode and
saving. API includes the complete maintained `observeScreenshot` operation and
publication. CLI includes the complete child process through the persistent
daemon and publication. OCR and marker preparation are outside the measured
interval. No builds/tests or other device controllers ran during these final
timing batches. All 48 images passed freshness verification.

Private local evidence retains images, JSON measurements, logs and failed
pilots. Device identifiers, local usernames and screen content are excluded
from committed findings.

## Timings

Warm medians, three samples per cell, milliseconds:

| Capture | Actual PNG | Backend + decode + save | Complete Node API | Complete CLI |
| --- | --- | ---: | ---: | ---: |
| Explicit 100% helper | 1080 x 2410 | 525.9 | 1035.8 | 1118.4 |
| Explicit 50% helper | 540 x 1205 | 239.5 | 1030.9 | 915.1 |
| Explicit 25% helper | 270 x 602 | 110.7 | 608.6 | 728.7 |
| Omitted scale, stock | 1080 x 2410 | 1321.8 | 1807.3 | 1920.8 |

Quarter-size CLI median was 34.8% below explicit full-size helper and 62.1%
below the existing stock full-resolution command. Quarter-size backend median
was 79.0% below full-size helper. These are acquisition measurements on one
screen/device, not full agent-task gains. Half-size complete Node timings were
highly variable and their median gain over full-size helper was negligible.

Warm ranges: backend 100% 479.5-543.5 ms, 50% 219.2-252.7 ms, 25% 100.9-120.9 ms;
Node 100% 906.3-1167.1 ms, 50% 827.8-1074.4 ms, 25% 510.8-961.6 ms;
CLI 100% 1022.3-1129.0 ms, 50% 853.7-928.6 ms, 25% 653.2-781.4 ms.

Cold backend deployment/start/capture: 1460.5 ms at 100%, 982.4 ms at 50%,
1134.5 ms at 25%. Cold complete Node calls: 1806.0, 1904.0 and 1587.5 ms.
CLI first helper use was 2165.2 ms; its first 50%/25% calls reused that session
and are not cold-start measurements. Persistence is necessary for the warm
benefit; direct one-shot CLI calls redeploy/start a helper each time.

## Reliability and compatibility

- Rotation changed the same session from portrait 270 x 602 to landscape
  602 x 270, reporting native 2410 x 1080 and rotation 1; restore returned to
  native 1080 x 2410 and rotation 0. PNG contents were visually checked.
- Killing the exact helper PID caused the next request to fail `transport`
  in 76 ms. One subsequent explicit screenshot request created a new session
  and succeeded in 1181 ms. No navigation/action was replayed.
- Cancellation rejected the pending full-size capture in 11 ms; a new request
  succeeded in a new session. No cancelled PNG was published.
- ADB transport reconnect rejected an in-flight capture in 18 ms. After the
  device returned, a new session succeeded in 1182 ms. This is transport
  interruption evidence, not a physical USB cable or reboot test.
- A real device response with only its request UUID replaced was rejected as
  `protocol`; no stale image was published. Unit tests additionally cover wrong
  session, sequence, timestamp, dimensions, rotation, CRC and unsolicited data.
- API 35 and API 36 emulator probes reported `capture_class` unavailable. After
  branch-local development Operator setup on API 35, `screenshot --scale 25`
  failed with `captureFailureReason: incompatible`, corrective OS guidance and
  `fallbackAttempted: false`. Omitting scale succeeded with a verified
  1080 x 2400 stock PNG. API 36 has probe evidence only.
- End-to-end doctor returned core readiness success on both devices, with
  `capture.reduced` pass/supported on the phone and warn/incompatible on API 35.
  Capability diagnostics distinguish supported APIs from an unverified live
  image. A supported probe does not claim the screen is unlocked or render-ready.
- Ordinary EOF cleanup left no new deployment on successful direct CLI or
  emulator probes. Abrupt transport loss left one owned temporary directory;
  it was explicitly removed during test cleanup. Final inspection found no capture
  helper process or deployment directory on the phone, and the owned daemon was stopped. The helper watchdog bounds
  an orphan process but cannot guarantee filesystem cleanup after forced death.

## Retained failures and repairs

An initial bundle-relative path was incorrect and fixed before measurements.
The first normal-exit cleanup relied on shutdown hooks that app_process did not
run on normal return; explicit `finally` cleanup fixed it. The initial local
Vision verifier failed under the sandbox and then stalled outside it. It was
terminated and replaced by the already-installed local OCR tool; these pilots
are excluded. Its path needed resolution from `/tmp` to the real path before
image decoding. OCR is bounded and not part of the shipped product.

A pilot closed the helper before the stock startup capture, accidentally making
the next full-size helper sample cold. The harness was corrected and all three
final batches rerun. A death-test pilot matched the wrapping shell rather than
the helper; exact app_process matching repaired it. The next pilot expected
transparent recovery in the same call, while the implementation intentionally
fails uncertain acquisition and recovers on the next explicit read-only request.
The corrected fault test demonstrated that contract. No failed pilot is hidden
in successful timing aggregates.

The packaging audit caught the repository-wide `*.dex` ignore rule; the shipped
first-party helper now has a narrow exception. The source, DEX and manifest are
tracked together and the actual npm package file list is checked.

## Validation and remaining limits

Full Node suite: 1509 passed. Focused helper checks: 16 passed; package/CLI
checks: 2 passed. Android `:app:assembleDebug` and `:app:testDebugUnitTest` passed.
Docs build, route checks and organization checks passed. Later startup-only
refinements passed focused checks and a physical final quarter-size CLI smoke.

Only one physical OS build is verified for reduced capture. Other OEMs, HDR,
protected/DRM surfaces, live keyguard transitions, fold/unfold/multi-display
changes, cable unplug/replug, host SIGKILL and reboot cleanup are not proven by
this batch. Strict policy and geometry guards exist, but those scenarios still
need dedicated physical fixtures. No model API calls were made.

The user chose fail-closed behavior on unverifiable builds. Safe automatic
stock fallback remains unavailable because stock capture can silently redact
protected content. Existing full-resolution defaults remain an explicit caller
choice. Future work must not weaken that boundary or replay navigation.

## API 37 emulator follow-up (2026-10-11)

The earlier phone/emulator contrast confounded OS versions. The installed
Pixel 10 Pro Fold emulator uses Android 17/API 37.2, 16 KiB pages, Google Play
arm64 image `CP41.260828.004.A7` (`SDK_INT_FULL=3700002`). The physical phone is
Android 17/API 37.1, build `CP3A.260905.009` (`SDK_INT_FULL=3700001`). This is a
same-major-API comparison, not identical firmware. No emulator image downloads,
root, hidden-API override or Operator APK identity capture were needed.

A first-party shell reflection probe ran with UID 2000 on all four targets:

| Target | Build | Internal capture class | Strict policy parameters | Older scaling builder |
| --- | --- | --- | --- | --- |
| Physical API 37.1 | CP3A.260905.009 | Present | Both throw policies = 2 | Absent |
| Emulator API 37.2 | CP41.260828.004.A7 | Present | Both throw policies = 2 | Absent |
| Emulator API 36.0 | BE2A.250530.026.D1 | Absent | Absent | Present |
| Emulator API 35 | AE3A.240806.036 | Absent | Absent | Present |

Both API 37 builds have matching `ScreenCaptureInternal.CaptureArgs.Builder`
scale/policy setters and the matching `IWindowManager.captureDisplay` signature.
The older builds have `ScreenCapture.CaptureArgs.Builder.setFrameScale`,
`setCaptureSecureLayers(boolean)` and `setAllowProtected(boolean)` instead.
Thus scaling itself is not new or emulator-specific. The current backend's
newer class layout and explicit exception policies are the compatibility
boundary. This probe does not prove that another safe backend for older Android
is impossible. Exact maintained requirements are in the durable design doc.

After canonical branch-local development Operator setup, doctor reported
`capture.reduced: supported` on API 37.2. Actual captures succeeded at every
supported size in the stable unfolded display configuration:

| Capture | PNG | Warm backend + decode + save | Warm complete Node | Warm persistent CLI |
| --- | --- | ---: | ---: | ---: |
| Explicit 100% | 2076 x 2152 | 259.8 ms | 381.8 ms | 450.7 ms |
| Explicit 50% | 1038 x 1076 | 86.1 ms | 172.7 ms | 265.7 ms |
| Explicit 25% | 519 x 538 | 36.7 ms | 185.8 ms | 220.5 ms |
| Omitted scale | 2076 x 2152 | 283.8 ms | 379.2 ms | 473.2 ms |

Medians use three rounds after one startup round, on the emulated-device
Settings page. All 48 final images decoded and matched their exact current
FRAME marker. Quarter-size and rotation frames were also visually inspected.
The persistent CLI used one session with sequences 1-12. Quarter-size CLI was
51.1% below its full-size helper median and 53.4% below stock. Emulator timings
are host/rendering-dependent and are not predictions for physical hardware or
full agent tasks. The phone used a different screen and image dimensions.

Cold backend times at 100/50/25 were 510.2/284.8/238.3 ms; complete Node times
were 674.7/389.3/318.8 ms. First persistent CLI helper capture was 677.1 ms;
subsequent sizes reused it. The daemon was already running. Every final capture
followed a recorded 500 ms laboratory marker-presentation delay outside the
measured interval. Production capture has no such added delay.

Retained pilots and their meaning:

- Whole-image OCR skipped clearly visible inverted marker text. The maintained
  optional verifier isolates and inverts the known overlay rectangle without
  modifying the saved image or receiving the expected label.
- A zero-delay backend pilot returned visible FRAME 13 after the overlay update
  for FRAME 14 had acknowledged. It had fresh capture metadata but the compositor
  had not presented the new text. The exact-image check failed the batch. This
  is rendering readiness, not stale protocol output: acquisition correlation
  cannot promise that an earlier UI change has rendered. No automatic action or
  capture replay was added. The settled final batch still verifies every image.
- The first CLI batch could not access the daemon socket from its sandbox and
  used 12 separate helper sessions. Those successful images are retained but
  excluded from persistent timings. Running with access to the existing socket
  produced one session with increasing sequences.
- The secure fixture initially rejected a mixed-case text selector because the
  Material button exposes uppercase text. The ordinary captures from that
  failed preparation are not counted as secure-window evidence. The successful
  retry used the observed uppercase selector and checked the SECURE window flag.

Fault validation on API 37.2 passed rotation (519 x 538 to 538 x 519 and back),
helper death, cancellation, transport reconnect and injected stale request UUID.
The dead helper had already been evicted before the next capture, which started
one new session and succeeded in 268 ms; there was no in-flight capture replay.
Cancellation failed in 6 ms, reconnect interrupted capture in 20 ms, and explicit
recovery succeeded in 249 ms. The stale response failed as `protocol`.
Rotation metadata and PNG dimensions were correct, but the image caught a system
rotation animation; stable acquisition geometry does not imply settled UI.

The first-party FLAG_SECURE fixture gave direct safety evidence: ordinary
quarter capture succeeded, enabling SECURE made quarter capture fail with
`EVIDENCE_CAPTURE_FAILED`, `rejected`, `fallbackAttempted: "false"` and no PNG at
the new destination. A separate omitted-scale request returned a decodable stock
PNG with the entire fixture area blacked out. Disabling SECURE restored a visible
quarter-size image with `ORDINARY WINDOW RESTORED`. This is not a test of
hardware-protected DRM buffers, whose throw-policy API is present but whose
behavior still requires a dedicated fixture.

Remaining boundaries: no general emulator restriction was found. API 37.0,
other OEMs, identical phone/emulator builds, protected DRM buffers, HDR fidelity,
fold/unfold transitions, secondary/virtual displays and physical keyguard/cable/
reboot behavior are not established by these runs. Keep capability probing and
fail-closed behavior; do not substitute an API-level-only allowlist.

Follow-up validation: branch-local Node build and 18 focused helper/package/CLI
checks passed; both first-party Java fixtures compiled, the APK signature
verified, and all seven shared-runner tests passed. The docs build passed route
and organization checks. The maintained OCR verifier independently rechecked
all 48 final images. Fixture compilation is wired into the Android CI suite;
these live emulator runs are explicit opt-in and were not run on remote CI.
The fixture was uninstalled, the one known owned directory left by transport
interruption was removed, and no helper directories remained. Rotation/overlay
state was restored and the test-owned daemon and API 37 emulator were stopped.


## Source-audit correction (2026-10-11)

The follow-up Android source audit found the new class/policy surface already
in Android 16 QPR2, absent in the inspected QPR1/initial Android 16 sources.
The tested older emulator was API 36.0, so its failure cannot establish that all
Android 16 builds fail. Android 16 QPR2 runtime compatibility remains untested.

More importantly, AOSP's inspected WindowManager-to-layer-capture path does not
preserve the throw policy as a distinct rejection condition when creating the
compositor screenshot arguments. Our independent secure-layer result check can
explain the passing FLAG_SECURE test. Protected DRM rejection is not established
by that test or by policy constant presence. Earlier statements that the newer
policies guarantee rejection must be read with this correction. The existing
implementation still has an unresolved fail-closed requirement for protected
buffers; no live DRM fixture has demonstrated enforcement. See the durable
source audit for exact symbols, source links and the required follow-up.


## Protected-buffer fix and older adapter (2026-10-11)

This follow-up supersedes the unresolved safety status above. The helper now
requires protected GPU composition, requests protected composition, and rejects
any returned HardwareBuffer carrying USAGE_PROTECTED_CONTENT before asBitmap,
software copy or PNG encoding. Secure-layer metadata is independently rejected;
secure pixels are never requested. The source rationale and exact requirements
are maintained in `docs/internal/design/persistent-screenshots.md`. Merely finding
the newer throw-policy constants is no longer a safety criterion.

A first-party fixture presents a synthetic EGL protected buffer independently of
FLAG_SECURE. On the API 37.1 physical phone, SurfaceFlinger reported buffer usage
0x4b00 (including the protected bit), while the fixture window was non-secure.
The automated final run verified fixture foreground/state before each negative
capture. Ordinary capture at 100/50/25 succeeded; protected-buffer capture at all
three sizes returned the specific pre-readback rejection and no file; ordinary
recovery succeeded. FLAG_SECURE rejection at all three sizes and recovery also
passed. Decoded ordinary/recovery images visibly showed the expected fixture
states. Seven host checks exercise the production readback callback boundary,
including mixed usage bits and failure propagation.

Both class layouts are now implemented: older ScreenCapture nested types and
newer ScreenCaptureInternal nested types. On API 35 and API 36.0 emulators, the
older adapter resolved successfully but the compositor capability was false.
The API 37.2 emulator resolved the newer adapter and reported the same false
capability. All three emulators rejected explicit 100/50/25 with `incompatible`,
no automatic fallback and no PNG. Omitted-scale stock capture remained successful;
all three images decoded and were visually inspected. Earlier emulator timings
above used the insufficient guard and do not establish safe current support.
Older physical hardware with protected GPU composition remains untested.

The hardware distinction matters: SurfaceFlinger can support protected display
or codec paths without protected GPU composition. Without the latter, a protected
layer can be silently redacted into ordinary output. Diagnostics therefore name
the compositor capability and recommend another verified device, without
promising that upgrading Android alone resolves it.

### Repeated physical measurements after the fix

The phone used the ordinary synthetic fixture at native 1080 x 2410. Four rounds
per mode covered helper 100/50/25 plus stock capture. All 48 final images decoded
and contained the exact current FRAME marker. A 500 ms laboratory presentation
delay preceded each timed capture; it is excluded from timing and absent from
production. Warm values below are medians of three observations, not benchmark
confidence intervals. The persistent CLI used one helper session with sequences
1 through 12. Complete API/CLI time includes readiness and publication work.

| Path | 100% | 50% | 25% | Stock full size |
| --- | ---: | ---: | ---: | ---: |
| Backend, verify and save | 390.4 ms | 286.7 ms | 159.0 ms | 1153.9 ms |
| Complete Node API | 842.9 ms | 685.5 ms | 533.2 ms | 1941.9 ms |
| Complete persistent CLI | 1139.8 ms | 887.0 ms | 802.8 ms | 1622.3 ms |

Backend cold helper captures were 1544.5/926.0/1015.5 ms at 100/50/25; complete
Node cold captures were 2515.8/1755.9/1673.3 ms. The first CLI helper capture was
2068.8 ms; subsequent sizes reused that helper. The daemon had already started
for marker presentation, so this is not daemon startup timing. Compared with
helper 100%, quarter size reduced warm backend time by 59%, complete Node by
37%, and complete CLI by 30%. These small fixture batches neither establish
full-agent-task gains nor isolate the safety fix's performance cost; earlier
batches used different screens and host/device conditions.

The maintained fault harness passed rotation (270 x 602 to 602 x 270 and back),
helper death, cancellation, transport reconnect and injected stale request ID.
After helper death, the pending acquisition failed in 90 ms; a separate explicit
request recovered in 1137 ms. Cancellation failed in 6 ms; reconnect interrupted
capture in 19 ms; explicit recovery took 1347 ms. Stale output failed as protocol.
No navigation or uncertain acquisition was replayed. Rotation PNGs were decoded
and inspected, with native and returned dimensions matching orientation.

Retained failures/preparation limits:

- An initial manual protected test subsequently captured the browser, not the
  fixture. Foreground had changed for an unknown reason; no active protected
  fixture buffer was present. That pilot is excluded. The automated final test
  now asserts fixture foreground and state before every negative capture.
- The lab OCR detector initially mistook the fixture's heading for the black
  overlay. The saved image contained the expected marker; the batch failed.
  Requiring a contiguous dark row to locate the overlay fixed the verifier.
  The final 48-image runs passed exact-marker checks; no failed sample was retried
  inside a batch or relabeled as successful.
- API 36 and API 37 CLI preparations initially reported missing development
  Operator packages. Canonical setup installed the matching local APKs; only
  subsequent runs count as capture compatibility evidence.
- The sandbox blocked process-group inspection in three Node tests. The complete
  suite rerun with the required host access passed all 1512 tests. Android debug
  build/unit tests, fixture checks and package checks also passed.

Remaining limits: no successful reduced capture on older physical hardware or
Android 16 QPR2 runtime, no exhaustive OEM/commercial DRM coverage, and no new HDR,
fold/unfold, secondary display, physical cable removal or reboot guarantees.
Protected GPU buffer and FLAG_SECURE tests are distinct evidence. Incompatible
hardware continues to fail closed rather than weakening the output contract.

Final validation: all 1512 Node tests, 21 focused helper/package/CLI checks,
seven production Java readback-boundary checks, Android debug build/unit tests,
fixture compilation/signature checks, and the full docs build passed. Docs
organization checks emitted no warnings. The synthetic fixture was uninstalled,
the prior phone app restored, overlays/rotation restored, and test-owned daemons
and the API 37 emulator stopped. Two exact directories left by cancellation and
transport interruption were removed using their recorded owned session IDs;
no helper directories remained on the four targets. Existing API 35/36 emulators
were left running. No model calls, third-party imports, merge, push or release.
