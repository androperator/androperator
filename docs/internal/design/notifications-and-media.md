# Notification and media observation

N1 introduces notification listing, media session listing/status, explicit play
and pause, and the `background-observation` doctor capability. N1 merged in
45d9667a821379a2385137d788a7eb4f13986c7b (PR #302). N2 adds notification
dismissal/buttons and media seeking on that merged base. Public contracts live in
[notifications](../../api/notifications.md) and [media](../../api/media.md).

## Service boundary and readiness

Node validates the entire execution before classifying it. A nonempty list containing exclusively
list_notifications, list_media_sessions, get_media_status, media_pause, media_play
and media_seek bypasses interactive readiness. Android parses and makes the
same classification before accessibility lookup and notification-shade closing.
Lists containing notification mutations or UI/other actions retain whole-execution
readiness in either order. A failed readiness check must not dispatch any prefix. Existing UI-only behavior remains in place.

Background doctor checks the host, selected device, installed Operator/version,
and actual listener-backed notification/media queries. It does not run doctor_ping,
clear logcat, launch an app, remediate permissions or invoke interactive readiness.
Default doctor remains interactive. Background --full/--fix is rejected before
checks. This capability does not promise Direct Boot, disconnected-adb, arbitrary
Doze or OEM process-policy support.

Notification snapshots use the connected listener's activeNotifications, including
ongoing/group entries; the presentation manager's historical cache is not reused.
Listener access denial and disconnection are distinct errors. Notification action
handles are opaque, revision-scoped references to exact advertised PendingIntents. No content is logged outside the
canonical result transport by the changed Android execution path.

Media handles map Android tokens to controllers for the lifetime of this Operator
process. Each selected controller is pinned through dispatch and postcondition
waiting. A replacement never satisfies an old command. Dispatch and reported-state
confirmation are separate, including timeout/cancellation evidence. Commands are
not replayed to recover a missing receipt.

## Original reports versus platform estimates

Live regression testing uncovered an important platform behavior:
[Android MediaSessionRecord](https://android.googlesource.com/platform/frameworks/base/+/dfd7091ae8cb/services/core/java/com/android/server/media/MediaSessionRecord.java)
extrapolates positions in getPlaybackState and rewrites the update timestamp.
Its playback-state callback delivers the stored player state instead.

Therefore the service retains onPlaybackStateChanged values and original timing.
Until the first callback, evidence is platform_query, original reported position
and update time are unknown, and the platform position is only an estimate. Once
a callback arrives, evidence is player_report. Fresh observations do not alter
its original update time. Neither callback state nor estimated progress proves
actual playback. Controlled player samples provide independent evidence.

Notification provisioning uses NotificationManager's allow_listener shell command,
even if secure settings already list the component. A settings-only grant left
the listener disconnected on the tested API 35 image. Older API 21-26 images may
use the legacy secure-setting grant if the shell command is absent; this fallback
still requires successful execution and is not a claim of a connected listener.

## Local validation record

Validated on 2026-09-13 from the N1 branch based on
626a169d5cb3cb3435e65a8e525f887873954c4e, including implementation commit 3c7d88f2
and permission/first-unlock hardening commit d1d7b1cc. Branch-local versions
remain 0.10.1 and 0.10.1-d (1001900); release versioning belongs to V1.
The final live target was the explicitly selected API 36 emulator. Earlier
locked/off and control proofs also passed on API 35. Temporary emulator PINs were
removed and accessibility settings restored; no personal credential was changed.

Final debug Operator SHA-256:
`0d21564b4499485aedc007a4da6eb4c1cbc120359364d58950685518933c1811`.
Independent fixture APK SHA-256:
`fd4596a1a002dc060cb0ba878c200cf53b8d332871bc586f497be24e407de47b`.
The standalone fixture survives Operator process death and records actual player
position, screen/keyguard state, power-event counters and control dispatch counts.

| Case | Evidence and outcome |
| --- | --- |
| Real video | The supplied YouTube video played in Chrome after unmuting. Pause/play confirmed player state. Paused API position 108676 ms matched visible elapsed time 1:48; duration was 205861 ms. |
| Real audio | Native browser audio played a generated 120-second WAV. Paused API position 36199 ms matched HTMLAudioElement.currentTime 36.14 seconds; resume showed 36.61 seconds and paused=false. Both real-player modes used Chrome; this is not a claim about every third-party player. |
| Actual fixture pause/play | Independent actualPlaying changed false/true. Already-paused requests returned dispatched=true and targetStateObserved=true with exactly one additional callback. |
| Position states | Live 1x/2x playback progressed; buffering estimates remained fixed; invalid position/update time stayed unknown. Offline math tests cover duration clamps, negative/nonfinite speed and invalid monotonic time. Wall-clock time is not an input. |
| Stale report, stalled player | Original callback position/time stayed fixed and report age increased while independent actual position stalled. |
| Stale report, moving player | Actual playback resumed without new reports; the original report timestamp remained unchanged. Missing updates alone do not prove a stall. |
| Locked/off matrix | All three reads, background doctor and generic MCP passed for nonsecure off, secure on/off, expired cache and relocked states. Independent sample counts advanced without power-transition counters changing during observation. |
| Accessibility unavailable | Clearing the enabled-service list actually unbound accessibility. Locked/off reads and background doctor still succeeded. |
| Open shade | SystemUI mExpandedVisible remained true before/after CLI reads and direct read ingress, without acquiring an accessibility hierarchy. |
| Mixed/UI ingress | With accessibility unbound, direct Android mixed lists in both orders and UI-only input returned SERVICE_UNAVAILABLE with no steps. Host regression tests reject both orders before broadcasting when readiness fails. |
| Notification lifecycle | Existing/ongoing/group notifications, progress, post/update/removal, revision changes, empty results, filtering and bounded/truncated results passed. |
| Permission and reconnection | Revocation returned NOTIFICATION_ACCESS_DENIED through CLI and MCP. Regrant restored existing notifications. Killing only the Operator while locked/off recovered the listener without opening the app; old session handles expired. |
| Before first unlock | After a controlled reboot, CLI reads, background doctor and MCP returned DEVICE_USER_NOT_UNLOCKED. Android user state remained RUNNING_LOCKED until explicit test cleanup. |
| Transport parity | Live HTTP /execute and typed decoding preserved report values and command/task correlation; generic MCP preserved successful read payloads and permission/expired-session errors. |
| Session/control races | Same-package sessions were ambiguous; exact selection worked. Ignored pause timed out with dispatched=true. Replacement during the wait failed with MEDIA_SESSION_EXPIRED. Offline tests pin a resolved session across destruction before dispatch and after dispatch, excluding the replacement. |
| Offline platform coverage | Robolectric API 21 and 28 cover snapshots, callback preservation, permission denial/disconnection, destroyed-token exclusion and pinned-session guards. |

Final validation passed all 1,583 Node tests, the full Android unitTest aggregate,
Operator/fixture debug assembly, and documentation generation with 34 navigation
pages, 399 generated-doc links and no organization warnings.

Raw local evidence is private; committed examples exclude serials, account content
and machine paths. Reproduction is in validation/notifications-media. Offline
checks run in normal CI; the live workflow is manual only.

## Corrections and compatibility limits

Testing exposed and fixed a settings-only permission grant, platform query
extrapolation, and stale permission settings after revocation. API 27+ now uses
NotificationManager.isNotificationListenerAccessGranted rather than trusting the
saved setting. Earlier APIs retain their compatible setting-based check.
A first-unlock guard uses read-only Android user-state probes; unsupported probes
leave runtime errors authoritative. It never wakes or unlocks the device.

Initial browser attempts on API 35 rendered blank; the supplied video and native
audio were successfully verified on the selected API 36 emulator. The initial
accessibility-off harness changed only the global switch, which did not reliably
unbind services; the final harness clears and restores the enabled-service list.
An initial shade setup raced keyguard dismissal; setup now settles before opening
the shade. These failed attempts are not counted as passing evidence.

Live platform coverage is API 26/35/36, with API 21/28 service behavior tested offline.
No live API 21 listener-binding claim is made. Old-image/OEM compatibility and
arbitrary Doze/process restrictions remain limits to consider during release
verification. Direct Boot service operation is not supported. Downstream PiP-window assertions remain separate work. N2 evidence follows below.

The PR review also verified that API 24-26 may return
`No shell command implementation.` with exit status zero. Provisioning recognizes
that response and uses the legacy grant through API 26; API 27+ missing-command
responses remain failures. Regression tests cover both behaviors.

The independent PR review also found unreported button-label truncation and
unsynchronized listener state on API 21-23. Button labels now contribute to
textTruncated. Revision handles use ConcurrentHashMap and the connection fields
are volatile; compiled Kotlin uses API-21-compatible putIfAbsent. New offline
regressions cover truncation and concurrent revision reads. The reviewer confirmed
all findings resolved with no new issues. Post-fix validation passed 20 focused
Node tests, toolkit/operator Android tests and debug assembly, plus the complete
locked/off lifecycle/control harness on the final API 36 APK above.

A fresh independent review found that temporary session inactivity incorrectly
removed its handle and original report. Records and callbacks now survive
inactivity until actual destruction; only active sessions remain discoverable or
targetable. The new regression failed on API 21/28 before the fix and passed
afterward. The final API 36 fixture run above verified inactivity/reactivation
preserves the handle, evidence kind, position and update timestamp, followed by
the complete locked/off lifecycle/control sequence. The fresh reviewer confirmed
the fix with no additional findings. Toolkit/operator unit tests and both debug
APK builds passed.

## API 26 live verification

The same final Operator and fixture APKs were installed on an explicitly selected
Android 8.0 API 26 emulator. Branch-local operator setup succeeded using the
legacy notification-listener grant after the platform returned
`No shell command implementation.`. POST_NOTIFICATIONS was correctly skipped as
unavailable on this platform. The live lifecycle harness now uses the legacy
setting for revoke/regrant through API 26 and the shell API on newer platforms.

The complete fixture run passed: actual pause/play, 1x/2x positions, buffering and
unknown positions, stale reports with stalled/moving actual playback, temporary
inactivity/reactivation, ambiguity, unsupported controls, ignored commands and
replacement during confirmation. CLI, typed helper, HTTP and generic MCP returned
consistent observations and errors.

Secure locked/on-off, accessibility-unbound, expired-cache and relocked cases all
passed with unchanged power-transition counters during each observation series.
Notification post/update/removal, revision and truncation checks, access
revocation/regrant, and Operator process recovery while locked/off passed.
SystemUI independently confirmed open-shade preservation; direct Android mixed/UI
commands failed before dispatch when accessibility was unavailable. Temporary
credentials were removed and accessibility settings restored.

This image reports `ro.crypto.state=unsupported`; encrypted-storage behavior
before the first unlock after reboot was not exercised here. That prerequisite
has separate API 36 evidence above. Real browser video/audio compatibility was
verified on API 36; the API 26 media proof uses the independent MediaPlayer fixture.

## N2 mutation invariants

At N2, all three new actions used the canonical Android execution path with
whole-execution interactive readiness. N3 extends background service execution
to media controls; notification mutations still require interactive readiness. Node validation, typed parameters/payload decoding, CLI, HTTP `/execute`
and generic MCP `execute` share the canonical action contract.

Dismissal checks a fresh listener snapshot and isClearable, dispatches cancellation
once, then reports whether a fresh snapshot actually omits the key. Optional
polling stops at its deadline and returns removalObserved=false when the key
remains. Query failure, listener replacement and permission loss after dispatch
remain errors with dispatch evidence, not empty snapshots or confirmed removal.

Button listings retain bounded process-local references to the exact advertised
PendingIntent and listener, revision, post time and action index. Each listing
issues fresh opaque handles; a published handle is never reassigned. Validation
checks the current snapshot/revision and sends the original PendingIntent. This
also protects a listing that sees a new platform snapshot before a delayed
listener callback. Input/authentication requirements on either the advertised or
current action are rejected. Canceled PendingIntents report dispatched=false;
other platform dispatch failures conservatively preserve dispatch uncertainty.
Android can still race between validation and sending. No retry or replacement
button selection follows that race.

Seek pins one controller, validates seek support and duration bounds, and issues
one absolute-position request. Missing/negative duration is unknown; zero permits
only zero. Positive waits require a new callback sequence and an original player
update time between dispatch and observation, with the reported position within
the requested absolute tolerance. Old PLAYING reports and platform extrapolation
cannot confirm a seek. Timeouts/cancellation retain dispatch and requested
position/wait/tolerance evidence. Inactivity/replacement ends a current command;
only separate future actions can select again. Original reports remain retained
across temporary inactivity until destruction.

N2 is additive to runtime skills. Inspection of the sibling runtime skill sources
found no consumers of the notification/media action contracts that require a
version change. No app-specific skill or release-version change belongs to this
batch.

## N2 integrated acceptance

Validated on 2026-09-13 at implementation commit
`bf85701e51b69b9daa9d7f458e393c9602b2eb1e`, based on origin/main
`3042ece4d1a2733ff3222aac9fac4a2baa6f5066`, which includes the merged N1 commit.
The matching branch-local CLI is 0.11.0; the debug Operator is 0.11.0-d
(versionCode 1100900). These versions were already on main and were not bumped
by N2. Feature completion does not assert merge or publication.

Operator APK SHA-256:
`4824e0cd8b613744512cdf2180274417c387fbfcc8c5f06ae6d7101e55e19765`.
Independent fixture APK SHA-256:
`abdf0551fcecf5bb105f62bbda9e5bc9a6ea54f2f9cb084e265faa4e07f13cfc`.

API 36 and API 26 emulators were selected explicitly after connectivity/API
checks and tested sequentially with those APKs. API 35 was available but was not
needed for additional N2 coverage. API 26 setup successfully used legacy
notification-access provisioning; POST_NOTIFICATIONS was skipped as unavailable.

| Case | Observed result |
| --- | --- |
| Complete fixture flow, both platforms | Discover notifications/sessions, read status, pause, seek to 20000 ms, play, invoke one button, dismiss. Independent MediaPlayer position matched the seek within 100 ms; actualPlaying changed on pause/play; the button counter increased by exactly one. |
| Dismissal, both platforms | Cancellation was dispatched and subsequent removal observed. Android's active notification section independently contained the key before dispatch and omitted it afterward. Reusing the removed key failed; ongoing/non-clearable notifications failed before dispatch. Offline simulated OS refusal retained dispatched=true with removalObserved=false. |
| Button references, both platforms | Notification update and actual Operator process death invalidated old handles. Tests verified the process ID changed rather than trusting a kill request. Canceled PendingIntents returned NOTIFICATION_ACTION_CANCELLED with dispatched=false; removed keys returned NOTIFICATION_EXPIRED. |
| Unsupported buttons | RemoteInput was advertised and rejected on API 26/36. Authentication-required buttons were advertised and rejected on API 36; API 26 has no equivalent flag. Offline API 28 additionally covers data-only RemoteInput. |
| Seek bounds, both platforms | Requests beyond reported duration failed before dispatch. Zero duration accepted zero and rejected one; unknown duration accepted a valid absolute seek. Unsupported sessions and ambiguous package selection returned distinct errors. |
| Ignored seek, both platforms | One seek callback arrived in the fixture while its independent position remained unchanged. A zero-tolerance wait timed out with dispatched=true. No second dispatch occurred. |
| Command timeout, both platforms | A 1000 ms execution budget ended a 30000 ms seek wait with COMMAND_TIMEOUT; requested position, wait, tolerance and dispatched=true survived in step evidence. The fixture counted one request. |
| Stale PLAYING report, both platforms | With original reports frozen and actual playback paused, an ignored seek could not be confirmed by extrapolation. The wait timed out and the original report timestamp remained unchanged. |
| Replacement during seek, both platforms | A same-package replacement expired the pinned session after one dispatch. The old handle stayed expired; the command never targeted the replacement. |
| Typed helper, HTTP and MCP, both platforms | Each path sought to 15000 ms, invoked a button and dismissed a notification. Independent samples showed position 15000, paused playback and exactly one new seek/button callback per path. Stale button errors were preserved. HTTP retained explicit command/task IDs; MCP returned the canonical correlated envelope with its generated IDs. |
| Locked/off regression, both platforms | N1 actual playback, stale reports, inactivity/reactivation, secure on/off, absent accessibility, expired cache, relocking, permission revocation/regrant and listener process recovery passed on the matching builds. Read-only CLI/MCP and background doctor did not change independent power-event counters. |
| Direct Android ingress, both platforms | All N2 mutations, each mixed with a read in both orders, failed with SERVICE_UNAVAILABLE and no steps while accessibility was unbound. Open-shade read preservation and prior UI-only rejection still passed. |

All 1658 Node tests passed after a branch-local build. The requested Android debug
assembly and app unit tests passed, as did the full unitTest aggregate (501 test
cases, no failures/errors), including API 21/28 service tests. Normal CI owns
these offline checks. The existing workflow_dispatch-only live workflow includes
the integrated N2 harness; no PR/push emulator job was added.

Temporary emulator credentials were removed and accessibility settings restored
by the lock/ingress harnesses. Local raw evidence remains outside Git. Committed
records omit device serials, user identifiers, account content and machine paths.

Fixture corrections worth retaining: RemoteInput PendingIntents must be mutable
on recent Android; notification archives must be excluded from active-removal
assertions; process death must be observed; and duration bounds must use the
player's reported metadata. The same nominal 60-second file reported 60023 ms on
API 26, so assuming 60000 would misclassify a valid seek as out of range.

## Remaining release and player limits

N2 feature acceptance is complete locally. Live API 21 listener binding, reads and
pause/play remain an explicit V1 follow-up; API 26/36 evidence and offline tests
do not waive it. Release-package validation with com.androperator.operator,
release notes, transport-release gates, publication and version follow-up remain
owned by the v0.11 release plan. This batch used the development package only.

Real browser compatibility remains supported by the separate N1 evidence above;
N2 seeking/buttons were proven with the independent fixture, not every third-party
player. Advertised seek support may still be ignored, rounded or reported slowly.
A confirmation is a player report, not independent evidence of playback progress
or PiP persistence. Authentication/replies, Direct Boot service operation,
restricted profiles, arbitrary OEM/Doze behavior and downstream PiP-window
assertions remain outside N2.


## Physical YouTube locked-control limitation

A subsequent 2026-09-13 test used the local 0.11.0 CLI and matching 0.11.0-d
Operator on a physical API 37 device. open_uri launched the supplied YouTube
video in com.google.android.youtube. Media discovery found one session advertising
play/pause/seek, and an unlocked media_play dispatched successfully with the
player reporting playing.

After the user locked the phone, status reads succeeded with screenOn=false and
deviceLocked=true. The user independently confirmed audible playback. With the
user then lighting the lock screen without unlocking, media_pause and media_play
against that same session both exited 1 with DEVICE_NOT_INTERACTIVE before media
dispatch. The current readiness predicate requires screenOn, !deviceLocked and
userUnlocked. Screen-off interactive commands can additionally attempt wake
fallbacks; this test avoided those fallbacks rather than treating a wake or unlock
as successful locked control.

All 16 independent keyguard samples across approximately 5.5 seconds showed the
lock screen active during the attempts. Android's YouTube AudioTrack was started
before and after, supporting continued playback. Sampling cannot exclude every
sub-sample transition. The original player position remained 17890 ms with its
unchanged callback timestamp; advancing estimates were not counted as playback
progress. Neither pause nor resume effects were proven because both requests
were rejected. No unlock command was sent.

This exposes a product limitation intentionally retained by N2, not evidence that
Android or YouTube lacks locked media control. N3 changes that classification as described below; this historical test records
the pre-N3 limitation and is not evidence of a successful control cycle.


## N3 locked media controls

N2 merged in ac8a474352476937b119ded7ecc739f517f5fc32 (PR #303). N3 uses an
explicit whole-execution service allowlist in both Node and Android. Reads plus
media_pause/media_play/media_seek bypass the interactive readiness cache and
accessibility lookup; notification mutations and UI/other lists do not. This
classification runs after validation. Background doctor remains read-only, and
the first-user-unlock probe still rejects confirmed RUNNING_LOCKED user storage.
No media dispatch, controller identity, confirmation or estimate semantics change.
No wake, home, app launch, shade closing or permission remediation is part of
eligible execution. Existing runtime skills have no consumers requiring changes.

Runtime implementation is committed in 0d4ce6c0, based on merged N2.
The matching development CLI/Operator versions remain 0.11.0/0.11.0-d. Operator
APK SHA-256: ef0ee1e93be21f722ea833a4500a6e9f594c9f214fbe2684a877b63a7dffc76c.
Fixture APK SHA-256: 5cdb561cb383938bcf9424ddbcdab5a6a1771e7942bdbfcbfbfbda2d582e8571.

### Physical YouTube acceptance

On 2026-09-13, the matching APK was installed on a physical API 37 phone. The
first app-opening attempt encountered temporarily unavailable accessibility after
installation. Once the user unlocked for setup and binding recovered, canonical
open_uri opened the requested video in com.google.android.youtube, independently
confirmed as the resumed app. Playback started before the user locked the phone.
No physical credential or accessibility setting was changed for this test.

Both pause and resume used the same discovered mediaSessionId. Each returned
one successful dispatch with targetStateObserved=true. The pause callback
reported PAUSED at 146897 ms; the resume callback reported PLAYING at 146897 ms
with a new original update timestamp. These are player reports, separately from
estimates. Independent Android audio evidence showed the same AudioTrack changing
started to paused and back to started. The user confirmed audible stop and resume
and that the screen stayed off during each operation.

Six independent window-policy samples spanning about 1.79 seconds during pause,
and seven spanning about 2.02 seconds during resume, all showed keyguard active
and SCREEN_STATE_OFF. The user picked up the phone between commands, lighting
its lock screen; they turned it off again before resume without unlocking.
Sampling cannot exclude every sub-sample transition, so this is bounded evidence
for each operation, not a claim of uninterrupted screen-off state between them.
No wake or unlock command was sent during either operation. Real YouTube seeking
was not required or exercised; independent seek effects belong to the fixture.


### N3 emulator and offline acceptance

API 36 and API 26 used explicit device selectors and the matching APKs above,
sequentially. Each secure lock matrix exercised five states: locked/off, locked/off
with accessibility unbound, after the cache interval, locked/on without
accessibility, and relocked/off. Each state performed pause, seek to 10000 ms
within 100 ms, and play against one selected session. Independent MediaPlayer
samples verified actual effects and exactly one callback for each requested
control. Screen-on/off transition counters remained unchanged during each series.

Typed helpers, HTTP /execute and generic MCP execute each performed pause/seek/play
under locked/on and locked/off with accessibility unbound. HTTP/MCP mixed reads
with controls and preserved session identity and canonical correlation. Ignored
seek and replacement during a locked wait returned their specific failures with
one dispatch; the replacement never satisfied the original command. The fixture
continues sampling independently, so estimates do not substitute for actual
position, playback state or counter evidence.

N1 stale-report/inactivity, speed, buffer/unknown-state, listener denial/regrant
and process-recovery regressions passed on both platforms. N2 dismissal/buttons,
seek bounds, ignored/stale/replacement waits and transport regressions also
passed. Open-shade direct ingress accepted service controls without accessibility
and rejected UI/notification-mutation lists before any prefix. The API 36 reboot
proof rejected all three controls, reads, doctor and MCP before first user unlock.
API 26 reports unsupported storage encryption and does not replace that proof.
Temporary emulator credentials were cleared and accessibility settings restored.

The final Node build passed all 1659 tests, including cold/warm/expired-cache
execution routing and first-user-unlock rejection. Android debug assembly, app
unit tests, the full unitTest aggregate (502 cases, zero failures/errors), and
fixture assembly passed. Documentation and route/link generation passed. Offline
checks remain automatic; the existing live workflow remains workflow_dispatch only.

Harness findings: fixture publication and notification repost callbacks can lag;
read-only session polling and settling before acquiring a new button handle make
setup explicit. A direct-ingress test limits fixture notification output so its
simple log reader does not confuse chunked results with missing results; larger
canonical envelopes are exercised through Node transports. Replacement proof
leaves a controller without callbacks, so a later independent control scenario
starts a fresh fixture after credential cleanup. Do not rebuild dist/ during
live execution. One API 26 independent sample read returned an ADB error despite
printing JSON; bounded fresh-read retry retains failed-read evidence and never
replays a media mutation. Legacy keyguard can time out during a long lit-screen
sequence, so its transport series are prepared separately; setup sleep/wake
transitions occur outside the measured commands. Direct mixed media/UI and
media/notification-mutation lists are rejected in both orders while locked/on
and locked/off, with no steps, control-counter change or power transition.

Live API 21 compatibility, release-package acceptance and V1-V3 release work
remain prerequisites owned by the release plan. This batch does not claim every
OEM/Doze policy or third-party player's behavior, Direct Boot support, physical
YouTube seeking, or PiP-window persistence.

## Bounded report observation

observe_media shares background readiness with get_media_status and pins the same
session for the whole interval. Per-observation callbacks are removed in finally,
including cancellation and expiry. Store at most 64 compact callback records but
count every callback; retain initial/final status independently. No unbounded
history or replay is introduced. Callback receipt time and the per-handle report
sequence expose transport freshness separately from the publisher's position time.
The public contract and interpretation limits live in docs/api/media.md.

Validated on the API 26 emulator with the matching debug Operator: a locked,
screen-off two-second observation received 18 reports and 1849 ms reported
position change. A one-second stalled interval received zero reports and zero
reported change while estimates advanced. Independent player state and wake
counters passed. A 30-second observation completed in 30002 ms, counted 181
callbacks and retained 64 with truncation. Typed Node and HTTP observation also
passed. These are fixture results, not physical-device, browser-specific or live
remote-playback validation. Reproduce the bounded observation cases through
validation/notifications-media/run.py and http-helper-observe.mjs, which are wired
into the existing manual live workflow.

The implementation passed 1661 Node tests, the Android debug build and app,
toolkit and operator unit tests, and the documentation build. Regression coverage
includes strict ingress and CLI flags, null/repeated callbacks, retained sample
bounds, cancellation cleanup, session expiry and older status payload decoding.
