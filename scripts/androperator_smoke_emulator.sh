#!/usr/bin/env bash
# Run the core Androperator smoke against a running Android emulator.
# Defaults to the release receiver package and auto-selects a single emulator target.
set -euo pipefail

cd "$(dirname "$0")/.."

resolve_emulator_device_id() {
  if [ -n "${DEVICE_ID:-}" ]; then
    return 0
  fi

  local devices
  devices="$(adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1}')"
  local count
  count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [ "$count" -eq 1 ]; then
    DEVICE_ID="$(printf '%s\n' "$devices" | sed '/^$/d')"
    export DEVICE_ID
    echo "Auto-selected emulator DEVICE_ID=$DEVICE_ID"
    return 0
  fi

  echo "ERROR: DEVICE_ID is not set and $count running emulators were found." >&2
  echo "Set DEVICE_ID=<emulator-serial> and re-run." >&2
  adb devices >&2 || true
  exit 1
}

resolve_emulator_device_id
export ANDROPERATOR_OPERATOR_PACKAGE="${ANDROPERATOR_OPERATOR_PACKAGE:-com.androperator.operator}"

./scripts/androperator_smoke_core.sh
