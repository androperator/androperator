# Evals Live Run Runbook

## Purpose

This repo-local skill is the convenience entrypoint for repeatable live-device
skill proving runs.

The source of truth remains:

- `evals/run_eval.py`
- `evals/harness/live_skill_eval.py`

Use this skill when you want the stable commands and the debugging workflow
without reconstructing them from memory.

## Before Running

- Build the branch-local Node CLI if you changed it:

```bash
npm --prefix apps/node run build
```

- Use the debug operator package for local validation unless you are explicitly
  testing the release path:

```bash
--operator-package com.androperator.operator.dev
```

- When multiple devices are connected, always pass `--device <serial>`.

## Run The Pack A Samsung Benchmark

Use this command for the Pack A red baseline and later green proof on the
required Samsung physical device:

```bash
uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent <agent> \
  --model <model> \
  --runtime local-dev \
  --mode full-repo \
  --skill-prompt prompt-skill.md \
  --device <samsung_serial> \
  --label <pack_a_label>
```

Rules:

- This path is Samsung-only for Pack A. Do not substitute another OEM or a
  second emulator.
- Keep explicit `--device <samsung_serial>` on every run.
- Before the discovery-first authoring skill ships, a truthful canary is
  expected to stay red because the required front door does not exist yet.
- The Pack A benchmark stays on the `android-version` eval id rooted at
  `com.android.settings`.

## Run The Solax Cold-Start Eval

One run:

```bash
.agents/skills/evals-live-run/scripts/run_solax_live_eval.sh \
  <device_serial> \
  1 \
  manual
```

Repeated proving:

```bash
.agents/skills/evals-live-run/scripts/run_solax_live_eval.sh \
  <device_serial> \
  4 \
  soak
```

The script wraps:

```bash
uv run --project evals --extra dev \
  python evals/run_eval.py solax-orchestrated-cold-start \
  --device <device_serial> \
  --operator-package com.androperator.operator.dev \
  --runs <runs> \
  --label <label>
```

Artifacts land under:

- `evals/artifacts/`

If a batch is worth retaining, copy the sanitized batch into the private
`androperator-artifacts` repo instead of committing it in the product repo.

## Debug The Solax Skill Directly

Use this when the eval batch says `skill_timed_out`, `skill_failed`, or when
you want the runtime-agent transcript and retained run directory.

```bash
.agents/skills/evals-live-run/scripts/debug_solax_orchestrated_skill.sh \
  <device_serial> \
  40
```

That script wraps:

```bash
env \
  ANDROPERATOR_SKILLS_REGISTRY=<workspace>/skills/skills-registry.json \
  ANDROPERATOR_SKILL_RETAIN_LOGS=1 \
  ANDROPERATOR_SKILL_LOG_DIR=/tmp/solax-orchestrated-debug \
  ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS=120000 \
  node apps/node/dist/cli/index.js skills run \
  com.solaxcloud.starter.set-discharge-to-limit-orchestrated \
  --device <device_serial> \
  --operator-package com.androperator.operator.dev \
  --output json \
  -- <percent>
```

Retained logs land under:

- `/tmp/solax-orchestrated-debug/`

## Inspect The Newest Batch

```bash
.agents/skills/evals-live-run/scripts/show_latest_solax_eval.sh
```

This prints the newest Solax batch directory and its `summary.json`.

## Interpretation

- Pack A red-baseline expectation before the new discovery skill exists:
  `skill_emitted = false`, `replay_status = "skipped"`, or a transcript that
  records the missing discovery route explicitly.
- `cold_start_verified` means the run started from a restarted outside-app
  state, selected a different target than the observed persisted value, and
  verified the final persisted row.
- `skill_timed_out` means the `skills run` subprocess hit the eval timeout and
  the harness failed the run truthfully.
- `run_start_restarted: true` means the harness force-stopped SolaX before the
  probe and again before the skill run.

What you will see on the device:

- the first visible pass into SolaX is usually the eval probe, not the real
  edit attempt
- that probe is expected to reach `Discharge to ...`, read the current value,
  and stop without opening the dialog
- after that, the harness restarts SolaX again and launches the real
  `skills run` pass
- during the real skill pass, the skill may continue from the current visible
  SolaX screen if it is already on `Peak Export`, `Device Discharging`, or the
  `Discharge to` dialog

So if you are watching the device live, a single eval run can look like:

1. a probe pass that reads but does not edit
2. a restarted skill pass that performs the edit and verification
