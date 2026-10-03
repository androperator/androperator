---
name: androperator-agent-control-loop
description: Execute Android goals that need adaptive navigation or verified extraction with Androperator. Use also for explicitly requested orchestrated skill authoring after bounded discovery.
---

# Androperator Agent Control Loop

Complete the requested Android goal with independently verified results, or return
a supported partial or failed outcome when a blocker or budget prevents completion.
For authorized orchestrated authoring, continue through implementation, metadata
validation and live proof using the authoring reference below.

The agent owns decisions and verification; Androperator executes. Use
`androperator-agent-orientation` if the CLI, device and Operator have not already
been selected and checked. Discover runtime skills and inspect actual goal
coverage before choosing this loop. No provider credential is required.

## Execute the goal

1. Define the outcome, separately required fields and independent success evidence.
   Declare action, observation, elapsed-time and recovery budgets appropriate to
   this goal. Obtain exclusive controller ownership of the selected device.
2. Observe current state. Check source completeness, projection coverage, freshness,
   foreground and relevant label/value or target/container relationships. Keep the
   original response, capture identity and local evidence. A completed command is
   neither a complete observation nor a verified outcome.
3. Choose one bounded next step from current evidence: extract, query, navigate,
   scroll an observed container, answer a specific visual question, or recover.
   Known-good routes guide decisions; observe their intermediate screens. Do not
   treat a package match, missing offscreen label or model confidence as proof.
4. Execute through the selected Androperator CLI with `--device <device_serial>`
   and `--operator-package <operator_package>`. Check relevant command help.
   Serialize actions; invalidate candidates after transitions or uncertain effects.
5. Observe and verify the destination or changed state. Continue only within the
   declared budgets. Never implicitly replay a mutation when its later snapshot
   failed. Preserve original failures alongside any successful recovery.
6. Return each independently supported result with its UI label, value, capture
   and action/read evidence. Distinguish partial, failed and verified outcomes;
   report failure phase, last useful evidence and remaining unknowns. Stop at a
   blocking sign-in, consent ambiguity, unavailable target or exhausted budget.

## Conditional references

- [Observation and targeting](references/observation.md): incomplete views,
  offscreen/moved controls, nested rows, ambiguous selectors or visual questions.
- [Failure and recovery](references/recovery.md): failed steps, timeouts,
  interruptions, prior effects and retained diagnostics.
- [Delegation and authoring](references/delegation.md): optional model proposals,
  Settings examples, or an explicit request to author an orchestrated skill.
