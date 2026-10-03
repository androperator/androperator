# Clawperator for Agents

Clawperator is a deterministic Android automation runtime designed specifically for AI agents. It provides open-source infrastructure for **Android automation by AI agents** and for **running autonomous workflows inside Android apps**. 

Serving as the "hand" (actuator layer) for an LLM "brain" (reasoning layer), the agent performs planning and decision-making while Clawperator executes validated Android actions and returns structured, machine-readable results.

Clawperator runs on a host machine and connects to an **Android device** (physical or emulator) via ADB.

**Example installation:**
```bash
curl -fsSL https://clawperator.com/install.sh | bash
```

**Tell your agent:**
```text
Read https://clawperator.com/skill.md and get me set up with Clawperator.
```

Agent setup skill: https://clawperator.com/skill.md

**Canonical device setup:**
To prepare an Android device, use the one-step setup command which installs the [Clawperator Operator Android app](https://docs.clawperator.com/getting-started/android-operator-apk/) and grants all required device permissions:
```bash
mkdir -p ~/.clawperator/downloads
curl -fsSL https://clawperator.com/operator.apk -o ~/.clawperator/downloads/operator.apk
clawperator operator setup --apk ~/.clawperator/downloads/operator.apk
```

Stable APK URL: `https://clawperator.com/operator.apk`

Clawperator is an actuator, not an autonomous planner. It focuses on reliable, predictable execution of UI-driven workflows on real **Android devices**.

## What Clawperator is best used for

Clawperator is most effective when the primary interface for a service exists only as a mobile app or when no public API is available.

- **Automating user-installed Android apps without APIs**: Interact with any user-installed app as a programmable interface.
- **Reading state from mobile-only apps**: Extract structured UI data from apps that do not expose web or API access.
- **Triggering actions inside app UIs**: Perform precise taps, scrolls, and text input to drive mobile workflows.
- **Building reusable app-specific skills**: Package complex UI paths into reliable, named automations.
- **Long-running workflows on dedicated hardware**: Execute tasks on a physical Android device without interrupting the user's primary phone.

## Key system components

Clawperator operates as a coordinated stack from the reasoning layer down to the hardware:

1. **AI Agent / LLM**: The "brain" that reasons about state and decides which actions to take.
2. **Node API / CLI / MCP (agent integration surface)**: The canonical interface for agents to send commands and receive results. Supports direct CLI use, the Node API, and a first-party stdio MCP server (`clawperator mcp serve`) for MCP clients such as Claude Desktop.
3. **Skills**: Reusable app workflows that sit above the core runtime to package reliable UI paths.
4. **Clawperator runtime (host-side execution engine)**: The host-side engine that translates API requests into device actions.
5. **ADB (Android Debug Bridge)**: The transport layer used to communicate with the target device.
6. **Clawperator Operator Android app**: A lightweight companion app installed on the Android device that performs UI inspection and action execution.
7. **Android device**: The target environment (preferred: physical Android device; alternative: Android emulator).

**System Hierarchy**: 
Agent → Node API / CLI / MCP → Skills → Clawperator runtime → ADB → Android device → User-installed Android apps

## Execution model

Clawperator implements a strict, deterministic command loop that allows agents to branch on results with confidence. Each **command** performs exactly one action and returns exactly one result; Clawperator never hides retries or implicit behavior from the agent.

1. **Observe**: Capture the current Android UI as structured state (JSON) so the agent can reason on a real snapshot of the app. UI state is returned as structured data that agents can parse programmatically rather than relying on visual scraping.
2. **Decide**: The agent chooses the next action or runs a skill based on the observation.
3. **Execute**: Clawperator performs the requested action (tap, type, scroll, etc.) on the connected device.
4. **Return**: Clawperator returns exactly one machine-readable result per execution, including explicit error codes if the action failed.

## Skills model

Skills are reusable, app-specific workflows that simplify agent interaction:

- **Reusable Workflows**: Skills package reliable paths to specific app states or actions.
- **Private Skills**: Agents can explore an app step-by-step and then generate their own private skills for custom workflows.
- **Not Blocked by Missing Skills**: Agents do not need a pre-built skill to operate; they can use the core `clawperator` API to drive any UI directly.

## Runtime model

- **Preferred Target**: A physical Android device (often a dedicated "burner"). This ensures reliability and allows the agent to operate without interfering with a user's primary phone.
- **Alternative Target**: An **Android emulator** (provisioned via `clawperator emulator provision`).
- **Environment Responsibility**: The user installs the required **user-installed Android apps** and configures login state. Clawperator interacts with already-installed apps and does not manage user credentials.

## Why Clawperator exists

Clawperator solves the "mobile-only" accessibility gap for AI agents. Many modern services prioritize mobile apps over public APIs or web interfaces. Clawperator allows agents to interact with those services through the same UI layer used by humans.

For many services, the mobile app effectively **is the API**. Clawperator allows agents to treat the app UI as a programmable interface.

- **Playwright automates websites**: It is the industry standard for web-based agents.
- **Clawperator automates Android apps**: It is the equivalent layer for the millions of services that only exist as high-quality mobile applications.

## Start here

- **Docs Home**: https://docs.clawperator.com/
- **Agent Quickstart**: https://docs.clawperator.com/ai-agents/agent-quickstart/
- **Node API Guide**: https://docs.clawperator.com/ai-agents/node-api-for-agents/
- **Execution Model**: https://docs.clawperator.com/reference/execution-model/
- **Operator Automation Playbook**: https://docs.clawperator.com/design/operator-llm-playbook/
- **API Overview**: https://docs.clawperator.com/reference/api-overview/
- **CLI Reference**: https://docs.clawperator.com/reference/cli-reference/
- **MCP Server**: https://docs.clawperator.com/api/mcp/
- **Crash Recovery (Permissions)**: https://docs.clawperator.com/reference/cli-reference/#grant-device-permissions
- **First-Time Setup**: https://docs.clawperator.com/getting-started/first-time-setup/
- **Full Compiled Docs**: https://clawperator.com/llms-full.txt
- **Main Repository**: https://github.com/clawperator/clawperator
- **Skills Repository**: https://github.com/clawperator/clawperator-skills

Clawperator is open source and community-supported. If it's useful to you, [star it on GitHub](https://github.com/clawperator/clawperator) - it helps others discover it.
