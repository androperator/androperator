#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
serial="$(adb get-serialno)"
export CLAWPERATOR_LOG_DIR="$PWD/artifacts/drag-drop/logs"
mkdir -p artifacts/drag-drop
node apps/node/dist/cli/index.js operator setup \
  --apk apps/android/app/build/outputs/apk/debug/app-debug.apk \
  --device "$serial" --operator-package com.clawperator.operator.dev
adb -s "$serial" shell am start -n com.clawperator.operator.dev/clawperator.activity.MainActivity
# This workflow runs on a disposable Google Play emulator, never a user's launcher.
adb -s "$serial" shell pm clear com.google.android.apps.nexuslauncher
node apps/node/dist/cli/index.js press home --device "$serial" --operator-package com.clawperator.operator.dev --no-daemon
node apps/node/dist/cli/index.js snapshot --device "$serial" --operator-package com.clawperator.operator.dev \
  --no-daemon --raw-path "$PWD/artifacts/drag-drop/setup.xml" > artifacts/drag-drop/setup.json
read -r target_x target_y < <(python3 - <<'PY'
import re
import xml.etree.ElementTree as E
root = E.parse('artifacts/drag-drop/setup.xml')
workspace = next(n for n in root.iter('node') if n.get('resource-id') == 'com.google.android.apps.nexuslauncher:id/workspace')
icons = [n for n in workspace.iter('node') if n.get('text') == 'Play Store' and n.get('visible-to-user') == 'true']
assert len(icons) == 1, 'Expected a unique visible Play Store workspace icon'
x1, y1, x2, y2 = map(int, re.findall(r'\d+', icons[0].get('bounds')))
# The fresh Pixel Launcher has blank rows above its app shortcuts.
print((x1+x2)//2, (y1+y2)//2 - 2*(y2-y1))
PY
)
node validation/drag-drop/run.mjs --device "$serial" --label 'Play Store' \
  --x "$target_x" --y "$target_y" --output-dir artifacts/drag-drop/round-trip --restore
