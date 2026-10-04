# Androperator

<img src="assets/androperator-logo.png" width="200" height="200" alt="Androperator logo" />

Androperator is a deterministic Android automation tool for AI agents to
navigate, observe, and control apps. It connects an agent running on your computer to an Android phone or
emulator, so the agent can inspect the screen, tap controls, enter text, and
check what happened.

It is especially useful for **agentic development**: giving a coding agent a
way to exercise an app, investigate a bug, and verify its changes against a
running Android UI.

Androperator was formerly known as Clawperator. Version **1.0.0** is available
as `androperator` on npm. See [migration guidance](docs/migration-to-androperator.md)
if you previously used Clawperator.

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

Androperator is the **hand** for the agent's **brain**. The agent or LLM owns
reasoning, planning, and app-specific strategy; Androperator executes validated
Android actions and returns structured evidence. This separation lets agents
adapt their plans while keeping the execution interface predictable.

Androperator has two parts: a Node.js CLI on the host and an Operator app on the
Android target. The host communicates with the device through `adb`; the
Operator uses Android accessibility to observe and interact with app UI.

Agents can use the CLI, MCP server, or HTTP API. The same execution contracts
support individual actions and validated sequences. Results include structured
status and errors, with `commandId` and `taskId` for correlation. Canonical
terminal results from the Operator use the `[Androperator-Result]` envelope.

**Design principles:**

- **Deterministic:** explicit actions and strict validation contracts; app-specific decisions stay with the agent.
- **Observable:** structured UI snapshots, machine-readable errors, and correlated execution results.
- **Agent-first:** JSON output, CLI/MCP/HTTP interfaces, and single-flight execution per device.

A typical setup keeps a phone connected to the agent's host machine, or uses
an emulator during development. The agent sends actions, reads the evidence,
and chooses its next step.

Available tools include:

- **Observation:** UI hierarchy snapshots, node queries, screenshots, and video evidence.
- **Control:** opening apps, tapping, scrolling, swiping, dragging, and entering text.
- **Skill authoring:** recordings and local skill tooling for agents to build and validate their own workflows.

UI visibility depends on what the app exposes through Android accessibility.
Agents should inspect the returned state and verify the outcome before moving
on. App-specific reasoning and recovery remain with the agent.

## Get started

Install the CLI with Node.js 24+:

```bash
npm install -g androperator@1.0.0
androperator install
```

The install command prepares the host and connected Android targets, including
Operator APK setup and readiness checks. You need a phone with USB debugging
enabled or an emulator visible to `adb`. Follow the [setup guide](docs/setup.md)
for prerequisites, device authorization, and permissions.

Choose a target and try a simple flow:

```bash
androperator devices
androperator doctor --device <device_serial>
androperator open com.android.settings --device <device_serial>
androperator snapshot --device <device_serial>
```

The snapshot returns the UI hierarchy for the agent to inspect. Choose the next
action from that evidence, execute it, and inspect the result again. Pass
`--device` explicitly when several targets are connected.

For the full bootstrap installer, including host prerequisites:

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

## Documentation for agents

- [Quickstart](docs/quickstart.md) - first device interaction.
- [Setup](docs/setup.md) - host requirements, APK installation, and permissions.
- [API overview](docs/api/overview.md) - CLI, HTTP API, actions, and result contracts.
- [Operator automation playbook](docs/internal/design/operator-llm-playbook.md) - runtime conventions and the agent/runtime boundary.
- [Local skills](docs/skills/overview.md) - instructions followed by the current agent.
- [Recording](docs/api/recording.md) - capture observations for skill authoring.
- [Troubleshooting](docs/troubleshooting/operator.md) - diagnose setup and runtime failures.

The current agent follows and authors reusable instructions with optional
ordinary helpers. [Settings examples](examples/skills/README.md) are included;
Androperator supplies execution and evidence without a runtime package framework.

Technical documentation is built from `docs/` and code-derived inputs in
`apps/node/src/`, through `sites/docs/`. The former landing site is maintained separately in
[clawperator/clawperator.com](https://github.com/clawperator/clawperator.com).

[Repository setup](.agents/skills/repo-setup/SKILL.md) enables the tracked Git
hooks. [Release notes](CHANGELOG.md) describe changes in each version.

## License

Apache 2.0. See [LICENSE](LICENSE).

Built by [@chrismlacy](https://x.com/chrismlacy), with help from ever-nondeterministic agents.\
GitHub: [chrislacy](https://github.com/chrislacy) · X: [@chrismlacy](https://x.com/chrismlacy) · Email: [chris@actionlauncher.com](mailto:chris@actionlauncher.com)

Copyright (c) 2026 Action Launcher Pty Ltd
