# Post-action rendering verification

## Ownership and scope

The public contract is [optional Node rendering verification](../../api/evidence.md#optional-post-action-rendering-verification-node).
`apps/node/src/domain/observe/renderVerification.ts` owns bounded observation,
verification and fallback. Agents or skills own destination predicates. Acquisition
adapters own canonical device checks, fresh capture and before/after context.
Existing CLI action success and result envelopes are unchanged.

This is an adapter-based Node helper, not a built-in visual recognizer or an
automatic CLI wait. Neither OCR nor an accelerated capture backend ships with
it. A caller must supply both adapters. The experimental physical consumer is
[`validation/render-verification/live.mjs`](../../../validation/render-verification/live.mjs);
its [report](../../../validation/render-verification/findings.md) and
[reproduction instructions](../../../validation/render-verification/README.md)
are committed project evidence. No external notebook is needed to understand
or continue this work. Private device artifacts are not required reading.

## Invariants for changes and adapters

- Preserve the canonical action receipt and its command/task correlation.
  Observation failure does not undo action success or authorize replay.
- Verify semantic evidence and the exact retained PNG independently. Return the
  image that passed, not a subsequent unverified capture.
- Bound retries, total time and fallback. A larger fresh image must pass the same
  predicate; full resolution is not itself proof of correctness.
- Reject invalid device/capture correlation, geometry, PNGs and ambiguous or
  unsafe acquisition. Relevant context changes reject that observation.
- Keep acquisition and verification read-only. A callback that outlives its
  deadline cannot publish success or overlap a new call on that verifier instance.
  Instances are not a global device lock; the caller prevents other navigation.
- Do not claim atomic tree/frame acquisition or general visual settling. Context
  keys and predicate correctness remain trusted adapter responsibilities.
- A painted heading may have an invisible, zero-width accessibility node. Use
  independently visible page content as semantic evidence and actual heading
  pixels as visual evidence; do not relabel inaccessible content as visible.

## Evidence and limits

The physical report records three alternating pairs on one Pixel 10 Pro/API 37,
12 successful ordinary phase checks and five injected fault cases. It retains
failed pilot outcomes as well as successful measurements. Quarter captures used
an experimental persistent shell helper and local macOS OCR; full captures used
the canonical CLI. Measurements cover complete observation paths, not merely
image resizing or a full model-driven task. Arrival retry counts differed.

The report includes exact timings, predicates, attempt counts, failure injection
and validation. Those findings justify bounded independent verification; they
do not establish portable hidden-API support, natural failure rates, or reduced
image accuracy for Jev/OpenAI Decisions.

## API and documentation tightening still outstanding

These are review findings, not implemented behavior. Keep the public reference
accurate until corresponding code and regression coverage change.

| Gap | Next change and acceptance |
| --- | --- |
| Short timeout with omitted reserve fails, including full-only mode | Make reserve semantics appropriate for full-only and short-budget calls. Preserve strict explicit-value validation; cover default and explicit budgets and document exact omission semantics. Current workaround: explicitly provide a valid reserve. |
| Acquisition does not receive the request's device or condition | Pass explicit context into the acquisition contract, or deliberately bind it in the factory. Test multiple calls with different devices/conditions without mutable external context. Until then, adapters must bind matching context themselves. |
| Generic argument and observation errors do not teach recovery | Add field-specific argument errors and safe structured failure stage/reason details. Distinguish acquisition, verification and evidence validation without exposing arbitrary exception contents or weakening fail-closed behavior. |
| The public example is an adapter-wiring sketch | Add a concrete canonical full-resolution acquisition example with an explicitly supplied visual verifier and worked outcomes. Keep experimental reduced capture separate; do not imply a portable built-in recognizer exists. |

## Subsequent capture-backend work

Keep this separate from verification orchestration:

1. Define a maintained Node capture adapter and helper ownership/lifecycle.
   Specify setup, doctor capability probes and supported Android builds.
2. Preserve fresh request identity, native geometry and rotation handling before
   publishing pixels. Test process death, startup failure, reconnect, cancellation
   and stale output. Fail closed on unknown, locked or protected states.
3. Provide explicit canonical full-resolution fallback with independent
   verification; never replay navigation or disguise an unknown failure as success.
4. Test multiple physical devices/builds and emulator behavior. Compare warm/cold
   capture and complete observation timings with the same acceptance predicates.
5. Then measure actual model accuracy and end-to-end Jev/Decisions task completion
   at reduced resolution. Separate injected failures, pilots and normal trials.

Do not infer Android app permissions from success under ADB shell identity.
Internal APIs used by the experiment need an explicit compatibility and execution
identity design before becoming a maintained capture backend.
