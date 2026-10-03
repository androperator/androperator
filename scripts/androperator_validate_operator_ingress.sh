#!/usr/bin/env bash
# Validate Operator ingress (Android broadcast path into the Operator app): minimal snapshot_ui with
# unique commandId, then logcat grep for correlatable Androperator-Result / ACTION_AGENT_COMMAND lines.
# Persists grep result for evidence doc and optional JSON summary.
# Usage: one device connected (or set DEVICE_ID). Optional: ANDROPERATOR_SMOKE_SUMMARY or
#        ANDROPERATOR_VALIDATE_SUMMARY=/path/to.json to write summary including logcatGrepOutput.
set -euo pipefail

cd "$(dirname "$0")/.."

# Device selection:
# - If DEVICE_ID is set, use it.
# - If unset and exactly one device is connected, auto-select it.
# - If unset and multiple devices are connected, fail and require explicit DEVICE_ID.
# NOTE: Do not commit personal device serials to this repository.
export DEVICE_ID="${DEVICE_ID:-}"
export ANDROPERATOR_OPERATOR_PACKAGE="${ANDROPERATOR_OPERATOR_PACKAGE:-com.androperator.operator.dev}"

# Unique commandId for this run (so logcat grep is correlatable)
VALIDATE_CMD_ID="validate-$(date +%s)"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CLI=(node apps/node/dist/cli/index.js)

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
  echo "ERROR: DEVICE_ID is not set and $count connected devices were found." >&2
  echo "Set DEVICE_ID=<serial> and re-run." >&2
  adb devices >&2 || true
  exit 1
}

resolve_device_id

if [ ! -f apps/node/dist/cli/index.js ]; then
  echo "Node CLI build not found at apps/node/dist/cli/index.js; building..."
  npm --prefix apps/node run build
fi

# Minimal execution: single snapshot_ui
VALIDATE_JSON="/tmp/androperator-validate-exec.json"
cat > "$VALIDATE_JSON" <<JSON
{
  "commandId": "$VALIDATE_CMD_ID",
  "taskId": "validate-task-1",
  "source": "validate-operator-ingress",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 20000,
  "actions": [
    { "id": "snap", "type": "snapshot_ui" }
  ]
}
JSON

GREP_OUTPUT_FILE="${ANDROPERATOR_OPERATOR_GREP_FILE:-/tmp/androperator-operator-ingress-grep.txt}"
SUMMARY_OUT="${ANDROPERATOR_SMOKE_SUMMARY:-${ANDROPERATOR_VALIDATE_SUMMARY:-}}"

echo "=== validate Operator ingress (commandId=$VALIDATE_CMD_ID) ==="
adb -s "$DEVICE_ID" logcat -c
set +e
"${CLI[@]}" exec \
   --device "$DEVICE_ID" \
  --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE" \
  --execution "$VALIDATE_JSON" \
  --output pretty 2>&1
EXEC_EXIT=$?
set -e

# Capture logcat lines that correlate to this command or Operator / ACTION_AGENT_COMMAND tags.
adb -s "$DEVICE_ID" logcat -d -t 800 \
  | awk -v cmd="$VALIDATE_CMD_ID" 'index($0, cmd) || $0 ~ /Androperator-Result|ACTION_AGENT_COMMAND/' \
  > "$GREP_OUTPUT_FILE" || true

echo "=== logcat grep result (saved to $GREP_OUTPUT_FILE) ==="
cat "$GREP_OUTPUT_FILE"
if [ ! -s "$GREP_OUTPUT_FILE" ]; then
  echo "(no matching lines)"
fi

if [ "$EXEC_EXIT" -ne 0 ]; then
  echo "ERROR: exec command failed (exit=$EXEC_EXIT)." >&2
  exit 1
fi

if [ ! -s "$GREP_OUTPUT_FILE" ]; then
  echo "ERROR: validation failed; no correlatable logcat lines found." >&2
  exit 1
fi

if [ -n "$SUMMARY_OUT" ]; then
  export SUMMARY_PATH="$SUMMARY_OUT"
  export GREP_FILE="$GREP_OUTPUT_FILE"
  export SMOKE_TIMESTAMP="$TIMESTAMP"
  export SMOKE_DEVICE_ID="$DEVICE_ID"
  export SMOKE_OPERATOR_PACKAGE="$ANDROPERATOR_OPERATOR_PACKAGE"
  export SMOKE_VALIDATE_CMD_ID="$VALIDATE_CMD_ID"
  node -e "
    const fs = require('fs');
    const path = process.env.SUMMARY_PATH;
    const grepFile = process.env.GREP_FILE;
    if (!path || !grepFile) { console.error('Missing SUMMARY_PATH or GREP_FILE'); process.exit(1); }
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(path, 'utf8')); } catch (e) {}
    const grepContent = fs.readFileSync(grepFile, 'utf8');
    existing.operatorIngressValidation = {
      timestamp: process.env.SMOKE_TIMESTAMP,
      deviceId: process.env.SMOKE_DEVICE_ID,
      operatorPackage: process.env.SMOKE_OPERATOR_PACKAGE,
      commandId: process.env.SMOKE_VALIDATE_CMD_ID,
      logcatGrepPath: grepFile,
      logcatGrepOutput: grepContent
    };
    fs.writeFileSync(path, JSON.stringify(existing, null, 2));
    console.log('Appended operatorIngressValidation to', path);
  "
fi

echo "=== validate Operator ingress done ==="
