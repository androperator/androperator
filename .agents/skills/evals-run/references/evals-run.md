# Evals Runbook

## Runtime Target Selection

- `local-dev` uses the branch-local Node CLI build and the `.dev` Operator APK.
- `published` uses the globally installed `androperator` binary and the release Operator APK.
- The code version is typically ahead of the published version. Do not mix runtime targets unless the CLI and APK versions are intentionally aligned.

## Before Running

- Use `./gradlew :app:assembleDebug` and install `apps/android/app/build/outputs/apk/debug/app-debug.apk` with `adb -s <serial>` when testing `local-dev`.
- Install the matching release CLI and release APK when testing `published`.
- Use `--device <serial>` whenever more than one Android device is connected.
- Use `--mode full-repo` only when the eval should see repository-internal docs and source.

## Run

```bash
uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent <agent> \
  --model <model> \
  --runtime <local-dev|published> \
  --device <serial>
```

## Pack A Benchmark On The AOSP Emulator

Use this command for the Pack A red baseline and later green proof on the
required AOSP emulator surface:

```bash
uv run --project evals --extra dev python evals/run_eval.py android-version \
  --agent <agent> \
  --model <model> \
  --runtime local-dev \
  --mode full-repo \
  --skill-prompt prompt-skill.md \
  --device <aosp_emulator_serial> \
  --label <pack_a_label>
```

Rules:

- Keep the benchmark on the existing `android-version` eval id.
- Use the AOSP emulator here. The Samsung physical-device path is documented in
  `evals-live-run`.
- Pass `--device <aosp_emulator_serial>` explicitly even if only one emulator
  is connected.
- A truthful canary stays red until the discovery front door is actually
  installed and the Pack A route can emit and replay a valid skill.
- The helper script remains useful for runtime-target comparison, but the Pack
  A discovery-authored route uses the direct `--mode full-repo --skill-prompt
  prompt-skill.md` invocation above.

## Pack A Device Matrix Helper

When you want one local-dev Pack A run on the connected AOSP emulator and one
on the connected physical device, use:

```bash
.agents/skills/evals-run/scripts/run_pack_a_android_version_matrix.sh <agent> <model>
```

By default, the helper:

- auto-detects exactly one connected emulator and exactly one connected
  physical device
- builds the branch-local Node CLI once
- assembles the debug APK once
- runs `operator setup` on both devices with the `.dev` operator package
- runs the Pack A eval twice with:
  - `--runtime local-dev`
  - `--mode full-repo`
  - `--skill-prompt prompt-skill.md`
- prints a short per-device summary with:
  - `outcome.status`
  - `answer_normalized`
  - `route_requirements_met`
  - `skill_generation_passed`
  - `replay_status`

Current Pack A expectation:

- use the required Samsung physical device for the physical leg when you are
  collecting acceptance proof, not another OEM handset

Optional flags:

- `--aosp-device <serial>` to override emulator auto-detection
- `--physical-device <serial>` to override physical-device auto-detection
- `--label-prefix <prefix>` to control the per-run labels
- `--dry-run` to print the planned setup and eval commands without executing
  them

Example:

```bash
.agents/skills/evals-run/scripts/run_pack_a_android_version_matrix.sh codex gpt-5.4 \
  --aosp-device <aosp_emulator_serial> \
  --physical-device <physical_device_serial> \
  --label-prefix verify-pack-a
```

To run both runtime targets on the same emulator with the matching APK setup
steps, use:

```bash
.agents/skills/evals-run/scripts/run_android_version_eval.sh <device_serial> <agent> <model>
```

Pass `local-dev` or `published` as a fourth argument to run only one target.
The published branch downloads the exact APK for the installed published CLI
version before setup.

## Triage

- `VERSION_INCOMPATIBLE` usually means the CLI and APK versions do not match.
- For `local-dev`, rebuild the debug APK from the same checkout before rerunning.
- For `published`, download and install the APK that matches `androperator version`.
- `doctor_preflight_failed` means preflight stopped the run before the agent started.
- `no_answer` means the transcript needs inspection for the answer marker and scorer behavior.
- Pack A red-baseline expectation before the new discovery skill ships:
  `skill_emitted = false`, `replay_status = "skipped"`, or a transcript that
  explicitly reports the missing or incomplete discovery route.
- Auth or provider errors such as `LLM not set` mean the agent config must be fixed before rerunning.

## Artifacts

- `evals/runs/<run_id>/config.json`
- `evals/runs/<run_id>/result.json`
- `evals/runs/<run_id>/transcript.txt`

## Follow-up Commands

- Replay: `uv run --project evals --extra dev python evals/run_eval.py android-version --replay <run_id>`
- Rescore: `uv run --project evals --extra dev python evals/run_eval.py android-version --rescore <run_id>`
