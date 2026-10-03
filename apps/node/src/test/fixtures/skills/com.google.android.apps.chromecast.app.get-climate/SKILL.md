---
name: com.google.android.apps.chromecast.app.get-climate
androperator-skill-type: replay
description: Read Google Home climate unit status (power/mode/indoor temp) on Android using ActionTask generic agent actions. Use when asked for current climate control status.
---

Use the skill-local script:

```bash
cd "$(git rev-parse --show-toplevel)"
CLIMATE_TILE_NAME="YOUR_TILE_NAME" ./skills/com.google.android.apps.chromecast.app.get-climate/scripts/get_climate_status.sh
```

Optional custom card label:

```bash
./skills/com.google.android.apps.chromecast.app.get-climate/scripts/get_climate_status.sh app.actiontask.operator.development "YOUR_TILE_NAME"
```

Expected output:

`HVAC status (...): power=<...>, mode=<...>, indoor_temp=<...>`

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
