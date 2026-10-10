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
