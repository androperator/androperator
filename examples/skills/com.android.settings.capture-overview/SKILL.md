---
name: com.android.settings.capture-overview
description: Observe Settings using current-agent decisions and verified Android evidence.
---

# Observe Settings

Use when the user wants a minimal Android observation example. You are the
current agent: call Androperator directly, without launching another agent.

1. Read the setup guide and check `androperator devices`. Select an explicit
   authorized target; require doctor readiness with the matching CLI/APK.
2. Run `androperator open com.android.settings --device <device_serial> --operator-package <operator_package>` and
   `androperator snapshot --device <device_serial> --operator-package <operator_package> --output json`.
3. Check process exit, `envelope.status`, and every step's `success`; inspect
   actual Settings labels in the hierarchy. Preserve command/task correlation.
4. Report the observed screen and retain failures locally. Do not claim Android
   version extraction from an overview or a successful process exit alone.

Opening Settings can resume its previous screen. Do not imply root-start proof
unless you observed it. Permissions, device consent, and sign-in can require the
user. Stop dependent work when readiness or observation fails.

Use `com.androperator.operator` for a published pair, or
`com.androperator.operator.dev` with the branch-local CLI and development APK.
