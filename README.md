# Androperator

<img src="assets/androperator-logo.png" width="160" height="160" alt="Androperator logo" />

**Your agent decides. Androperator executes and reports.**

Your agent needs to see what's happening inside an Android app to decide what
to do next. Androperator gives it that visibility and the controls to act on it:
UI snapshots, screenshots, taps, text entry, and more, through a deterministic API.

The loop is simple. Your agent chooses a command. Androperator executes it on
a device or emulator and reports the result. Your agent can inspect the updated
screen, check what changed, and choose its next move. That's how a plan becomes
work you can see in the running app.

Connect through the CLI, MCP server, or HTTP API. Put your coding agent to work
building features, turning vague bug reports into repeatable steps, and checking
fixes with evidence to back up its conclusions.

[Quick Start](#quick-start) · [Documentation](https://docs.androperator.com/) · [GitHub](https://github.com/androperator/androperator)

<a id="develop-with-eyes-on-the-app"></a>

## Give your coding agent the running app

A fix can look right in code and still be wrong on screen. Let your agent open
the app, reproduce the bug, and check its work where you'll actually use it.
Screenshots show the layout; UI snapshots give the agent controls to target.

Ask your agent: **“Reproduce the settings bug, fix it, then use Androperator to
check the updated screen on the emulator.”**

```mermaid
flowchart LR
    accTitle: Android development feedback loop
    accDescr: The agent changes code, the development tools build and launch the app, and Androperator returns UI evidence for the agent to check.
    A[Agent changes code] --> B[Build and launch app]
    B --> C[Androperator reports UI state]
    C --> D[Agent checks the result]
    D --> A
```

Your development tools build and install the app. Androperator lets your agent
interact with it and inspect the result. That feedback brings the running app
into the coding loop: change the code, try it on the device, see what needs work.

## Turn “it sometimes breaks” into steps you can follow

“The display setting keeps resetting.” That's a starting point, but it's hard
to fix a bug you can't reproduce. Ask your agent to investigate in the running
app, try the likely paths, and narrow down what triggers it. Androperator
runs the requested actions and observations, giving the agent fresh evidence
to decide which path to try next.

Ask your agent: **“Investigate this report: ‘The display setting keeps resetting.’
If you can reproduce it, repeat the flow to confirm it and write numbered steps
with the starting conditions, expected result, actual result, and screenshots.”**

The useful output is a reproduction another person can follow. If the agent
can't reproduce the bug, have it record what it tried and what's still unknown.

<a id="automate-qa-verification"></a>
<a id="put-your-qa-checklist-to-work"></a>

## Give every fix a first QA pass

A fix is ready for a first check as soon as the updated app is running. Have
your agent replay the reproduction steps, compare what happens with what
should happen, and write up the result. Use the same approach for your regular
QA checklist.

Ask your agent: **“Check the display-setting fix against these reproduction
steps. Verify that the preference survives closing and reopening the app.
Write a report with pass/fail results, screenshots, and anything you couldn't
verify.”**

```mermaid
flowchart LR
    accTitle: From a fix to a QA report
    accDescr: The agent chooses checks from reproduction steps or a QA checklist. Androperator executes its commands and returns evidence. The agent evaluates the results and writes a report.
    A[Reproduction steps or QA checklist] --> B[Agent chooses checks]
    B --> C[Androperator executes commands]
    C --> D[Androperator reports results and UI evidence]
    D --> E[Agent evaluates results]
    E -->|Next check| B
    E --> F[Agent writes QA report]
```

A successful tap doesn't prove a test passed. Your agent judges the observed
result and produces the report: what it tested, what passed, what failed, and
what still needs attention. You get a first line of automated verification
with evidence to review.

## How it works

Androperator connects your agent's decisions to what's happening on the device.
It validates and executes explicit commands, reports action results and errors,
and exposes the UI through snapshots and screenshots. Your agent uses that
feedback to plan the next step, check an outcome, or investigate a failure.

```mermaid
flowchart TB
    accTitle: Decide, execute, report, repeat
    accDescr: The agent decides what to do and calls Androperator through the CLI, MCP server, or HTTP API. Androperator uses adb and the Androperator Operator App to execute commands and report results and UI evidence for the next decision.
    A[Your agent decides] -->|CLI / MCP / HTTP| B[Androperator executes and reports]
    B -->|adb| C[Androperator Operator App on Android]
    C -->|Accessibility actions| D[Running Android app]
    D -->|UI state| C
    C -->|Structured results| B
    B -->|Results and UI evidence for the next decision| A
```

The Node.js CLI runs on your computer. The Androperator Operator App uses
accessibility to inspect and interact with apps on a connected phone or emulator.
Screenshots capture the device display. No app-specific SDK integration is
required; UI hierarchy visibility depends on what the app exposes through
Android accessibility.

- **Observe:** XML UI snapshots, compact JSON hierarchies, node queries, screenshots, and recordings.
- **Act:** open apps, tap, type, scroll, swipe, and drag.
- **Report:** structured action results and explicit errors give your agent feedback it can check alongside UI observations.

Your agent can use the API directly or follow a reusable skill for a familiar
workflow. Either way, the decisions stay with your agent.

<a id="install"></a>

## Quick Start

Start by asking your agent to handle setup:

```text
Read https://androperator.com/skill.md and get me set up with Androperator.
```

Prefer the terminal? On macOS or Linux, this installs the CLI and helps set up
the Androperator Operator App on your Android device:

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

Or, with Node.js 24+ and Android platform-tools already installed:

```bash
npm install -g androperator
androperator install
```

No phone handy? Create an Android emulator with Google Play:

```bash
androperator emulator provision
```

Emulator provisioning needs a supported host and Android SDK emulator tools.
For a physical phone, enable USB debugging and authorize the computer.
Follow the [setup guide](docs/setup.md) for prerequisites and permissions, and
[emulator guidance](https://docs.androperator.com/api/serve/#endpoint-post-android-provision-emulator) for host requirements.

<a id="try-the-observation-loop"></a>

### Take a look around

Check your device is ready, open Settings, and grab a snapshot and screenshot:

```bash
androperator devices
androperator doctor --device <device_serial>
androperator open com.android.settings --device <device_serial>
androperator snapshot --compact --device <device_serial>
androperator screenshot --path /tmp/android-screen.png --device <device_serial>
```

The compact snapshot returns a bounded JSON hierarchy. Use the observed text
or resource IDs to choose an action, then inspect again. Pass `--device`
explicitly when multiple targets are connected. These commands use the release
Androperator Operator App; for a local debug APK, add
`--operator-package com.androperator.operator.dev`.

<a id="go-deeper"></a>

## Keep going

- [Quickstart](docs/quickstart.md) - your first device interaction.
- [Setup](docs/setup.md) - host requirements and Android permissions.
- [API overview](docs/api/overview.md) - CLI, HTTP, actions, and results.
- [MCP server](docs/api/mcp.md) - connect an agent through MCP.
- [Recording](docs/api/recording.md) - capture a flow and its evidence.
- [Troubleshooting](docs/troubleshooting/operator.md) - diagnose setup and runtime failures.

Androperator was formerly known as Clawperator. See the
[migration guide](docs/migration-to-androperator.md) and [release notes](CHANGELOG.md).

## License

[Apache 2.0](LICENSE). Built by [@chrismlacy](https://x.com/chrismlacy),
with help from ever-nondeterministic agents.

Copyright (c) 2026 Action Launcher Pty Ltd
