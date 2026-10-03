#!/bin/bash
#
# validate_recording.sh - End-to-end recording API validation
#
# Usage: ./validate_recording.sh [device_serial]
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
RUNS_DIR="${RECORDING_VALIDATION_RUNS_DIR:-$HOME/src/androperator-dumps/runs}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RUN_DIR="$RUNS_DIR/$TIMESTAMP"

# Use local CLI build from repo root (supports 'recording' canonical command)
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ANDROPERATOR_CLI="$REPO_ROOT/apps/node/dist/cli/index.js"

# Receiver package - use env var or default to dev package for testing
OPERATOR_PKG="${ANDROPERATOR_OPERATOR_PACKAGE:-com.androperator.operator.dev}"

# Device selection
DEVICE_ID="${1:-}"
if [[ -z "$DEVICE_ID" ]]; then
    echo "[INFO] No device serial provided, checking connected devices..."
    DEVICES=$(node "$ANDROPERATOR_CLI" devices --output json 2>/dev/null | grep -o '"serial":"[^"]*"' | cut -d'"' -f4 || true)
    if [[ -z "$DEVICES" ]]; then
        DEVICE_COUNT=0
    else
        DEVICE_COUNT=$(printf '%s\n' "$DEVICES" | grep -c ".*" || true)
    fi
    
    if [[ "$DEVICE_COUNT" -eq 0 ]]; then
        echo "[ERROR] No Android devices connected"
        exit 1
    elif [[ "$DEVICE_COUNT" -gt 1 ]]; then
        echo "[ERROR] Multiple devices connected. Please specify device serial:"
        echo "$DEVICES"
        exit 1
    else
        DEVICE_ID=$(echo "$DEVICES" | head -1)
        echo "[INFO] Auto-selected device: $DEVICE_ID"
    fi
fi

# Create run directory
mkdir -p "$RUN_DIR"
echo "[INFO] Run artifacts will be saved to: $RUN_DIR"

# Path for validation report
REPORT_FILE="$RUN_DIR/validation_report.json"

# Initialize report
cat > "$REPORT_FILE" << EOF
{
  "timestamp": "$TIMESTAMP",
  "deviceId": "$DEVICE_ID",
  "steps": {},
  "validations": {},
  "passed": false
}
EOF

# Helper function to update report
update_report() {
    local key="$1"
    local value="$2"
    local tmp_file=$(mktemp)
    jq ".$key = $value" "$REPORT_FILE" > "$tmp_file" && mv "$tmp_file" "$REPORT_FILE"
}

# Step 1: Start recording
echo "[INFO] Clearing any stale recording session before starting..."
node "$ANDROPERATOR_CLI" recording stop --device "$DEVICE_ID" --operator-package "$OPERATOR_PKG" --json >/dev/null 2>&1 || true

echo "[STEP 1] Starting recording session..."
START_OUTPUT=$(node "$ANDROPERATOR_CLI" recording start --device "$DEVICE_ID" --operator-package "$OPERATOR_PKG" --json 2>&1) || {
    echo "[ERROR] Recording start failed: $START_OUTPUT"
    update_report "steps.start" '{"success": false, "error": "command failed"}'
    exit 2
}

# Extract session ID from start response
SESSION_ID=$(echo "$START_OUTPUT" | jq -r '.envelope.stepResults[0].data.sessionId // empty' 2>/dev/null || true)
if [[ -z "$SESSION_ID" ]]; then
    # Try alternative path in response
    SESSION_ID=$(echo "$START_OUTPUT" | jq -r '.sessionId // empty' 2>/dev/null || true)
fi

if [[ -z "$SESSION_ID" ]]; then
    echo "[ERROR] Start response missing sessionId"
    echo "$START_OUTPUT" > "$RUN_DIR/start_error.json"
    update_report "steps.start" '{"success": false, "error": "missing sessionId"}'
    exit 2
fi

echo "[INFO] Recording started with session: $SESSION_ID"
update_report "steps.start" "{\"success\": true, \"sessionId\": \"$SESSION_ID\"}"

# Step 2: Run Play Store search skill
echo "[STEP 2] Running Play Store search skill for 'Action Launcher'..."
# Use local copy of Play Store search skill that uses local CLI build
SKILL_SCRIPT="$SCRIPT_DIR/../play-store-search-skill/scripts/search_play_store.js"
SKILL_OUTPUT=$(node "$SKILL_SCRIPT" "$DEVICE_ID" "Action Launcher" "$OPERATOR_PKG" 2>&1) || {
    echo "[WARN] Play Store skill may have encountered issues: $SKILL_OUTPUT"
    # Continue anyway - partial results are still valid for recording
}

echo "$SKILL_OUTPUT" > "$RUN_DIR/skill_output.txt"
update_report "steps.skill" '{"success": true}'

# Step 3: Stop recording
echo "[STEP 3] Stopping recording session..."
STOP_OUTPUT=$(node "$ANDROPERATOR_CLI" recording stop --device "$DEVICE_ID" --operator-package "$OPERATOR_PKG" --json 2>&1) || {
    echo "[ERROR] Recording stop failed: $STOP_OUTPUT"
    update_report "steps.stop" '{"success": false, "error": "command failed"}'
    exit 4
}

# Extract event count
EVENT_COUNT=$(echo "$STOP_OUTPUT" | jq -r '.envelope.stepResults[0].data.eventCount // 0' 2>/dev/null || echo "0")
echo "[INFO] Recording stopped with $EVENT_COUNT events captured"
update_report "steps.stop" "{\"success\": true, \"eventCount\": $EVENT_COUNT}"

# Step 4: Pull recording
echo "[STEP 4] Pulling recording to host..."
PULL_OUTPUT=$(node "$ANDROPERATOR_CLI" recording pull --device "$DEVICE_ID" --operator-package "$OPERATOR_PKG" --session-id "$SESSION_ID" --out "$RUN_DIR" --json 2>&1) || {
    echo "[ERROR] Recording pull failed: $PULL_OUTPUT"
    update_report "steps.pull" '{"success": false, "error": "command failed"}'
    exit 5
}

NDJSON_FILE="$RUN_DIR/${SESSION_ID}.ndjson"
if [[ ! -f "$NDJSON_FILE" ]]; then
    echo "[ERROR] NDJSON file not found at expected path: $NDJSON_FILE"
    update_report "steps.pull" '{"success": false, "error": "file not found"}'
    exit 5
fi

FILE_SIZE=$(stat -f%z "$NDJSON_FILE" 2>/dev/null || stat -c%s "$NDJSON_FILE" 2>/dev/null || echo "0")
echo "[INFO] Pulled NDJSON file: $NDJSON_FILE ($FILE_SIZE bytes)"
update_report "steps.pull" "{\"success\": true, \"fileSize\": $FILE_SIZE, \"path\": \"$NDJSON_FILE\"}"

# Step 5: Export the raw event evidence, including available snapshots.
echo "[STEP 5] Exporting recording evidence..."
EXPORT_FILE="$RUN_DIR/${SESSION_ID}.export.json"
if ! node "$ANDROPERATOR_CLI" recording export --input "$NDJSON_FILE" --out "$EXPORT_FILE" --snapshots include --output json > "$RUN_DIR/export_output.json"; then
    update_report "steps.export" '{"success": false, "error": "command failed"}'
    exit 6
fi
if [[ ! -f "$EXPORT_FILE" ]]; then
    update_report "steps.export" '{"success": false, "error": "output file not found"}'
    exit 6
fi
update_report "steps.export" "$(jq -n --arg path "$EXPORT_FILE" '{success: true, path: $path}')"

# Step 6: Validate raw evidence rather than inferred replay steps.
echo "[STEP 6] Validating exported evidence..."
if ! jq -e --arg session "$SESSION_ID" --argjson count "$EVENT_COUNT" '
    .exportVersion == 1 and .session.sessionId == $session and
    .snapshotMode == "include" and .counts.totalEvents == $count and
    (.events | length) == $count and $count > 0 and
    any(.events[]; .type == "window_change") and
    any(.events[]; .type == "click") and
    any(.events[]; .snapshot.present == true and (.snapshot.xml | type) == "string")
' "$EXPORT_FILE" > /dev/null; then
    update_report "passed" "false"
    update_report "validations.errors" '["missing events, snapshots, or inconsistent export metadata"]'
    exit 7
fi
update_report "passed" "true"
update_report "validations.errors" "[]"
echo "[PASS] Exported events and snapshot evidence verified"
