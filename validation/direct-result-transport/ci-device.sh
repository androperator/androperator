#!/usr/bin/env bash
set -euo pipefail
serial="$(adb devices | awk '$2 == "device" { print $1; exit }')"
test -n "$serial"
mkdir -p artifacts/direct-result-transport
node apps/node/dist/cli/index.js operator setup --apk apps/android/app/build/outputs/apk/debug/app-debug.apk --device "$serial" --operator-package com.clawperator.operator.dev
adb -s "$serial" shell am start -a android.settings.SETTINGS
node validation/direct-result-transport/probe.mjs --device "$serial" --transport logcat > artifacts/direct-result-transport/logcat.jsonl
node validation/direct-result-transport/probe.mjs --device "$serial" --transport direct > artifacts/direct-result-transport/direct.jsonl
