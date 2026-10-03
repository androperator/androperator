# Eval System Design

## Purpose

The eval harness measures whether an unfamiliar agent can use Androperator to
operate a connected Android device and complete a task on a real target. It
also measures whether the same run can emit a reusable Androperator skill and
replay that skill deterministically.

The harness is a measurement tool, not a planner. Agent reasoning stays
outside the runtime.

## Measurement Boundaries

Every run is described by two independent axes:

| Axis | Values | What it changes |
| --- | --- | --- |
| Knowledge surface | `public-surface`, `full-repo` | Whether the agent sees only public docs or the repository itself |
| Runtime target | `local-dev`, `published` | Whether the run uses the branch-local CLI build or the global release binary |

`public-surface` runs use a fresh temp directory and only expose the public
command surface. `full-repo` runs use the repository root so the agent can read
internal source and docs. The harness does not sandbox filesystem access.

`local-dev` uses the branch-local Node CLI build at
`apps/node/dist/cli/index.js` and the debug Operator APK
`com.androperator.operator.dev`. `published` uses the globally installed
`androperator` binary and the release Operator APK `com.androperator.operator`.

Doctor preflight runs before the agent is spawned. The harness also keeps
`ANDROID_SERIAL` in the agent environment and passes the selected device as an
explicit CLI selector.

## Result Artifacts

Every completed run writes a `result.json` file under `evals/runs/<run_id>/`.
The main task score remains in `outcome`.

When the skill prompt variant is used and the spec defines `skill_generation`,
the harness adds a `skill_score` block to `result.json`.

If preflight fails before the agent starts, the harness still writes
`config.json` and `result.json`. Those artifacts keep the generic
`outcome.failure_reason` such as `doctor_preflight_failed`, and they also add a
`preflight` block with structured doctor diagnostics when the failing step was
`androperator doctor`. Public-surface runs keep only the minimal
`doctor_failure.code` and `doctor_failure.summary` in that block. Full-repo
runs also keep the raw `doctor_report` so engineers can inspect the full doctor
payload when the repo surface is already exposed.

```json
{
  "outcome": {
    "status": "pass",
    "answer_extracted_raw": "Android 16",
    "answer_normalized": "16",
    "ground_truth_normalized": "16",
    "answer_correct": true,
    "failure_reason": null
  },
  "skill_score": {
    "skill_emitted": true,
    "skill_valid": true,
    "skill_validation_errors": [],
    "replay_attempted": true,
    "replay_status": "pass",
    "replay_answer_normalized": "16",
    "replay_answer_correct": true,
    "replay_wall_clock_s": 12.4
  }
}
```

`skill_score` fields:

| Field | Meaning |
| --- | --- |
| `skill_emitted` | The transcript contained a complete skill block between the configured markers. |
| `skill_valid` | The extracted skill passed structural validation against the skill registry contract. |
| `skill_validation_errors` | Validation failures, if any. |
| `replay_attempted` | The harness attempted to run the extracted skill. |
| `replay_status` | `pass`, `fail`, `no_answer`, `error`, or `skipped`. |
| `replay_answer_normalized` | Normalized replay answer used for scoring. |
| `replay_answer_correct` | Whether the replay answer matched the ground truth. |
| `replay_wall_clock_s` | Replay execution time in seconds. |

`skill_score` is independent from the task score. A run can pass the main eval
and fail skill replay, or fail the task and still emit a valid skill.

## Skill Emission Protocol

The skill prompt variant instructs the agent to emit a skill block between the
exact markers:

```text
ANDROPERATOR_SKILL_START
<skill JSON here>
ANDROPERATOR_SKILL_END
```

The extractor keeps the last complete block in the transcript.

The emitted JSON must satisfy the `SkillEntry` contract:

- `id`
- `applicationId`
- `intent`
- `summary`
- `path`
- `skillFile`
- `scripts`
- `artifacts`

Validation is structural. The harness parses the JSON, checks required fields
and replay-readiness constraints, and does not rely on permanent registration
in the user skill store. Required string fields must be non-blank, listed
script and artifact paths must be non-blank strings, and replayable skills
must include inline content coverage for every listed script and artifact.
That keeps replay self-contained and avoids writing generated skills to the
repository.

To make the skill replayable, the emitted JSON may also include inline file
content:

- `skillMarkdown`
- `scriptContents`
- `artifactContents`

The replay materializer writes those files into a temp directory, creates a
temporary registry, and removes everything after the replay finishes.

## Replay Contract

Replay is a separate execution step, not a second agent run.

Replay semantics:

1. Load `config.json`, `result.json`, and `transcript.txt` from the original
   run directory.
2. Extract the last complete skill block.
3. Require that replay uses the same device serial recorded in the run config.
4. Validate the extracted skill structurally.
5. Materialize the skill into a temp directory.
6. Run `androperator skills run <skill_id> --device <serial> --operator-package
   <package> --skip-validate`.
7. Score the replay against the original ground truth.
8. Delete the temp materialization after replay.

Replay has its own wall-clock timeout. The default is 60 seconds, and
`--replay-timeout-s` overrides it.

Current answer surfacing contract:

- Replay only reports `pass`, `fail`, or `no_answer` when `androperator skills
  run` exited with code `0`. Non-zero exit codes are always `replay_status =
  "error"`.
- If a skill artifact contains a plain-text answer, replay uses that artifact
  content only when the replayed skill created or modified that artifact
  during execution.
- Otherwise replay falls back to the run output and looks for
  `ANDROPERATOR_EVAL_ANSWER: <version>` in the raw output, stdout, stderr, or
  JSON envelope text.

That order matters because some generated skills update their artifact file
during execution. Capturing a seeded artifact answer before the run would be a
false positive if the skill never rewrote the file. Binary or unreadable
artifacts are skipped and do not block stdout or stderr answer extraction.

## Decision Rules

| Question | Rule |
| --- | --- |
| What if no skill block is emitted? | `skill_emitted = false`, replay is skipped. |
| What if skill validation fails? | `skill_valid = false`, replay is skipped. |
| What if replay returns no answer? | `replay_status = "no_answer"` when the run exited cleanly, otherwise `error`. |
| What if replay times out? | `replay_status = "error"` and `replay_wall_clock_s` records the elapsed time. |
| Does task score affect skill score? | No. They are independent. |
| Can generated skills be committed automatically? | No. The harness uses temp materialization only. |

## Failure Modes To Prevent

- Replaying against a different device than the original run used.
- Writing generated skills to a permanent repo location.
- Treating a missing skill block as a task failure instead of a skipped skill
  score.
- Letting replay run indefinitely instead of enforcing the replay timeout.
- Assuming replay should rediscover the Android version. The skill should
  carry the discovered version forward and replay should verify it.
- In `full-repo`, collapsing doctor preflight failures to
  `doctor_preflight_failed` without the associated `code`, `detail`,
  evidence, and fix steps from the doctor report.
- In `public-surface`, retaining more than `doctor_failure.code` and
  `doctor_failure.summary`, or leaking raw doctor reports or host-specific
  paths and commands.

## Operational Guidance

- For repo-local Codex work, prefer the [`evals-run`](../../../.agents/skills/evals-run/SKILL.md) skill.
- Use the bundled helper script when you want one command to build the debug APK, install the matching APK for each runtime target, and run both paths on the same emulator.
- Use `--mode full-repo` and `--skill-prompt prompt-skill.md` when you want to
  measure skill emission on the strongest available prompt surface.
- For Pack A, the existing `android-version` benchmark is the required red and
  then green proving surface for discovery-authored Settings/About-device
  skills. The benchmark stays on the existing eval id, uses
  `prompt-skill.md`, and treats `androperator-skill-author-by-agent-discovery` as the
  required discovery front door before any skill can be emitted.
- Pack A confidence requires explicit-device runs on one AOSP emulator and one
  Samsung physical device. Keep the emulator path in `evals-run` and the
  Samsung path in `evals-live-run`; do not silently substitute another OEM.
- Use `--replay <run_id>` to inspect a previous run's emitted skill.
- Pass `--device <serial>` explicitly whenever more than one device is
  connected.
- Keep `skill_score` separate from `outcome` when you analyze runs.

## Live Skill Eval Boundary

The Solax orchestrated cold-start proving flow lives in `/evals` as a dedicated
live-device batch eval, not as an extension of the repo-local `evals-run`
skill.

Reason:

- `evals-run` is scoped to the `android-version` benchmark, runtime-target
  choice (`local-dev` versus `published`), replay, and rescore
- the Solax cold-start flow is a different abstraction: repeated skill proving
  with per-run normalization, current-state probing, target selection, and
  aggregate pass-fail classification
- encoding that logic in `/evals` keeps the proving policy inspectable,
  reviewable, and reusable by future eval authors without teaching a repo-local
  skill to become the proving harness itself

Current command surface:

```bash
uv run --project evals --extra dev python evals/run_eval.py solax-orchestrated-cold-start \
  --device <serial> \
  --operator-package com.androperator.operator.dev \
  --runs 4
```

This command now uses the same runtime-resolution rules as the rest of the eval
entrypoint:

- `--runtime local-dev` uses the branch-local CLI and the local-dev operator
  package resolution path
- `--runtime published` uses the published CLI and release operator package
  resolution path
- `--operator-package` is honored through that same resolution path instead of
  being handled as a Solax-only shortcut

Artifact boundary:

- agent benchmark evals write single-run artifacts under `evals/runs/<run_id>/`
- live orchestrated-skill proving writes batch artifacts under
  `evals/artifacts/<batch_id>/`
- retained live batches are copied into the private `androperator-artifacts`
  repo rather than committed in the main product repo

Run-start normalization:

- each live proving run force-stops the target app before probe so the observed
  persisted value comes from a restarted app process, not leftover in-app state
  from a previous attempt
- the harness force-stops the target app again before `skills run` so the skill
  itself starts from a fresh outer-app state as well
- missing restart-before-probe proof is a distinct failed classification and
  does not count as `cold_start_verified`

Visible run shape:

- one eval run is intentionally two-phase on the device:
  1. the harness probe reopens the app, traverses to the relevant persisted row,
     reads the current value, and stops without editing
  2. the harness re-normalizes outside-app state, then launches the real
     `skills run` attempt
- the probe phase can look like a "first failed run" to a human watcher if they
  do not know that the first traversal is target-selection setup rather than
  the edit attempt itself
- this is current intentional behavior in the eval harness, not an accidental
  duplicate run

Skill continuation policy:

- once `skills run` starts, the Solax orchestrated skill is allowed to continue
  from the current visible in-app SolaX state when it already shows `Peak
  Export`, `Device Discharging`, or the `Discharge to` dialog
- that continuation behavior is part of the skill contract, not the probe
- as a result, a clean cold-start proof batch member can still look visually
  non-linear inside the app even though the harness proved outside-app restart
  before the skill run

Hang handling:

- the live orchestrated-skill harness must bound `skills run` with an explicit
  timeout and classify a hung skill as `skill_timed_out`
- a hung skill is evidence of an unproven run, not a reason to leave the batch
  without summary output

That split is intentional. The benchmark harness measures an agent solving a
task. The cold-start skill eval measures whether a pre-authored skill proves
its claimed behavior repeatedly from a normalized device state.
