# Media sessions

```sh
androperator media list
androperator media status --session <id>
androperator media observe --session <id> --duration-ms 10000
androperator media pause --session <id> --wait-timeout-ms 2000
androperator media play --session <id> --wait-timeout-ms 2000
```

Discover active Android sessions before targeting one. `--app <package>` may
replace `--session` only when it identifies exactly one session. No implicit
selection of a recent or playing app occurs. Session handles expire when their
session ends or the Operator restarts; a replacement from the same package does
not inherit the handle. Temporarily inactive sessions are omitted from discovery
and cannot be targeted (`MEDIA_SESSION_EXPIRED`). Reactivating the same Android
session restores its existing handle and retained original report. The selected
controller is pinned throughout each action.

List/status/observe and pause/play/seek work while the display is off or keyguard locked
without waking it or requiring accessibility. Executions may mix these media
controls with notification/media reads. Adding a UI action or notification
mutation retains whole-execution interactive readiness. Notification access and a connected
listener are required. Players without active sessions cannot be controlled here.

| Action | Parameters |
| --- | --- |
| list_media_sessions | Optional applicationId, limit (1-100, default 25), maxTextChars (1-1024, default 256) |
| get_media_status | Exactly one applicationId or mediaSessionId |
| observe_media | Exactly one applicationId or mediaSessionId; required durationMs (integer 1-30000) |
| media_pause / media_play | Exactly one applicationId or mediaSessionId; optional waitTimeoutMs (0-30000, default 0) |
| media_seek | Exactly one applicationId or mediaSessionId; required positionMs; optional waitTimeoutMs and positionToleranceMs (see below) |

Use these actions through CLI, typed `runNotificationMedia`, HTTP `/execute`, or
generic MCP `execute`. Canonical `data.payload` is a JSON string with
schemaVersion 1 and deviceState (screenOn, deviceLocked, userUnlocked). Lists contain sessions/total/truncated; status contains session.
Use `decodeNotificationMediaPayload` for typed Node decoding. Session metadata
includes nullable title/artist/durationMs, state and supportedControls.

## Position evidence

`evidence` is `player_report` after a playback-state callback has arrived for the
selected session. Before that, it is `platform_query`: Android may have already
extrapolated the queried position and replaced its timestamp. In this case,
reportedPositionMs, positionUpdatedElapsedMs and positionUpdateAgeMs are null,
estimatedPositionMs contains the platform value, and positionUnknownReason is
`original_player_report_unavailable`. Repeating queries cannot manufacture an
original player report. Session discovery does not wait for a callback.

- reportedPositionMs is the player's last reported value; unknown is null.
- positionUpdatedElapsedMs preserves the player's original update timestamp.
- observedElapsedMs is the query time in Android elapsed realtime, not wall time.
- positionUpdateAgeMs exposes report age. A fresh query need not be a fresh report.
- estimatedPositionMs extrapolates a valid position using playbackSpeed in
  advancing states, bounded by zero and known duration. It does not advance paused
  or buffering reports. Invalid/missing timing or speed yields null with a reason.

An unchanged PLAYING report can keep producing advancing estimates after actual
playback stops. Neither an estimate nor a state query proves ongoing playback or
PiP-window persistence. Use independent playback/window evidence for assertions.
Live streams, ads and remote playback may have app-defined or unavailable timelines.

## Control evidence

Pause/play require the advertised control. With default waitTimeoutMs zero,
results report dispatched and targetStateObserved plus a new session observation.
The execution timeout may end a wait earlier. A positive wait requests bounded confirmation of the player's reported target
state. This establishes reported state, not independent playback progress.
MEDIA_POSTCONDITION_TIMEOUT retains dispatched=true. Expired sessions, unsupported
controls and ambiguity return MEDIA_SESSION_EXPIRED, MEDIA_ACTION_UNSUPPORTED or
MEDIA_SESSION_AMBIGUOUS. Never replay a mutation after uncertain transport.

## Seeking

```sh
androperator media seek --session <id> --position-ms 20000 --wait-timeout-ms 2000 --position-tolerance-ms 100
```

`media_seek` requires exactly one `mediaSessionId` or `applicationId`, and
`positionMs`. Position must be a finite nonnegative integer no greater than
9007199254740991 (JavaScript's maximum safe integer). Missing, blank, fractional,
negative and unsafe positions are rejected before dispatch. Unknown parameters
and conflicting selectors are rejected on both Node and Android ingress.

The selected player must advertise seek. If durationMs is known and nonnegative,
positionMs must be no greater than it: zero duration permits only position zero.
Missing or negative duration is unknown and imposes no upper bound beyond the
safe-integer limit. The service never silently clamps the requested position.
A player can still reject or ignore a supported request.

Optional `waitTimeoutMs` is 0-30000 (default 0); optional `positionToleranceMs` is
0-60000 (default 1000). Both must be integers. With no wait the result reports
dispatch and a fresh session observation. With a positive wait, confirmation
requires a new playback-state callback after dispatch, a valid original update
time at or after dispatch and no later than observation, and a nonnegative
reported position within the absolute tolerance. A previous report, platform
query or extrapolated estimate cannot satisfy the wait. A player that reports
infrequently, rounds positions or seeks only to keyframes may need a larger
tolerance or may time out even when it moves.

The schemaVersion 1 payload contains dispatched, requestedPositionMs,
positionToleranceMs, waitTimeoutMs, targetPositionObserved, session,
observedElapsedMs and deviceState. The same parameters and payload work through
typed helpers, HTTP `/execute` and generic MCP `execute`. MEDIA_POSITION_OUT_OF_RANGE
means the requested position exceeds known duration; MEDIA_ACTION_UNSUPPORTED
means seek is not advertised. Invalid direct service values use
MEDIA_POSITION_INVALID; ingress rejects malformed parameters during validation.

MEDIA_POSTCONDITION_TIMEOUT, execution timeout/cancellation and session expiry
retain dispatched, requestedPositionMs, positionToleranceMs and waitTimeoutMs in
string-valued step evidence. A session that becomes inactive or is replaced during
a wait fails with MEDIA_SESSION_EXPIRED. The command never follows its replacement
or repeats an uncertain control. Original player reports remain separate from
estimates, including across temporary inactivity. Report confirmation is not
independent proof of actual playback; verify the player when that matters.

## Observing reports over time

`media observe --session <id> --duration-ms 10000` collects playback-state callbacks
for a requested ten seconds and returns one result at the end. Duration is
configurable from 1 to 30000 milliseconds; it is not a refresh interval. The
player determines when callbacks arrive. Use `media status` for an immediate
snapshot. Observation does not issue play/pause/seek or force fresh reports.

The canonical action is `observe_media` with `durationMs` and exactly one target.
Missing, blank, fractional or out-of-range durations and unrelated parameters are
rejected. CLI and typed helpers default the execution timeout to durationMs plus
10000 milliseconds; an explicit timeout remains authoritative and can end the
action early. Raw `/execute` and MCP callers must budget their execution timeout.
Session expiry or inactivity fails with MEDIA_SESSION_EXPIRED without following a
replacement. Cancellation, timeout or permission loss fails the action rather
than returning a completed observation. Partial samples are not returned on failure.

The schemaVersion 1 payload adds these fields to the usual observedElapsedMs and
deviceState (the latter describes the end of observation):

- initialSession and session: starting and ending status for the pinned handle.
- startedElapsedMs, endedElapsedMs and durationMs: actual monotonic boundaries
  and requested duration. Scheduling can make the actual interval longer.
- samples: the first 64 playback-state callbacks received during the interval,
  in receipt order. Empty means no callback arrived. Initial/final status are
  separate from this array. Each sample contains playerReportSequence,
  playerReportReceivedElapsedMs, state (the same readable values as status),
  reportedPositionMs, positionUpdatedElapsedMs and playbackSpeed. Null callback
  state is retained as unknown with null position/timing/speed fields; a negative position is null.
  Sample update timestamps preserve the published value, including invalid zero
  or future values; receipt time is the Operator's own clock reading.
- newPlayerReportCount: all callbacks received, including identical/null reports
  and callbacks omitted after the retention limit. truncated signals omitted samples.
- reportedPositionDeltaMs: final minus initial reported position, or null if
  either is unknown. It can be negative after seeking or a timeline change and
  does not measure rendered media or distance played.

Status/list/control results also expose playerReportSequence (zero before the
first callback), playerReportReceivedElapsedMs (null before the first callback),
bufferedPositionMs (null for absent state or a negative published value), and
playbackType (`local`, `remote`, or `unknown`). Buffer zero is the value published
by Android and does not prove the buffer is empty. Receipt time differs from the
player's positionUpdatedElapsedMs: receiving a report does not refresh its
published update timestamp. Sequence numbers belong to one handle in one
Operator process; repeated reads do not increment them. The Node decoder accepts
older status payloads without these additive fields.

Fresh reports are evidence that the session publisher sent updates, not proof of
audible audio or rendered frames. No reports is also not proof of stalled playback.
Use independent player/output evidence when testing background playback.

### Agent workflow

For a one-off reading, use `media status --app <package>`. For a test interval,
first use `media list --app <package>` and select a mediaSessionId, then call
`media observe --session <id> --duration-ms 10000`. Pinning the discovered handle
ensures a replacement session cannot satisfy the test. An ambiguous package
requires explicit session selection; an expired handle requires rediscovery.

Read newPlayerReportCount and reportedPositionDeltaMs first, then inspect samples
for pauses, buffering, seeks or unknown values. Zero callbacks is a successful
observation with insufficient evidence of fresh reports, not a playback failure.
Use initialSession/session for context and truncation to detect incomplete sample
history. Keep independent output assertions separate. Do not pause/play merely
to manufacture a fresh report during a background-playback test.
