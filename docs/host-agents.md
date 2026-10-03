# Host Agent Orientation

## Purpose

Choose the correct Androperator front door after install: runtime-skill discovery
through `androperator skills`, installed authoring-workflow discovery through
`androperator bundled-skills`, long-running tool registration through
`androperator mcp serve`, or direct action work through the CLI and local API.
This page also defines the zero-results route: when runtime-skill discovery
finds no relevant match, start with `androperator-skill-author-by-agent-discovery` and use
`androperator-skill-author-by-recording` only after discovery returns
`proceed_to_recording`, or when the route is already well understood.
If packaged first-party bundled skills are installed, `androperator-agent-orientation`
is the first-run packaged front door for this route and should point back to
this page, while `androperator-upgrade` is the packaged whole-product upgrade
route. It checks `androperator --version`, verifies the installer-owned Node, npm, and
Java prerequisites before choosing the CLI-first path, uses the CLI-first
upgrade sequence when the host is already viable, and falls back to
`install.sh` only as recovery when the CLI is not reachable or the bootstrap
prerequisites still need repair.

## Adaptive execution and goal coverage

After orientation, use `androperator-agent-control-loop` for bounded adaptive
navigation and independently verified extraction. It checks completeness,
coverage, freshness and UI relationships, executes on the explicit target, and
verifies each destination. Conditional references cover ambiguous selectors,
nested rows, selective screenshots, failed-step recovery and optional delegation.
No model provider credential is required by this bundled guidance.

Match runtime skills by requested outcome, supported inputs, outputs and evidence,
not package overlap. A Settings landing-screen skill does not cover OS version
and build-number extraction. Partial coverage remains a discovery gap.

For an explicit orchestrated-authoring request with sufficient bounded evidence,
discovery can return `proceed_to_orchestrated_authoring` with `handoff_target`
`androperator-agent-control-loop`. Discovery stops before authoring; the control
loop then uses the canonical authoring workflow and the Settings examples linked
from [Jev integration](skills/jev.md). Recording-based authoring retains
`proceed_to_recording` and its dedicated proving workflow. One-shot requests do
not authorize durable skill creation. Discovery retains its five-snapshot,
three-screenshot and 90-second limits.

## Public Setup Skill

Use the public setup skill before this page when the host is not installed,
needs repair, or has not been verified yet:

```text
Read https://androperator.com/skill.md and get me set up with Androperator.
```

`https://androperator.com/skill.md` is the outside-agent setup entrypoint. It
covers the installer fallback, direct npm install, `androperator install`,
readiness checks, local orientation files, MCP setup handoff, and stop
conditions for human approval boundaries.

After `androperator install` succeeds, this page takes over as the durable
post-install routing guide. Read the local host guide first when present:

```bash
cat ~/.androperator/AGENTS.md
cat ~/.androperator/install-state.json
cat ~/.androperator/mcp-config-snippet.json
```

Use `~/.androperator/mcp-config-snippet.json` only after deciding that the host
should connect through stdio MCP and `androperator mcp serve`. Use direct CLI
commands or `androperator skills` when the host does not need MCP.

## When To Read This Page

Use this page to orient an installed host. Select the CLI and target before
checking device readiness.

### Select the CLI and target

Respect an explicitly requested CLI. For installed-release workflows, use the
installed `androperator`; the presence of a newer checkout is not evidence that
it needs an upgrade. For repository development, build with
`npm --prefix apps/node run build` and invoke `node apps/node/dist/cli/index.js`
from the repository root. Replace `androperator` in the examples with the chosen
invocation. Inspect its `--version`, `--help`, and command-specific help before
using features that may be newer than the installed release.

```bash
androperator devices
```

With zero reachable devices, stop device work and follow [Setup](setup.md).
Report unauthorized or offline targets rather than substituting another device.
With one reachable device, confirm it matches the intended target. With multiple
devices, resolve the requested serial or ask the user. Carry that explicit
`--device <device_serial>` through device-specific checks and actions in every case.

### Select an installed Operator

Inspect packages on the selected device before recommending installation:

```bash
adb -s <device_serial> shell pm list packages com.androperator.operator
androperator version --check-compat --device <device_serial> --operator-package <operator_package> --output json
```

The package listing is a substring search; distinguish exact names. Public releases
normally use `com.androperator.operator`; repository development defaults to
`com.androperator.operator.dev`. Run the compatibility check for each relevant
installed candidate using the selected CLI. It reports `compatible` and the CLI/APK
versions; current compatibility requires equal versions after normalizing the
trailing debug `-d` suffix. See [Version Compatibility](troubleshooting/compatibility.md).

A mismatched debug package does not imply an installed release package is unusable.
Use a compatible package appropriate to the task, while respecting an explicitly
required variant. Do not silently change the user's CLI or Operator choice.
A failed package query is not proof that the package is absent.

### Check readiness for the selected pair

```bash
androperator doctor --device <device_serial> --operator-package <operator_package> --output json
```

Continue device work only with exit code `0` and `criticalOk: true`. Inspect the
failed check, error code, and skipped prerequisites to choose targeted recovery
from [Setup](setup.md) or [Errors](api/errors.md). Do not default to reinstalling,
upgrading, `--fix`, or `--full`. Doctor includes device probes and may attempt
waking; it is not a passive host-only check. Keep the explicit device and package
on later `snapshot`, `skills run`, and direct-action commands, or configure the
same pair for MCP using [MCP Server](api/mcp.md).

Host-agent readiness is separate. A missing Codex executable or unsupported model
must be resolved for a route that requires it; neither establishes an Androperator
transport failure. Doctor's device success does not prove a model can run.

### Interpret the first result

The agent decides what to do and verifies the user outcome. Androperator executes
validated actions and returns structured evidence. A completed command does not
alone prove a complete observation or a verified user outcome. Check source
completeness and coverage using [Snapshot](api/snapshot.md), then inspect the
resulting app state.

For readiness, dispatch, result-wait, and post-processing failures, use
[Execution failure evidence](api/errors.md#execution-failure-evidence). Preserve
requested-command and readiness-probe identities separately. Even work marked
`not_dispatched` can have earlier preflight effects. Observe before retrying an
uncertain mutation; retained results may show execution despite a later
post-processing failure.

## First Route After Install

Use this order:

1. Read this page.
2. If packaged first-party bundled skills are installed and you are unfamiliar
   with this host, start with `androperator-agent-orientation`. It should verify
   readiness, separate runtime skills from bundled skills, and end with one
   concrete next step.
3. If the user or calling workflow explicitly chose a whole-product refresh,
   use `androperator-upgrade`.
4. If you need an app-specific capability, start with `androperator skills`.
5. If your host already speaks stdio MCP and wants registered tools, use `androperator mcp serve`.
6. If you already know you need raw actions and result envelopes, continue to [Quickstart](quickstart.md).

## Choose The Front Door

| Situation | Start here | Why |
| --- | --- | --- |
| You are unfamiliar with this host and want the packaged first-run orientation surface | `androperator-agent-orientation` | Thin packaged router that points back to this page and the canonical docs. |
| The user or calling workflow explicitly chose a whole-product refresh before you trust any downstream route | `androperator-upgrade` | Checks `androperator --version`, verifies Node 24+, npm reachability, and Java 17/21, then uses `npm install -g androperator@latest`, `androperator install`, and `androperator doctor`. Uses `install.sh` only when the CLI is not reachable or the bootstrap prerequisites need repair. |
| You know the Android package id and want the fastest answer to "what can this host do for this app?" | `androperator skills for-app <package_id>` | `skills for-app` is the primary app-oriented discovery surface. |
| You only know user-language terms such as app name or intent | `androperator skills search --keyword <text>` | Search is the fallback when you do not have the package id yet. |
| You already have a skill id and want the exact metadata | `androperator skills get <skill_id>` | Confirms the registry entry before a run. |
| You want to execute a skill through the wrapper | `androperator skills run <skill_id> ...` | Uses the runtime-skill wrapper and its validation gate. |
| Runtime-skill discovery returned no relevant match and you need the zero-results authoring route | `androperator bundled-skills list` | Bundled skills are separate from runtime skills. Start with `androperator-skill-author-by-agent-discovery`, then use `androperator-skill-author-by-recording` only after discovery returns `proceed_to_recording`, or when the route is already well understood. |
| Your host already supports stdio MCP and wants registered tools such as `devices`, `snapshot`, `execute`, and `configure` | `androperator mcp serve` | MCP is the transport surface for long-running tool registration. |
| You already know the exact action payload you want to send | [Quickstart](quickstart.md) | Quickstart covers the observe / decide / act loop directly. |

## Runtime-Skill Discovery Flow

Use the shortest successful path first:

```bash
androperator skills for-app <package_id>
androperator skills search --keyword <text>
androperator skills get <skill_id>
androperator skills run <skill_id>
```

Decision rules:

- Start with `skills for-app` when you know the Android package id.
- Use `skills search --keyword` when you only have a user-language term.
- Use `skills get` before `skills run` when you need to confirm the exact id or summary.
- Use `skills run` only after discovery, not as the first probe.
- Do not start with `skills list` unless the real task is inventory rather than
  app-oriented discovery.
- If discovery returns zero relevant matches and the next job is skill creation
  rather than raw execution, inspect installed bundled skills with
  `androperator bundled-skills list`, start with
  `androperator-skill-author-by-agent-discovery`, and continue to
  [Authoring](skills/authoring.md).

## Zero-Results Route

Use this authoring decision table only after runtime-skill discovery found no
relevant installed match.

| Situation | Next surface | Expected outcome |
| --- | --- | --- |
| No relevant runtime skill match and the next job is choosing the truthful route | `androperator bundled-skills list` | Confirm the installed bundled-skill front doors on this host. |
| You need the bounded zero-results front door | `androperator-skill-author-by-agent-discovery` | Produce one discovery artifact and choose exactly one next step. |
| Discovery returns `proceed_to_recording`, or the route is already well understood | `androperator-skill-author-by-recording` | Run the proving workflow from a fresh recording and one self-test. |
| You explicitly want the low-level manual scaffold instead of the installed guided workflows | `androperator skills new <skill_id>` | Create a local scaffold only. |

The discovery pass should stay agent-driven by default. If discovery returns
`proceed_to_recording`, the next phase changes boundary: use
`androperator-skill-author-by-recording` as a user-performed proving workflow rather than
continuing autonomous device driving through the recording step.

## MCP Decision Rule

Use `androperator mcp serve` only when the host already wants MCP.

Use [MCP Server](api/mcp.md) for:

- stdio MCP client setup
- long-running MCP sessions
- tool registration for hosts such as Claude Desktop

Do not use MCP as the first discovery surface when the real question is
"what runtime skills are installed for this app?". Start with
`androperator skills` for that job.

## When Discovery Stalls

Use this sequence:

Run `androperator skills list` from your project to inspect local skills. An
empty list means no local skill is available; it is not an installation failure.
Inspect `skills/<skill_id>/skill.json` if loading reports an error. See
[local lookup rules](skills/overview.md#registry).

When no skill matches, inspect `androperator bundled-skills list` and use the
installed authoring helpers or the optional
[Settings examples](https://github.com/androperator/androperator/tree/main/examples/skills).

Then continue to [Authoring](skills/authoring.md), start with
`androperator-skill-author-by-agent-discovery`, and move to `androperator-skill-author-by-recording`
only after discovery returns `proceed_to_recording`, or when the route is
already well understood.

## Durable Post-Install Files

These files help a host orient after install:

| Path | Meaning | Next step |
| --- | --- | --- |
| `~/.androperator/AGENTS.md` | Local Androperator guide written by `androperator host setup` during install | Use it as machine-local context after you read this public route. |
| `~/.androperator/install-state.json` | Durable install metadata written by `androperator host setup` | Check `registryPath`, `cliVersion`, and `lastDeviceSerial` without rerunning install. |
| `~/.androperator/mcp-config-snippet.json` | Paste-ready MCP config written by `androperator host setup` | Use it when you choose the MCP route. |
| `~/.androperator/skills/skills/` | Optional local runtime skills | Each skill has its own `skill.json`; no catalog or index is required. |
| `~/.androperator/bundled-skills/` | Installed first-party bundled skills | Inspect it through `androperator bundled-skills list` when runtime discovery returns no relevant match. |
| `~/.agents/skills/<androperator-bundled-skill>/` | Managed real directory copies for generic agent skill discovery | Generic agents such as OpenClaw can discover packaged Androperator bundled skills without following symlinks outside `~/.agents/skills`. |

## Verification

Use these commands to confirm the intended surface is working:

```bash
androperator --help
androperator skills --help
androperator bundled-skills --help
androperator skills for-app com.android.settings
androperator skills search --keyword settings
androperator skills get com.android.settings.capture-overview
androperator skills list
androperator bundled-skills list
test -d ~/.agents/skills/androperator-agent-orientation
test ! -L ~/.agents/skills/androperator-agent-orientation
```

Check:

- `androperator --help` and `androperator skills --help` name `androperator-agent-orientation` as the first-run surface for unfamiliar hosts and point zero-match users to `androperator bundled-skills list`
- `androperator --help` and `androperator skills --help` name `androperator-upgrade` as the packaged whole-product refresh route and note the Node, npm, and Java prerequisite gate
- `androperator bundled-skills --help` names `androperator-agent-orientation` as the first-run orientation skill, `androperator-upgrade` as the packaged whole-product upgrade route after explicit upgrade intent and prerequisite viability, `androperator-skill-author-by-agent-discovery` as the zero-results front door, and `androperator-skill-author-by-recording` as the proving workflow
- `skills for-app`, `skills search`, and `skills list` return top-level `skills` and `count`
- `skills get` returns a top-level `skill`
- `bundled-skills list` returns top-level `skills`, `count`, and `installedDir`
- `bundled-skills list` includes `androperator-agent-orientation`, `androperator-upgrade`, `androperator-skill-author-by-agent-discovery`, and `androperator-skill-author-by-recording` in `skills[].name`
- packaged Androperator bundled skills under `~/.agents/skills/` are real directories, not symlinks

For MCP:

```bash
androperator mcp serve
```

Check:

- the process starts without printing normal CLI help
- the process remains attached to stdio for the MCP client

## Read Next

| Topic | Page |
| --- | --- |
| Install and device readiness | [Setup](setup.md) |
| Raw observe / decide / act loop | [Quickstart](quickstart.md) |
| Runtime-skill registry and wrapper behavior | [Skills Overview](skills/overview.md) |
| Authoring-workflow install and current boundaries | [Authoring](skills/authoring.md) |
| MCP client setup and tool surface | [MCP Server](api/mcp.md) |
