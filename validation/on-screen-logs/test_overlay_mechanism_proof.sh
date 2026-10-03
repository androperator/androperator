#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proof="$script_dir/run_overlay_mechanism_proof.sh"

# Fixed scenarios still mutate the shared panel and must reject ordinary app callers.
python3 - "$script_dir/../../apps/android/shared/data/operator/src/debug/AndroidManifest.xml" <<'PY'
import sys
import xml.etree.ElementTree as ET

android = '{http://schemas.android.com/apk/res/android}'
activities = ET.parse(sys.argv[1]).getroot().findall('application/activity')
activity = next(item for item in activities if item.get(android + 'name') ==
                'androperator.operator.debug.OnScreenLogProofActivity')
assert activity.get(android + 'exported') == 'true', 'ADB proof activity must remain exported'
assert activity.get(android + 'permission') == 'android.permission.DUMP', \
    'Overlay proof activity must require the same privileged ingress permission'
PY

bash -n "$proof"
help_output="$($proof --help)"
grep -Fq -- '--device <device_serial>' <<<"$help_output"
grep -Fq -- '--output-dir <absolute_path>' <<<"$help_output"
if grep -Fq 'set_on_screen_log' "$proof"; then
    echo "The overlay-mechanism proof must not introduce a raw action ingress." >&2
    exit 1
fi
