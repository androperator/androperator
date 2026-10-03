# Direct Android evals

The android-version eval asks the current host agent to navigate Settings and
read the Android version through Androperator. Public-surface and full-repo
modes retain transcripts, execution evidence, budgets and exact answer scoring.
Runtime-package generation, catalog cold-start and replay modes are removed.

Build the branch-local CLI before local-dev runs. Select an explicit device and
matching development Operator. Host provider credentials are required only for
an actual agent run; host tests do not prove live app reliability.

```bash
python3 evals/run_eval.py --help
./validation/test_all.sh --suite evals
```

Use `--dry-run` to inspect configuration and `--rescore <run_id>` to re-evaluate
retained direct-agent answers. See [the Settings spec](specs/android-version/spec.json)
and its public/full-repo prompts for scoring and allowed evidence.
