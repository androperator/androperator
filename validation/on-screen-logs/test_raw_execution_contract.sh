#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
cli="$repo_root/apps/node/dist/cli/index.js"

if [[ ! -f "$cli" ]]; then
    echo "Build the branch-local Node package before running this check." >&2
    exit 1
fi

validate_fixture() {
    local fixture="$1"
    node "$cli" exec --validate-only --payload "$fixture" --output json
}

flow_output="$(validate_fixture "$script_dir/raw-flow-001.json")"
baseline_output="$(validate_fixture "$script_dir/raw-baseline-flow.json")"
clear_output="$(validate_fixture "$script_dir/raw-clear.json")"
replacement_output="$(validate_fixture "$script_dir/raw-replacement-flow.json")"
action_alias_output="$(validate_fixture "$script_dir/raw-action-type-aliases.json")"

grep -Fq '"validated":true' <<<"$flow_output"
grep -Fq '"validated":true' <<<"$replacement_output"
grep -Fq '"validated":true' <<<"$baseline_output"
grep -Fq '"validated":true' <<<"$clear_output"
grep -Fq '"validated":true' <<<"$action_alias_output"
grep -Fq '"textColor":"#FFA1B2C3"' <<<"$replacement_output"
grep -Fq '"backgroundColor":"#7F0A0B0C"' <<<"$replacement_output"
grep -Fq '"type":"set_on_screen_log"' <<<"$action_alias_output"
grep -Fq '"type":"clear_on_screen_log"' <<<"$action_alias_output"

if validate_fixture "$script_dir/invalid-value-alias.json" >/dev/null 2>&1; then
    echo "set_on_screen_log must reject generic parameter aliases." >&2
    exit 1
fi

if invalid_output="$(validate_fixture "$script_dir/invalid-intermediate-screenshot.json")"; then
    echo "Intermediate screenshots must be rejected before dispatch." >&2
    exit 1
fi
grep -Fq '"code":"EXECUTION_VALIDATION_FAILED"' <<<"$invalid_output"
grep -Fq 'single final screenshot action' <<<"$invalid_output"
echo "Raw on-screen-log execution contract tests passed."
