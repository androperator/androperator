# AAOS screenshot capture follow-up

The car-input verification on the API 35 Automotive Google APIs arm64 emulator
found an existing screenshot failure, outside the rotary/button input scope.

- Branch-local CLI `screenshot` returned `EVIDENCE_CAPTURE_FAILED` with
  `unrecognised content at end of stream`.
- The emulator exposed two physical displays and a virtual cluster display.
- Direct `adb exec-out screencap -p -d <primary_physical_display_id>` produced a
  valid primary-display PNG. Snapshots and car input commands worked.
- No screenshot behavior was changed as part of car input support.

Next step: reproduce on the same image, inspect the display selection and PNG
bytes in `apps/node/src/domain/observe/captureScreenshot.ts` and its callers,
and establish whether multiple captures are concatenated or another source
adds trailing bytes. Add a regression test for the confirmed cause, then
verify branch-local screenshot capture on AAOS and a phone emulator. Do not
infer full AAOS screenshot compatibility from working rotary inputs.
