#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
bash "$root/validation/video-rotation/fixture/build.sh" "$temporary/fixture.apk"
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
"$sdk/build-tools/35.0.0/apksigner" verify "$temporary/fixture.apk"
python3 -c 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())' "$root/validation/video-rotation/run.py"
