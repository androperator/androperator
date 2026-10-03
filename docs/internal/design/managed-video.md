# Managed video evidence

The public contract is [Managed video](../../api/evidence.md#managed-video).
Video shares the still-evidence schema and does not change accessibility-event
recording or Android action envelopes. Host prerequisites are an installed
scrcpy with capture-orientation locking, ffprobe, and ffmpeg 6.1+ with libx264.
No scrcpy executable or server is shipped by Androperator. Screenshots remain
ADB-only and select the active physical display.
`videoDependencies.ts` owns the shared host probes for video start and doctor's
advisory `host.video.dependencies` check. Unmet requirements reject video start
with `HOST_DEPENDENCY_MISSING`, structured dependency reasons, and repair guidance
before acquiring ownership. Doctor never installs these optional dependencies.

## Capture and display geometry

`observe/activeDisplay.ts` reads the active primary viewport from `dumpsys
display`. The logical primary display remains 0 when a foldable switches from
its inner display to its outer display, but the physical ID changes. Physical
IDs are decimal strings: converting them to JavaScript numbers loses precision.
Screenshot capture passes that ID to `screencap -d`. A recognized but inactive,
ambiguous or malformed viewport fails instead of choosing an arbitrary display.
Older dumps without viewport activity metadata retain the platform's default
selection, including Android 10 records that omit `isActive`.
Display selection consumes the screenshot's existing timeout budget.

`scrcpyVideo.ts` captures logical display 0 continuously, with no playback window,
audio, control or clipboard access. `--capture-orientation=@` locks the canvas to
its initial orientation without changing Android rotation settings. Content can
rotate within the canvas, retaining its size instead of fitting landscape into
a portrait letterbox. This deliberately permits sideways content in the file.

Folding can change encoder dimensions even with orientation locked. A single
MP4 with changing H.264 dimensions can have stale container geometry in players.
The worker records an intermediate Matroska file, inspects every decoded frame,
and partitions consecutive equal-size spans. Each span is encoded into a separate
MP4 with correct codec headers and timestamps reset to zero. Capture is never
restarted to split a file, so folding does not introduce a recorder restart gap.
The first output is `video.mp4`; subsequent outputs use numbered names. The
manifest already supports multiple video artifacts. `captures.json` records
source span times, decoded frame counts, clip paths and probe results.

The initial size retains the existing even-dimension/aspect validation. scrcpy
may align its encoder dimensions; final encoding produces the exact requested
initial size. A startup aspect change beyond 2% fails instead of stretching a
new display into the old request. Later spans keep their aspect ratio and fit
the requested longest-edge limit. No padding, framing, or audio is introduced.

## Ownership and persistence

`video.ts` validates inputs and prerequisites before acquiring the fixed per-user,
per-device lock and starting a detached Node worker. See
[Evidence storage](still-evidence.md#writable-evidence-roots-and-video-ownership)
for root configuration and upgrade/recovery limits. Output directories remain
exclusive, and caller values are passed as argument arrays, never shell code.
The worker passes the configured ADB path to scrcpy through its environment.

The worker owns the scrcpy child handle and signals that handle only. Saved PIDs
are diagnostic data, never authority to signal or reclaim ownership. A nonce,
worker start identity and heartbeat identify the original worker. Stop uses an
atomic nonce-bound request file. Status/stop remain idempotent across initiating
CLI exits, concurrent callers, and completed sessions. Heartbeats continue
through encoding, verification and artifact publication.

Startup acknowledges a live recorder that has opened its capture file; it does
not promise decoded media yet. scrcpy has its own duration limit, independent
of the Node worker, and the worker also requests stop at its deadline. An
unresponsive recorder is killed using its owned handle and retains the lock for
manual recovery. A stale worker heartbeat likewise retains ownership. No
age-based takeover or process-name termination is permitted.

Sessions created before the scrcpy backend retain their original state and
screenrecord worker path. New starts never silently fall back to screenrecord.
That legacy path still verifies exact remote arguments and process start identity
before signaling. It is retained for persisted-session compatibility, not as
rotation or foldable support.

## Verification and partial evidence

Source frame inspection must finish without decoder diagnostics. Every output
clip must have positive media duration, exact expected dimensions, and a full
successful decode through EOF with exactly the source span's frame count and
no error output. The source encoder timebase is preserved so closely spaced
VFR timestamps cannot round together during MP4 encoding.
Only then is its `.partial.mp4` file promoted. A later clip failure preserves
already verified clips and the intermediate capture; the bundle remains partial.
Artifact reads and hashes must succeed before the bundle can be complete.
Caller context, including a failed original verdict, is preserved unchanged.

The source MKV is deleted only after every clip is verified and readable. It is
retained as partial evidence on failure, since its changing dimensions are not a
promise of correct playback in ordinary players. Diagnostic streams share a
1 MiB retention limit, with truncation reported as a partial artifact. Each
media subprocess has a 16 MiB combined output limit. Probe has a 10-second
budget; source inspection, each encode and each full decode have separate
120-second budgets. Encoding uses two codec threads; decode verification uses
two decoder threads, one output thread and a 256 MiB maximum single allocation.
These are not whole-session time or memory limits.

Output encoding preserves variable frame timing. Idle periods can make media
duration shorter than wall-clock capture duration. A zero-duration clip remains
partial. Aggregate media duration sums verified clips; aggregate size is null
when verified clips have different dimensions. Stop waits only 15 seconds and
may return pending while the original worker continues finalization.

## Regression coverage

Unit coverage checks physical display IDs, inactive/ambiguous viewports,
screenshot cancellation, missing scrcpy, orientation-lock arguments, frame-size
partitioning, corrupt source/output, later-clip failure, unreadable artifacts,
and an unresponsive recorder. Detached-process fixtures cover CLI survival,
concurrent stop, separate-device ownership and stale-worker recovery.

`validation/video-stream-verification/scrcpy-fixture.mjs` constructs real H.264
with three dimension spans, runs the production worker with only recorder
transport faked, and verifies all frames survive in three correctly sized MP4s.
It is part of the existing video-stream harness and CI validation route. The
same harness retains late-packet corruption, truncated-tail, VFR timing and
maximum-duration full-decode checks. Fake process results alone are not proof
of valid media or correct framing.

## Live validation

Validation used external scrcpy 4.1 on macOS, the branch-local CLI, and matching
0.12.1-d debug Operators on an Android 16/API 36 phone emulator and an Android
17/API 37 foldable emulator. The phone recording preserved Settings content
through portrait, landscape, and portrait again in one 574x1280 clip. Decoded
frames showed sideways full-size landscape content and subsequent portrait
navigation, rather than frozen playback or additional capture padding.

YouTube fullscreen was exercised on both emulators. The phone video buffered
inside YouTube, so that run establishes fullscreen rotation and captured UI
changes, not uninterrupted streaming playback. A separate Settings run provided
the phone's independent rotation/navigation proof. The foldable played YouTube
through fullscreen, closing and reopening, producing three verified clips at
1234x1280, 584x1280, and 1234x1280 with all 735 captured frames retained. PNG
screenshots independently showed the active inner and outer displays. A separate
foldable run verified programmatic rotation plus fold/unfold transitions.

A longer live YouTube capture exposed timestamp rounding during final encoding.
Preserving the source encoder timebase repaired the failure; replaying that same
capture preserved all 1,228 frames. The generated dimension-change fixture now
includes closely spaced VFR timestamps, and production verification requires
exact per-span frame counts. Private media and action receipts remain outside
tracked source. Windows graceful stop, physical foldables, and other scrcpy
versions are not covered by these live checks.

## FFmpeg timing compatibility

Encoding and verification share `-fps_mode passthrough -enc_time_base demux`.
The demuxer timebase preserves closely spaced VFR timestamps; passthrough alone
would still permit encoder rounding. The old `-vsync 0 -enc_time_base -1` pair
is no longer used. This deliberately replaces support for hosts predating
`-fps_mode` with a minimum of FFmpeg 6.1 and a real encoder capability probe.
See [FFmpeg's timing option definitions](https://ffmpeg.org/ffmpeg.html#Advanced-options).

Doctor and startup share a two-frame synthetic encode, including libx264 and
the precise production timing option values. A missing encoder, removed option,
unsupported timebase value, or reduced build that cannot run the probe fails
before recording. Full decode still fails on stderr, incomplete progress,
corruption or wrong frame counts. If encoding creates no MP4, its original error
is retained on the failed artifact without a secondary missing-file error;
unrelated artifact read failures remain errors. Raw Matroska evidence is preserved.

Validated locally with isolated macOS arm64 builds of FFmpeg/ffprobe 6.1, 8.1.3
and 9.0.2, all linked to libx264. Each passed the complete real-codec harness:
three changing display-size spans, closely spaced VFR timestamps, exact frame
counts and rebased timestamps, corrupt and truncated tails, and maximum-duration
full decoding. FFmpeg 9.0.2 independently rejected both legacy `-vsync` and
negative `-enc_time_base -1`; the modern pair passed on all three versions.

Fresh Settings rotation recordings on an Android 16 phone emulator with the
matching 0.12.2-d Operator finalized with 160 frames on 6.1, 151 on 8.1.3 and
137 on 9.0.2. All source timestamps matched the final clips after rebasing,
all artifact hashes and sizes verified, and inspected frames showed full-size
landscape between portrait views. No global FFmpeg installation was changed.
These runs do not establish physical Pixel or Windows behavior. Synthetic
multi-size recordings exercise folding-related finalization for each version.
