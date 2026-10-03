---
name: docs-build
description: Build or regenerate the Androperator docs site and llms-full.txt from canonical sources.
---

# Docs Build

Run the complete pipeline from the repository root:

```bash
./scripts/docs_build.sh
```

The script builds Node, assembles `sites/docs/.build/`, runs MkDocs, generates
`llms-full.txt`, copies static root files, and validates routes. It also reports
warning-only organization checks. There is no need to run assembly separately
before a normal build.

## Source Boundaries

`docs/` owns authored pages; `apps/node/src/` owns CLI/API behavior.
`sites/docs/static/` owns static root files. `sites/docs/.build/` and
`sites/docs/site/` are generated: fix the source or generator and rebuild.
Commit source fixes and tracked generated changes together.

For content work, use `docs-author`. For pipeline or routing changes, consult
[references/repo-docs.md](references/repo-docs.md), `sites/docs/mkdocs.yml`,
and `sites/docs/source-map.yaml` as relevant. Command detail links are owned
by `sites/docs/ownership.yaml`.

## Targeted Diagnostics

Use only the helper relevant to the failure, then rerun the complete build
after a fix:

- `scripts/assemble.py`: staging assembly.
- `scripts/generate_cli_reference.py`: CLI reference.
- `scripts/generate_error_table.py`: error markers.
- `scripts/generate_selector_table.py`: selector markers.
- `scripts/generate_mcp_tool_summary.py`: MCP summary.
- `scripts/generate_llms_full.py`: machine-facing full docs.
- `scripts/validate_docs_organization.py`: warning-only organization checks.

These paths are relative to this skill directory. Keep navigation and output
paths stable unless the requested change requires moving them. For deleted
pages, remove nav, source-map entries, and incoming links before regeneration.

Finish when the pipeline passes and the generated diff reflects the intended
source change. Report relevant warnings and unresolved failures accurately.
