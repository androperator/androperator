---
name: com.android.settings.get-version-details
description: Read Android version details using current-agent decisions and verified Android evidence.
---

# Read Android version details

Use when the user wants the exact Android OS release version and Build number.
The current agent plans, navigates, and verifies; Androperator executes actions.
No nested Codex process or `androperator skills run` is involved.

## Prepare

Check an explicit authorized device and compatible CLI/Operator with doctor.
Read [helper setup](../README.md#optional-helper-setup) if using the optional
bounded evidence helper. Otherwise perform the same observation/action/verification
loop directly through the CLI/API and retain its evidence. Never use shell system
properties, historical answers, direct About-screen intents, or tap Build number.

## Agent control loop

1. Open Settings and inspect the current hierarchy. With helpers: run
   `node examples/skills/utils/settings_version_tool.js open`.
2. Choose one current, visible, unambiguous About phone/tablet/emulated device
   candidate; where observed, follow Software information. Otherwise scroll the
   observed list to reveal the missing row. Do not assume an OEM route.
3. With helpers, run `act <candidate_id> <capture_id>` to execute one offered
   action and reacquire evidence. `observe` refreshes stale evidence. Never use
   an expired candidate or alternate scroll directions without evidence.
4. Associate each exact label with its value in the same supported row. Verify
   the string independently using a successful `read-value` response. Android
   version, API level, security patch, and manufacturer skin are distinct fields.
5. Once both fields are collected, call `finish`. Check the receipt and retained
   `verified-result.json`; report exact values and evidence, not an invented frame.

## Recovery and limits

The optional helper supports About routes and bounded scrolling, not general
Android navigation or back recovery. A resumed unsupported submenu can require
an honest stop. Do not restart a failed run and describe it as one successful run.
On uncertain dispatch, observe before repeating an action. Retain raw errors.

If an overlay requires review, inspect the actual screenshot with your host's
image tool. Only approve an observed harmless unobstructive overlay using
`approve-overlay <capture_id>`. Never infer approval from metadata, dismiss
unknown dialogs, or grant device/account consent on the user's behalf.

The helper permits 18 actions and a 275-second command budget. Stop on deadline,
unsafe/unsupported structure, duplicate labels, truncation, or unverifiable values.
Keep raw evidence private. A zero exit code or parsed response is not terminal proof.
