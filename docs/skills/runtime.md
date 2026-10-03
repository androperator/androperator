# Device preparation for agent workflows

Use `androperator devices` and select an explicit `--device <device_serial>`.
For local development, build `apps/node`, install the matching debug APK and pass
`--operator-package com.androperator.operator.dev`. Published installations use
`com.androperator.operator`.

Run doctor for the selected pair. Device readiness includes APK presence,
version compatibility, accessibility, handshake and interactive state. A locked
or unavailable target must produce a truthful blocked outcome. Do not bypass
readiness, infer an action happened from a process exit, or silently replace
failed evidence with a later success.

The current agent follows instructions through CLI, HTTP or MCP. Helpers are
optional and caller-owned; scheduling and supervision belong to the host.
Retain command/task IDs and the `[Androperator-Result]` envelope when proving
an action or read. See [setup](../setup.md) and [examples](examples.md).
