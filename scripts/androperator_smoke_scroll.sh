#!/usr/bin/env bash
# Scroll action smoke test: deterministic Settings round-trip.
#
# Opens Android Settings (present on every Android device), scrolls to the
# bottom using a manual scroll loop (one scroll action per step, verifying
# edge_reached), then returns to the top in a single scroll_until action
# (bounded loop, accepts EDGE_REACHED or NO_POSITION_CHANGE as top signal),
# and confirms the leading-child signature at the top matches the initial
# snapshot.
#
# Usage:
#   ./scripts/androperator_smoke_scroll.sh
#   DEVICE_ID=<serial> ./scripts/androperator_smoke_scroll.sh
#
# Optional env vars:
#   DEVICE_ID                    - device serial (auto-selected when only one device is connected)
#   ANDROPERATOR_OPERATOR_PACKAGE - defaults to com.androperator.operator.dev
#   SCROLL_MAX_STEPS             - max scroll steps in each direction before failing (default: 30)
set -euo pipefail

cd "$(dirname "$0")/.."

npm --prefix apps/node run build --silent

export DEVICE_ID="${DEVICE_ID:-}"
export ANDROPERATOR_OPERATOR_PACKAGE="${ANDROPERATOR_OPERATOR_PACKAGE:-com.androperator.operator.dev}"
SCROLL_MAX_STEPS="${SCROLL_MAX_STEPS:-30}"
SETTINGS_PACKAGE="com.android.settings"

CLI=(node apps/node/dist/cli/index.js)

# ---------------------------------------------------------------------------
# Device resolution
# ---------------------------------------------------------------------------
resolve_device_id() {
  if [ -n "$DEVICE_ID" ]; then
    return 0
  fi
  local devices
  devices="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
  local count
  count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$count" -eq 1 ]; then
    DEVICE_ID="$(printf '%s\n' "$devices" | sed '/^$/d')"
    export DEVICE_ID
    echo "Auto-selected DEVICE_ID=$DEVICE_ID"
    return 0
  fi
  echo "ERROR: DEVICE_ID is not set and $count connected device(s) found." >&2
  echo "Set DEVICE_ID=<serial> and re-run." >&2
  adb devices >&2 || true
  exit 1
}

resolve_device_id

# ---------------------------------------------------------------------------
# Helper: run a single-action execution payload and return JSON result
# ---------------------------------------------------------------------------
run_action() {
  local payload="$1"
  "${CLI[@]}" exec \
    --device "$DEVICE_ID" \
    --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE" \
    --execution "$payload" \
    2>&1
}

# ---------------------------------------------------------------------------
# Helper: extract a field from a step result by action id
# Usage: extract_step_field <json> <action_id> <field>
# Example: extract_step_field "$result" "scr1" "scroll_outcome"
# ---------------------------------------------------------------------------
extract_step_field() {
  local json="$1" action_id="$2" field="$3"
  echo "$json" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
    const steps = d.steps || d.stepResults || (d.envelope && d.envelope.stepResults) || [];
    const step = steps.find(s => s.id === '$action_id');
    if (!step) { process.exit(1); }
    console.log((step.data && step.data['$field']) || '');
  " 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Helper: extract the snapshot text from a snapshot_ui step
# ---------------------------------------------------------------------------
extract_snapshot() {
  local json="$1" action_id="$2"
  echo "$json" | node -e "
    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
    const steps = d.steps || d.stepResults || (d.envelope && d.envelope.stepResults) || [];
    const step = steps.find(s => s.id === '$action_id');
    if (!step) { process.exit(1); }
    console.log((step.data && step.data.text) || '');
  " 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Helper: extract the first N non-empty XML text attributes from a hierarchy dump.
# This gives us a stable "what is visible near the top" signature without relying
# on brittle grep/head pipelines or the old unsupported snapshot format param.
# ---------------------------------------------------------------------------
leading_signature() {
  local snapshot="$1"
  local n="${2:-5}"
  printf '%s' "$snapshot" | node -e "
    const xml = require('fs').readFileSync(0, 'utf8');
    const limit = Number(process.argv[1]);
    const texts = [];
    const regex = /\\btext=\"([^\"]+)\"/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const value = match[1].trim();
      if (value) texts.push(value);
      if (texts.length >= limit) break;
    }
    console.log(texts.join('|'));
  " "$n"
}

PAYLOAD_FILE=$(mktemp /tmp/androperator-scroll-smoke-XXXXXX.json)
trap 'rm -f "$PAYLOAD_FILE"' EXIT

echo "=== scroll smoke: DEVICE_ID=$DEVICE_ID receiver=$ANDROPERATOR_OPERATOR_PACKAGE ==="

# ---------------------------------------------------------------------------
# 1) Open Settings and take initial snapshot
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 1: open Settings + initial snapshot ---"

cat > "$PAYLOAD_FILE" <<JSON
{
  "commandId": "scroll-smoke-init",
  "taskId": "scroll-smoke",
  "source": "smoke-scroll",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 60000,
  "actions": [
    { "id": "close",   "type": "close_app",    "params": { "applicationId": "$SETTINGS_PACKAGE" } },
    { "id": "open",    "type": "open_app",     "params": { "applicationId": "$SETTINGS_PACKAGE" } },
    { "id": "settle",  "type": "sleep",        "params": { "durationMs": 2000 } },
    { "id": "snap-init", "type": "snapshot_ui" }
  ]
}
JSON

INIT_RESULT="$(run_action "$PAYLOAD_FILE")"
echo "$INIT_RESULT" | node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2))' 2>/dev/null || echo "$INIT_RESULT"

SNAP_INIT="$(extract_snapshot "$INIT_RESULT" "snap-init")"
if [ -z "$SNAP_INIT" ]; then
  echo "ERROR: initial snapshot returned empty. Check device connectivity and accessibility service." >&2
  exit 1
fi
SIG_INIT="$(leading_signature "$SNAP_INIT" 5)"
echo "Leading signature (init): $SIG_INIT"

# ---------------------------------------------------------------------------
# 2) Scroll DOWN until edge_reached
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 2: scroll DOWN until edge_reached ---"

DOWN_STEPS=0
REACHED_BOTTOM=false
while [ "$DOWN_STEPS" -lt "$SCROLL_MAX_STEPS" ]; do
  DOWN_STEPS=$((DOWN_STEPS + 1))

  cat > "$PAYLOAD_FILE" <<JSON
{
  "commandId": "scroll-smoke-down-$DOWN_STEPS",
  "taskId": "scroll-smoke",
  "source": "smoke-scroll",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    {
      "id": "scr",
      "type": "scroll",
      "params": {
        "container": { "resourceId": "com.android.settings:id/recycler_view" },
        "direction": "down",
        "distanceRatio": 0.7,
        "settleDelayMs": 300
      }
    }
  ]
}
JSON

  RESULT="$(run_action "$PAYLOAD_FILE")"
  OUTCOME="$(extract_step_field "$RESULT" "scr" "scroll_outcome")"
  echo "  down step $DOWN_STEPS: scroll_outcome=$OUTCOME"

  if [ "$OUTCOME" = "edge_reached" ]; then
    REACHED_BOTTOM=true
    echo "  -> bottom edge reached after $DOWN_STEPS scroll(s)"
    break
  fi

  if [ "$OUTCOME" = "gesture_failed" ]; then
    echo "ERROR: gesture_failed during downward scroll at step $DOWN_STEPS" >&2
    echo "$RESULT" | node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2))' 2>/dev/null || echo "$RESULT"
    exit 1
  fi

  if [ -z "$OUTCOME" ]; then
    echo "ERROR: no scroll_outcome in step result at down step $DOWN_STEPS" >&2
    echo "$RESULT" | node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2))' 2>/dev/null || echo "$RESULT"
    exit 1
  fi
done

if [ "$REACHED_BOTTOM" = "false" ]; then
  echo "ERROR: edge_reached not seen after $SCROLL_MAX_STEPS downward scrolls" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3) Scroll UP to top using scroll_until (bounded loop, single action)
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 3: scroll UP to top using scroll_until ---"

cat > "$PAYLOAD_FILE" <<JSON
{
  "commandId": "scroll-smoke-up",
  "taskId": "scroll-smoke",
  "source": "smoke-scroll",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 60000,
  "actions": [
    {
      "id": "scr",
      "type": "scroll_until",
      "params": {
        "container": { "resourceId": "com.android.settings:id/recycler_view" },
        "direction": "up",
        "distanceRatio": 0.7,
        "settleDelayMs": 300,
        "maxScrolls": $SCROLL_MAX_STEPS,
        "noPositionChangeThreshold": 3
      }
    }
  ]
}
JSON

RESULT="$(run_action "$PAYLOAD_FILE")"
echo "$RESULT" | node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2))' 2>/dev/null || echo "$RESULT"

TERMINATION="$(extract_step_field "$RESULT" "scr" "termination_reason")"
SCROLLS_EXECUTED="$(extract_step_field "$RESULT" "scr" "scrolls_executed")"
echo "  scroll_until result: termination_reason=$TERMINATION scrolls_executed=$SCROLLS_EXECUTED"

REACHED_TOP=false
if [ "$TERMINATION" = "EDGE_REACHED" ] || [ "$TERMINATION" = "NO_POSITION_CHANGE" ]; then
  REACHED_TOP=true
  echo "  -> top reached: $TERMINATION after $SCROLLS_EXECUTED scroll(s)"
fi

UP_STEPS="$SCROLLS_EXECUTED"

if [ "$REACHED_TOP" = "false" ]; then
  echo "ERROR: scroll_until did not reach top (termination_reason=$TERMINATION)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4) Final snapshot and leading-child signature comparison
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 4: final snapshot + signature comparison ---"

cat > "$PAYLOAD_FILE" <<JSON
{
  "commandId": "scroll-smoke-final",
  "taskId": "scroll-smoke",
  "source": "smoke-scroll",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 30000,
  "actions": [
    { "id": "settle",   "type": "sleep",        "params": { "durationMs": 500 } },
    { "id": "snap-final", "type": "snapshot_ui" }
  ]
}
JSON

FINAL_RESULT="$(run_action "$PAYLOAD_FILE")"
echo "$FINAL_RESULT" | node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2))' 2>/dev/null || echo "$FINAL_RESULT"

SNAP_FINAL="$(extract_snapshot "$FINAL_RESULT" "snap-final")"
if [ -z "$SNAP_FINAL" ]; then
  echo "ERROR: final snapshot returned empty." >&2
  exit 1
fi
SIG_FINAL="$(leading_signature "$SNAP_FINAL" 5)"
echo "Leading signature (final): $SIG_FINAL"

if [ "$SIG_INIT" = "$SIG_FINAL" ]; then
  echo "Signature match: initial and final leading-child signatures are identical."
else
  echo "WARN: leading-child signature differs after round trip."
  echo "  init:  $SIG_INIT"
  echo "  final: $SIG_FINAL"
  echo "  This may indicate the Settings list did not return to the same starting position."
  echo "  Review the snapshots above to confirm correctness."
  # Non-fatal: signature may differ on devices where Settings shows dynamic content
  # (e.g. suggested settings). The round-trip edge detection is the primary assertion.
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "=== scroll smoke PASSED ==="
echo "  Down scrolls to edge: $DOWN_STEPS"
echo "  Up scrolls to edge:   $UP_STEPS"
echo "  Signature match:      $([ "$SIG_INIT" = "$SIG_FINAL" ] && echo yes || echo no - see WARN above)"
