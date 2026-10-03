# Optional delegation and orchestrated authoring

The controlling agent can supply Jev or another provider a bounded decision
problem: requested outcome, current capture and coverage, allowed candidates,
necessary relationship evidence, permitted choices including escalation, and
latency/action/fallback budgets. The provider returns a proposal. Validate its
schema, allowed choice, freshness, target eligibility and user authorization
before Androperator executes. Confidence alone authorizes nothing. Reject invalid,
stale, late or unsupported proposals; retain the reason and continue locally
within budget or stop honestly. Missing provider credentials need not prevent
host-agent operation.

Use [Jev integration](https://docs.androperator.com/skills/jev/) for the optional
provider example and its setup. The companion Settings skills
`com.android.settings.get-version-details-codex` and
`com.android.settings.get-version-details-codex-with-jev` illustrate retained
UI extraction, candidate validation, recovery and independent terminal proof.
Inspect their current instructions and helpers before reusing commands. Their
app routes, timing limits and provider choice are not core contracts.

For explicitly requested orchestrated authoring, use the goal-coverage findings
and evidence from discovery; fill any missing discovery context within its budget.
Continue with this loop, the canonical
[authoring workflow](https://docs.androperator.com/skills/authoring/) and the
Settings examples. Define inputs, result evidence, budgets, checkpoints and honest
failure output; keep app policy in the companion skills repository and wrappers
thin. Implement the skill, validate metadata, and prove live navigation and terminal
evidence. Repair failures within the authorized scope and budgets; report any
remaining blocker rather than presenting an unproved skill as complete. Do not
infer authoring permission from an ordinary one-shot request. Recording remains
the route for recording-based authoring; discovery itself does not write skills.

The repository's linked Play Store search skill is a secondary known-route
example. Its script can detect a final sign-in/account screen, but does not
independently establish every claimed app-not-found or details-page condition.
Inspect the actual destination and requested app identity before claiming success.
Its package deep link skips in-app search and cannot prove adaptive navigation.
Do not broaden a search/details request into app installation.
