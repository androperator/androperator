# Agent UX Review Frame

Use this compact checklist for a focused review. Consult
`docs/internal/design/node-api-design-guiding-principles.md` when a decision
needs the fuller design rationale.

---

## The Core Rule

The command an agent tries first, based on intuition from Playwright, adb, GitHub
CLI, or general CLI habits, should work when it maps cleanly to a deterministic
Androperator contract. When it does not, consider an alias or a teaching error
within the requested scope. Report the gap during a review-only task; do not
silently change runtime behavior.

---

## Review Heuristics

- Flat action commands (`click`, `type`, `scroll`) - not organizational namespaces
- One primary documented name, synonyms accepted silently in the parser
- Positional primary argument where the target is obvious
- Simple selector flags (`--text`, `--id`, `--desc`, `--role`) for UI targeting
- `--selector <json>` as escape hatch only, not the common path
- Short generic flag names: `--device`, `--json`, `--text`, `--desc`
- Errors must include: what went wrong, valid options, runnable example
- "Did you mean" redirects for removed, renamed, or misspelled commands
- `--json` output: raw parseable JSON, stable schema, error paths included
- No implementation internals in external command, flag, or schema names
- Deterministic: identical inputs produce identical outputs; error on ambiguity

---

## Findings Worth Reporting

Report an issue when the current API would likely cause an agent to:

- Try a familiar command or flag name that fails without a recovery path
- Need JSON for a single-action workflow that should have simple flags
- Parse pretty output because `--json` is unavailable, unstable, or noisy
- Misread implementation details as user-intent concepts
- Receive an error that omits valid options or a runnable example
- Miss a synonym or alternative placement because tests only cover the happy path

Do not report a preference when the existing shape is already guessable,
deterministic, documented, and tested.
