#!/usr/bin/env bash
set -euo pipefail
serial="$(adb devices | awk '$2 == "device" { print $1; exit }')"
test -n "$serial"
node apps/node/dist/cli/index.js operator setup --apk apps/android/app/build/outputs/apk/debug/app-debug.apk --device "$serial" --operator-package com.androperator.operator.dev
adb -s "$serial" install -r validation/notifications-media/fixture/build/outputs/apk/debug/notification-media-fixture-debug.apk
adb -s "$serial" shell pm grant com.androperator.fixture.media android.permission.POST_NOTIFICATIONS
python3 validation/notifications-media/run.py --device "$serial" --output artifacts/notifications-media --secure-lock --controls
python3 validation/notifications-media/mutations.py --device "$serial" --output artifacts/notifications-media/mutations
python3 validation/notifications-media/ingress-shade.py --device "$serial" --output artifacts/notifications-media/ingress-shade
python3 validation/notifications-media/first-unlock.py --device "$serial" --output artifacts/notifications-media/first-unlock
