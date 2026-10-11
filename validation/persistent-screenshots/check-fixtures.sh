#!/usr/bin/env bash
# Compile first-party live-test fixtures in CI without installing or contacting a device.
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
javac --release 8 -cp "$sdk/platforms/android-35/android.jar" -d "$build" "$source_dir/CaptureApiProbe.java"
javac --release 8 -cp "$sdk/platforms/android-35/android.jar" -d "$build" "$source_dir/../../apps/capture-helper/CaptureHelper.java" "$source_dir/CaptureSafetyTest.java"
java -cp "$build:$sdk/platforms/android-35/android.jar" CaptureSafetyTest
"$sdk/build-tools/35.0.0/d8" --min-api 28 --lib "$sdk/platforms/android-35/android.jar" --output "$build" "$build/CaptureApiProbe.class"
bash "$source_dir/secure-fixture/build.sh" "$build/fixture.apk"
"$sdk/build-tools/35.0.0/apksigner" verify "$build/fixture.apk"
