# Local skill examples

Androperator provides deterministic actions and evidence. Agents supply goals,
navigation decisions, and reusable skills. These examples are optional source
references, not an app-skill catalog, and installation does not copy them.

- `com.android.settings.capture-overview`: a minimal executable starter. It opens
  Settings and captures evidence; it does not claim version extraction.
- `com.android.settings.get-version-details-codex`: the primary adaptive example.
  Codex chooses navigation; local helpers independently verify exact Android
  version and Build number against live label/value rows and read-value envelopes.
- `com.android.settings.get-version-details-codex-with-jev`: advanced bounded
  delegation. Codex retains responsibility for recovery and verification; Jev
  selects only from fresh, allowlisted navigation candidates.

From the repository root, build the branch CLI and select this collection:

```bash
npm --prefix apps/node run build
export ANDROPERATOR_SKILLS_DIR="$PWD/examples/skills"
node apps/node/dist/cli/index.js skills list
node apps/node/dist/cli/index.js skills validate --all
node apps/node/dist/cli/index.js skills run com.android.settings.capture-overview \
  --device <device_serial> --operator-package com.androperator.operator.dev
```

Install the matching debug APK before branch testing. For a release CLI/APK pair,
use `androperator` and `com.androperator.operator` instead. Select an explicit
compatible device; no other controller may use it during a run.

To run the primary example, authenticate the selected `codex` executable and
set `VERSION_CODEX_MODEL` to a model it supports. Then:

```bash
node apps/node/dist/cli/index.js skills run com.android.settings.get-version-details-codex \
  --device <device_serial> --operator-package com.androperator.operator.dev \
  --timeout 300000 --output json
```

The advanced example additionally needs `JEV_API_KEY`. Keep the key out of logs.
Read each SKILL.md for action limits, deadlines, disclosure boundaries, overlay
review, observation recovery, and success requirements. No provider dependency
is added to the core runtime. These examples use only Node built-ins.

Adapt copies in a workspace containing `skills/`, including the shared `utils/`
folder. No index generation or catalog checkout is required. Existing indexed
workspaces remain readable for migration; remove their optional index to switch
to direct manifest discovery, after checking that every indexed skill has a
complete skill.json.

## Provenance and validation

The Codex and Jev examples adapt the historical
[Settings orchestration PR #52](https://github.com/clawperator/clawperator-skills/pull/52)
and subsequent improvements through source commit
`76bad61b5915e70dd53f38111eaf932c5ff92706`. Shared helpers are bundled here;
the former repository is not a runtime dependency. The CLI resolver now uses
Androperator names and the wrapper-selected CLI rather than sibling catalog paths.

Run `node --test validation/skills/*.test.js` for evidence, privacy, stale-state,
recovery, deadline, and result-verification regressions. Live runs retain raw
command responses, screenshots, hierarchy, agent transcript, events, and metadata
locally. A parsed response or zero exit code is not proof of the intended screen
or exact extracted values. Never commit run evidence or device identifiers.
