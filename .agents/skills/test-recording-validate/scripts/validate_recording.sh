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

# Step 5: Parse recording
echo "[STEP 5] Parsing recording to step log..."
PARSE_OUTPUT_FILE="$RUN_DIR/parse_output.json"
PARSE_SUMMARY_FILE="$RUN_DIR/parse_summary.txt"

# Capture both stdout and stderr separately
PARSE_STDOUT=$(node "$ANDROPERATOR_CLI" recording parse --input "$NDJSON_FILE" --output json 2>"$PARSE_SUMMARY_FILE") || {
    echo "[ERROR] Recording parse failed"
    cat "$PARSE_SUMMARY_FILE" >&2
    update_report "steps.parse" '{"success": false, "error": "command failed"}'
    exit 6
}

echo "$PARSE_STDOUT" > "$PARSE_OUTPUT_FILE"
STEPS_FILE="$RUN_DIR/${SESSION_ID}.steps.json"

# Find the actual steps.json file (may have different naming)
if [[ -f "${NDJSON_FILE%.ndjson}.steps.json" ]]; then
    STEPS_FILE="${NDJSON_FILE%.ndjson}.steps.json"
elif OUTPUT_REL_PATH="$(echo "$PARSE_STDOUT" | jq -r '.outputFile // empty' 2>/dev/null)" && [[ -n "$OUTPUT_REL_PATH" && -f "$RUN_DIR/$OUTPUT_REL_PATH" ]]; then
    STEPS_FILE="$RUN_DIR/$OUTPUT_REL_PATH"
fi

if [[ ! -f "$STEPS_FILE" ]]; then
    echo "[ERROR] Steps JSON file not found"
    update_report "steps.parse" '{"success": false, "error": "output file not found"}'
    exit 6
fi

STEP_COUNT=$(jq '.steps | length' "$STEPS_FILE" 2>/dev/null || echo "0")
echo "[INFO] Parsed step log: $STEPS_FILE ($STEP_COUNT steps)"
update_report "steps.parse" "{\"success\": true, \"stepCount\": $STEP_COUNT, \"path\": \"$STEPS_FILE\"}"

# Step 6: Validate step log
echo "[STEP 6] Validating step log structure..."

VALIDATION_ERRORS=()

# Check for open_app step
OPEN_APP_COUNT=$(jq '[.steps[] | select(.type == "open_app")] | length' "$STEPS_FILE" 2>/dev/null || echo "0")
if [[ "$OPEN_APP_COUNT" -lt 1 ]]; then
    VALIDATION_ERRORS+=("missing open_app step")
    echo "[FAIL] No open_app step found"
else
    echo "[PASS] Found $OPEN_APP_COUNT open_app step(s)"
fi

# Check for click step
CLICK_COUNT=$(jq '[.steps[] | select(.type == "click")] | length' "$STEPS_FILE" 2>/dev/null || echo "0")
if [[ "$CLICK_COUNT" -lt 1 ]]; then
    VALIDATION_ERRORS+=("missing click step")
    echo "[FAIL] No click step found"
else
    echo "[PASS] Found $CLICK_COUNT click step(s)"
fi

# Check for uiStateBefore on all steps
MISSING_UISTATE=$(jq '[.steps[] | select(.uiStateBefore == null)] | length' "$STEPS_FILE" 2>/dev/null || echo "0")
if [[ "$MISSING_UISTATE" -gt 0 ]]; then
    VALIDATION_ERRORS+=("$MISSING_UISTATE step(s) missing uiStateBefore")
    echo "[WARN] $MISSING_UISTATE step(s) have null uiStateBefore"
else
    echo "[PASS] All steps have uiStateBefore"
fi

# Check for parse warnings
WARNINGS=$(jq '._warnings // empty' "$STEPS_FILE" 2>/dev/null || true)
if [[ -n "$WARNINGS" && "$WARNINGS" != "null" && "$WARNINGS" != "[]" ]]; then
    echo "[INFO] Parse warnings: $WARNINGS"
    update_report "validations.warnings" "$WARNINGS"
fi

# Check event count
if [[ "$EVENT_COUNT" -eq 0 ]]; then
    VALIDATION_ERRORS+=("zero events captured")
    echo "[WARN] Recording captured zero events"
fi

# Update validation report
update_report "validations.openAppCount" "$OPEN_APP_COUNT"
update_report "validations.clickCount" "$CLICK_COUNT"
update_report "validations.nullUiStateCount" "$MISSING_UISTATE"

if [[ ${#VALIDATION_ERRORS[@]} -eq 0 ]]; then
    echo "[PASS] All validations passed"
    update_report "passed" "true"
    update_report "validations.errors" "[]"
    exit 0
else
    echo "[FAIL] Validation errors:"
    printf '  - %s\n' "${VALIDATION_ERRORS[@]}"
    
    # Build JSON array of errors
    ERRORS_JSON=$(printf '%s\n' "${VALIDATION_ERRORS[@]}" | jq -R . | jq -s .)
    update_report "passed" "false"
    update_report "validations.errors" "$ERRORS_JSON"
    exit 7
fi
