#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: validation/on-screen-logs/run_overlay_mechanism_proof.sh --device <device_serial> --output-dir <absolute_path>

Runs the debug-only overlay-mechanism proof. The selected device must already have the branch's
debug Operator APK installed and its accessibility service enabled. Output captures are local
validation artifacts and must not be committed.
EOF
}

device=""
output_dir=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --device)
            device="${2:-}"
            shift 2
            ;;
        --output-dir)
            output_dir="${2:-}"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            usage >&2
            exit 2
            ;;
    esac
done

if [[ -z "$device" || -z "$output_dir" || "$output_dir" != /* ]]; then
    usage >&2
    exit 2
fi

adb_cmd=(adb -s "$device")
proof_component="com.androperator.operator.dev/androperator.operator.debug.OnScreenLogProofActivity"
service_component="com.androperator.operator.dev/androperator.operator.accessibilityservice.OperatorAccessibilityService"
remote_video="/sdcard/on-screen-log-overlay-proof.mp4"

"${adb_cmd[@]}" get-state >/dev/null
if ! "${adb_cmd[@]}" shell dumpsys accessibility | grep -Fq "$service_component"; then
    echo "The debug Operator accessibility service is not enabled on $device." >&2
    exit 1
fi

mkdir -p "$output_dir"
"${adb_cmd[@]}" shell dumpsys accessibility > "$output_dir/accessibility-before.txt"
"${adb_cmd[@]}" shell am start -W -a android.settings.SETTINGS >/dev/null
"${adb_cmd[@]}" exec-out screencap -p > "$output_dir/baseline.png"
"${adb_cmd[@]}" shell screenrecord --help >/dev/null 2>&1
"${adb_cmd[@]}" shell rm -f "$remote_video"
"${adb_cmd[@]}" shell screenrecord --time-limit 8 "$remote_video" &
recording_pid=$!

run_scenario() {
    "${adb_cmd[@]}" shell am start -W -n "$proof_component" --es scenario "$1" >/dev/null
}

run_scenario left
# The controller's draw acknowledgement has already completed before each activity finishes.
# These pauses make both labels legible in the recording; they do not acknowledge rendering.
sleep 1
"${adb_cmd[@]}" exec-out screencap -p > "$output_dir/left.png"
"${adb_cmd[@]}" shell dumpsys window > "$output_dir/window-left.txt"
"${adb_cmd[@]}" shell input swipe 540 1800 540 700 250
run_scenario right
sleep 1
"${adb_cmd[@]}" exec-out screencap -p > "$output_dir/right.png"
"${adb_cmd[@]}" shell dumpsys window > "$output_dir/window-right.txt"
run_scenario clear

wait "$recording_pid"
"${adb_cmd[@]}" pull "$remote_video" "$output_dir/on-screen-log-overlay-proof.mp4" >/dev/null
"${adb_cmd[@]}" shell rm -f "$remote_video"
"${adb_cmd[@]}" shell dumpsys window > "$output_dir/window-after-clear.txt"
"${adb_cmd[@]}" shell dumpsys accessibility > "$output_dir/accessibility-after.txt"

echo "Overlay-mechanism proof captures written to $output_dir"
