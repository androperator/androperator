# Physical rendering verification findings

Date: 2026-10-11. Implementation measured: `f6a13c2e`, based on merged main
`e0fb9a00` (#397). Device: Pixel 10 Pro, Android API 37, portrait, development
Operator. Host: macOS, Node 24.11.1. No Android implementation changes or new
third-party dependencies were required.

## What this establishes

The new opt-in Node helper can retain a successful action receipt while rejecting
an observation whose relevant context changes, whose pixels do not show the
requested destination, or whose verification fails. It returns the exact PNG
that passed separate semantic and visual checks. It never receives a navigation
callback and cannot replay the preceding action through this interface.

Existing CLI commands and their result contracts remain unchanged. The helper
requires trusted caller-supplied acquisition and verification. The physical
consumer uses the existing experimental direct-buffer helper and local macOS
Vision OCR; neither is a maintained production dependency of this API. A portable
screenshot backend remains separate work.

## Comparison method

Three alternating pairs: full/quarter, quarter/full, full/quarter. Each run opens
Settings, confirms the About phone row in actual pixels and checks unchanged
snapshot bounds before clicking once. It then verifies arrival and separately
verifies visible Build number content after scrolling. Every acquisition is
bracketed by canonical compact snapshots and display geometry checks. The same
semantic and pixel predicates apply at both resolutions.

Full captures use the canonical CLI screenshot path, producing 1080 x 2410 PNGs.
Quarter captures use a persistent experimental shell helper, producing 270 x 602
PNGs directly. Both use branch-local CLI snapshots with `--no-daemon`, an explicit
device and development Operator. This compares these complete acquisition paths,
not just resizing cost. Capture-session startup is warmed by an excluded pilot.
There were no builds, test suites or other device controllers during this batch.

The full-only arm allows two observations. Quarter-first allows three small
observations then two fresh full observations, with a shared 30-second deadline
and six-second fallback reserve. Time below includes snapshots, display checks,
acquisition, PNG validation, OCR and verification. It excludes preparation and
navigation unless explicitly labeled otherwise. No model/provider calls occur.
Raw images, snapshots, command receipts, OCR and manifests remain private.

## Ordinary timings

All 12 primary phase checks passed: six at each resolution. All six quarter
checks succeeded without full-size fallback.

| Pair | Full arrival | Quarter arrival | Full scrolled content | Quarter scrolled content |
| --- | ---: | ---: | ---: | ---: |
| 1 | 9.345 s | 2.687 s | 5.196 s | 3.407 s |
| 2 | 9.606 s | 5.506 s | 5.435 s | 3.495 s |
| 3 | 9.750 s | 2.750 s | 5.279 s | 3.560 s |
| Mean | 9.567 s | 3.648 s | 5.303 s | 3.487 s |
| Median | 9.606 s | 2.750 s | 5.279 s | 3.495 s |

Mean settled-content observation time fell 34.2%; each arm used one frame in
every scrolled-content trial. This is the cleaner size/path comparison.

Arrival used two full observations in all three trials versus one, two and one
quarter observations. Every rejected ordinary arrival was a before/after context
change, not an OCR rejection. The 61.9% mean arrival reduction includes these
different retry counts and should not be attributed wholly to capture speed.
Mean click-start-to-accepted-evidence time was 10.641 s full versus 4.691 s quarter;
it includes the canonical click and observation, but excludes preparation.
These are small-sample observation measurements, not a full Jev/Decisions task
benchmark, general latency guarantee or measured universal reliability rate.

## Recovery and failure trials

These five injected cases are separate from ordinary timing aggregates. Original
fresh PNGs and OCR results are retained alongside injected evidence/decisions.

| Case | Result | Attempts | Observation time |
| --- | --- | --- | ---: |
| Two stale pre-click quarter frames | Third, fresh quarter frame verified | 3 quarter | 9.410 s |
| Reduced recognition forced to fail | Fresh full frame independently verified | 3 quarter + 1 full | 14.039 s |
| Impossible destination condition | `RENDER_NOT_VERIFIED` | 3 quarter + 2 full | 19.501 s |
| Recognition fails at both sizes | `RENDER_NOT_VERIFIED` | 3 quarter + 2 full | 20.549 s |
| Cancel during verification | `RENDER_CANCELLED`, no accepted frame | 2 quarter | 5.559 s |

The first stale frame was rejected for a context change. The second was rejected
by its pixels despite matching semantic evidence. The third was genuinely fresh
and passed both checks. In the reduced-recognition case, the first small frame
also encountered a context change; the next two failed the injected pixel check.
Cancellation followed one context-change rejection. These details matter: not
every rejection was caused by the injected fault.

Across the batch, including its warm pilot and faults, all 38 retained attempts
were audited for PNG hash/dimension agreement where an image was available.
All 16 accepted frames passed the actual stored snapshot and OCR predicates;
zero injected stale frames were accepted. Nine observations were rejected for
context changes. All action receipts remained successful and unchanged. The
command ledger contains exactly one click per trial (12 total), with no replay
for observation rejection, fallback or cancellation. Failed verification results
have no accepted capture ID. These are controlled tests, not natural failure-rate
estimates.

## Pilot history and discovered accessibility behavior

Failed preparation and policy pilots are retained and excluded from the timing
table, not converted into successful trials:

1. Pilot 1 observed the launcher immediately after opening Settings and stopped
   before rendering verification. Preparation now waits through non-Settings
   snapshots without issuing another navigation action. Unknown overlays remain
   errors.
2. Pilot 2 stopped during the About phone click before verification. Its failing
   process output was not retained by the initial harness, so the exact click
   failure is unproven; later overlay evidence does not establish its cause.
   The harness now saves failed-process stdout and diagnostics. Preparation also
   verifies actual target pixels and unchanged snapshot bounds before clicking.
3. Pilot 3 reached the correct page. All three quarter and two full pixel checks
   passed, but all semantic checks failed. Android reported the painted About
   phone heading as invisible with zero-width bounds. The example had incorrectly
   required that heading to be visible in the accessibility tree. It now requires
   independently visible Basic info and Device name content for arrival, while
   still requiring the heading in the screenshot's top region. After scrolling,
   it requires visible Build number semantics and both heading/content pixels.
   Regression coverage preserves this distinction; the core's two-check rule was
   not weakened.
4. Pilot 4 passed: arrival 6.156 s with one context-change rejection and a second
   quarter frame accepted; scrolled content 3.448 s with one quarter frame.
5. The comparison batch's excluded warm pilot passed: arrival 6.705 s with one
   context-change rejection; scrolled content 3.276 s with one frame.

## Limits and next work

The predicate is specific to this English Settings layout. Snapshot and screenshot
observations are not atomic; matching context keys do not prove absence of every
intervening change. The helper trusts its adapters and cannot independently
attest device identity, frame freshness or predicate correctness. A title-only
predicate proves only the title, not complete page loading. Callers must prevent
concurrent navigation, and cancellation cannot forcibly stop arbitrary blocking
JavaScript. An outstanding callback keeps that verifier instance busy.

The next screenshot-helper PR should maintain the capture process, capability
checks, geometry/freshness handling, recovery and canonical full-resolution
fallback. It must test more Android builds/devices and fail closed on unknown or
protected states. Agent/model accuracy at reduced resolution remains separate
work; this OCR-backed test does not answer it. PRs #353, #398 and #399 remain
closed without merging; this does not revive the persistent-CLI designs.

## Automated validation

- Node build and full suite: 1,499 tests passed across 206 suites.
- Settings predicate: four tests passed, including the actual inaccessible-heading
  regression. The earlier combined example/policy run passed 22 tests before
  that fourth policy regression was added.
- Validation-runner tests: seven passed; the policy test is wired into CI.
- Documentation build passed, including generated link checks and no organization
  warnings. No generated tracked output changed.
- Initial fresh Astra review of all implementation files at `f6a13c2e`: no
  material issues found. The final branch including this report is reviewed
  separately before publication.

An initial sandboxed Node suite could not inspect host processes or bind required
sockets; the authorized process/socket run passed. These are host permission
failures, not physical verification failures. No Android code changed, so an APK
rebuild and unrelated Android suite were not required for this Node-only change.
