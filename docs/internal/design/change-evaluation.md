# Evaluate benefit before production integration

A change should solve a concrete user problem at a reasonable adoption and
maintenance cost. Correctness checks remain necessary; they cannot establish
that the feature is useful. Apply the preflight in `AGENTS.md` before substantial
changes and reassess the result before production closeout.

## Lessons from the agent-loop experiments

These closed, unmerged PRs illustrate different failure modes, not a reason to
avoid experiments:

| Work | Evidence and lesson |
| --- | --- |
| [#398](https://github.com/androperator/androperator/pull/398): persistent CLI execution in the daemon | Five physical-device pairs showed no meaningful task gain: median 28.113 s to 28.158 s. The earlier 14.8% in-process result avoided repeated Node startup; the transparent CLI still paid startup, ownership and communication costs. A different execution path needs its own proof. |
| [#399](https://github.com/androperator/androperator/pull/399): reduce launcher overhead | Mean task improvement was 2.05%, median 2.55%; three pairs improved and two regressed. Packaging, context matching and fallback complexity outweighed the demonstrated benefit. Investigate the remaining ceiling before another production refactor. |
| [#400](https://github.com/androperator/androperator/pull/400): rendering verification helper | Tests and reviews passed, but callers still supplied acquisition, context checks and visual recognition. Reduced captures were the default without a maintained reduced backend. Existing CLI users gained no automatic benefit. Validate the useful consumer and supported default before publishing an abstraction. |

The avoidable cost was extensive integration and polishing before deciding
whether to ship. Negative experiments were valuable; repeated completion reviews
could not resolve the missing product benefit. Preserve useful findings and
reliability tests without making the experimental interface a production promise.

## Compare the path users will actually run

- State what the prototype removed and what production must retain: process
  startup, transport, validation, ownership, readiness and recovery costs.
- Keep baseline, workload, observation requirements and timing boundaries
  comparable. Request arrival before parsing is not equivalent to arrival after
  parsing. Do not add overlapping component savings or transfer percentages
  between different batches and baselines.
- Measure the complete workflow as well as components. Separate cold startup
  from warm operation; retain failures, pilots, retries and run-to-run variation.
  A small single-device result does not establish broad reliability or model accuracy.
- Estimate the remaining opportunity before refactoring. In #399, screenshots
  consumed roughly 13 seconds of a 29-second task; further launcher work had
  much less room. That motivates a capture experiment, not a promised speedup.
- Preserve output, readiness, correlation and no-replay behavior. A faster run
  that drops required evidence or checks is not an equivalent improvement.

## Make the product decision explicit

Show a real usage example and list what callers must build. Androperator should
provide reliable deterministic actions and observations; app-specific strategy
and acceptance conditions stay with agents or skills. A helper that merely wraps
caller-owned hard work needs a demonstrated consumer before becoming public API.

Choose acceptance and stopping conditions before measuring. They depend on the
benefit and complexity, not a universal speed percentage. Use the smallest
experiment on the intended path, then decide whether its evidence warrants
production hardening. Do not defer checks necessary to make the experiment safe
or its comparison valid.

At closeout, compare actual outcomes with the original criteria and remaining
caller burden. Proceed when justified; otherwise explain the shortfall and
recommend narrowing or stopping. Preserve sanitized evidence and actionable
follow-up in project docs; use the notebook for working context. Do not silently
replace a requested feature with an experiment, close a PR, or delete work without
authorization. When a user explicitly chooses to proceed despite a known tradeoff,
record it and retain required correctness validation.
