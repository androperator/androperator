# Failure and recovery

Retain the original command response, stderr, individual failed step and evidence
before deciding a recovery. Inspect host `details` or envelope `failureEvidence`:
phase (`readiness`, `dispatch`, `result_wait`, `post_processing`) and dispatch state
(`not_dispatched`, `dispatched`, `unknown`) answer different questions. Requested
command/task IDs are distinct from readiness probe IDs and probe dispatch state.
Inspect `earlierEffects` and preceding successful steps; missing facts do not
establish no effects. A post-processing error can retain an executed result.

After a mutation timeout or failed refresh, clear both public and nested candidate
menus. Preserve old values and capture identity as historical evidence only.
Acquire a bounded fresh read-only observation when eligible; inspect current state
before deciding whether any further mutation is needed. Never replay a preceding
click or scroll implicitly because the following snapshot failed. A fresh capture
restores observation validity, not final task success.

For example, a successful scroll followed by `SNAPSHOT_EXTRACTION_FAILED` should
retain the scroll and failed snapshot separately, inspect extraction diagnostics,
and use an explicitly budgeted fresh snapshot. Do not repeat the scroll. If that
observation also fails or the recovery budget expires, return honest partial or
failed results with the original failure and last useful evidence.

Use child-local diagnostic directories when launching helpers. Core logging
status is exactly `available`, `disabled` or `write_failed`; companion helpers may
use different status vocabulary. Claim artifacts only when persistence succeeded.
Keep bounded previews and raw local evidence private; do not dump raw UI or
credentials into public reports. Preserve pending overlay-review evidence while
invalidating stale targets. A provider error alone does not invalidate an otherwise
current unchanged observation.

The Settings example allows one eligible malformed-XML observation recovery within
ten seconds and the remaining run budget. That is its app-specific policy, not a
universal retry rule. See the canonical [failure evidence](https://docs.androperator.com/api/errors/#execution-failure-evidence)
and [snapshot recovery](https://docs.androperator.com/api/snapshot/#extraction-diagnostics-and-recovery)
contracts. Core does not decide whether to retry.
