# Eval Harness

## Prerequisites

- Python 3.11 or newer
- A connected Android device
- The Androperator Operator APK installed and permissioned

## Run The Eval Harness

Use the project-managed Python environment from the `evals/` project root:

```bash
uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent claude \
  --model claude-haiku-4-5
```

You can pass `--device <serial>` when more than one device is connected.
The lockfile for this project lives at `evals/uv.lock`.

For repo-local Codex work, the [`evals-run`](../.agents/skills/evals-run/SKILL.md)
skill wraps the common emulator workflow, including both runtime targets.
Its helper script lives at
[`run_android_version_eval.sh`](../.agents/skills/evals-run/scripts/run_android_version_eval.sh).

## Solax Orchestrated Cold-Start Eval

Use the Solax cold-start eval when you need repeatable live-device proof that
the orchestrated skill can start from outside the app, choose a target value
that differs from the currently persisted value, and verify the final
persisted `Discharge to <n>%` row.

Command:

```bash
uv run --project evals --extra dev python evals/run_eval.py solax-orchestrated-cold-start \
  --device <serial> \
  --operator-package com.androperator.operator.dev \
  --runs 4
```

The Solax live eval follows the normal eval runtime resolution rules:

- `--runtime local-dev` uses the branch-local Node CLI build and defaults to
  `com.androperator.operator.dev`
- `--runtime published` uses the published `androperator` binary and the release
  operator package
- `--operator-package` overrides the local-dev default, and published runtime
  still resolves to the release package

Optional flags:

- `--skills-registry <path>` overrides the default sibling-repo registry path
  `<workspace>/skills/skills-registry.json`
- `--artifacts-dir <path>` overrides the default batch root
  `evals/artifacts/`
- `--label <text>` adds a readable suffix to the batch id
- `--dry-run` writes the batch directory and `config.json` but skips live
  device execution

Unsupported on this eval:

- `--agent`, `--model`, `--skill-prompt`, `--replay`, `--rescore`,
  `--timeout-s`, `--max-turns`, and `--runs-dir`

Retention boundary:

- `evals/artifacts/` is local working output in this repo and is ignored by
  git
- if a live batch is worth preserving, copy the sanitized batch into the
  private `androperator-artifacts` repo instead of committing it here

This eval encodes the cold-start proving policy in code. For every run it:

1. force-stops `com.solaxcloud.starter` so the run starts from a restarted app process
2. presses Home
3. proves the app is not foregrounded
4. opens SolaX and probes the current persisted discharge row
5. force-stops SolaX again and re-proves outside-app state before the skill run
6. chooses a configured target percent that differs from the observed value
7. runs `androperator skills run ...`
8. classifies the run as cold-start proof, outside-app proof failure, skill timeout, or a
   specific failure mode

What you will see on-device during one eval run:

- the first visible traversal into SolaX is usually the harness probe, not the
  actual edit attempt
- that probe is expected to reach the `Discharge to ...` row, read the current
  persisted value, and stop without opening the edit dialog
- after the probe, the harness force-stops SolaX again and only then launches
  the real `skills run` edit attempt
- during the real skill run, the Solax orchestrated skill may continue from the
  current visible SolaX surface if it is already on `Peak Export`, `Device
  Discharging`, or the `Discharge to` dialog, instead of always rebuilding the
  route from the home tab

That means a visually "two-phase" run on the device is expected today:

1. probe pass to observe the current value
2. restarted skill pass to change and verify the value

Artifacts land under `evals/artifacts/<batch_id>/`:

- `config.json` - batch configuration
- `run-01/metadata.json` - per-run normalization, probe, target selection, and
  classification
- `run-01/result.json` - parsed raw `skills run` JSON when the command emitted
  valid JSON
- `run-01/commands/` - stdout, stderr, and parsed command payloads for every
  normalization and probe step
- `summary.json` - machine-readable aggregate result
- `summary.md` - readable batch digest

Those files are local by default. Retained batches belong in the private
artifacts repo, not in the main product repo history.

Truth boundary:

- `cold_start_verified` means the run proved restart-before-probe, proved
  outside-app start state before the skill run, selected a different target
  than the observed persisted value, and ended with
  `skillResult.terminalVerification.status = "verified"` for the requested
  percent
- `run_start_not_proven` means the eval did not prove the initial restart
  happened before the probe path, so the batch member cannot count as cold-start
  proof even if the later skill run succeeded
- `outside_app_not_proven` means the eval did not prove the run started from
  normalized outside-app state before the skill run, so the batch member cannot
  count as cold-start proof even if later in-app behavior looked promising
- `skill_timed_out` means the orchestrated `skills run` process did not finish
  within the eval timeout window, so the batch records the partial evidence and
  fails the run truthfully
- any other classification is a failed cold-start proof batch member, even if
  the skill emitted a structured `SkillResult`

This eval lives directly in `/evals`. It does not extend the repo-local
`evals-run` skill because that skill remains scoped to the `android-version`
benchmark, runtime-target setup, replay, and rescore workflow.

Every run writes its artifacts under `evals/runs/<run_id>/`:

- `config.json`
- `result.json`
- `transcript.txt`

Replay runs also write `result-replay.json`. Rescore runs write
`result-rescored.json`.

Runtime targets:

- `--runtime local-dev` uses the branch-local `apps/node/dist/cli/index.js`
  build and the `.dev` Operator APK (`com.androperator.operator.dev`). This is
  the default for day-to-day development.
- `--runtime published` uses the globally installed `androperator` binary and
  the release Operator APK (`com.androperator.operator`). Use this to verify
  the shipped runtime path.

### Runtime Target Version Compatibility

The two runtime targets use different version sources that can diverge:

- `local-dev`: CLI version comes from `apps/node/package.json` (code version), and the APK is the local debug build in `com.androperator.operator.dev`.
- `published`: CLI version comes from `npm install -g androperator` (published version), and the APK is the downloaded release in `com.androperator.operator`.

The **code version** is typically ahead of the **published version** because
it includes unreleased changes. This means you cannot mix runtime targets
without version alignment.

**Important:** The CLI and APK versions must be compatible. If you see a
`VERSION_INCOMPATIBLE` error during preflight, align your setup:

- For `local-dev` (code version): Build and install the debug APK from the
  same source tree:
  ```bash
  ./gradlew :app:assembleDebug
  adb -s <serial> install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
  ```

- For `published` (published version): Install matching versions of the CLI
  and APK:
  ```bash
  npm install -g androperator@<version>
  androperator operator setup --apk <downloaded-apk> --device <serial>
  ```

The published APK download URL follows the pattern:
`https://downloads.androperator.com/operator/v{VERSION}/operator-v{VERSION}.apk`

Knowledge modes:

- `--mode public-surface` keeps the agent in a fresh temp directory and gives
  it only public docs plus the command surface.
- `--mode full-repo` runs the agent from the repository root and lets it read
  internal docs and source code. Use this when you want to measure the boost
  from repo-local knowledge.

## Skill Scoring And Replay

The `android-version` eval can also score whether the agent emitted a reusable
skill package.

For Pack A, this is the benchmark that must become the red and then green proof
surface for discovery-authored Settings/About-device skills. The required route
is:

1. keep the eval id as `android-version`
2. run with `--mode full-repo`
3. use `--skill-prompt prompt-skill.md`
4. treat `androperator-skill-author-by-agent-discovery` as the required discovery front door
5. treat `androperator-skill-author-by-recording` as the proving handoff when discovery says
   `proceed_to_recording`

Current Pack A device matrix:

- AOSP emulator for the repo-local `evals-run` path
- Samsung physical device for the repo-local `evals-live-run` path

Do not substitute another OEM or a second emulator for the Samsung leg without
updating the pack.

Use the skill prompt variant to enable that scoring:

```bash
uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent claude \
  --model claude-sonnet-4-6 \
  --mode full-repo \
  --skill-prompt prompt-skill.md \
  --device <serial>
```

For the initial Pack A red baseline, use the branch-local runtime and expect
the skill path to remain red until the discovery-first front door exists:

```bash
uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent codex \
  --model gpt-5.4 \
  --runtime local-dev \
  --mode full-repo \
  --skill-prompt prompt-skill.md \
  --device <serial> \
  --label pack-a-red-baseline
```

Truth boundary for that red baseline:

- the main Android-version answer may still be correct, but the overall
  `outcome.status` stays `fail` until the Pack A discovery-to-proving route is
  actually proven
- `skill_emitted = false` and `replay_status = "skipped"` are still truthful
  red outcomes before `androperator-skill-author-by-agent-discovery` is implemented, but
  they now fail the run instead of leaving it green
- when `skill_generation_passed = false`, the harness applies the skill gate
  to the top-level run outcome and typically records
  `failure_reason = "skill_route_not_proven"` for missing route evidence or
  `failure_reason = "skill_not_emitted"` when no skill was emitted
- a transcript that explicitly reports the missing discovery route is still a
  truthful red outcome, but it remains a failing run until the route is proven

When you use `--skill-prompt prompt-skill.md` and the spec provides
`skill_generation`, the run records a `skill_score` block in `result.json`.
You will see fields like:

- `skill_emitted`
- `skill_valid`
- `skill_validation_errors`
- `replay_attempted`
- `replay_status`
- `replay_answer_normalized`
- `replay_answer_correct`
- `replay_wall_clock_s`

Replay the emitted skill from a previous run with:

```bash
uv run --project evals --extra dev python evals/run_eval.py android-version \
  --replay <run_id>
```

Replay uses the device serial recorded in the original run config. It writes
`result-replay.json` alongside the original artifacts. If the original run did
not emit a valid skill, replay reports `replay_status = "skipped"`.
Replay only reports `pass`, `fail`, or `no_answer` when the replayed
`androperator skills run` process exits cleanly. Non-zero exit codes are always
recorded as `replay_status = "error"`.

Other supported agents:

- `claude`
- `gemini`
- `codex`
- `kimi`

Example invocations:

```bash
uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent gemini \
  --model auto-gemini-3 \
  --device <serial>

uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent codex \
  --model gpt-5.1-codex-mini \
  --device <serial>

uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent kimi \
  --model kimi-code/kimi-for-coding \
  --device <serial>
```

The harness records `metrics.turns_counted` and `metrics.turns_budget` in
`result.json` when turn counting is enabled. These are diagnostic fields only.
They are not scoring gates and they are not meant to be compared across
agents.

`--max-turns` stops a run with `outcome.status = budget_exceeded` if the agent
has not answered yet. Gemini currently counts assistant `delta: true` message
chunks as turns, so its turn count can look more granular than a human reading
of the reply. That is expected for Gemini.

`--rescore <run_id>` replays scoring from `config.json` and `transcript.txt`
without re-running the agent. It writes `result-rescored.json` alongside the
original `result.json`.

## Read `result.json`

Every run writes `evals/runs/<run_id>/result.json`.

Key fields:

- `run_id` - unique run directory name
- `eval_id` - always `android-version` for this eval
- `agent.type` and `agent.model` - the evaluated agent identity
- `knowledge_mode` - `public-surface` or `full-repo`
- `runtime_target` - `local-dev` or `published`
- `spec.eval_version` - eval spec version
- `spec.prompt_sha256` - hash of the rendered prompt text
- `environment.device_serial` - the device used for the run
- `environment.ground_truth_android_version` - Android version read from `adb`
- `outcome.status` - `pass`, `fail`, `timeout`, `no_answer`, `error`, or `budget_exceeded`
- `outcome.status` can also be `budget_exceeded` when `--max-turns` is hit
- `outcome.answer_extracted_raw` - last marker value emitted by the agent
- `outcome.answer_normalized` - normalized answer used for scoring
- `outcome.ground_truth_normalized` - normalized ground truth
- `outcome.answer_correct` - whether the normalized answer matched ground truth
- `outcome.failure_reason` - non-null for error runs
- `preflight` - present on preflight failures when the harness has structured
  diagnostics. Public-surface runs keep only `doctor_failure.code` and
  `doctor_failure.summary` there. Full-repo runs also include the raw
  `doctor_report`
- `metrics.wall_clock_s` - total elapsed run time
- `metrics.violations.used_adb` - diagnostic flag for direct `adb shell` usage
- `metrics.turns_counted` - diagnostic turn count or `null`
- `metrics.turns_budget` - the configured max turn budget
- `skill_score` - present when the run used the skill prompt and the spec has
  `skill_generation`
- `skill_score.route_requirements_met` - whether the transcript proved the
  required Pack A discovery route
- `skill_score.skill_generation_passed` - whether emitted skill validation,
  replay, answer correctness, and route proof all succeeded
- `artifacts.transcript` - transcript file name
- `artifacts.config` - config file name

## Public-Surface Isolation

Public-surface runs use a fresh temp directory from `tempfile.mkdtemp()`.
That directory does not contain repo files, repo paths are not put into the
agent prompt, and the harness only forwards a minimal environment. This is
soft isolation, not a sandbox. The agent can still access the broader machine
filesystem if it chooses to.

The harness uses the branch-local `androperator` build when available. Public
surface runs avoid leaking repo paths into the prompt and use a temp-directory
shim so the agent can invoke `androperator` without seeing the underlying
workspace path.

## Parallel Runs

Runs are not parallel. Use one device and one eval run at a time.

## Add An Agent Adapter

Start with `evals/harness/agents/base.py`.

Implement:

- `build_command(prompt, work_dir)`
- `build_env(base_env)`
- `supports_streaming()`
- `normalize_line(raw)`

## Internal Answer Marker

`ANDROPERATOR_EVAL_ANSWER` is an internal eval marker only. It is not a public
API and must not appear in public-facing documentation or production usage.

## Common Failure Patterns

- The agent loops on the same screen
- The agent never emits `ANDROPERATOR_EVAL_ANSWER`
- The agent uses `adb` directly and the run only records the violation
- The agent guesses the answer without using Androperator
- Gemini `delta: true` chunks count as turn boundaries for `--max-turns`, so a
  long answer can consume more than one counted turn
- `skill_score.replay_status = "skipped"` means the run did not emit a valid
  skill block, not that replay failed
- Replay only trusts answer artifacts that the skill created or modified
  during the replayed run. Seeded inline artifact contents alone do not count
  as a successful replay result.
- `outcome.failure_reason = "doctor_preflight_failed"` means preflight blocked
  the run before the agent started. Check `preflight.doctor_failure` in
  `result.json` for the actionable doctor code and summary. Full-repo runs also
  preserve the raw `doctor_report`.
- `VERSION_INCOMPATIBLE` during preflight means the CLI and APK versions don't
  match. See [Runtime Target Version Compatibility](#runtime-target-version-compatibility)
  above. The code version (local-dev) is typically ahead of the published version.
