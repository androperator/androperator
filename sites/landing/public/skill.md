---
name: androperator-setup
description: Install, repair, verify, and orient Androperator for agent-driven Android observation and control.
license: Apache-2.0
compatibility: Node.js 24+, npm, adb, and an authorized Android device or emulator. Host Android builds require Java 17 or 21.
metadata:
  homepage: https://androperator.com
  docs: https://docs.androperator.com
  repository: https://github.com/androperator/androperator
  installer: https://androperator.com/install.sh
  package: androperator
---

# Androperator setup

Use this skill for first installation, repair of an existing install, device
readiness, Operator APK verification, and host-agent orientation. For example:

```text
Read https://androperator.com/skill.md and get me set up with Androperator.
```

Androperator is the deterministic hand for an agent's brain. The agent plans,
chooses actions, and verifies outcomes; Androperator executes validated Android
actions and returns structured evidence. It does not supply credentials or
bypass Android permissions.

Read the [setup guide](https://docs.androperator.com/setup/) for platform-specific
prerequisites and permission instructions. Use the CLI as the canonical interface
for device actions. This file covers setup; use the linked documentation for
full runtime contracts.

## Host and device prerequisites

| Requirement | Check |
| --- | --- |
| Node.js 24+ | `node -v` |
| npm on PATH | `npm -v` |
| adb on PATH | `adb version` |
| Authorized physical device or emulator | `androperator devices` |
| Java 17 or 21 for host Android builds | `java -version` |

The bootstrap installer can provision supported host prerequisites. Human action
may be needed for OS installation prompts, Developer Options, USB debugging
consent, accessibility or notification permissions, app installation, and app
sign-in. Ask the user to complete the specific blocked step and then recheck it.

## Install or repair

If the CLI is missing and host prerequisites need bootstrapping, inspect the
[installer](https://androperator.com/install.sh), then run:

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

If Node.js and npm are already ready, install the published CLI directly:

```bash
npm install -g androperator@latest
```

After the CLI exists, use the canonical setup route for both first setup and
repair:

```bash
androperator devices
androperator install
```

Installation can remediate multiple connected devices; `install` does not select
one with `--device`. Before running it, confirm that all connected targets are
authorized for setup, or disconnect targets that should not be changed. For later
checks and actions, replace `<device_serial>` with the intended target from
`devices`. If that target is unclear, ask the user. An empty list or an
unauthorized/offline device is not ready.

`androperator install` handles Operator remediation, bundled authoring skills,
and host-local orientation. Use this route rather than substituting a raw
`adb install`. Installation initializes a local workspace rather than downloading
a companion catalog. Agents create their own local runtime skills; no companion
catalog or skills registry file is required. Optional examples are source
references, not an installation prerequisite. Follow the
[skills documentation](https://docs.androperator.com/skills/overview/) for local
metadata and discovery rules.

Stable release APK aliases `/operator.apk`, `/install.apk`, and `/apk` on
`androperator.com` resolve the latest published APK through release metadata.
The release Operator package is `com.androperator.operator`; development builds
use `com.androperator.operator.dev` and require an explicit matching package.

## Verify readiness and actual observation

```bash
androperator doctor --device <device_serial> --output json
androperator open com.android.settings --device <device_serial> --output json
androperator snapshot --device <device_serial> --output json
```

Continue only when:

- Doctor exits `0` and reports `criticalOk: true`.
- The selected device is authorized and listed with state `device`.
- Open and snapshot exit `0`, return `envelope.status: "success"`, and report
  successful steps in `envelope.stepResults`.
- The snapshot hierarchy contains actual Settings content, proving the intended
  app opened. A successful process exit alone is insufficient.

Preserve command/task correlation and returned errors. Never convert a failed
setup or action into success. If a check fails, retain its exact command, output,
and evidence; consult [Operator troubleshooting](https://docs.androperator.com/troubleshooting/operator/).

## Read host-local orientation

After installation, read these files when present:

| File | Purpose |
| --- | --- |
| `~/.androperator/AGENTS.md` | Current host capabilities and next-step guidance. |
| `~/.androperator/install-state.json` | Install metadata; absent/null fields are not proof of readiness. |
| `~/.androperator/mcp-config-snippet.json` | Generated configuration for a host that supports stdio MCP. |

These are host-specific files, not substitutes for a fresh readiness check.
Keep private device evidence and credentials out of shared documents.

## Routes after setup

Read [agent guidance](https://androperator.com/agents.md),
[host-agent orientation](https://docs.androperator.com/host-agents/), the
[CLI reference](https://docs.androperator.com/api/cli/), and the
[documentation index](https://androperator.com/llms.txt).
The [full agent corpus](https://androperator.com/llms-full.txt) provides the
technical documentation in one file.

If the host supports stdio MCP, configure it using the local snippet and
[MCP documentation](https://docs.androperator.com/api/mcp/) after CLI setup works:

```bash
androperator mcp serve
```

For an app-specific task, discover local runtime skills before authoring one:

```bash
androperator skills list
androperator skills search --keyword "<term>"
androperator skills get <skill_id>
```

An empty local collection is valid. Use the bundled authoring guidance and
[skills documentation](https://docs.androperator.com/skills/overview/) to create
skills from observed behavior. The agent remains responsible for planning and
verification.

## Stop and report blockers

Stop dependent work and report the exact failing check when there is no
authorized target, the target is ambiguous, doctor is not ready, or observation
fails. Request human intervention for device consent, permissions, sign-in, or
other prompts that require it. Do not guess credentials, hide prompts, bypass
permissions, or perform sensitive account/payment actions without authorization.
Resume after the blocker is resolved and the relevant readiness check passes.
