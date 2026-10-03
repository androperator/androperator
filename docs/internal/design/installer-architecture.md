# Installer Architecture

## Purpose

Keep the Androperator install path easy to reason about, test, and recover.

This note defines the ownership boundary between the public shell installer at
`sites/androperator-public/install.sh` and the Node CLI install surfaces. Use it when
changing setup, upgrade, host artifact generation, operator remediation,
bundled-skill installation, or install validation.

## Source Of Truth

| Surface | Authority |
| --- | --- |
| Shell bootstrap behavior | `sites/androperator-public/install.sh` |
| Top-level install command and help | `apps/node/src/cli/registry.ts` |
| CLI-owned post-bootstrap flow | `apps/node/src/cli/commands/install.ts` |
| Operator remediation policy | `apps/node/src/cli/commands/operatorRemediate.ts` |
| Host artifact generation | `apps/node/src/domain/host/hostSetup.ts` |
| Install shell validation | `validation/install/README.md`, `validation/install/test_install.sh` |
| Public setup behavior | `docs/setup.md` |
| Upgrade skill behavior | `apps/node/bundled-skills/androperator-upgrade/SKILL.md` |

## Core Rule

`install.sh` is a bootstrap wrapper. It is not the installer brain.

Product behavior should live in the Node CLI whenever Node can already run. The
CLI is typed, easier to unit test, easier to expose through stable JSON, and
directly callable by agents and host tooling.

The canonical post-bootstrap route is:

```bash
androperator install
```

The shell installer delegates to that route after it finishes shell-owned
prerequisite bootstrap.

## Shell Ownership

`install.sh` owns only behavior required before the CLI can reliably run, plus
shell-specific user guidance.

The shell may own:

- OS validation for supported host families
- Java detection and provisioning
- Node.js detection and provisioning
- `curl`, `adb`, and `git` presence or provisioning
- `npm install -g androperator@latest`
- freshly installed CLI binary discovery
- top-level shell error trapping around bootstrap failures
- shell activation hints such as `source ~/.zshrc`
- pass-through invocation of `androperator install`

The shell should stay small, linear, and boring. A future shell change should be
suspicious if it needs arrays, JSON parsing, multi-step product state, or
branch-heavy summary formatting.

## CLI Ownership

The Node CLI owns Androperator install behavior after the CLI is available.

`androperator install` should own:

- operator remediation orchestration
- bundled-skills install, including canonical bundled-skill copies, Claude and
  Codex discovery symlinks, and managed real directory copies under
  `~/.agents/skills/`
- host setup
- state threading between those steps
- installer-facing JSON output
- installer-facing pretty output
- warning and failure classification
- follow-up command guidance

Lower-level commands must remain reusable and truthful:

- `androperator operator remediate`
- `androperator bundled-skills install`
- `androperator host setup`

`androperator install` orchestrates those surfaces. It should not make them
private implementation details.

## Things The Shell Should Not Do

Do not add these responsibilities to `install.sh`:

- parse CLI JSON
- maintain post-bootstrap device arrays or counters
- decide operator remediation policy
- decide host artifact success or warning semantics
- format device remediation summaries
- format host artifact summaries
- install bundled skills by re-implementing CLI logic
- write Androperator host artifacts directly
- decide whether shared-agent bridge failures are fatal
- encode multi-device policy

If a proposed shell change needs one of those behaviors, implement or extend a
CLI surface instead.

## Result Contracts

Installer behavior must be machine-checkable.

Node install surfaces should prefer stable JSON for automation and focused
tests. Pretty output is for humans and shell pass-through, not for downstream
state extraction by bash.

The shell should trust the CLI exit code and output. It should not parse the
pretty output or decode JSON back into shell variables.

## Validation Boundary

Shell validation should prove shell-owned behavior:

- bootstrap checks gate execution
- `install_cli()` selects the freshly installed binary
- `install.sh` delegates to `androperator install` with the expected arguments
- delegated exit codes propagate correctly
- shell-specific guidance appears only on appropriate paths

Node tests should prove product behavior:

- post-bootstrap sequencing
- operator remediation policy
- bundled-skills warning behavior
- host artifact warning behavior
- multi-device summaries
- no-device and remediation-failure paths
- JSON and pretty output contracts
- CLI help and usage errors

When behavior moves from shell to Node, move the detailed tests with it.

## Change Checklist

Before adding install behavior, ask:

1. Can this run after Node is available?
2. Can this be expressed as a CLI command or option?
3. Does this need structured output?
4. Would an agent need to call this without going through `install.sh`?
5. Would a unit test be clearer in TypeScript than in bash?

If the answer to any of those is yes, prefer the CLI.

Before editing `install.sh`, verify:

1. the behavior must happen before Node or npm is available, or
2. the behavior is shell-specific activation or error handling, or
3. the shell is only delegating to a CLI-owned surface.

Before changing install validation, verify:

1. shell harnesses cover only bootstrap and delegation behavior
2. Node tests cover install policy and result contracts
3. `./validation/install/test_install.sh` remains the install validation
   entrypoint

## Related Docs

- `docs/setup.md`
- `docs/internal/design/agent-host-integration.md`
- `docs/internal/release-reference.md`
- `validation/install/README.md`
