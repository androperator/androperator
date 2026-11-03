#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
bash "$source_dir/fixture/build.sh" "$build/fixture.apk"
"$sdk/build-tools/35.0.0/apksigner" verify "$build/fixture.apk"
