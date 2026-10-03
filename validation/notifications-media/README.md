# Notification/media fixture

The shell-permission-protected fixture is a separate test APK
(`com.androperator.fixture.media`). It plays generated local MP4 content using
MediaPlayer and publishes a MediaSession. Its private JSON sample records actual
player position independently from reports, power transitions and control counts.
Killing the Operator therefore does not kill the evidence source. The fixture is
not packaged in either Operator variant and requires no personal account.

Build the matching CLI, Operator and fixture from the repository root:

```sh
npm --prefix apps/node run build
./gradlew :app:assembleDebug :notification-media-fixture:assembleDebug
```

Provision the selected emulator through `operator setup`, install the fixture APK
from `validation/notifications-media/fixture/build/outputs/apk/debug/`, and grant
its `android.permission.POST_NOTIFICATIONS` on API 33+. Then run:

```sh
python3 validation/notifications-media/run.py --device <device_serial> --output /tmp/notification-proof --secure-lock --controls
python3 validation/notifications-media/mutations.py --device <device_serial> --output /tmp/notification-proof/mutations
python3 validation/notifications-media/ingress-shade.py --device <device_serial> --output /tmp/notification-proof/ingress
python3 validation/notifications-media/first-unlock.py --device <device_serial> --output /tmp/notification-proof/first-unlock
```

Requirements: adb, Python 3, ffmpeg with H.264/AAC encoders, and a controlled
emulator without an existing credential. The extended speed proof requires API
23+; offline service tests cover API 21 and 28. The first-unlock proof reboots the
selected emulator and requires a platform with credential-encrypted user storage.
Both credential tests remove their temporary PIN in cleanup. The locked matrix
also restores the original accessibility settings.

The basic run tests bounded observe with fresh reports and a stale-report interval
while screen-off, including independent player position and wake counters. It
also tests actual pause/play, 1x/2x reports, buffering and unknown
positions, then freezes a PLAYING report while actual playback stops and resumes.
It verifies that temporary inactivity/reactivation preserves the session handle
and original report, then queries beyond the readiness-cache TTL with independent
power-event counters.
HTTP and typed-helper results are compared with the fixture. `--secure-lock`
adds CLI, background doctor and generic MCP reads, actually unbound accessibility,
notification post/update/removal, permission revocation, reconnection and Operator
process recovery. `--controls` covers ambiguity, unsupported/expired handles,
ignored commands and session replacement during a postcondition wait. A new run
restarts only the fixture, so repeated runs do not require reinstallation.

`ingress-shade.py` uses SystemUI's independent state dump to check an open shade.
It directly exercises Android broadcast ingress with accessibility unavailable,
proving mixed lists in both orders, each N2 mutation and UI-only lists fail without
a partial prefix.
`first-unlock.py` checks specific CLI/doctor/MCP errors before first unlock.
Each script retains completed evidence on failure. Never infer actual playback
from an extrapolated position or infer no transient wake from endpoint state alone.

Normal CI runs offline Node/Android tests. The notifications-media workflow is
manual (`workflow_dispatch`) and runs this live sequence. It is not a PR/push
emulator job. Real browser compatibility is separate: `browser/index.html` uses
native audio controls and displays HTMLAudioElement.currentTime. Serve it with a
generated local `tone.wav`; it does not fabricate MediaSession reports.

## Notification mutations and seeking

Run `mutations.py` after `run.py`, sequentially on the selected emulator. It
restarts the independent fixture using the generated media file, then proves
notification/session discovery, status, pause, seek, play, button dispatch and
dismissal. Actual MediaPlayer position, seek/button counters and the system's
notification dump provide independent evidence. The script does not set a PIN or
change accessibility; the lock harness removes its own temporary credential and
restores its initial accessibility settings in `finally`.

The N2 matrix covers removed/non-clearable keys, updated and restarted action
handles, canceled PendingIntents, RemoteInput, authentication requirements on API
31+, unsupported/ambiguous sessions, known/unknown/zero duration, ignored seeks,
zero tolerance, execution timeout receipts, stale PLAYING reports and replacement
during a seek wait. It runs the same mutations through typed helpers, HTTP and
generic MCP, checking actual effects and structured stale-reference errors.

The fixture's RemoteInput button uses a mutable explicit PendingIntent because
Android rejects immutable RemoteInput notification actions. Other fixture buttons
remain immutable. Replies are never sent. Actual seeks use SEEK_CLOSEST on API
26+; older fixture platforms use their available seek operation and may round to
keyframes. API 26 cannot expose the API 31 authentication-required flag, so that
case is covered live on API 36. API 21 listener compatibility remains a release
follow-up; offline API 21/28 tests do not satisfy it.

Offline regressions run in normal Node/Android CI, including safe positions,
whole-execution readiness, exact advertised-intent handles, canceled/input
buttons, refused cancellations, seek cancellation and transport non-replay.
The existing manual live workflow includes `mutations.py`; no automatic emulator
job is added.

## Locked media controls (N3)

The secure lock matrix also pauses, seeks and resumes the same session in locked
on/off states, with accessibility unbound and after the readiness-cache interval.
Independent MediaPlayer samples must show actual pause/play and seek within
100 ms, exactly one callback per control, and unchanged screen-transition counters.
The locked-transports.mjs harness runs typed helpers and mixed read/control lists
through HTTP and generic MCP, checking session identity and actual effects.
Ignored seeks and replacement during confirmation remain explicit failures with
dispatch evidence. Direct Android ingress preserves the open shade for service
controls while rejecting UI/notification-mutation lists before any prefix.

Run run.py with --secure-lock --controls, then mutations.py and ingress-shade.py
on each explicit emulator. Run first-unlock.py on a controlled encrypted emulator;
it also checks that media controls fail before first unlock. The replacement
proof ends its selected session; the later, separate control regression starts a
fresh fixture after temporary-credential cleanup. Keep the branch-local dist/
unchanged while a live harness is running; rebuilding it can interrupt a child CLI
before it produces JSON. Session discovery polls boundedly after fixture launch;
notification transport setup allows repost callbacks to settle before acquiring
a fresh handle. The lit lock screen is prepared separately for each transport
series so a legacy keyguard sleep timer does not expire during a long run; those
setup transitions happen before the measured controls. Independent sample reads
may retry at most three times after a read error, retaining failed-read evidence.
Neither setup repair retries a mutation. Offline CI stays
automatic; live CI stays manual.
