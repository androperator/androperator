# Known Issues

## Package-list failure can look empty

The package-list handler currently consumes ADB stdout without checking its exit
code. A failed query with empty stdout can appear as `{ "packages": [] }`.
Do not use that result alone as proof of absence. Inspect target/tool diagnostics;
see [package discovery](../api/devices.md#packages). Fixing exit handling requires
a separate runtime change; documentation does not make this result reliable.

## Diagnose and report

Use [capability-appropriate doctor](../host-agents.md#choose-readiness),
[version compatibility](compatibility.md), and the actual [error/failure evidence](../api/errors.md).
After uncertain dispatch, observe state before repeating a mutation. Retain
command/task IDs, CLI/Operator versions, failed steps and relevant
[NDJSON logs](../api/logging.md), with private values removed before sharing.

Report reproducible defects in [GitHub issues](https://github.com/androperator/androperator/issues)
with the trigger, command, actual output, expected outcome and any bounded
workaround. Absence from this page does not establish that a problem is fixed.
