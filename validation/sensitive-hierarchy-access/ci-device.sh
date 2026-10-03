#!/usr/bin/env bash
set -euo pipefail
# Revision is deliberately pinned. A new Settings image requires renewed A/B proof.
python3 - "$ANDROID_HOME/system-images/android-35/google_apis/x86_64/source.properties" <<'PY'
from pathlib import Path
import sys
values = dict(line.split('=', 1) for line in Path(sys.argv[1]).read_text().splitlines() if '=' in line)
assert values['Pkg.Revision'].strip() == '9', values
assert values['AndroidVersion.ApiLevel'].strip() == '35', values
PY
serial="$(adb devices | awk '$2 == "device" {print $1}')"
[[ -n "$serial" && "$serial" != *$'\n'* ]]
for variant in debug release; do
  package=com.androperator.operator
  if [[ "$variant" == debug ]]; then package=com.androperator.operator.dev; fi
  python3 validation/sensitive-hierarchy-access/prepare_operator.py --device "$serial" --operator-package "$package" \
    --apk "apps/android/app/build/outputs/apk/$variant/app-$variant.apk" --out "artifacts/sensitive-hierarchy/$variant-setup"
  python3 validation/sensitive-hierarchy-access/run.py --device "$serial" --operator-package "$package" --out "artifacts/sensitive-hierarchy/$variant"
done
