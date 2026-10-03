# Still evidence capture

The public contract is [Still Evidence Bundles](../../api/evidence.md). This
describes the still-capture implementation. The complementary
[managed video implementation](managed-video.md) extends its schema and artifact
ownership without changing the still-capture contract.

## Ownership and failure boundaries

`domain/evidence/capture.ts` coordinates one selected device, an exclusive new
bundle, screenshot then hierarchy, metadata, capture receipts, and the atomic
manifest writer. It neither replays a caller action nor runs doctor remediation. Caller
context is copied before asynchronous capture and never interpreted as a verdict.

`domain/observe/captureScreenshot.ts` is shared with normal screenshot execution
post-processing. It uses argument-array ADB invocation and an explicitly resolved
serial, with bounded process lifetime and output size. Evidence invokes that host
primitive independently of Operator readiness or application-root availability.
Its receipt is explicitly host-owned; no Android result envelope is invented.
The hierarchy uses the normal snapshot execution and retains the original result
and any Operator overlay metadata in `captures.json`. Its readiness probe uses
`doctor_ping` to read device state without wake or Home input. Sleeping or locked
devices retain screenshot evidence while hierarchy reports `DEVICE_NOT_INTERACTIVE`.

The budget runner caches the initial device inventory for the nested execution
preflight, bounds subsequent calls by the deadline, and kills only child processes
created by this capture. Deadline cancellation records `COMMAND_TIMEOUT` before
terminating screenshot capture and retains any received partial image bytes. A component with no remaining usable budget is recorded
as timed out without dispatch. File validation and manifest persistence remain
possible after the device-work budget expires. Metadata queries are read-only,
explicitly targeted, and bounded by the same deadline. Package names are restricted
to identifier characters before use in remote package inspection.

Files are first written under partial names, read back and validated, then renamed.
PNG decoding checks CRCs, dimensions, and decoded pixels. XML validation uses the
shared compact snapshot parser, without applying its output to the saved bytes.
Only usable screenshot/hierarchy artifacts count toward overall availability;
`captures.json` alone cannot make a failed bundle partial or complete. Metadata
or receipt-file errors make otherwise usable evidence partial. The manifest writer
and validator share `contracts/evidence.ts`; no file hashes include the manifest
itself. Each terminal attempt requires a new directory.

MCP exposes only domain-created manifest paths and never accepts caller output
paths. Managed bundles default to the evidence bundle root under the user's
Androperator state directory. Node tests inject their own root, process/capture
providers, metadata readers, clock, and file operations. There are no uploads or report generation in the still-capture path.

## Device classification

Still capture and video start share `collectEvidenceMetadata`. A failed read is
distinct from a successful property inventory with absent emulator flags. The
inventory parser accepts bracketed Android properties, including multiline boot
history values, bracketed continuation lines, and CRLF output. Lines beginning
with a bracketed name followed by a colon delimit entries and must have valid
headers. The final bracket before the next entry or end of output closes a value.
Missing value brackets or incorrect header spacing on these lines invalidate the
inventory instead of being absorbed into the preceding value. Empty, malformed,
or duplicate-key inventories cannot establish a device type. Parsed nonempty
flag values remain in the
manifest, with null for absent or empty flags.

For a usable inventory, either emulator flag equal to `"1"` wins, even against
`"0"` or another unexpected value. If both flags are absent, empty, or `"0"`,
classification is `physical` by inference. Other nonempty values, failed reads,
timeouts, and exhausted budgets remain `unknown`, with
`EVIDENCE_CAPTURE_FAILED`, stage `metadata`, component `deviceType`.
This is a heuristic, not hardware attestation. Other required metadata failures
still make usable bundles partial. Schema version 1 and historical manifests
remain unchanged.

### Physical-device classification validation

On 2026-09-13, source based on `e96e7584` plus this classification fix used
branch-local CLI 0.10.1 and the matching branch-built 0.10.1-d development APK,
installed on explicit physical and emulator targets. Android debug assembly
passed. The physical device's two emulator flags were absent. A new still bundle
and finalized video bundle both reported `complete`, `physical`, null raw flags,
and terminal CLI exit 0. Artifact sizes and SHA-256 hashes matched; the still
hierarchy passed an independent XML parser and the screenshot was visually
inspected. The H.264 video independently decoded fully with ffmpeg; ffprobe
reported 572 by 1280 pixels and 5.281122 seconds.

The emulator retained `emulator` classification with both flags equal to `"1"`.
Its still bundle remained partial, exit 1, solely because hierarchy capture
returned `SNAPSHOT_HIERARCHY_UNAVAILABLE`. This establishes classification,
not successful emulator hierarchy capture or resolution of that separate issue.
Initial partial bundles remain untouched. Those live runs exposed multiline
boot-history properties on both targets; sanitized LF and CRLF regression
fixtures now cover them.

The complete Node suite passed 1,615 tests. Regressions cover classification
precedence, malformed inventories, read failures and budgets, preservation of
other metadata failures, and real detached-worker finalization and CLI terminal
status for physical, emulator, and unknown classifications. Video acceptance used
writable default state; subsequent restricted-host combined acceptance is
recorded [below](#writable-state-integrated-validation). Private captures and
logs remain outside tracked files.

A subsequent code review identified valid multiline values containing brackets
that the initial parser rejected. Regression coverage now includes continuation
lines starting with `[` and intermediate lines ending with `]`, under LF and
CRLF, with both physical and emulator flags. After the parser correction, live
metadata collection again returned physical with absent flags and emulator with
explicit flags, with no metadata errors on either target.

## Validation and observed limits

Local device checks used a dedicated Android 16 / API 36 emulator with the
branch-built 0.10.0-d debug Operator and Node CLI 0.10.0. The Android debug build
passed, and the APK was installed on the selected target. Other connected devices
were not targeted.

A Settings search screen with the keyboard visible produced a complete CLI bundle.
The image was opened and visually confirmed; an independent XML parser accepted
the hierarchy. All three artifact hashes and sizes matched the saved bytes.
Image/hierarchy correlation IDs and observation times matched `captures.json`,
and the saved XML exactly matched its Operator result. The caller's example
failed verdict remained unchanged in context. The image was 1344 by 2992 pixels;
the manifest reported API level, emulator property evidence, density and primary
display rotation from targeted reads.

A second capture selected an unavailable Operator package. Its actual ADB image
capture succeeded, hierarchy failed with `OPERATOR_NOT_INSTALLED`, and the command
returned partial status with exit 1 and a readable manifest. A live MCP stdio call
also created a complete bundle beneath the server-owned evidence root and retained
the caller's original verdict.

An initial, separate app-open attempt returned `RESULT_ENVELOPE_TIMEOUT`. It was
not replayed by evidence capture, relabeled as success, or treated as an evidence-capture fix.
The screen retained Settings search state. These are bounded observations, not a
claim of complete release readiness or a fix for separate preparation/transport
workstreams. Both installed Operator variants were enabled at observation time;
Evidence capture explicitly targeted the debug variant and does not change accessibility setup.

Offline regression coverage includes root-unavailable and missing-Operator
failures, independent capture attempts, exhausted and remaining budgets, exclusive
output creation, malformed/empty PNGs, persisted-byte corruption, file/manifest
write failures, metadata fallback/null values, device selection, context/path
validation, CLI exit behavior, and MCP path restrictions and partial results.
Private captures and validation logs remain outside tracked files.

Validation commands passed: the complete Node suite (1,498 tests), then 151
focused evidence/execution/observe/MCP checks after final file-verification and
input-validation changes; the documentation build (32 navigation pages, no
organization warnings); and `git diff --check`. A final CLI evidence bundle
passed independent hash/XML/correlation checks. Normal screenshot capture through
the extracted helper also returned a successful canonical envelope and a decoded
1344 by 2992 PNG. Existing raw screenshot/snapshot skill consumers retain their
contracts, so no sibling skill migration or version bump is required.

The subsequent readiness and cancellation fixes passed a Node build and 155
focused evidence/execution/observe/MCP tests. Coverage includes sleeping, locked,
and interactive probe results and overall-deadline cancellation with partial bytes.
These follow-ups were not re-tested on a live sleeping or locked device.


## Writable evidence roots and video ownership

`domain/evidence/storage.ts` resolves `ANDROPERATOR_EVIDENCE_DIR` once before
asynchronous request work. Managed captures share its `bundles/` convention;
legacy still-test `baseDir` injection remains a bundle directory. Video workers
and manifest-path lifecycle calls use persisted absolute paths and do not
re-resolve the caller's environment. MCP opaque-ID lookup uses the configured
root. `serve.ts` has no evidence routes, so the task's requested HTTP lookup
check is not an existing surface; MCP is the managed lookup owner.

Video ownership uses exclusive file creation in a fixed per-OS-user directory,
independent of home/environment overrides and the chosen bundle root. On POSIX
this is `/tmp/androperator-evidence-locks-<uid>`; Windows uses the OS account's
`AppData/Local/Temp/androperator-evidence-locks`, derived from `os.userInfo()`.
POSIX derives ownership directly from the process effective numeric UID, so
container users do not need an account database entry. It rejects symlinks,
foreign owners and group/other permissions on that directory. The directory is
not automatically removed or relocated. Its device serial hash keys a nonce/session/absolute-output record. Two starts racing from
different roots still arbitrate the same exclusive creation. Workers retain
the existing nonce, heartbeat and remote process identity checks. Neither age
nor a stale heartbeat permits takeover, deletion, or a signal to a saved host
PID. Failed lock persistence before dispatch cleans up its own acquired file;
known startup failures release ownership, while uncertain worker/recorder death
retains recovery state and artifacts.

Root, ownership-directory and fresh output-directory probes exercise creation,
reading, rename and deletion before recorder dispatch. Storage failures expose
`EVIDENCE_STORAGE_UNWRITABLE` with the failing absolute path and recovery action.
Output collision remains `EVIDENCE_OUTPUT_EXISTS`. No root migration, log
relocation or permission adjustment occurs. Preflight establishes current access,
not a guarantee against later permission changes, capacity exhaustion or external
file deletion. Host temporary-file cleanup must preserve active/recovery locks.
Separate hosts/users and mixed versions with older root-local locks are outside
this ownership boundary; stop and recover old-version sessions before upgrading.

The existing screen/snapshot contracts and runtime skill inputs are unchanged;
no sibling skill version bump is needed.


### Writable-state integrated validation

On 2026-09-13, writable-state revision `7a0bdf7e` was integrated with `37b8aac5`
from main and recorded in merge `2ea7e363`. Branch-local CLI 0.10.1 and the
matching branch-built 0.10.1-d development APK targeted the explicitly selected
physical Android 16 / API 36 device. The APK had been built and installed during
writable-state validation; the integrated changes contained no Android changes.

A macOS sandbox explicitly denied writes under the real default home evidence
root. An independent write probe returned `EPERM`. Without the override, CLI
start returned exit 1 with `EVIDENCE_STORAGE_UNWRITABLE`, the default root path
and recovery action, without starting a recorder. With a writable override and
separate explicit output directory, start returned exit 0 and `recording`.
Separate CLI processes using the same root and a different root both returned
exit 1 with `EVIDENCE_RECORDING_ACTIVE`.

Manifest-path status and stop worked from a new environment with an empty
root variable. Stop returned exit 0 and `complete`, released its lock, and a new
recording using the second root started and completed at its eight-second cap.
The first recording retained 572x1280 H.264 media with two decoded frames,
about 7.17 seconds of host time and 8.12 seconds of media time. Its extracted
UPDATED frame was opened and visually checked. The fresh recording retained
about 9.16 seconds of host time and 1.91 seconds of media time. Host and media
timelines remain independent observations.

A managed MCP recording under the same sandbox survived closure of its
initiating server. Fresh MCP processes found and stopped it using only its
session ID and the same root, returning `complete` without `isError`. It retained
about 4.98 seconds of host time and 1.72 seconds of media time. CLI still capture
returned exit 0 and `complete`; managed MCP still capture likewise returned
`complete` without `isError`. All five bundles had empty error arrays, complete
artifacts and physical-device classification. The worker fully decoded each
video; independent ffprobe inspection succeeded, and every saved artifact's bytes
and SHA-256 matched its manifest. Temporary on-screen logs were cleared.

Earlier isolated writable-state runs had retained metadata-only partial bundles;
those artifacts remain unchanged. The combined run closes the integration check
for writable state and device classification. Private media and command logs
remain in ignored worktree artifacts, not committed fixtures. Publication still
requires the release workflow's transport disposition, release-Operator checks
and other applicable gates; this validation does not authorize publication.

The integrated Node build and all 1,640 tests passed without skips. Coverage
retains physical/emulator/unknown classification, simultaneous same-root and
different-root starts, independent devices, default/relative roots with spaces,
blank/unwritable state, startup failure, worker death, stale ownership,
changed-environment lifecycle and managed MCP errors. The sub-agent review fix
also covers POSIX numeric users without account database entries. The docs build
passed without organization warnings. Windows live operation and filesystem
cleanup/reboot recovery were not exercised; retained ownership always requires
manual verification before removal.
