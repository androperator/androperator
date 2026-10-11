#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
javac --release 8 -cp "$sdk/platforms/android-36/android.jar" -d "$build" "$root/apps/capture-helper/CaptureHelper.java"
"$sdk/build-tools/36.0.0/d8" --min-api 28 --lib "$sdk/platforms/android-36/android.jar" --output "$build" "$build"/*.class
cp "$build/classes.dex" "$root/apps/node/capture-helper/capture.dex"
node - "$root" <<'JS'
const fs = require('node:fs'), crypto = require('node:crypto');
const root = process.argv[2], dir = root + '/apps/node/capture-helper/';
fs.writeFileSync(dir + 'manifest.json', JSON.stringify({protocol:1,
  sha256:crypto.createHash('sha256').update(fs.readFileSync(dir+'capture.dex')).digest('hex'),
  sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(root+'/apps/capture-helper/CaptureHelper.java')).digest('hex')}, null, 2)+'\n');
JS
