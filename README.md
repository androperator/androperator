# Androperator

<img src="assets/androperator-logo.png" width="200" height="200" alt="Androperator logo" />

Androperator is a tool for AI agents to navigate, observe, and control Android
apps. It connects an agent running on your computer to an Android phone or
emulator, so the agent can inspect the screen, tap controls, enter text, and
check what happened.

It is especially useful for **agentic development**: giving a coding agent a
way to exercise an app, investigate a bug, and verify its changes against a
running Android UI.

Androperator was formerly known as Clawperator. Its first release under the new
name will be **1.0.0**. The renamed package and public installation endpoints
are being prepared; use the source checkout until release and domain cutover
are complete. See [migration guidance](docs/migration-to-androperator.md).

## Why Androperator?

A coding agent can read your source and run tests, but working on an Android
app also means using it. Androperator gives the agent a way to navigate the
running app and bring observations back into its development loop.

An agent can use it to:

- Explore an unfamiliar app and find the controls needed for a task.
- Reproduce a reported UI problem and capture evidence of the result.
- Check a user flow after changing code, including navigation and text entry.
- Turn a verified sequence of actions into a reusable local skill.
- Operate existing Android apps as part of a larger agent workflow.

You choose the goal. Your agent decides what to do next. Androperator executes
the requested actions and returns evidence for the agent to inspect.

## How it works

Androperator has two parts: a Node.js CLI on the host and an Operator app on the
Android target. The host communicates with the device through `adb`; the
Operator uses Android accessibility to observe and interact with app UI.

Agents can use the CLI, MCP server, or HTTP API. The same execution contracts
support individual actions and validated sequences. Results include structured
status and errors, with command and task IDs for correlation.

Available tools include:

- **Observation:** UI hierarchy snapshots, node queries, screenshots, and video evidence.
- **Control:** opening apps, tapping, scrolling, swiping, dragging, and entering text.
- **Skill authoring:** recordings and local skill tooling for agents to build and validate their own workflows.

UI visibility depends on what the app exposes through Android accessibility.
Agents should inspect the returned state and verify the outcome before moving
on. App-specific reasoning and recovery remain with the agent.

## Get started

For development before the 1.0.0 release, build from source:

```bash
git clone https://github.com/androperator/androperator.git
cd androperator
npm --prefix apps/node ci
npm --prefix apps/node run build
```

You need Node.js 24+, `adb` on your PATH, and an Android device or emulator.
Install the matching Operator APK and grant its permissions using the
[setup guide](docs/setup.md). For a local debug build, select
`com.androperator.operator.dev` explicitly:

```bash
node apps/node/dist/cli/index.js devices
node apps/node/dist/cli/index.js doctor --device <device_serial> --operator-package com.androperator.operator.dev
node apps/node/dist/cli/index.js open com.android.settings --device <device_serial> --operator-package com.androperator.operator.dev
node apps/node/dist/cli/index.js snapshot --device <device_serial> --operator-package com.androperator.operator.dev
```

The snapshot returns the UI hierarchy for the agent to inspect. Choose the next
action from that evidence, execute it, and inspect the result again. Pass
`--device` explicitly when several targets are connected.

After publication, the CLI will be available as `androperator@1.0.0` on npm,
with the matching APK and installer at `androperator.com`.

## Documentation for agents

- [Quickstart](docs/quickstart.md) - first device interaction.
- [Setup](docs/setup.md) - host requirements, APK installation, and permissions.
- [API overview](docs/api/overview.md) - CLI, HTTP API, actions, and result contracts.
- [Local skills](docs/skills/overview.md) - create and run your own workflows.
- [Recording](docs/api/recording.md) - capture observations for skill authoring.
- [Troubleshooting](docs/troubleshooting/operator.md) - diagnose setup and runtime failures.

Androperator does not require a companion skills catalog. Agents create and
maintain local skills; optional bundled examples are planned separately.

Technical documentation is built from `docs/` and code-derived inputs in
`apps/node/src/`, through `sites/docs/`. The former landing site is preserved
separately in `sites/landing-clawperator/`.

For development, use the branch-local CLI build and matching Operator APK.
[Repository setup](.agents/skills/repo-setup/SKILL.md) enables the tracked Git
hooks. [Release notes](CHANGELOG.md) describe changes in each version.

## License

Apache 2.0. See [LICENSE](LICENSE).

Built with human claws by [@chrismlacy](https://x.com/chrismlacy), with a scrappy crew of bots.\
GitHub: [chrislacy](https://github.com/chrislacy) · X: [@chrismlacy](https://x.com/chrismlacy) · Email: [chris@actionlauncher.com](mailto:chris@actionlauncher.com)

Copyright (c) 2026 Action Launcher Pty Ltd
