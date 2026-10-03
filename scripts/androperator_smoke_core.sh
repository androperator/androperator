#!/usr/bin/env bash
# Stage 1 real-device smoke for Androperator Node API.
# Usage: one physical device connected (or set DEVICE_ID); edit DEVICE_ID and ANDROPERATOR_OPERATOR_PACKAGE if needed.
# Optional: ANDROPERATOR_SMOKE_SUMMARY=/path/to/summary.json to write a machine-readable JSON summary.
set -euo pipefail

cd "$(dirname "$0")/.."

# Android UI engine unit tests live in Gradle module :shared:test (not :shared:data:task).
# Example: ./gradlew :shared:test:testDebugUnitTest --tests "*UiActionEngineDefaultTest*"

# 0) Build node CLI
npm --prefix apps/node run build

# 1) Device selection:
# - If DEVICE_ID is set, use it.
# - If unset and exactly one device is connected, auto-select it.
# - If unset and multiple devices are connected, fail and ask for DEVICE_ID.
# NOTE: Do not commit personal device serials to this repository.
export DEVICE_ID="${DEVICE_ID:-}"

# 2) Set operator package (edit if needed)
export ANDROPERATOR_OPERATOR_PACKAGE="${ANDROPERATOR_OPERATOR_PACKAGE:-com.androperator.operator.dev}"
# 3) Baseline app package should be broadly available on Android devices.
export BASELINE_APP_PACKAGE="${BASELINE_APP_PACKAGE:-com.android.settings}"

SMOKE_SUMMARY="${ANDROPERATOR_SMOKE_SUMMARY:-}"
OUTCOMES_FILE=""
if [ -n "$SMOKE_SUMMARY" ]; then
  OUTCOMES_FILE=$(mktemp)
  trap 'rm -f "$OUTCOMES_FILE"' EXIT
fi
SMOKE_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

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

# 4) Sanity checks
echo "=== devices ==="
"${CLI[@]}" devices
echo "=== packages list (third-party) ==="
PACKAGES_JSON="$("${CLI[@]}" packages list --device "$DEVICE_ID" --third-party)"
echo "$PACKAGES_JSON" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(JSON.stringify(d, null, 2));'

if ! echo "$PACKAGES_JSON" | grep -q "\"$ANDROPERATOR_OPERATOR_PACKAGE\""; then
  echo "ERROR: operator package not found in packages list: $ANDROPERATOR_OPERATOR_PACKAGE" >&2
  exit 1
fi
# Baseline may be system app (e.g. com.android.settings); check full list if not in third-party
if ! echo "$PACKAGES_JSON" | grep -q "\"$BASELINE_APP_PACKAGE\""; then
  PACKAGES_ALL="$("${CLI[@]}" packages list --device "$DEVICE_ID" 2>/dev/null)" || true
  if ! echo "${PACKAGES_ALL:-}" | grep -q "\"$BASELINE_APP_PACKAGE\""; then
    echo "ERROR: baseline app package not found: $BASELINE_APP_PACKAGE" >&2
    exit 1
  fi
fi
echo "Package precheck passed: operator package + baseline app present."

# 5) Minimal direct exec (close/open/sleep/snapshot)
SMOKE_JSON="/tmp/androperator-smoke-exec.json"
cat > "$SMOKE_JSON" <<JSON
{
  "commandId": "smoke-cmd-1",
  "taskId": "smoke-task-1",
  "source": "smoke-test",
  "expectedFormat": "android-ui-automator",
  "timeoutMs": 60000,
  "actions": [
    { "id": "close", "type": "close_app", "params": { "applicationId": "$BASELINE_APP_PACKAGE" } },
    { "id": "open", "type": "open_app", "params": { "applicationId": "$BASELINE_APP_PACKAGE" } },
    { "id": "wait", "type": "sleep", "params": { "durationMs": 3000 } },
    { "id": "snap", "type": "snapshot_ui" }
  ]
}
JSON

echo "=== exec (minimal) ==="
if [ -n "$SMOKE_SUMMARY" ]; then
  EXEC_JSON="$("${CLI[@]}" exec --device "$DEVICE_ID" --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE" --execution "$SMOKE_JSON" 2>&1)" || true
  echo "$EXEC_JSON" | node -e 'const d=require("fs").readFileSync(0,"utf8"); try { const j=JSON.parse(d); console.log(JSON.stringify({ step: "exec", result: j.terminalSource ? "ok" : (j.code === "RESULT_ENVELOPE_TIMEOUT" ? "timeout" : "error"), terminalSource: j.terminalSource || undefined, timeoutDiagnostics: j.code === "RESULT_ENVELOPE_TIMEOUT" ? j : undefined })); } catch(e) { console.log(JSON.stringify({ step: "exec", result: "error" })); }' >> "$OUTCOMES_FILE"
  echo "$EXEC_JSON" | node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2))'
else
  EXEC_OUT="$("${CLI[@]}" exec --device "$DEVICE_ID" --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE" --execution "$SMOKE_JSON")" || true
  echo "$EXEC_OUT"
fi
# Stage 1: timeout with correct diagnostics is acceptable; continue to snapshot
if [ -n "$SMOKE_SUMMARY" ]; then
  EXEC_OUT="$EXEC_JSON"
fi
if echo "$EXEC_OUT" | grep -q '"terminalSource"'; then
  echo "Execute succeeded with terminal envelope (record terminalSource above)."
elif echo "$EXEC_OUT" | grep -q 'RESULT_ENVELOPE_TIMEOUT'; then
  echo "Execute timed out (diagnostics above); continuing to snapshot."
else
  echo "Execute failed with unexpected error; exiting." >&2
  exit 1
fi

# 6) Snapshot check
echo "=== snapshot ==="
if [ -n "$SMOKE_SUMMARY" ]; then
  SNAP_JSON="$("${CLI[@]}" snapshot --device "$DEVICE_ID" --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE" 2>&1)" || true
  echo "$SNAP_JSON" | node -e 'const d=require("fs").readFileSync(0,"utf8"); try { const j=JSON.parse(d); console.log(JSON.stringify({ step: "snapshot", result: j.terminalSource ? "ok" : (j.code === "RESULT_ENVELOPE_TIMEOUT" ? "timeout" : "error"), terminalSource: j.terminalSource || undefined, timeoutDiagnostics: j.code === "RESULT_ENVELOPE_TIMEOUT" ? j : undefined })); } catch(e) { console.log(JSON.stringify({ step: "snapshot", result: "error" })); }' >> "$OUTCOMES_FILE"
  echo "$SNAP_JSON" | node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2))'
  SNAP_OUT="$SNAP_JSON"
else
  SNAP_OUT="$("${CLI[@]}" snapshot --device "$DEVICE_ID" --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE")" || true
  echo "$SNAP_OUT"
fi
if echo "$SNAP_OUT" | grep -q '"terminalSource"'; then echo "Snapshot: record terminalSource above."; fi
if echo "$SNAP_OUT" | grep -q 'RESULT_ENVELOPE_TIMEOUT'; then echo "Snapshot: timeout (diagnostics above)."; fi

# 7) Optional action wrapper checks (may vary by OEM/locale and should not fail the entire smoke)
echo "=== read (optional) ==="
if ! "${CLI[@]}" read \
  --device "$DEVICE_ID" \
  --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE" \
  --id "android:id/title"; then
  echo "WARN: optional read failed on this device/locale; continuing."
fi

echo "=== type (optional) ==="
if ! "${CLI[@]}" type \
  --device "$DEVICE_ID" \
  --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE" \
  --role "textfield" \
  --text "test"; then
  echo "WARN: optional type failed (expected on some screens); continuing."
fi

if [ -n "$SMOKE_SUMMARY" ]; then
  SUMMARY_PATH="$SMOKE_SUMMARY" \
  OUTCOMES_PATH="$OUTCOMES_FILE" \
  SUMMARY_TIMESTAMP="$SMOKE_TIMESTAMP" \
  SUMMARY_DEVICE_ID="$DEVICE_ID" \
  SUMMARY_OPERATOR_PACKAGE="$ANDROPERATOR_OPERATOR_PACKAGE" \
  SUMMARY_STRICT_MODE="true" \
  node -e '
    const fs = require("fs");
    const path = process.env.SUMMARY_PATH;
    const outcomesPath = process.env.OUTCOMES_PATH;
    if (!path || !outcomesPath) {
      console.error("Missing SUMMARY_PATH or OUTCOMES_PATH");
      process.exit(1);
    }
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
    const lines = fs.readFileSync(outcomesPath, "utf8").trim().split("\n").filter(Boolean);
    const commandOutcomes = lines.map((l) => JSON.parse(l));
    const summary = {
      ...existing,
      timestamp: process.env.SUMMARY_TIMESTAMP,
      deviceId: process.env.SUMMARY_DEVICE_ID,
      operatorPackage: process.env.SUMMARY_OPERATOR_PACKAGE,
      commandOutcomes,
      strictMode: process.env.SUMMARY_STRICT_MODE === "true",
    };
    fs.writeFileSync(path, JSON.stringify(summary, null, 2));
    console.log("Wrote smoke summary to", path);
  '
fi
echo "=== smoke done ==="
