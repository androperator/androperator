# Agent Host Integration Notes

## Purpose

Capture the durable integration assumptions for host agents that discover and
invoke Androperator from a higher-level assistant runtime.

This is an internal design note. It is not public product documentation. Use it
when changing install, onboarding, agent guides, runtime-skill discovery, or
MCP setup.

Read [OpenClaw Reference](../openclaw-reference.md) first if you need the basic
answer to "what is OpenClaw?" This file assumes that baseline context and
focuses on the Androperator-side design implications.

## Scope Of This Note

This file is about agent-host integration decisions for Androperator.

It is not meant to re-explain OpenClaw itself in full. Instead, it answers:

1. what host-agent layer Androperator is integrating with
2. which host-agent discovery conventions matter
3. how Androperator's current install model lines up with those conventions
4. what durable design rules should guide future onboarding work

For the OpenClaw system overview, workspace model, and official docs links, use
[OpenClaw Reference](../openclaw-reference.md).

## Example Host Model

The motivating example is OpenClaw, but the model here is broader:

1. a user sends a natural-language request to an assistant runtime
2. that runtime routes the request to an underlying coding agent such as Codex
   or Claude Code
3. that coding agent shells out to `androperator` or connects to its MCP server
4. Androperator acts as the deterministic Android actuator

Example user request:

> "I saw this app called androperator. Check it out and see if I can use it to control my air conditioner via the Google Home app. I've plugged in an Android device."

In that flow, the assistant runtime is not the same thing as Androperator. The
host agent is the "brain". Androperator is the "hand".

## Why This Needs Its Own Note

Androperator already documents:

1. the CLI and Node API
2. runtime skills
3. bundled skills
4. the MCP server

What was missing during the onboarding findings pass was the host-agent layer:

1. what a host agent is likely to discover first
2. which files and conventions it uses
3. how that differs from Androperator's current install layout
4. why an apparently successful install can still leave the host agent unable
   to use the runtime skills that are already present

That context shapes product decisions. It should not need to be rediscovered by
future agents. The OpenClaw-specific background is captured separately in
[OpenClaw Reference](../openclaw-reference.md) so this file can stay focused on
integration behavior rather than system introduction.

## Host-Agent Discovery Conventions

The OpenClaw-style pattern to design for is:

1. `AGENTS.md`
2. `TOOLS.md`
3. plugin entry points
4. per-agent skill directories such as:
   - `~/.agents/skills`
   - `~/.claude/skills`
   - `~/.codex/skills`
5. MCP server registration

Important distinction:

- runtime Androperator skills are CLI-level assets addressed through
  `androperator skills ...`
- prompt-skills under `~/.agents/skills` or similar are host-agent discovery
  assets

These are not the same model and should not be treated as interchangeable.

## Current Androperator Install Model

The installer follows the boundary in
[Installer Architecture](installer-architecture.md): `install.sh` bootstraps
host prerequisites and installs the CLI, then delegates post-bootstrap behavior
to `androperator install`.

The CLI-owned post-bootstrap flow does these host-relevant things:

1. remediates connected Android devices through `operator remediate`
2. installs runtime skills under `~/.androperator/skills`
3. installs bundled skills into host-agent discovery directories
4. writes `~/.androperator/AGENTS.md`
5. writes `~/.androperator/install-state.json`
6. writes `~/.androperator/mcp-config-snippet.json`
7. appends the Androperator bridge to `~/.agents/AGENTS.md` when that file
   already exists

Key implications:

1. runtime skills are installed, but not exposed through host-agent discovery
   conventions
2. bundled skills are exposed through host-agent discovery conventions:
   - Claude Code and Codex discovery entries are managed symlinks into
     `~/.androperator/bundled-skills/`
   - generic agents discovery entries under `~/.agents/skills/` are managed
     real directory copies marked with `.androperator-managed`
3. the generated guide lives under `~/.androperator/AGENTS.md`, not the places a
   host agent is most likely to inspect first
4. the runtime-skills registry is discovered from the installed home-directory
   path when no explicit `ANDROPERATOR_SKILLS_REGISTRY` override is set
5. the local guide and shared-agent bridge now explicitly advertise the
   first-run and discovery-to-proving route:
   - `androperator-agent-orientation` is the packaged first-run orientation
     front door
   - `androperator-upgrade` is the packaged whole-product upgrade route through
     the canonical installer plus `doctor`
   - `androperator-skill-author-by-agent-discovery` is the zero-results front door
   - `androperator-skill-author-by-recording` is the proving workflow after
     `proceed_to_recording`
   - the shared bridge points back to `~/.androperator/AGENTS.md` plus
     `androperator skills ...` and `androperator bundled-skills list`
     without pretending shared skill dirs contain runtime skills

Refs:

- `sites/androperator-public/install.sh`
- `apps/node/src/cli/commands/install.ts`
- `apps/node/src/domain/host/hostSetup.ts`
- `apps/node/src/adapters/skills-repo/localSkillsRegistry.ts`
- `apps/node/src/domain/skills/syncSkills.ts`
- `docs/internal/design/installer-architecture.md`
- `docs/internal/design/mcp-server.md`

## Durable Design Rules

### 1. Host-agent discovery is a first-class product surface

If a host agent cannot discover the installed runtime capabilities, the
underlying capability does not matter.

The install flow should be judged by whether a cold-start host agent can answer:

1. what Androperator is
2. how to call it
3. what runtime skills are already installed
4. which skill best matches the user's request

### 2. Runtime skills and prompt-skills must stay conceptually separate

Do not blur:

1. runtime skills invoked as `androperator skills run <id>`
2. host-agent prompt-skills discovered from `~/.agents/skills` or related dirs

If we add a bridge skill under shared agent skill directories, it must stay
visibly a pointer/delegator to `androperator skills`, not a fake re-expression
of the runtime-skills model.

### 3. `AGENTS.md` / `TOOLS.md` are the primary bridge

For host-agent onboarding, the preferred bridge order is:

1. `AGENTS.md`
2. `TOOLS.md`
3. MCP config snippet
4. optional bridge skill in shared agent skill directories

That order keeps the runtime model honest and avoids pretending that every
host-agent convention is interchangeable with Androperator's own registry model.

Public docs should also expose one canonical post-install route. The current
public first stop is `docs/host-agents.md`, which explains when to use
`androperator skills`, when to use `androperator mcp serve`, and what to try next
when discovery stalls.

### 4. Shell rc propagation is not enough for agent workflows

Appending to `~/.zshrc` or `~/.bashrc` helps interactive humans, but it is not a
reliable discovery mechanism for host agents that spawn non-login shells.

Any setting the host agent must rely on after install should either:

1. be discoverable without shell rc sourcing
2. or be materialized into a durable file that the host agent can read directly

### 5. App-oriented capability discovery matters more than subsystem taxonomy

A host agent responding to a user message does not primarily ask:

> "What subcommands does Androperator support?"

It asks:

> "What can this host do for Google Home?"

That is why app-oriented discovery surfaces are higher leverage than more help
text on `skills` or `doctor`.

## Preferred Near-Term Integration Pattern

If Androperator needs to work well with an OpenClaw-style host, prefer this
shape:

1. make the runtime-skills registry self-discovering from the installed home
   path
2. render installed runtime skills into `~/.androperator/AGENTS.md`
3. append a bounded Androperator section to `~/.agents/AGENTS.md`
4. write a small `~/.androperator/TOOLS.md` or equivalent host-agent tool
   description
5. write a ready-to-paste MCP config snippet under `~/.androperator/`
6. only after that, consider a bridge skill in shared agent skill directories

## Google Home HVAC As The Canonical Example

This repo now has a useful canonical onboarding scenario:

1. user mentions Google Home in natural language
2. runtime skills already exist for that app
3. the main risk is not device execution
4. the main risk is host-agent discovery and handoff after install

That makes Google Home HVAC a good regression example for future install and
agent-host work. A host-agent-friendly install should make it straightforward to:

1. discover the installed Google Home runtime skills
2. identify the safest first-run path
3. explain preconditions such as sign-in state and exact unit label
4. return current HVAC state without inventing a new skill

## When To Update This Note

Update this file when changing any of the following:

1. `install.sh` host-facing outputs or on-disk artifacts
2. `~/.androperator/AGENTS.md` generation
3. shared agent skill-directory wiring
4. MCP onboarding or config guidance
5. assumptions about OpenClaw-style host discovery conventions
6. the preferred bridge order between host agents and Androperator

## Related Docs

- `docs/internal/design/installer-architecture.md`
- `docs/internal/openclaw-reference.md`
- `docs/internal/design/mcp-server.md`
- `docs/internal/design/operator-llm-playbook.md`
- `docs/internal/design/node-api-design-guiding-principles.md`
