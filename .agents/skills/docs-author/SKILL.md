---
name: docs-author
description: Author or revise Androperator documentation in docs/. For building the site, use docs-build.
---

# Docs Author

Write documentation that lets the reader use the changed surface correctly.
Verify changed behavioral claims against the owning code; existing docs alone
are not proof.

For page design, terminology, or source lookup, consult the relevant sections of
[the documentation guide](../../../docs/internal/documentation-drafting-north-star.md).
Read it as needed, not once per page. Match detail to the task: a typo fix does
not require an API audit, and a contract page needs enough detail to construct
and interpret a valid call.

## Authored and Generated Boundaries

- Author public content in `docs/`; engineering guidance goes in
  `docs/internal/`.
- The CLI reference `sites/docs/.build/api/cli.md` is generated. Do not create
  an authored `docs/api/cli.md`.
- Fix generated detail in code metadata, generators, or
  `sites/docs/ownership.yaml`. Use `sites/docs/source-map.yaml` for
  code-derived pages and marker expansion.
- Keep one canonical owner for contract detail; link from summary pages.
- For anchors or page moves, consult
  `docs/internal/design/stable-doc-anchors.md`. Explicit HTML anchors such as
  `<a id="action-click"></a>` are supported.
- Preserve exact machine-readable codes in rendered output. If source encoding
  changes them, verify `llms-full.txt` and cover the generator behavior.

## Complete the Change

Review the changed facts, examples, defaults, error behavior, and links against
their sources. Resolve in-scope issues before returning. If documenting a
contract reveals API friction, describe actual behavior and report the design
issue without expanding a docs-only task into runtime changes.

For new or removed public pages, update `sites/docs/mkdocs.yml`, any relevant
source-map entries, and incoming links. Use docs-build to regenerate and run
`./scripts/docs_build.sh` for the completed batch. Review organization warnings
that intersect the change. Commit source and tracked output as a coherent unit;
do not require draft/refinement commits for each page.
