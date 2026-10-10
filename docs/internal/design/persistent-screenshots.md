# Persistent screenshot acquisition

Public options and result fields are owned by [take_screenshot](../../api/actions.md#action-take-screenshot).

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
length. Startup confirms the session UUID and strict policy capability. Each
request has a new UUID and scale. Each response echoes that UUID/session and
supplies a strictly increasing sequence and device monotonic capture time.
Unsolicited bytes, unknown framing, wrong IDs and mismatched geometry poison the
session. Node never substitutes a cached frame.

The helper reads primary logical display 0's local physical identity, logical
pixel extent and rotation for each capture. It checks interactivity/keyguard and
geometry before capture, after readback and after encoding. Hardware buffers
must have the requested floored dimensions. Strict secure and protected content
policies throw instead of silently redacting, and secure-layer results are
rejected again before publication. Hardware buffers and both bitmaps are freed
in `finally`.

Node bounds headers to 4 KiB, encoded images to 64 MiB and decoded images to
32 million pixels. It decodes PNG data with CRC validation and checks its actual
dimensions. Capture and publication use the remaining execution budget from
dispatch; cancellation discards the session. A unique sibling temporary file is
renamed into the destination only after validation. Storage failure does not
recapture. Existing command/task correlation, paths, envelope source and earlier
action outcomes remain intact.

A failed or dead helper is removed from the session registry. The next explicit
read-only screenshot request redeploys it. No execution, tap, navigation or
capture attempt is automatically replayed after uncertain output. A scaled
screenshot is restricted to one final screenshot action to avoid implying
intermediate capture timing from execution post-processing.

## Compatibility and safe full-resolution choice

The API 37 physical test build has `android.window.ScreenCaptureInternal` and
strict secure/protected-content policy constants. The tested API 35 emulator
does not have that class. This is a capability check, not a promise based on an
SDK number. Reflection success is not proof of a live image; doctor labels that
distinction explicitly. Capture errors remain failures even if an ordinary
`screencap` command might exit successfully.

The original requirement for automatic full-resolution fallback is constrained
by safety evidence: ordinary screencap can redact protected pixels without a
machine-readable failure. The implementation therefore follows the agreed
fail-closed policy on unverifiable builds. Omitted scale preserves the existing
stock full-resolution path; it does not acquire the helper's stricter policy
guarantees. Do not add a broad catch-and-screencap fallback. A future automatic
fallback requires a backend that can certify the same safety properties for
the image actually returned.

PNG validity, correlation and stable geometry establish acquisition evidence,
not app-specific rendering completion or visual adequacy at quarter resolution.
Those judgments remain with agents/skills. Screenshots and accessibility trees
are separate observations. HDR/color fidelity, OEM coverage and image-consuming
agent accuracy need additional evidence; no model calls are part of validation.
