# Notifications

Read accessible active Android notifications without opening the notification
shade, waking the display or dismissing keyguard:

```sh
androperator notifications list --app <package> --limit 25 --max-text-chars 256
androperator doctor --capability background-observation
```

Notification access must be enabled for the selected Operator and its listener
must be connected. Operator setup grants access; unavailable access or a
connection failure returns an error, not an empty list. Android profile and
sensitive-content restrictions still apply.

`list_notifications` accepts optional `applicationId`, `limit` (1-100, default 25)
and `maxTextChars` (1-1024, default 256). Omit applicationId for all accessible apps.
Blank values, unknown parameters and invalid bounds are rejected. The same action
works through HTTP `/execute` and generic MCP `execute`.

The canonical step's `data.payload` is a JSON string with `schemaVersion: 1`,
`observedElapsedMs`, `deviceState`, `notifications`, `total` and `truncated`. Node's
`decodeNotificationMediaPayload` validates and decodes it. Notifications include
key, applicationId, nullable title/text, postTime, ongoing/clearable/group fields,
action descriptors, text/action truncation flags and nullable generic progress.
deviceState records screenOn, deviceLocked and userUnlocked at query completion.
These endpoint values alone cannot exclude a transient wake; use independent
state-transition evidence for regression tests. Ongoing notifications and group summaries are included. Results are capped at
64,000 payload bytes as well as the requested item/text limits; `truncated`
indicates omitted items. An empty list with total zero is a successful snapshot.

Action descriptors expose opaque actionId, title, requiresInput and
requiresAuthentication. Use these handles for the button operation below. Progress is the notification's generic value/max and
indeterminate flag, not a playback timestamp. Use [media status](media.md).

Observation-only execution lists may contain list_notifications,
list_media_sessions and get_media_status in any order. They bypass interactive
readiness and do not need accessibility or an app window. Lists may also include
media_pause, media_play and media_seek without waking or unlocking the device.
Any list containing a UI action, dismissal or notification button retains normal
whole-execution interactive readiness; no prefix runs if readiness fails. Before first unlock after reboot, a supported Android user-state probe returns
DEVICE_USER_NOT_UNLOCKED before dispatch. Unlock the user once during setup; reads
do not unlock it. An unsupported probe leaves platform/runtime failures authoritative.

Errors include NOTIFICATION_ACCESS_DENIED, NOTIFICATION_LISTENER_DISCONNECTED,
NOTIFICATION_QUERY_FAILED and NOTIFICATION_SERVICE_UNAVAILABLE. Inspect the
failed step's errorCode; transport failures remain distinct.

## Dismissal

```sh
androperator notifications dismiss '<key>' --wait-timeout-ms 2000
```

`dismiss_notification` requires `notificationKey` (nonblank, at most 4096
characters). Optional `waitTimeoutMs` is an integer from 0 to 30000, default 0.
Android checks the current listener snapshot and clearability immediately before
requesting cancellation. The schemaVersion 1 payload contains notificationKey,
dispatched, removalObserved, waitTimeoutMs, observedElapsedMs and deviceState.

`dispatched: true` means cancellation was requested. Only `removalObserved: true`
means a subsequent active snapshot omitted the key. With a positive wait the
service polls until removal or the deadline; a still-present notification returns
success with removalObserved=false, including when Android refuses cancellation.
It does not claim deletion. A re-posted notification with the same key may prevent
confirmation. Observation failure after dispatch returns an error with dispatch
receipt retained. A missing key returns NOTIFICATION_EXPIRED; a non-clearable
notification returns NOTIFICATION_NOT_DISMISSIBLE before dispatch.

## Notification buttons

```sh
androperator notifications action '<key>' --action '<action-id>'
```

`invoke_notification_action` requires `notificationKey` and `actionId` (nonblank,
at most 128 characters). Use the opaque actionId returned by a recent listing.
The schemaVersion 1 payload contains notificationKey, actionId, dispatched,
observedElapsedMs and deviceState. Dispatch does not confirm the application's
side effect.

The service validates the current key and notification revision, then sends the
exact advertised PendingIntent once. Notification updates, removals, listener
replacement/reconnection and Operator restart invalidate references. The process
issues fresh opaque handles for each listing and retains at most 2000 advertised
button handles; an evicted handle also requires a
fresh listing. Unadvertised buttons, including truncated ones, cannot be invoked.
No replacement button is selected after a race. Android can still change state
between validation and dispatch.

| Error | Meaning |
| --- | --- |
| NOTIFICATION_EXPIRED | The key is no longer active |
| NOTIFICATION_ACTION_EXPIRED | The advertised revision/handle is no longer available or does not match |
| NOTIFICATION_ACTION_CANCELLED | Android canceled the PendingIntent; dispatched=false |
| NOTIFICATION_ACTION_INPUT_UNSUPPORTED | The button requires RemoteInput, including data-only input |
| NOTIFICATION_ACTION_AUTHENTICATION_UNSUPPORTED | The button requires authentication on a platform that exposes this requirement |
| NOTIFICATION_MEDIA_OPERATION_FAILED | A platform operation failed; inspect dispatched before deciding what to do next |

Dismissal and buttons require interactive readiness and accessibility for the
whole execution, including mixed read/mutation lists. They do not automatically
authenticate. Both work through `runNotificationMedia`, HTTP `/execute` and generic
MCP `execute` with the same canonical action parameters. All step data remains
string-valued. Failures/cancellation retain dispatched and waitTimeoutMs when a
step began; a missing transport receipt is uncertain and never triggers replay.
