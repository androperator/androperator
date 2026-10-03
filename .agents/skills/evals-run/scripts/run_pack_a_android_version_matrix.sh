#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: run_pack_a_android_version_matrix.sh <agent> <model> [options]

Runs the Pack A android-version eval on one AOSP emulator and one physical
Android device using the local-dev runtime.

Options:
  --aosp-device <serial>      Explicit emulator serial
  --physical-device <serial>  Explicit physical-device serial
  --label-prefix <prefix>     Prefix for per-run labels
  --dry-run                   Print planned commands without executing them
EOF
}

if [[ $# -lt 2 ]]; then
  usage
  exit 2
fi

AGENT="$1"
MODEL="$2"
shift 2

AOSP_DEVICE=""
PHYSICAL_DEVICE=""
LABEL_PREFIX="pack-a-matrix-$(date +%Y%m%d-%H%M%S)"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --aosp-device)
      [[ $# -ge 2 ]] || { echo "missing value for --aosp-device" >&2; exit 2; }
      AOSP_DEVICE="$2"
      shift 2
      ;;
    --physical-device)
      [[ $# -ge 2 ]] || { echo "missing value for --physical-device" >&2; exit 2; }
      PHYSICAL_DEVICE="$2"
      shift 2
      ;;
    --label-prefix)
      [[ $# -ge 2 ]] || { echo "missing value for --label-prefix" >&2; exit 2; }
      LABEL_PREFIX="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel)"
DEBUG_APK="$ROOT/apps/android/app/build/outputs/apk/debug/app-debug.apk"
LOCAL_CLI="$ROOT/apps/node/dist/cli/index.js"

discover_devices() {
  local connected serial
  local -a emulators=()
  local -a physical_devices=()

  while read -r serial; do
    [[ -n "$serial" ]] || continue
    if [[ "$serial" == emulator-* ]]; then
      emulators+=("$serial")
    else
      physical_devices+=("$serial")
    fi
  done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')

  if [[ -z "$AOSP_DEVICE" ]]; then
    if [[ ${#emulators[@]} -ne 1 ]]; then
      echo "expected exactly one connected emulator, found ${#emulators[@]}" >&2
      echo "pass --aosp-device <serial> explicitly" >&2
      exit 2
    fi
    AOSP_DEVICE="${emulators[0]}"
  fi

  if [[ -z "$PHYSICAL_DEVICE" ]]; then
    if [[ ${#physical_devices[@]} -ne 1 ]]; then
      echo "expected exactly one connected physical device, found ${#physical_devices[@]}" >&2
      echo "pass --physical-device <serial> explicitly" >&2
      exit 2
    fi
    PHYSICAL_DEVICE="${physical_devices[0]}"
  fi
}

device_summary() {
  local serial="$1"
  local manufacturer model
  manufacturer="$(adb -s "$serial" shell getprop ro.product.manufacturer 2>/dev/null | tr -d '\r' | head -n 1)"
  model="$(adb -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r' | head -n 1)"
  if [[ -n "$manufacturer" || -n "$model" ]]; then
    printf '%s (%s %s)' "$serial" "${manufacturer:-unknown}" "${model:-unknown}"
  else
    printf '%s' "$serial"
  fi
}

print_command() {
  printf '  %q' "$@"
  printf '\n'
}

setup_local_dev_device() {
  local serial="$1"
  node "$LOCAL_CLI" operator setup \
    --apk "$DEBUG_APK" \
    --device "$serial" \
    --operator-package com.androperator.operator.dev \
    --output json >/dev/null
}

run_pack_a_leg() {
  local leg_name="$1"
  local serial="$2"
  local label="${LABEL_PREFIX}-${leg_name}"
  local -a eval_cmd=(
    uv run --project "$ROOT/evals" --extra dev python "$ROOT/evals/run_eval.py" android-version
    --agent "$AGENT"
    --model "$MODEL"
    --runtime local-dev
    --mode full-repo
    --skill-prompt prompt-skill.md
    --device "$serial"
    --label "$label"
  )

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[$leg_name] operator setup:"
    print_command node "$LOCAL_CLI" operator setup --apk "$DEBUG_APK" --device "$serial" --operator-package com.androperator.operator.dev --output json
    echo "[$leg_name] eval:"
    print_command "${eval_cmd[@]}"
    return 0
  fi

  echo "==> [$leg_name] operator setup on $(device_summary "$serial")"
  setup_local_dev_device "$serial"

  echo "==> [$leg_name] running Pack A eval"
  local output
  if ! output="$("${eval_cmd[@]}" 2>&1)"; then
    printf '%s\n' "$output"
    return 1
  fi
  printf '%s\n' "$output"

  local run_dir
  run_dir="$(printf '%s\n' "$output" | awk 'NR == 1 { print; exit }')"
  if [[ ! -f "$run_dir/result.json" ]]; then
    echo "missing result.json for $leg_name run: $run_dir" >&2
    return 1
  fi

  python3 - "$run_dir/result.json" "$leg_name" "$serial" <<'PY'
import json
import sys
from pathlib import Path

result_path = Path(sys.argv[1])
leg_name = sys.argv[2]
serial = sys.argv[3]
payload = json.loads(result_path.read_text(encoding="utf-8"))
outcome = payload.get("outcome", {})
skill_score = payload.get("skill_score", {})
print(
    f"[{leg_name}] {serial} | outcome={outcome.get('status')} | "
    f"answer={outcome.get('answer_normalized')} | "
    f"route_requirements_met={skill_score.get('route_requirements_met')} | "
    f"skill_generation_passed={skill_score.get('skill_generation_passed')} | "
    f"replay_status={skill_score.get('replay_status')}"
)
PY
}

discover_devices

echo "Pack A device matrix:"
echo "  AOSP emulator:  $(device_summary "$AOSP_DEVICE")"
echo "  Physical device: $(device_summary "$PHYSICAL_DEVICE")"
echo "  Label prefix:   $LABEL_PREFIX"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run only. No build, setup, or eval commands will execute."
else
  echo "==> building branch-local Node CLI"
  npm --prefix "$ROOT/apps/node" run build
  echo "==> assembling debug APK"
  "$ROOT/gradlew" app:assembleDebug
fi

FAILED=0
run_pack_a_leg "aosp" "$AOSP_DEVICE" || FAILED=1
run_pack_a_leg "physical" "$PHYSICAL_DEVICE" || FAILED=1

exit "$FAILED"
