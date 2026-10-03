---
name: evals-live-run
description: Run or debug Androperator live-device skill evals, including orchestrated cold-start proving.
---

# Evals Live Run

Use this skill when you want to run or debug the durable live-device skill
proving flows that live under `/evals`.

Read [`references/evals-live-run.md`](references/evals-live-run.md) for the
runbook.
Use the helper scripts in `scripts/` when you want a stable wrapper instead of
retyping the full command.

## When To Use

- Run the Solax orchestrated cold-start eval on a real device.
- Run the Pack A `android-version` benchmark on the required Samsung physical
  device with `--mode full-repo --skill-prompt prompt-skill.md`.
- Re-run repeated cold-start proving with explicit `--device` and
  `--operator-package`.
- Debug the Solax orchestrated skill directly with retained logs.
- Inspect the newest live eval artifact batch and summarize pass/fail.

## Scope

- Keep the proving policy in `/evals`, not in this skill.
- Treat this skill as a convenience wrapper for repeatable human and agent use.
- Do not move skill-specific proving logic out of the eval harness.
