#!/usr/bin/env bash
set -euo pipefail

usage() {
    echo 'Usage: run_cli_contract_proof.sh --device <device_serial> --output-dir <absolute_path>'
}
device=''
output_dir=''
while [[ $# -gt 0 ]]; do
    case "$1" in
        --device|--output-dir)
            [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { usage >&2; exit 2; }
            if [[ "$1" == --device ]]; then
                [[ -z "$device" ]] || exit 2
                device="$2"
            else
                [[ -z "$output_dir" ]] || exit 2
                output_dir="$2"
            fi
            shift 2 ;;
        --help|-h) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done
[[ -n "$device" && "$output_dir" == /* ]] || { usage >&2; exit 2; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Executable injection is for the offline harness tests; production uses the checkout build.
cli=(node "$repo_root/apps/node/dist/cli/index.js")
if [[ -n "${ANDROPERATOR_CLI_PROOF_EXECUTABLE:-}" ]]; then cli=("$ANDROPERATOR_CLI_PROOF_EXECUTABLE"); fi
common=(--device "$device" --operator-package com.androperator.operator.dev --output json --no-daemon)
adb_cmd=(adb -s "$device")
mkdir -p "$output_dir"
printf 'case\texit_status\tassertion\n' > "$output_dir/results.tsv"
printf 'image\texpected_label\tvisual_review\n' > "$output_dir/captures.tsv"
settings_saved=false
restore_setting() {
    local namespace="$1" key="$2" value="$3"
    if [[ -z "$value" || "$value" == null ]]; then
        "${adb_cmd[@]}" shell settings delete "$namespace" "$key" > /dev/null
    else
        "${adb_cmd[@]}" shell settings put "$namespace" "$key" "$value" > /dev/null
    fi
    local actual expected="$value"
    [[ -n "$expected" ]] || expected=null
    actual="$("${adb_cmd[@]}" shell settings get "$namespace" "$key" | tr -d '\r')"
    printf '%s\t%s\t%s\t%s\n' "$namespace" "$key" "$expected" "$actual" >> "$output_dir/settings-restoration.tsv"
    [[ "$actual" == "$expected" ]] || { echo "Setting verification failed: $namespace $key" >&2; return 1; }
}
cleanup() {
    local status=$?
    trap - EXIT INT TERM
    local cleanup_status=0
    if $settings_saved; then
        restore_setting system accelerometer_rotation "$original_rotation_auto" || cleanup_status=1
        restore_setting system user_rotation "$original_rotation" || cleanup_status=1
        restore_setting system font_scale "$original_font_scale" || cleanup_status=1
        restore_setting secure enabled_accessibility_services "$original_services" || cleanup_status=1
        restore_setting secure accessibility_enabled "$original_accessibility" || cleanup_status=1
    fi
    "${cli[@]}" on-screen-log clear "${common[@]}" > "$output_dir/cleanup.json" 2> "$output_dir/cleanup.stderr" || cleanup_status=$?
    python3 - "$output_dir/cleanup.json" <<'PYCLEAN' || cleanup_status=1
import json, sys
result = json.load(open(sys.argv[1]))['envelope']
assert result['status'] == 'success'
assert result['stepResults'][0]['success'] and result['stepResults'][0]['data'] == {'visible': 'false'}
PYCLEAN
    printf 'cleanup\t%s\tclear\n'   "$cleanup_status" >> "$output_dir/results.tsv"
    if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then status=$cleanup_status; fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_case() {
    local name="$1" expectation="$2" status=0
    shift 2
    printf '%q ' "${cli[@]}" "$@" "${common[@]}" > "$output_dir/$name.command"
    printf '\n' >> "$output_dir/$name.command"
    "${cli[@]}" "$@" "${common[@]}" > "$output_dir/$name.json" 2> "$output_dir/$name.stderr" || status=$?
    local assertion=0
    python3 - "$output_dir/$name.json" "$expectation" "$status" <<'PY' || assertion=$?
import json, sys
value = json.load(open(sys.argv[1]))
expectation, status = sys.argv[2], int(sys.argv[3])
if expectation.startswith('failure:'):
    assert status != 0, 'invalid input unexpectedly succeeded'
    envelope = value.get('envelope', {})
    code = value.get('code') or envelope.get('errorCode')
    assert code == expectation.split(':', 1)[1], value
else:
    assert status == 0, value
    envelope = value.get('envelope', value)
    assert envelope.get('status') == 'success', value
    steps = envelope.get('stepResults', [])
    assert steps and all(step['success'] for step in steps), value
    for step in steps:
        assert all(isinstance(v, str) for v in step['data'].values()), step
    data = steps[0]['data']
    if expectation == 'set':
        assert data.get('visible') == 'true' and data.get('rendered') == 'true', data
    elif expectation == 'clear':
        assert data == {'visible': 'false'}, data
PY
    printf '%s\t%s\t%s\n' "$name" "$status" "$assertion" >> "$output_dir/results.tsv"
    [[ $assertion -eq 0 ]]
}
set_label() { local name="$1" label="$2"; shift 2; run_case "$name" set on-screen-log set --text "$label" "$@"; }
capture() {
    local name="$1" label="$2"
    run_case "$name" success screenshot --path "$output_dir/$name.png"
    [[ -s "$output_dir/$name.png" ]] || { echo "Missing capture: $name" >&2; return 1; }
    printf '%s.png\t%s\tpending\n' "$name" "$label" >> "$output_dir/captures.tsv"
}
"${adb_cmd[@]}" get-state > "$output_dir/device-state.txt"
original_rotation_auto="$("${adb_cmd[@]}" shell settings get system accelerometer_rotation | tr -d '\r')"
original_rotation="$("${adb_cmd[@]}" shell settings get system user_rotation | tr -d '\r')"
original_font_scale="$("${adb_cmd[@]}" shell settings get system font_scale | tr -d '\r')"
original_services="$("${adb_cmd[@]}" shell settings get secure enabled_accessibility_services | tr -d '\r')"
original_accessibility="$("${adb_cmd[@]}" shell settings get secure accessibility_enabled | tr -d '\r')"
settings_saved=true
printf '%s\n' "$original_rotation_auto" "$original_rotation" "$original_font_scale" "$original_services" "$original_accessibility" > "$output_dir/original-settings.txt"
run_case baseline success snapshot
"${adb_cmd[@]}" shell dumpsys window > "$output_dir/windows-before.txt"
set_label defaults 'CLI-DEFAULTS'
capture defaults-image 'CLI-DEFAULTS'
for anchor in left right; do
    for alignment in left right; do
        label="CLI-$anchor-$alignment"
        set_label "$label" "$label" --anchor "$anchor" --text-align "$alignment" --top-offset-dp 24 --edge-offset-dp 12 --width-dp 180 --text-color '#a1b2c3' --background-color '#7f0a0b0c'
        capture "$label-image" "$label"
    done
done
set_label zero-offsets 'CLI-ZERO' --top-offset-dp 0 --edge-offset-dp 0 --ttl-ms 1e3
set_label multiline $'CLI-MULTILINE\nSecond line with enough words to wrap within the narrow panel' --width-dp 80
capture multiline-image 'CLI-MULTILINE (wrapped)'
long_text="$(python3 -c 'print("CLI-TRUNCATION\n" + "line\n" * 250, end="")')"
set_label truncation "$long_text" --font-size-sp 24 --width-dp 80
python3 - "$output_dir/truncation.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1]))['envelope']['stepResults'][0]['data']['truncated'] == 'true'
PY
capture truncation-image 'CLI-TRUNCATION (final line ellipsized)'
run_case invalid-layout failure:ON_SCREEN_LOG_LAYOUT_INVALID on-screen-log set --text CLI-INVALID --edge-offset-dp 1000
run_case missing-text failure:USAGE on-screen-log set
run_case invalid-number failure:USAGE on-screen-log set --text CLI-INVALID --width-dp 12px
run_case clear-panel-option failure:USAGE on-screen-log clear --text CLI-INVALID
run_case clear-first clear on-screen-log clear
run_case clear-second clear on-screen-log clear
set_label ttl 'CLI-TTL' --ttl-ms 1000
# This waits for expiry, never for draw or capture acknowledgement.
sleep 2
run_case ttl-expired success snapshot
python3 - "$output_dir/ttl-expired.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1]))['envelope']['stepResults'][0]['data']['operator_overlay_visible'] == 'false'
PY
set_label replacement-expiry-old 'CLI-EXPIRY-OLD' --ttl-ms 10000
set_label replacement-expiry-new 'CLI-EXPIRY-NEW' --ttl-ms 60000
sleep 11
run_case replacement-expiry-visible success snapshot
python3 - "$output_dir/replacement-expiry-visible.json" <<'PYASSERT'
import json, sys
assert json.load(open(sys.argv[1]))['envelope']['stepResults'][0]['data']['operator_overlay_visible'] == 'true'
PYASSERT
capture replacement-expiry-image 'CLI-EXPIRY-NEW'
set_label rotated 'CLI-ROTATED' --width-dp 180
"${adb_cmd[@]}" shell dumpsys input > "$output_dir/rotation-before.txt"
"${adb_cmd[@]}" shell settings put system accelerometer_rotation 0
"${adb_cmd[@]}" shell settings put system user_rotation 1
# Configuration changes are asynchronous; preserve the existing panel during the transition.
sleep 2
[[ "$("${adb_cmd[@]}" shell settings get system user_rotation | tr -d '\r')" == 1 ]]
"${adb_cmd[@]}" shell dumpsys input > "$output_dir/rotation-after.txt"
python3 - "$output_dir/rotation-after.txt" <<'PYROTATION'
import re, sys
text = open(sys.argv[1]).read()
assert re.search(r'SurfaceOrientation:\s*1|orientation=1', text), 'Display did not rotate to orientation 1'
PYROTATION
run_case rotated-existing-panel success snapshot
python3 - "$output_dir/rotated-existing-panel.json" <<'PYASSERT'
import json, sys
assert json.load(open(sys.argv[1]))['envelope']['stepResults'][0]['data']['operator_overlay_visible'] == 'true'
PYASSERT
capture rotated-image 'CLI-ROTATED'
restore_setting system user_rotation "$original_rotation"
restore_setting system accelerometer_rotation "$original_rotation_auto"
"${adb_cmd[@]}" shell settings put system font_scale 1.5
set_label font-scale 'CLI-FONT-SCALE' --width-dp 180
capture font-scale-image 'CLI-FONT-SCALE'
restore_setting system font_scale "$original_font_scale"
set_label before-service-restart 'CLI-BEFORE-RESTART'
service_component='com.androperator.operator.dev/androperator.operator.accessibilityservice.OperatorAccessibilityService'
services_without_operator="$(python3 - "$original_services" "$service_component" <<'PYFILTER'
import sys
print(':'.join(s for s in sys.argv[1].split(':') if s != sys.argv[2]))
PYFILTER
)"
restore_setting secure enabled_accessibility_services "$services_without_operator"
current_services="$("${adb_cmd[@]}" shell settings get secure enabled_accessibility_services | tr -d '\r')"
[[ "$current_services" != *"$service_component"* ]] || { echo 'Operator service remained enabled' >&2; exit 1; }
sleep 1
restore_setting secure enabled_accessibility_services "$original_services"
# Service reconnection is asynchronous; this bounded wait is unrelated to draw acknowledgement.
sleep 2
run_case after-service-restart success snapshot
python3 - "$output_dir/after-service-restart.json" <<'PYASSERT'
import json, sys
assert json.load(open(sys.argv[1]))['envelope']['stepResults'][0]['data']['operator_overlay_visible'] == 'false'
PYASSERT
for cycle in $(seq 1 10); do
    # Each command is separately awaited. There is deliberately no retry or capture delay.
    set_label "cycle-$cycle-set" "CLI-CYCLE-$cycle-A"
    capture "cycle-$cycle-a" "CLI-CYCLE-$cycle-A"
    set_label "cycle-$cycle-replace" "CLI-CYCLE-$cycle-B" --anchor right
    capture "cycle-$cycle-b" "CLI-CYCLE-$cycle-B"
    run_case "cycle-$cycle-clear" clear on-screen-log clear
done
run_case after-clear success snapshot
"${adb_cmd[@]}" shell dumpsys window > "$output_dir/windows-after.txt"
cat > "$output_dir/review-required.txt" <<'REVIEW'
Machine assertions passed. Review every captures.tsv image and record visible/missing/stale labels.
This harness does not claim visual verification from draw acknowledgements.
Supplement with playable replacement/clear video, app bounds/foreground and interaction comparisons,
read/wait selector exclusion, and another real dialog/overlay. Restore any settings changed during
those supplemental checks. Lifecycle/rotation/font-scale command evidence is retained separately.
Until these reviews and supplemental checks pass, the live acceptance gate remains pending.
REVIEW
echo "CLI contract artifacts: $output_dir; visual and supplemental gates remain pending."
