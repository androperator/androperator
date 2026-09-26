# Evidence Bundles

Capture a screenshot and raw hierarchy as local files with device metadata,
correlation IDs, timestamps, hashes, and explicit component failures. A bundle
records observations; it does not assert an application outcome or change a
caller-supplied test verdict.

## CLI capture

```bash
clawperator evidence capture --device <device_serial> --operator-package com.clawperator.operator.dev --output-dir /absolute/new/bundle --label "Settings observation" --context-json '{"commandId":"original-command","originalVerdict":"failed"}'
```

| Option | Contract |
| --- | --- |
| `--output-dir <directory>` | Required absolute new directory; its parent must exist. Blank paths, filesystem roots, parent traversal, and existing destinations are rejected. |
| `--device <serial>` | Standard explicit device selection. Required when multiple devices are connected. |
| `--operator-package <package>` | Standard Operator selection; package identifier characters only, with no automatic variant switch. |
| `--label <text>` | Optional, defaults to null; at most 2048 UTF-16 code units. An empty label is valid. |
| `--context-json <object>` | Optional JSON object, defaults to `{}`; at most 16 KiB UTF-8 when serialized. Arrays, null, and non-JSON values are invalid. |
| `--timeout <ms>` | Overall device-work budget, default 30000; integer `1000..120000`. |
| `--output <json\|pretty>` | Response formatting. |

Device selection occurs once. The screenshot is attempted first, followed by
raw hierarchy capture on that same device. Both are attempted independently
within the remaining budget. With less than 1000 ms remaining, hierarchy capture
is recorded as timed out without dispatch because that is the execution engine's
minimum timeout. Metadata queries also use the remaining budget. Final local
file/manifest persistence can continue after the device-work deadline so timeout
evidence remains available.

The screenshot uses the same targeted ADB capture helper as normal screenshots
and does not require an application accessibility root or an available Operator.
Hierarchy capture still requires the selected Operator and preserves its actual
success or failure. Its readiness check is read-only: a sleeping or locked device
returns a hierarchy failure without wake or Home input. Expiring the device-work
budget records screenshot or hierarchy cancellation as `COMMAND_TIMEOUT` and
retains completed artifacts and any partial image bytes. A hierarchy canceled
by this budget retains `details.deadlineOwner: "evidence_capture"`, the execution
phase, dispatch state, earlier effects and available result-reader diagnostics
in `captures.json`. This distinguishes an owned deadline from an unexplained
`RESULT_TRANSPORT_EXITED`. A terminal result accepted before deadline cancellation
is preserved. Host cleanup does not prove that Android execution stopped, and
capture never replays a dispatched action. Screenshot bytes must decode as a valid PNG with matching,
positive dimensions. Capture is limited to 64 MiB and decoding to 32 million
pixels. Empty, corrupt, or incomplete PNGs cannot mark an image complete.

The screenshot and hierarchy are sequential, not atomic or automatically settled.
The caller owns waiting, assertions, and screen preparation. Capture does not
retry a prior action, change overlays, run doctor, upload media, or generate a
report. [Accessibility-event recording](recording.md) remains a separate feature.

## Result and exit status

```json
{
  "ok": true,
  "status": "complete",
  "manifestPath": "/absolute/new/bundle/manifest.json",
  "evidenceId": "generated-uuid"
}
```

| Status | Meaning | CLI exit |
| --- | --- | --- |
| `complete` | Both image and XML verified, metadata available, and capture receipts persisted | 0 |
| `partial` | At least one requested capture is usable, but another capture, metadata field, or receipt file failed | 1 |
| `failed` | Neither requested capture is usable | 1 |

Partial/failed results have `ok: false` and `code: "EVIDENCE_CAPTURE_FAILED"`.
They retain the readable manifest and any available artifacts when the destination
is writable. `EVIDENCE_OUTPUT_EXISTS` rejects collisions without overwriting.
Invalid requests or device-selection failures occur before capture. If storage
prevents manifest persistence, the command returns `EVIDENCE_CAPTURE_FAILED`;
files already written remain in the chosen directory, but no finalized manifest
is promised.

A complete capture can contain `context.originalVerdict: "failed"`. These are
independent facts. Never replace the caller's original verdict with capture status.

## Bundle files and manifest

| File | Content |
| --- | --- |
| `manifest.json` | Atomically finalized schema-version-1 manifest |
| `screenshot.png` | Verified screenshot |
| `hierarchy.xml` | Verified raw XML, unchanged from the capture envelope |
| `captures.json` | Original Operator capture result and host screenshot receipt |

Incomplete artifacts retain names such as `screenshot.partial.png` or
`hierarchy.partial.xml`. A new attempt requires a new directory. A terminal
bundle is not subsequently modified by capture commands. Bundles contain local
screen content and may contain sensitive data; no upload is performed.

The manifest contains `schemaVersion: 1`, `evidenceId`, `label`, opaque `context`,
`device`, host UTC ISO `startedAt`/`finishedAt`, `status`, `artifacts`, and `errors`.

`device` includes:

- `serial`, `operatorPackage`, `cliVersion`, and `operatorVersion`;
- `apiLevel`, `androidVersion`, `manufacturer`, and `model`;
- `deviceType`: `emulator` if either `ro.kernel.qemu` or `ro.boot.qemu` is `"1"`,
  including conflicting `"0"`/`"1"` indicators. A successfully read, parseable
  property inventory is inferred to be `physical` when both flags are absent,
  empty, or `"0"`. Unexpected nonempty values without a `"1"`, malformed or
  empty inventories, and failed or timed-out reads produce `unknown`.
  `deviceTypeProperties` retains nonempty raw values, with null for absent or
  empty flags;
- `display.width`, `height`, `density`, and `rotation`. Current `wm` overrides
  take precedence over physical dimensions/density. Rotation uses the primary
  display's input viewport or the older `SurfaceOrientation` value (`0..3`).

Still and video capture use the same classification policy. Emulator flags are
a heuristic, not hardware attestation. Unknown classification remains a metadata
failure; this policy does not change historical manifests.

Unavailable metadata is null with an associated error; unknown device type is
`unknown`. Missing metadata makes otherwise usable evidence partial. Geometry
and device properties are targeted ADB observations and are not synchronized
with the screenshot or device clock.

Each still-capture artifact includes `kind` (`screenshot`, `hierarchy`, or `capture_envelopes`),
a bundle-relative `path`, `mimeType`, `status`, `bytes`, `sha256`, separate
`startedAt`/`finishedAt`, and monotonic `durationMs`. Image and hierarchy entries
also include `commandId` and `taskId` for their capture records. Failed entries
without usable files have null path/size/hash and an `error`; retained partial
files have their own partial entry and error. The manifest never hashes itself.
Errors contain `{code,stage,message,component}`, with component nullable.

`captures.json` retains the Operator result under its hierarchy record's
`result`, including the canonical envelope and fields such as
`operator_overlay_visible` when supplied. The screenshot record has
`source: "adb_screencap"` and a host transport receipt, not an invented Operator
envelope. Its `result.ok` describes transport completion; the manifest separately
records PNG validation. Each capture record includes the corresponding artifact's
correlation and observation/persistence timing. No base64 media is embedded.

## MCP and Node domain

MCP `evidence_capture` accepts the common `deviceId`, `operatorPackage`, and
`timeoutMs` fields, plus optional `label` and `context` (an object, not a JSON
string). It rejects `outputDir`, raw paths, and unknown parameters. Each request
allocates a new bundle beneath the server-owned
`~/.clawperator/evidence/bundles` directory by default and returns its `manifestPath`.
See [storage configuration](#evidence-storage-configuration) to change this root.
Partial/failed results also set MCP `isError: true` while preserving that path.
See [MCP Server](mcp.md#mcp-tool-evidence-capture).

The shared Node domain entry point is `captureEvidence(options, dependencies?)`
in `domain/evidence/capture.ts`. It accepts equivalent typed options. Omitting
`outputDir` allocates a managed bundle; the test/server dependency `baseDir`
overrides its managed bundle root. The writer and readers share the schema in
`contracts/evidence.ts`. Injectable capture, metadata, file, process, and clock
dependencies support deterministic testing.

## Evidence storage configuration

Set `CLAWPERATOR_EVIDENCE_DIR` to a writable evidence root when the default
`~/.clawperator/evidence` is unavailable. Managed still and video bundles use
`<evidence_root>/bundles/<session_id>`. The setting applies to Node and MCP
callers and CLI video state preflight. CLI `--output-dir` remains a separate,
absolute new bundle directory; it is not interpreted relative to this root.
The HTTP `serve` API does not expose evidence endpoints.

An omitted variable retains the default. Empty or whitespace-only values fail
with `EXECUTION_VALIDATION_FAILED`. Relative roots resolve against the caller's
working directory once at request entry. Detached workers use the absolute
output and ownership paths saved in `session.json`.

```bash
export CLAWPERATOR_EVIDENCE_DIR=/absolute/writable/evidence
clawperator evidence video start --device <device_serial> --operator-package com.clawperator.operator.dev --output-dir /absolute/new/video-bundle --duration-seconds 30
```

Video checks root, lock-directory and bundle writes before spawning its worker.
`EVIDENCE_STORAGE_UNWRITABLE` includes `path`, `causeCode`, `message`, and
`recovery` in CLI/Node and MCP errors. Select writable state and output paths,
and permit access to the fixed host lock directory below. No permissions are
changed. A failed preflight starts no recorder and releases any acquired device
lock. It may leave newly created empty directories; use a new bundle directory
on retry. Later filesystem failures can still prevent manifest persistence.
`CLAWPERATOR_LOG_DIR` remains an independent logging setting.

Absolute manifest-path status/stop continues to work after changing or unsetting
the root, even if its new value is invalid. MCP session-ID lookup requires the
root containing that managed bundle; configure a new MCP process with the same
root to resume it. Changing the root does not migrate or delete old bundles.

## Managed video

Video uses the same bundle schema and adds a persistent, bounded recording
lifecycle. It does not change accessibility-event `record start/stop` commands.

<a id="video-dependencies"></a>

### Optional host dependencies

Install [scrcpy](https://github.com/Genymobile/scrcpy#readme) 3.0 or newer,
`ffprobe`, and `ffmpeg` 6.1 or newer with the `libx264` encoder on the host before starting
video. All three commands must be available on `PATH`. Clawperator checks their
capabilities before dispatch and does not bundle or install these tools.
On macOS, install them with `brew install scrcpy ffmpeg`. On other hosts, install
scrcpy and an FFmpeg distribution that includes ffprobe and libx264, then expose
the executables on the PATH used by the CLI or MCP server.

`clawperator doctor --device <device_serial>` reports `host.video.dependencies`
as an advisory warning when any requirement is unmet. This does not block normal
device readiness or install anything, including with `--fix`. A passing check
verifies host tooling only, not that a device can encode or record its screen.

Video start returns `HOST_DEPENDENCY_MISSING` before reserving the device or
creating an output bundle when dependencies are missing, fail to run, or lack
required capabilities. CLI exits 1; MCP returns `isError: true`. Node rejects with
the same payload. The error includes:

- `message`: names every failing executable and requirement.
- `hint`: installation and PATH guidance, a macOS install command, and the doctor
  command to rerun before retrying.
- `details.capability`: `video-recording`.
- `details.dependencies`: entries with `dependency` (`scrcpy`, `ffmpeg`, or
  `ffprobe`), `reason` (`missing`, `unavailable`, or `unsupported`), and `requirement`.
- `details.docsUrl`: this dependency guide.

`missing` means executable lookup failed (ENOENT or exit 127); `unavailable`
means another execution failure or timeout; `unsupported` means required scrcpy
flags are absent, FFmpeg is older than 6.1, or its timing/encoder capability probe fails. Repair the environment before retrying;
repeating the same capture does not install dependencies. This replaces the
previous generic `EVIDENCE_CAPTURE_FAILED` prerequisite error.

FFmpeg 6.1 is the minimum supported release. Newer releases must also pass the
runtime capability probe; an executable's version alone does not prove support.
Doctor and video start run a two-frame in-memory libx264 encode with
`-fps_mode passthrough -enc_time_base demux`. This checks the installed encoder
and exact timing option values without recording a device or creating media files.
Builds must include the `lavfi` input, `color` filter and `null` output used by
this probe. Install a full FFmpeg distribution if a reduced build fails it.
Both segment encoding and full decode verification use those same timing options:
frames pass through without rate conversion, and the encoder retains the demuxer
timebase. Frame-count checks and strict full-stream decoding remain required.

For Clawperator 0.12.1, FFmpeg 8.1.3 is a tested temporary workaround for the
legacy arguments rejected by 9.0.2. This does not establish compatibility with
all FFmpeg 8 releases or make 8.1.3 the minimum. To select an installed alternative
without changing the host default, use a process-local environment:

```bash
PATH="$(brew --prefix ffmpeg@8)/bin:$PATH" clawperator evidence video start --device <device_serial> --output-dir /absolute/new/video-bundle --duration-seconds 25
```

Confirm the selected executable's version. Use the same environment for startup
and any independently launched verification commands; the detached worker inherits
its startup PATH. No host installation or global PATH changes are made by Clawperator.

Still screenshots require only ADB: capture explicitly selects the active physical
display, including a foldable's outer screen. Older Android dumps without
viewport activity metadata retain default display selection.

```bash
clawperator evidence video start --device <device_serial> --operator-package com.clawperator.operator.dev --output-dir /absolute/new/video-bundle --duration-seconds 30
clawperator evidence video status --session /absolute/new/video-bundle/manifest.json
clawperator evidence video stop --session /absolute/new/video-bundle/manifest.json
ffprobe -v error -show_streams /absolute/new/video-bundle/video.mp4
```

Start requires an explicit device and an integer `--duration-seconds` from 1 to
180. The duration is enforced by the scrcpy process even if the Node worker
disappears. It is also bounded by the worker while the worker is alive.
The common `--timeout` option applies only to still capture; video uses the fixed
startup, stop, and media subprocess budgets below.
The output directory must be absolute and new. Optional `--label` and
`--context-json` have the same contracts as still capture. There is no automatic
retry, wake, navigation, overlay change, audio, or application assertion.

By default, the current display dimensions are scaled down to a longest edge of
at most 1280 pixels, with both edges rounded down to positive even numbers.
`--size WIDTHxHEIGHT` accepts positive even dimensions within 1% of the current
display aspect ratio. The recording canvas stays in its initial orientation.
When Android rotates, content rotates within that canvas at full size instead
of shrinking into a portrait letterbox. Landscape content can therefore appear
sideways in a recording that started in portrait; device rotation settings are
not changed.

Folding or unfolding can change the capture dimensions. Capture continues without
restarting, and finalization creates a separate MP4 for each consecutive size
span. The first clip is `video.mp4`; later clips are `video-0002.mp4`,
`video-0003.mp4`, and so on. Read every `kind: "video"` artifact in manifest order.
Each clip has fixed dimensions, its own codec headers, and timestamps starting
at zero. Later sizes preserve their aspect ratio and stay within the initial
longest-edge limit (1280 by default, or the longest edge of `--size`). The initial
clip honors the exact requested size. No framing or padding is added.

The source is captured as H.264, then each span is encoded as H.264 MP4 and fully
verified. This final encoding requires host CPU time; stop can return pending
while it runs. File existence alone is never proof of usable video.

The detached Node worker survives the start CLI process. Start waits at most five
seconds for the live scrcpy process to open its capture file. This confirms
startup, not a decoded frame. A startup
acknowledgement timeout returns `ok: false`, `code: "COMMAND_TIMEOUT"`, and the
session path, and requests that the worker stop. Status remains available.

| Operation | Success and exit status |
| --- | --- |
| Start | Exit 0, `ok: true`, `status: "recording"` after startup confirmation. Startup failures or timeout exit 1. |
| Status | Exit 0 for a found `starting`, `recording`, `finalizing`, or `complete` session. Partial, failed, unknown, or unavailable-worker states exit 1. |
| Stop | Exit 0 only for `complete`. It waits up to 15 seconds; pending, partial, or failed sessions exit 1. Poll status if finalization remains pending. |

Responses include `sessionId`, `manifestPath`, `status`, and `ok`, plus a failure
`code` when applicable. Status and stop use the immutable saved target and reject
conflicting device or Operator options. Repeated stop after finalization returns
the existing outcome without changing evidence. Concurrent stop requests write
nonce-bound requests; only the worker publishes manifests.

### Video artifacts and recovery

Active video manifests have `finishedAt: null`; terminal manifests have a host UTC
finish time. `video` contains `requestedDurationSeconds`, `hostDurationMs`,
`mediaDurationMs`, `requestedSize`, `actualSize`, `codec`, and `stopReason`.
Host duration uses a monotonic clock and is measured independently of the decoded
media timeline. Idle screens can produce shorter media timelines; neither duration
is a substitute for the other. A zero-duration idle recording remains partial,
even if one frame decodes. Available probe metadata is retained on verification
failure. For multiple clips, `mediaDurationMs` is the sum of verified clip
durations and `actualSize` is null when clip sizes differ. `captures.json` lists
each span's source start/end time, frame count, output path, and verified media
properties. Stop reasons are `requested`, `duration_cap`,
`startup_failure`, or `failure` (null while recording).

The worker records `capture.partial.mkv` locally, inspects decoded frame dimensions
through the entire source, and encodes each span into a `.partial.mp4` file.
It probes each clip's codec, exact output dimensions and positive media duration,
then fully decodes the first video stream with ffmpeg through its final frame.
Verification requires a successful end-of-stream report with exactly the source
span's frame count and no error diagnostics. Later corruption cannot pass on the strength of an
opening frame. Source timing is preserved for variable-frame-rate recordings;
verification does not compare media time with host time.

Probe has a 10-second deadline. Source frame inspection, each clip encode, and
each full decode have separate 120-second hard deadlines. Encoding and decoding
use at most two codec threads. Verification also uses a 256 MiB single-allocation
limit and null output. Each video subprocess has a combined 16 MiB output limit;
exceeding a deadline or output limit kills that subprocess and fails verification.
Only verified clips lose their `.partial` suffix. The intermediate MKV is removed
only after every clip is verified and its artifact can be read. On failure it is
retained as partial evidence; it is not a promise of correctly framed playback
across display size changes. Successfully verified clips remain available if
another clip fails.

Stop still waits at most 15 seconds. A pending `COMMAND_TIMEOUT` can therefore
precede successful finalization; use status or repeat stop for the same session.
The worker keeps its heartbeat and ownership through final persistence and never
recaptures after verification failure. Larger sizes, higher frame rates, many
fold transitions, and slower hosts increase finalization time. Exceeding a
subprocess budget fails verification instead of publishing unverified media.
Failed verification retains partial bytes and errors. `encoder.stderr.txt` and
`captures.json` retain encoder diagnostics and the host recorder receipt; neither
is an invented Operator result. `encoder.stderr.txt` includes both scrcpy output
streams, since informational messages can use either. An empty diagnostic
artifact is valid and hashed. Retention is capped at 1 MiB; truncation is reported
as a partial artifact and bundle error.
Every requested artifact must be readable and complete before the bundle can
report success. Artifact-read failures retain their underlying error; an unreadable
video fails the bundle, while an unreadable receipt or stderr makes usable video
partial. Metadata failures also produce partial status when the video is usable.

One exclusive lock per device and OS user lives in a fixed host directory:
`/tmp/clawperator-evidence-locks-<uid>` on POSIX, or
`<OS-account-home>/AppData/Local/Temp/clawperator-evidence-locks` on Windows.
It is independent of `CLAWPERATOR_EVIDENCE_DIR`, `HOME`, `TMPDIR`, and `TEMP`.
POSIX requires a real directory owned by the current user with no group/other
permissions. A different evidence root cannot bypass an existing device lock.
The lock filename hashes the device serial; exclusive file creation arbitrates
simultaneous starts, and its contents identify the session, nonce and absolute
bundle path. Separate devices can record independently. This is same-host,
same-user coordination; separate hosts/users and external recorders do not share
it. Do not delete the lock directory or run temporary-file cleanup against it
while recordings or unresolved recovery state remain.

Before upgrading from a version using root-local locks, stop its recordings and
resolve retained ownership using that version's saved manifests. Mixed-version
recorders do not share the new lock location. Existing manifest-path status/stop
remains readable and uses its saved ownership path.
`session.json` keeps the random nonce, host worker PID/start identity, recorder
backend, target, deadline and recovery state separate from the manifest. A
nonce-bound heartbeat identifies the original worker. The worker signals only
the scrcpy child handle it created. No stored host PID authorizes a signal.
Older screenrecord session state remains readable for status and stop; new
recordings always require scrcpy.

`EVIDENCE_RECORDING_ACTIVE` refuses a second session on the same device.
`EVIDENCE_SESSION_NOT_FOUND` indicates an unknown or invalid session.
`EVIDENCE_RECOVERY_REQUIRED` means ownership cannot be verified. Status reports
an unavailable worker as failed while retaining its last persisted manifest and
lock. Inspect the saved session and verify any surviving recorder before manual
recovery; never remove a lock based on age alone or signal a PID without checking
its identity. scrcpy's own duration cap bounds a surviving recorder process.
No automatic stale-lock takeover occurs. A confirmed failure to spawn the host
worker records a failed startup manifest and releases its own lock because no
recorder was started. An unresponsive recorder retains the lock for recovery.

Live recording has been verified on macOS with scrcpy 4.1 and Android emulators.
Windows graceful stop and other scrcpy versions remain unproven.

### Video MCP and Node API

`evidence_video_start` accepts `durationSeconds`, optional `size`, `label`,
`context`, `deviceId`, and `operatorPackage`. An explicit target configured in the
MCP session can supply the device. It rejects output paths and unknown fields,
allocates a bundle under the configured evidence root
(`~/.clawperator/evidence/bundles` by default), and returns `sessionId`.
`evidence_video_status` and `evidence_video_stop` accept only that opaque
`sessionId`; path and target overrides are rejected. Failed and pending-stop
results set `isError: true`.

Node callers use `startVideo`, `videoStatus`, and `stopVideo` in
`domain/evidence/video.ts`. Start accepts the equivalent typed options; status and
stop use `{session: absoluteManifestPath}` with optional matching target fields.
The injectable video `baseDir` overrides the evidence root containing `bundles/`;
it cannot move the device lock. Still capture's existing `baseDir` dependency
continues to mean its bundle root.
