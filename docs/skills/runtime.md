# Device preparation for agent workflows

Use `androperator devices` and select an explicit `--device <device_serial>`.
For local development, build `apps/node`, install the matching debug APK and pass
`--operator-package com.androperator.operator.dev`. Published installations use
`com.androperator.operator`.

Choose the [capability-specific readiness gate](../host-agents.md#choose-readiness)
for the selected pair. Interactive device readiness includes APK presence,
version compatibility, accessibility, handshake and interactive state. A locked
interactive target must produce a truthful blocked outcome; supported background
notification/media operations do not require waking or dismissing keyguard. Do not bypass
readiness, infer an action happened from a process exit, or silently replace
failed evidence with a later success.

The current agent follows instructions through CLI, HTTP or MCP. Helpers are
optional and caller-owned; scheduling and supervision belong to the host.
Retain command/task IDs and the `[Androperator-Result]` envelope when proving
an action or read. See [setup](../setup.md) and [examples](examples.md).
