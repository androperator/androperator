# Planning migration

Task plans and working context now use notebook-plan. Durable repository knowledge
stays in repository files; documentation cleanup is required at task completion.

## Preserved research

- [System navigation samples and limits](system-gesture-detection-findings.md)
- [Snapshot I/O research](snapshot-io-research.md)
- [Installer compaction review](installer-compaction-review.md)
- [Installer 0.7.4 live validation](installer-074-live-validation.md)
- [Browser Rendering findings](geo-browser-rendering-findings.md)

These are historical observations, not current contract claims. The existing
[result transport record](result-transport-reliability.md),
[GEO design](generative-engine-optimization.md), release reference and public
API docs retain their canonical ownership. Duplicate GEO implementation planning
was retired because the audit helper, skill and design already exist.

## Notebook destinations

Within the notebook's mapped Androperator project folder:

| Task folder | Preserved scope |
| --- | --- |
| `android-system-gesture-detection` | Fixture-first normalization plan, missing samples and product decisions |
| `android-release-apk-snapshot-smoke` | Deferred minified release snapshot validation |
| `android-automotive-screenshot-followup` | AAOS trailing-byte screenshot investigation |
| `node-result-transport-reliability` | Deferred causal investigation and bounded acceptance steps |
| `node-io-optimizations` | Reconcile remaining performance candidates with current work |
| `api-discoverability` | Navigation diagnostics and device-status candidates |
| `api-recording-export-followup` | Recording status, export provenance, concurrency and CLI regression candidates |
| `skills-personalized-skills-followup` | Downstream personal-wrapper cleanup and cross-repo references |
| `doctor` | SDK installation proposal requiring current-code reconciliation |
| `install-followup` | Install-state version metadata and conditional test-slice follow-up |
| `releases-v0.10.x` | Historical delivery queue and publication gates to reconcile before release |
| `geo` | Conditional extraction and crawl watch items |

Migration preserves deferred work without authorizing it. Historical status and
release numbers must be reconciled before resuming. The release-note classifier
continues recognizing historical `tasks/` paths so old task-only commits remain
classified correctly; changelog entries retain their historical titles.
