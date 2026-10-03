---
name: test-recording-validate
description: Smoke-test recording start, Play Store interaction, stop, pull, and parsing with artifact validation.
---

# Test Recording Validate

Validates the Androperator recording API surface end-to-end by:
1. Starting a recording session
2. Running the Play Store search skill (searching for "Action Launcher")
3. Stopping the recording
4. Pulling the recording to host
5. Parsing and validating the step log

## Purpose

This skill provides a repeatable smoke test for the recording feature that exercises:
- `recording start` / `recording stop` lifecycle
- `recording pull` to retrieve NDJSON from device
- `recording parse` to convert NDJSON to step log
- Parser validation of the output structure

## Prerequisites

- Androperator Operator app installed and permissioned on the target device
- Play Store app available on the device
- Branch-local Androperator CLI build present at `apps/node/dist/cli/index.js`
- The local embedded Play Store helper in this skill directory

This skill intentionally uses the branch-local Node CLI build and the local
embedded Play Store helper, so it does not depend on the globally installed
`androperator` binary or an external skills repo checkout.

## Usage

```bash
# Run with explicit device selection
./scripts/validate_recording.sh <device_serial>

# Or let the skill auto-select if only one device
./scripts/validate_recording.sh
```

## Validation Criteria

The skill verifies:
- Start response contains `sessionId`
- Stop response contains non-zero `eventCount` (when flow produces interactions)
- Pull writes a `.ndjson` file to host
- Parse writes a `.steps.json` file
- Parsed step log contains at least one `open_app` step
- Parsed step log contains at least one `click` step
- Each step has `uiStateBefore` populated
- No structural parse errors

## Output Artifacts

All artifacts are written to `$HOME/src/androperator-dumps/runs/<timestamp>/`
(or the directory named by `RECORDING_VALIDATION_RUNS_DIR`):
- `<session_id>.ndjson` - Raw recording from device
- `<session_id>.steps.json` - Parsed step log
- `parse_summary.txt` - Parse stderr summary (step inference log)
- `validation_report.json` - Structured validation results

## Exit Codes

- `0` - All validations passed
- `1` - Device not found or multiple devices without explicit selection
- `2` - Recording start failed
- `3` - Play Store skill execution failed
- `4` - Recording stop failed
- `5` - Recording pull failed
- `6` - Recording parse failed
- `7` - Validation failed (check report for details)
