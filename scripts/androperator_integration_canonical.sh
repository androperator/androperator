#!/usr/bin/env bash
# Opt-in real-device integration check: compile known artifact, exec, assert canonical envelope.
# Gate: run only when ANDROPERATOR_RUN_INTEGRATION=1 so CI stays stable with no device.
# Usage: ANDROPERATOR_RUN_INTEGRATION=1 [DEVICE_ID=...] ./scripts/androperator_integration_canonical.sh
set -euo pipefail

if [ "${ANDROPERATOR_RUN_INTEGRATION:-0}" != "1" ]; then
  echo "Skipping integration (ANDROPERATOR_RUN_INTEGRATION not 1)"
  exit 0
fi

cd "$(dirname "$0")/.."

npm --prefix apps/node run build

export DEVICE_ID="${DEVICE_ID:-}"
export ANDROPERATOR_OPERATOR_PACKAGE="${ANDROPERATOR_OPERATOR_PACKAGE:-com.androperator.operator.dev}"
SKILL_ID="${SKILL_ID:-com.google.android.apps.chromecast.app.get-climate}"
ARTIFACT_NAME="${ARTIFACT_NAME:-climate-status}"
CLIMATE_TILE_NAME="${CLIMATE_TILE_NAME:-Master}"

CLI=(node apps/node/dist/cli/index.js)

echo "=== integration: compile artifact ==="
"${CLI[@]}" skills compile-artifact "$SKILL_ID" --artifact "$ARTIFACT_NAME" --vars "{\"CLIMATE_TILE_NAME\":\"$CLIMATE_TILE_NAME\"}" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.execution) process.exit(1); require("fs").writeFileSync("/tmp/androperator-integration-exec.json", JSON.stringify(d.execution));'

echo "=== integration: exec on device ==="
EXEC_OUT="$("${CLI[@]}" exec --device "$DEVICE_ID" --operator-package "$ANDROPERATOR_OPERATOR_PACKAGE" --execution /tmp/androperator-integration-exec.json 2>&1)" || true

echo "$EXEC_OUT" | node -e '
const data = require("fs").readFileSync(0, "utf8");
let j;
try { j = JSON.parse(data); } catch (e) { console.error("Invalid JSON:", e.message); process.exit(2); }
if (j.code && j.code !== "USAGE") {
  console.error("Exec failed:", j.code, j.message || "");
  process.exit(3);
}
if (j.terminalSource !== "androperator_result") {
  console.error("Expected terminalSource=androperator_result, got:", j.terminalSource);
  process.exit(4);
}
if (!j.envelope || j.envelope.status !== "success") {
  console.error("Expected envelope.status=success, got:", j.envelope?.status);
  process.exit(5);
}
console.log("Integration OK: terminalSource=androperator_result, status=success");
'
exit $?
