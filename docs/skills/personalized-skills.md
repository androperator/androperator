# Personalized Skills

## Purpose

Define when a local agent-facing skill may encode one user's labels, devices,
account state, profile defaults, or workflow preferences, and how to keep that
skill truthful without presenting it as shared runtime capability.

This page covers personalized agent-facing wrappers that call Androperator
runtime skills. It does not change the runtime skills registry contract
documented in [Overview](overview.md), and it does not add an Androperator memory
or preference store.

## Skill Types

Androperator documentation uses these skill categories. Keep the names separate:

| Skill type | Primary home | Who discovers it | Purpose |
| --- | --- | --- | --- |
| Runtime skill | Installed skills repo, normally `~/.androperator/skills/skills/` | `androperator skills list`, `androperator skills search`, `androperator skills get`, `androperator skills run` | Reusable app automation package with `skill.json`, `SKILL.md`, scripts, artifacts, and registry metadata. Public runtime skills are authored in the `local skill workspace` repository. |
| Bundled skill | `~/.androperator/bundled-skills/`, copied or linked into host-agent skill directories | Claude Code, Codex, OpenClaw-compatible hosts, or `androperator bundled-skills list` | First-party agent workflow shipped with Androperator, such as orientation, upgrade, discovery, or recording-authoring guidance. It helps an agent operate Androperator, but it is not a runtime app automation package. |
| Personalized skill | User-owned host-agent skill directory, commonly `~/.agents/skills/` | Host-agent skill discovery, such as OpenClaw `agents-skills-personal` | User-scoped wrapper that may hold local assumptions and usually calls one or more runtime skills with `androperator skills run ... --output json`. |
| OpenClaw workspace skill | `~/.openclaw/workspace/skills/` | OpenClaw workspace context loading | Workspace-scoped agent instruction. It may be personalized, but its scope is the OpenClaw workspace rather than the user's shared personal skill home. |

The public `local skill workspace` repository is the source for shared runtime
skills. It is not the home for personal defaults. A personalized skill may call
a shared runtime skill, but it does not become a runtime skill unless it is
converted into the runtime skill file layout and registry contract.

## When To Use

Create or maintain a personalized skill when all of these are true:

| Condition | Required signal |
| --- | --- |
| The user repeats a local workflow | The same intent comes up often enough that a wrapper reduces risk or toil. |
| Generic runtime skills already exist or can be called directly | `androperator skills search`, `androperator skills for-app`, or `androperator skills get` identifies the runtime skill to invoke. |
| The missing piece is local context | The workflow depends on local labels, room names, account profile choice, device graph, preferred defaults, or user-specific navigation state. |
| The skill is scoped honestly | The skill name, description, or notes make clear that the assumptions are local or user-scoped. |
| Private values can stay out of public artifacts | Examples use placeholders such as `<device_serial>`, `<profile_name>`, `<room_label>`, or `<account_label>`. |

Do not create a personalized skill when the user needs a one-time action, when
the route is unsafe to run without confirmation, or when a shared runtime skill
can already accept explicit inputs without local assumptions.

## What Counts As Personalized

Personalized skills include any agent-facing wrapper whose correct behavior
depends on local facts that are not true for every user.

| Category | Personalized value | Sanitized example |
| --- | --- | --- |
| Device graph | Which Android device or operator package to target | `<device_serial>`, `<operator_package>` |
| Local labels | App-specific room, zone, device, or tile names | `<room_label>`, `<device_label>` |
| Account state | Profile names, signed-in account, app region, feature flags | `<profile_name>`, `<account_label>` |
| User preference | Preferred mode, default ordering, safe test target | `<preferred_mode>`, `<safe_test_title>` |
| Local convention | Workspace skill home, wrapper name, runbook path | `<personal_skill_home>`, `<local_config_path>` |

A skill is still personalized even when the runtime skill it calls is generic.
For example, a personal HVAC wrapper may call generic AirTouch runtime skills
from the installed runtime skills repo, but the wrapper remains personalized if
it maps `<user_room_alias>` to one user's actual `<zone_label>`.

## Agent Rules

Use this decision model before creating or invoking a personalized skill:

1. Discover runtime skills first with `androperator skills search`,
   `androperator skills for-app`, or `androperator skills get`.
2. If the runtime skill is a clear match but needs local defaults, create a
   personalized host-agent wrapper rather than changing the runtime registry.
3. Put user-specific defaults in the personal skill home or local config, not
   in public docs, public task files, or shared runtime skills.
4. Name the assumptions. The wrapper should say which categories it depends on,
   such as local labels, profile default, or device graph.
5. Reject missing or ambiguous local values at the wrapper boundary. Ask for
   clarification or inspect the live app before running.
6. For mutating workflows, run only when the user intent is clear and the test
   target is safe. If no safe target exists, record a blocker.
7. Report runtime failures truthfully. Do not convert failed or indeterminate
   runtime output into a natural-language success.

Personalized skills are valid local outcomes. They are not second-class, but
they are scoped. Do not describe them as shared or generic until the personal
assumptions are removed or made explicit inputs.

## Privacy Boundaries

Never commit these values to this repository, public docs, public examples, or
shared skill packages:

| Private value | Public replacement |
| --- | --- |
| Device serials | `<device_serial>` |
| Account identifiers or profile names | `<account_label>`, `<profile_name>` |
| Credentials, tokens, API keys | `<credential_name>` and a reference to local secret storage |
| Exact personal room, zone, device, or tile labels | `<room_label>`, `<zone_label>`, `<device_label>` |
| Personal routines or schedules | `<local_routine>` |
| Local paths that reveal private setup | `<local_config_path>` |

Do not invent storage behavior. Current Androperator runtime skill contracts in
`apps/node/src/contracts/skills.ts` define registry entries, optional agent
runtime config, and optional skill contracts. They do not define a general
encrypted personal preference store.

## Local Versus Shared

Use this table to choose the correct home and claim:

| Skill shape | Home | Claim allowed |
| --- | --- | --- |
| Runtime skill from `local skill workspace` | Installed runtime skills repo and registry, normally under `~/.androperator/skills/skills/` | Generic execution package when its inputs and verification do not depend on one user's private setup. |
| Personalized host-agent wrapper | User-owned agent skill directory such as `~/.agents/skills/` | Local or user-scoped wrapper that may encode private defaults outside public artifacts. |
| OpenClaw workspace skill | `~/.openclaw/workspace/skills/` | Workspace-scoped agent skill for one OpenClaw workspace. |
| Bundled Androperator skill | `~/.androperator/bundled-skills/` plus host discovery entries | First-party Androperator workflow for agents, not a runtime app automation skill. |

Promotion from local to shared requires one of these changes:

- Replace hardcoded personal values with explicit inputs.
- Move defaults into documented local configuration with placeholders in public
  docs.
- Add discovery that reads the live app state before acting.
- Generalize selectors so they target stable UI structure rather than one
  user's labels.
- Document setup requirements that another user can satisfy without private
  knowledge.

## Promotion Checklist

Before presenting a personalized skill as shared, verify:

| Check | Pass condition |
| --- | --- |
| Inputs | Every formerly personal value is an explicit input, documented config, or discovered live value. |
| Privacy | Public files contain placeholders only. |
| Runtime contract | The shared skill has a registry entry and file layout that match [Overview](overview.md). |
| Validation | `androperator skills validate <skill_id> --dry-run` passes for runtime skills. |
| Off-device tests | Parser, normalizer, or command-shape logic has tests that fail on wrong argv or unsafe defaults. |
| Live proof | Device-affecting behavior is proven on a safe target or the blocker is recorded. |
| Result truthfulness | The wrapper reports success only from verified runtime output. |

If any check fails, keep the skill personalized or local.

## Examples

No-argument personal wrapper:

~~~markdown
---
name: home-battery-get-level
description: Read the current home battery level through the local Androperator runtime skill.
---

Run:

```bash
androperator skills run com.example.energy.get-battery --output json
```
~~~

Argument-bearing personal wrapper:

```bash
androperator skills run com.example.media.set-list-state \
  --output json \
  -- \
  --action add \
  --title "<safe_test_title>" \
  --profile "<profile_name>"
```

Local alias wrapper:

```bash
androperator skills run com.example.hvac.set-zone-state \
  --output json \
  -- \
  --zone-name "<zone_label>" \
  --state on
```

These examples are personalized because `<profile_name>` and `<zone_label>` are
local account or home values. A shared version must accept them as inputs,
discover them, or document setup that another user can reproduce.

## Verification

Use this sequence for a personalized wrapper:

1. Run the local wrapper test beside the personal skill.
2. Confirm host discovery.
3. Inspect the skill metadata.
4. Run a safe forward test through the host agent, or record a concrete blocker.
5. Interpret Androperator runtime output using the trust order from
   [Device Prep and Runtime](runtime.md#skill-result-trust-order-and-json-wrapper-policy).

Command pattern:

```bash
~/.agents/skills/<skill_name>/scripts/test_command_shape.sh
openclaw skills list --eligible --json
openclaw skills info <skill_name> --json
openclaw agent --agent <agent_id> --message "<safe request>" --json
```

Use `--agent <agent_id>`, `--session-id <session_id>`, or
`--to <e164_number>` for the forward test unless the OpenClaw host has a
default route. If no safe target or route exists, record that blocker instead
of treating a targetless `openclaw agent --message ... --json` failure as a
skill failure.

Discovery success shape:

```json
{
  "name": "home-battery-get-level",
  "source": "agents-skills-personal",
  "eligible": true,
  "missing": {
    "bins": [],
    "anyBins": [],
    "env": [],
    "config": [],
    "os": []
  }
}
```

Runtime result interpretation:

| Step | Field | Rule |
| --- | --- | --- |
| 1 | top-level wrapper `status` and `code` | Branch here first. If the wrapper is `failed` or `indeterminate`, report that state. |
| 2 | nested `skillResult.status` | Inspect only after wrapper success, or when intentionally describing child state inside a failed wrapper. |
| 3 | `skillResult.result` | Use this as the domain answer when present. |
| 4 | `checkpoints`, `terminalVerification`, `execEnvelopes` | Use as proof and audit detail, not as the default answer path. |

If a host command cannot run safely, record the blocker with the exact command
and reason. A blocker is better than a false success.
