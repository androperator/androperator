# Androperator

![Androperator logo](assets/androperator-logo.png)

Androperator, formerly known as Clawperator, is preparing its first release as
version 1.0.0. See [migration guidance](docs/migration-to-androperator.md).

<img src="docs/img/androperator-logo.png" width="200" height="200" alt="Androperator logo" />

Androperator ("Claw Operator") is a deterministic Android automation runtime for AI agents. It is the actuator layer: the external agent or LLM owns reasoning and planning, and Androperator executes validated Android actions on behalf of a user.

## Why Androperator?

Many consumer services only expose critical data in mobile apps, not public web APIs.

Examples include:
- Family tracking/location apps
- Home automation apps
- Grocery/shopping apps
- Ride-hailing apps

Androperator lets AI agents interact with these apps on your behalf. Its API is predictable and stable, so skills can be created, reused, and shared.

## What is Androperator?

Androperator is the execution layer for LLM-driven Android automation. It provides a deterministic Node.js CLI and HTTP API - the "hand" for an LLM "brain."

**What agents can do:**
- Connect to a real Android device
- Run deterministic UI actions (tap, scroll, type, read)
- Observe screen state via structured snapshots
- Get canonical terminal results (`[Androperator-Result]`)
- Compose primitives into repeatable skills

**Design principles:**
- **Deterministic:** Strict contracts, no hidden retries, one result envelope per command
- **Observable:** Structured UI snapshots and machine-readable error codes
- **Agent-first:** JSON output, typed errors, single-flight concurrency

**Typical setup:** A dedicated Android device (any cheap/old phone) stays connected to your agent's host machine as a permanent actuator. The agent sends commands via the Androperator API; Androperator executes and reports results.


## Install

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

The installer:
- installs or upgrades the CLI prerequisites
- downloads the current stable operator APK via `latest.json`
- verifies the APK checksum
- offers to install the APK to a single connected Android device, even when run via `curl ... | bash`

Or install the CLI directly:

```bash
npm install -g androperator
```

## Quick Start

```bash
androperator doctor                              # Verify setup
androperator devices                             # List connected devices
androperator snapshot --device <device_id>       # Capture UI tree
androperator exec payload.json --device <device_id>   # Run an execution (`execute` synonym; `--payload` / `--execution` optional)
```

CLI device commands are flat (`snapshot`, `screenshot`, `click`, `open`, `type`, ...). When several devices are connected, pass `--device` (alias: `--device-id`). See [API Overview](docs/api/overview.md) for flags, HTTP routes, and error codes.

## Requirements

- Node.js >= 24
- `adb` in PATH
- Android device with USB debugging enabled
- Androperator APK installed ([stable download](https://androperator.com/operator.apk), [historical releases](https://github.com/androperator/androperator/releases))

## For AI Agents

Androperator is an actuator, not an autonomous planner. Use these entrypoints first:

- [Agent Quickstart](https://docs.androperator.com/ai-agents/agent-quickstart/) - fastest path from install to first successful execution
- [Node API for Agents](https://docs.androperator.com/ai-agents/node-api-for-agents/) - action contracts, result envelopes, and error codes
- [Execution Model](https://docs.androperator.com/reference/execution-model/) - required fields, timeout policy, and status semantics
- [Operator Automation Playbook](https://docs.androperator.com/design/operator-llm-playbook/) - background runtime conventions and deeper rationale
- [llms.txt](https://androperator.com/llms.txt) - root machine-readable index
- [llms-full.txt](https://androperator.com/llms-full.txt) - full compiled technical corpus in one fetch

## Documentation

Full docs at [docs.androperator.com](https://docs.androperator.com)

[Release notes](https://github.com/androperator/androperator/blob/main/CHANGELOG.md) cover changes in each version.

Website surfaces in this repo:
- `sites/landing-clawperator/` preserves the legacy site at [clawperator.com](https://clawperator.com)
- `sites/docs/` builds the technical documentation site at [docs.androperator.com](https://docs.androperator.com)

When updating website content, make sure you are editing the correct surface. The docs content itself is sourced from `docs/`, `apps/node/src/`, , then published through `sites/docs/`.

Both public sites deploy automatically to Cloudflare after changes are merged to `main`.

- [Setup](docs/setup.md) - Device prep, APK install, accessibility
- [API Overview](docs/api/overview.md) - CLI, HTTP API, execution contract
- [Runtime Architecture](docs/internal/design/node-api-design.md) - System design
- [Operator Troubleshooting](docs/troubleshooting/operator.md) - Common issues

## For Developers

```bash
git clone https://github.com/androperator/androperator.git
cd androperator
npm --prefix apps/node ci && npm --prefix apps/node run build && npm --prefix apps/node link
```

For clone-local git defaults (including tracked hooks), use `.agents/skills/repo-setup/SKILL.md`.

If Androperator is useful to your project, consider [starring the repo on GitHub](https://github.com/androperator/androperator).

## License

Apache 2.0

Built with human claws by [@chrismlacy](https://x.com/chrismlacy), with a scrappy crew of bots.  
GitHub: [chrislacy](https://github.com/chrislacy) · X: [@chrismlacy](https://x.com/chrismlacy) · Email: [chris@actionlauncher.com](mailto:chris@actionlauncher.com)

Copyright (c) 2026 Action Launcher Pty Ltd
