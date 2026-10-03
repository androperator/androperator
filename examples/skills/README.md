# Skills the current agent follows

These optional examples are instructions for the agent already working with the
user. Read a SKILL.md and follow it using Androperator's CLI/API. They do not
launch another Codex process, install a catalog, or require `androperator skills`.
Your host owns skill discovery, orchestration, and optional delegation.

- [Settings observation](com.android.settings.capture-overview/SKILL.md): minimal
  starter that opens Settings and verifies an actual snapshot.
- [Settings version details](com.android.settings.get-version-details/SKILL.md):
  adaptive navigation and independently verified Android version and Build number.
- [Bounded Jev delegation](com.android.settings.get-version-details-with-jev/SKILL.md):
  the current agent supervises an optional external navigation-choice provider.

Copy/adapt instructions into your host's skill format. If you use the optional
helpers, copy the sibling `utils/` directory too. No runtime manifests or index
files are needed to read these instructions. The current agent owns discovery and execution; Androperator supplies actions and evidence.

## Optional helper setup

The version helpers retain raw command output, hierarchy, screenshots, events,
and verification evidence in a fresh local directory. They use only Node built-ins.
From the repository root, build the branch CLI and select a compatible device/APK:

```bash
npm --prefix apps/node run build
node apps/node/dist/cli/index.js devices
```

For the helper commands, supply the following environment on every invocation
(or use one persistent shell). These are helper execution inputs, not collection
discovery configuration. Replace placeholders before executing:

```bash
export ANDROPERATOR_BIN="$PWD/apps/node/dist/cli/index.js"
export ANDROPERATOR_DEVICE_ID="<device_serial>"
export ANDROPERATOR_OPERATOR_PACKAGE="com.androperator.operator.dev"
export ANDROPERATOR_SKILL_ID="com.android.settings.get-version-details"
export VERSION_RUN_DIR="$(mktemp -d)"
export ANDROPERATOR_RUN_ID="run_example-$(basename "$VERSION_RUN_DIR")"
node examples/skills/utils/settings_version_tool.js open
```

Install the matching development APK before branch testing. For a published
CLI/APK pair, set `ANDROPERATOR_BIN` to its executable path and use
`com.androperator.operator`. No Codex login/model configuration is needed: the
current agent makes decisions through its own host. Do not run another controller
on the selected device. Never reuse a run directory, including after failure.

The helper allows at most 18 actions and a 275-second device-command budget.
`finish` independently verifies retained values and emits a compact receipt;
`verified-result.json` retains the full result and correlated execution envelopes.
A helper failure is evidence to inspect, not a success result. Screenshots/tree
captures are separate observations, not proof against occlusion.

Jev is optional and requires `JEV_API_KEY` only for the advanced example. Review
its disclosure policy before use. Keep credentials and raw device evidence local.

## Provenance and validation

Helpers adapt the historical [Settings orchestration PR #52](https://github.com/clawperator/clawperator-skills/pull/52)
and subsequent improvements through `76bad61b5915e70dd53f38111eaf932c5ff92706`.
They are bundled source references; the former catalog is not a runtime dependency.
Unlike those launchers, these examples are followed by the current agent.

Run `node --test examples/skills/tests/*.test.js` for focused observation,
provider-disclosure, deadline, and allowed-choice regressions. Live success on
one emulator is not a physical-device/OEM reliability or latency benchmark.
