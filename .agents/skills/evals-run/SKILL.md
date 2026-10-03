---
name: evals-run
description: Run, rescore or diagnose direct-agent Androperator Android evals.
---

# Direct agent evals

Read [the harness documentation](../../../evals/README.md) and select an explicit
device with the matching CLI/Operator. Use the retained android-version eval in
public-surface or full-repo mode. Build the branch-local CLI for local-dev runs.
Inspect `python3 evals/run_eval.py --help` for supported flags.

Use `--dry-run` for configuration, `--rescore <run_id>` for retained answers.
Run `./validation/test_all.sh --suite evals` for host tests. Actual agent runs
need host provider credentials. Preserve transcripts and raw failures; a host
check does not prove live reliability. No runtime-package or replay mode exists.
