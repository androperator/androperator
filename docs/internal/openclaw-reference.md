# OpenClaw Reference

## Purpose

Give future agents and contributors a fast orientation to OpenClaw without
requiring them to rediscover it from the web.

This file is internal context only. It is not the source of truth for OpenClaw.
When behavior or terminology matters, verify against the official OpenClaw
docs.

## Why This Exists

OpenClaw is new enough that it may not be reliably present in model training
data.

During the Androperator onboarding findings pass, a meaningful amount of work
went into answering basic questions such as:

1. what OpenClaw is
2. how it relates to a coding agent such as Codex or Claude Code
3. what files and conventions it uses for discovery
4. what parts of the system are relevant to Androperator integration

That context should be available locally for future agents.

## One-Paragraph Summary

OpenClaw is a personal AI assistant you run on your own hardware. It exposes
the assistant through chat surfaces such as Telegram and other messaging
channels, keeps workspace and session state local, and routes user requests to
an underlying agent runtime plus tools. In Androperator terms: OpenClaw is the
high-level assistant host or control plane, while Androperator is a specialized
actuator that OpenClaw-hosted agents may call to automate Android apps.

Primary source:

- [OpenClaw FAQ](https://docs.openclaw.ai/start/faq/)

## Mental Model

For Androperator contributors, the most useful model is:

1. user sends a request to OpenClaw
2. OpenClaw receives it through a channel such as Telegram
3. OpenClaw routes the request into an agent session
4. that session may use an underlying coding agent runtime such as Codex or
   Claude Code
5. that runtime calls tools, shell commands, plugins, skills, or MCP servers
6. Androperator may be one of those tools when Android automation is needed

Important consequence:

Androperator is not competing with OpenClaw. It sits beneath it in the stack for
the use cases where Android app control is required.

## OpenClaw Concepts That Matter Most Here

### 1. Gateway + personal assistant model

OpenClaw is built as an always-on assistant host. The Gateway is the control
plane, and the assistant is the product surface the user interacts with.

Relevant docs:

- [What is OpenClaw?](https://docs.openclaw.ai/start/faq/)
- [Personal Assistant Setup](https://docs.openclaw.ai/start/clawd)

### 2. Local workspace

OpenClaw uses a local workspace, by default under:

`~/.openclaw/workspace`

The docs say brand-new workspaces are created with starter files such as:

1. `AGENTS.md`
2. `SOUL.md`
3. `TOOLS.md`
4. `IDENTITY.md`
5. `USER.md`
6. `HEARTBEAT.md`

This matters because Androperator's current installer writes its agent-facing
guide to `~/.androperator/AGENTS.md`, not to OpenClaw's workspace.

Relevant docs:

- [Personal Assistant Setup](https://docs.openclaw.ai/start/clawd)

### 3. Tool and discovery conventions

For Androperator integration work, the most relevant OpenClaw discovery surfaces
are:

1. `AGENTS.md`
2. `TOOLS.md`
3. plugin entry points
4. skills and workspace conventions
5. MCP-compatible tool registration

This is the main reason Androperator install/onboarding work needs to care about
host-facing artifacts instead of only the CLI itself.

Relevant docs:

- [AGENTS.default](https://docs.openclaw.ai/AGENTS.default)
- [Tools](https://docs.openclaw.ai/tools/index)
- [Onboarding (CLI)](https://docs.openclaw.ai/start/wizard)

### 4. Tools-first direction

OpenClaw's docs emphasize first-class tools for capabilities such as browser,
canvas, nodes, and cron. This is relevant because it means Androperator will
likely fit best as:

1. a CLI tool described through host-agent guidance
2. an MCP server
3. or a plugin/tool bridge

It is less natural to treat Androperator runtime skills as if they were already
native OpenClaw prompt-skills.

Relevant docs:

- [Tools](https://docs.openclaw.ai/tools/index)
- [MCP Server](../api/mcp.md)

### 5. Skills exist in OpenClaw too, but they are a different model

OpenClaw has its own skill ecosystem and installation flows. That does not mean
Androperator runtime skills are directly interchangeable with OpenClaw skills.

For this repo, keep the distinction clear:

1. OpenClaw skills are part of the host assistant ecosystem
2. Androperator runtime skills are part of the Android automation runtime
3. a bridge may connect them, but they are not the same abstraction

Relevant docs:

- [ClawHub / skills installation](https://docs.openclaw.ai/tools/clawhub)

## What Future Agents Should Assume

If you are a future agent working in this repo, assume:

1. OpenClaw is a host assistant system, not just another CLI tool
2. OpenClaw may delegate to a coding agent runtime that shells out to
   `androperator`
3. OpenClaw-specific context is not guaranteed to be in your pretrained
   knowledge
4. when integration details matter, verify them against the official docs
5. Androperator's install/onboarding should be designed so an OpenClaw-style host
   can discover and use it without manual archaeology

## Questions This File Helps Answer

Use this file as the quick answer to:

1. "What is OpenClaw?"
2. "Why does Androperator care about `AGENTS.md` and `TOOLS.md`?"
3. "Why is `~/.openclaw/workspace` relevant to Androperator onboarding?"
4. "Why is there an internal design note about agent host integration?"

For deeper Androperator-side implications, continue to:

- [agent-host-integration.md](design/agent-host-integration.md)

## Most Useful Links

- [OpenClaw FAQ](https://docs.openclaw.ai/start/faq/)
- [Personal Assistant Setup](https://docs.openclaw.ai/start/clawd)
- [Onboarding (CLI)](https://docs.openclaw.ai/start/wizard)
- [Tools](https://docs.openclaw.ai/tools/index)
- [AGENTS.default](https://docs.openclaw.ai/AGENTS.default)
- [ClawHub](https://docs.openclaw.ai/tools/clawhub)
- [Delegate Architecture](https://docs.openclaw.ai/concepts/delegate-architecture)
