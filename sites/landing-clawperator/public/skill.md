---
name: clawperator-setup
description: Install, repair, verify, and orient Clawperator for Android automation by AI agents.
license: Apache-2.0
compatibility: Requires Node.js 24+, npm, Java 17 or 21, adb, and a physical Android device or Android emulator.
metadata:
  homepage: https://clawperator.com
  docs: https://docs.clawperator.com
  repository: https://github.com/clawperator/clawperator
  installer: https://clawperator.com/install.sh
  package: clawperator
  last_verified_package_version: 0.9.5
---

# Clawperator Setup Skill

Use this skill when a user asks:

```text
Read https://clawperator.com/skill.md and get me set up with Clawperator.
```

Clawperator is a deterministic actuator for Android automation by AI agents.
The external agent is the brain: it reasons, asks the user for approval when
needed, and decides the next step. Clawperator is the hand: it executes
validated Android actions and returns structured results.

Clawperator is not an autonomous planner, credential manager, or permission
bypass tool. Do not invent credentials, hide prompts from the user, or continue
when no authorized Android target is available.

## When To Use

Use this skill for:

- first install on a host
- repair of a stale or broken install
- device or emulator readiness checks
- Operator APK setup verification
- host-agent orientation after install
- MCP setup after the CLI is working

Do not use this file as a full runtime command guide. After setup succeeds,
prefer the public docs and the local host files written by `clawperator install`.

## Prerequisites

| Requirement | Required state | Check |
| --- | --- | --- |
| Node.js | 24+ | `node -v` |
| npm | Available on `PATH` | `npm -v` |
| Java | 17 or 21 | `java -version` |
| adb | Available on `PATH` | `adb version` |
| Android target | Physical device or emulator visible to adb | `clawperator devices` |

Human action may be required for OS prompts, Android Developer Options, USB
debugging authorization, accessibility permission, notification permission, app
installation, app sign-in, and choosing which physical device or emulator to
target.

## Setup Flow

If the `clawperator` CLI is missing or the host may need prerequisites, run the
public bootstrap installer:

```bash
curl -fsSL https://clawperator.com/install.sh | bash
```

If Node.js 24+ and npm are already ready and you only need the npm package,
install the CLI directly and then run the canonical post-bootstrap route:

```bash
npm install -g clawperator@latest
clawperator install
```

If the CLI already exists, repair or refresh through the same post-bootstrap
route:

```bash
clawperator install
```

`clawperator install` is the setup route after the CLI exists. It handles
Operator remediation, runtime skills, bundled host-agent skills, and local host
orientation. Do not replace it with raw `adb install`.

## Readiness Checks

Run these checks after install or repair:

```bash
clawperator doctor
clawperator devices
clawperator snapshot --device <device_serial>
```

Success criteria:

- `clawperator doctor` exits `0` and reports `criticalOk` as `true`.
- `clawperator devices` shows at least one device with state `device`.
- `clawperator snapshot --device <device_serial>` exits `0` and returns a
  successful result envelope.

If more than one adb-visible target is connected, choose one serial from
`clawperator devices` and pass `--device <device_serial>` on later `snapshot`,
runtime-skill, and direct action commands.

## Local Orientation

After `clawperator install`, read these host-local files when present:

| File | Use |
| --- | --- |
| `~/.clawperator/AGENTS.md` | First local guide for what this host can do now. |
| `~/.clawperator/install-state.json` | Install metadata such as CLI version, registry path, APK version, and last device serial. |
| `~/.clawperator/mcp-config-snippet.json` | Generated MCP configuration for stdio MCP clients. |

These files are host-specific. Treat them as local orientation, not public
documentation.

## Post-Setup Routes

Use the public docs for stable technical detail:

- Setup: https://docs.clawperator.com/setup/
- Host agent orientation: https://docs.clawperator.com/host-agents/
- CLI reference: https://docs.clawperator.com/api/cli/
- MCP server: https://docs.clawperator.com/api/mcp/
- Full agent corpus: https://clawperator.com/llms-full.txt

Use MCP only after setup when the host agent supports stdio MCP:

```bash
clawperator mcp serve
```

Use runtime-skill discovery after setup when the task is app-specific:

```bash
clawperator skills list
clawperator skills search --keyword "<term>"
clawperator skills get <skill_id>
```

## Stop Conditions

Stop and report the exact failing command and output when:

- no authorized Android device or emulator is available
- `clawperator doctor` does not reach `criticalOk: true`
- `clawperator snapshot --device <device_serial>` fails
- Android requires Developer Options, USB debugging, accessibility permission,
  notification permission, or app sign-in from the human
- the user has not approved a credential, purchase, payment, account change, or
  other sensitive action
- setup requires choosing among multiple physical devices or emulators and the
  correct target is unclear

Never guess credentials, bypass approval, or claim setup is complete before the
readiness checks pass.
