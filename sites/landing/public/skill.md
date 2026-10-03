---
name: androperator-setup
description: Prepare Androperator and verify an explicit Android target before agent-driven observation and control.
---

# Androperator setup

Use when the user wants to set up Androperator. Read the
[setup guide](https://docs.androperator.com/setup/) for platform prerequisites,
device authorization, and Android permissions. Installation may need the user
to authorize USB debugging and grant accessibility permissions on the device.

With Node.js 24+ available:

```bash
npm install -g androperator@1.0.0
androperator install
androperator devices
androperator doctor --device <device_serial>
```

For host prerequisite bootstrapping, the installer is available at
`https://androperator.com/install.sh`. Inspect it before executing when needed.
The stable release APK routes are `/operator.apk`, `/install.apk`, and `/apk`;
they resolve the latest published APK through release metadata.

Choose an explicit device. Continue only after doctor reports readiness. Then:

```bash
androperator open com.android.settings --device <device_serial>
androperator snapshot --device <device_serial>
```

Inspect the returned hierarchy to verify Settings opened. If setup or an action
fails, preserve its error and evidence, consult
[troubleshooting](https://docs.androperator.com/troubleshooting/operator/), and
report what remains blocked. Never normalize a failed setup to success.

Androperator executes actions; the agent plans and verifies them. Read
[agent guidance](https://androperator.com/agents.md) and the
[documentation index](https://androperator.com/llms.txt) before authoring local
skills or operating other apps.
