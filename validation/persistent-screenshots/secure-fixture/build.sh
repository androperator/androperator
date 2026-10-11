#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
output=${1:?Usage: build.sh /absolute/output.apk}
[[ "$output" = /* ]] || { echo 'Output must be absolute' >&2; exit 2; }
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
platform="$sdk/platforms/android-35/android.jar"
build_tools="$sdk/build-tools/35.0.0"
javac --release 8 -cp "$platform" -d "$build" "$source_dir/CapturePolicyActivity.java"
"$build_tools/d8" --min-api 28 --lib "$platform" --output "$build" "$build/com/androperator/capturefixture/"*.class
"$build_tools/aapt2" link -I "$platform" --manifest "$source_dir/AndroidManifest.xml" -o "$build/unsigned.apk"
zip -q -j "$build/unsigned.apk" "$build/classes.dex"
"$build_tools/zipalign" -f 4 "$build/unsigned.apk" "$build/aligned.apk"
keytool -genkeypair -keystore "$build/test.keystore" -storepass capture-test -keypass capture-test -alias fixture -keyalg RSA -validity 1 -dname 'CN=Local Capture Fixture' >/dev/null 2>&1
"$build_tools/apksigner" sign --ks "$build/test.keystore" --ks-pass pass:capture-test --out "$output" "$build/aligned.apk"
