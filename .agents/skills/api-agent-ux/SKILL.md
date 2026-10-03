---
name: api-agent-ux
description: Design or review Androperator CLI/API ergonomics, including naming, selectors, errors, and output contracts.
---

# API Agent UX

Assess whether a capable agent's likely first attempt maps to a clear,
deterministic Androperator contract. Familiarity is a useful design signal, not
permission to weaken validation or infer hidden intent.

Read the owning implementation for the surface under discussion; use
`AGENTS.md` for source routing.

- For naming or contract design, consult the relevant principles in
  `docs/internal/design/node-api-design-guiding-principles.md`.
- For a focused review, use
  [references/agent-ux-review-frame.md](references/agent-ux-review-frame.md)
  as a compact checklist. Consult the full design note when rationale matters.

## Decision Criteria

Look for likely failures: an intuitive command rejected without recovery,
unnecessary JSON for a simple action, confusing selector names, unstable output,
or errors that do not teach a valid next attempt.

When a familiar form maps unambiguously to the existing behavior, consider a
parser alias, clearer primary name, selector flag, or teaching error. A docs
rewrite alone will not make a rejected command parse. Keep exactly one primary
documented form and avoid hidden heuristics.

Recommend or implement the smallest useful change within the requested scope.
For review-only work, including a review-swarm pass, remain read-only and report
material findings. A documentation request does not authorize API changes.

For implementation, verify canonical and alias forms, valid/invalid/missing
values, supported flag placements, structured JSON, and exit codes as relevant.
Keep help text and authored docs aligned with the parser.

For each review finding, identify the file and line or symbol, likely user
failure, evidence, and proposed fix. Omit preferences that do not change usability
or correctness.
