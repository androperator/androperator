#!/usr/bin/env bash
# Opt-in device check of direct execution and canonical command/task correlation.
set -euo pipefail
if [ "${ANDROPERATOR_RUN_INTEGRATION:-0}" != "1" ]; then
  echo "Skipping integration (ANDROPERATOR_RUN_INTEGRATION not 1)"
  exit 0
fi
cd "$(dirname "$0")/.."
: "${DEVICE_ID:?Set DEVICE_ID to an explicit connected target}"
OPERATOR_PACKAGE="${ANDROPERATOR_OPERATOR_PACKAGE:-com.androperator.operator.dev}"
npm --prefix apps/node run build
RUN_DIR=$(mktemp -d)
trap 'rm -rf "$RUN_DIR"' EXIT
cat > "$RUN_DIR/execution.json" <<'JSON'
{"commandId":"integration-snapshot","taskId":"integration-direct-execution","source":"integration","expectedFormat":"android-ui-automator","timeoutMs":15000,"actions":[{"id":"snapshot","type":"snapshot"}]}
JSON
node apps/node/dist/cli/index.js exec --device "$DEVICE_ID" --operator-package "$OPERATOR_PACKAGE" --execution "$RUN_DIR/execution.json" > "$RUN_DIR/result.json"
node --input-type=module - "$RUN_DIR/result.json" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const result=JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(result.terminalSource, 'androperator_result');
assert.equal(result.envelope.status, 'success');
assert.equal(result.envelope.commandId, 'integration-snapshot');
assert.equal(result.envelope.taskId, 'integration-direct-execution');
assert.equal(result.envelope.stepResults[0].success, true);
assert.match(result.envelope.stepResults[0].data.text, /<hierarchy/);
console.log('Direct execution and correlation verified.');
JS
