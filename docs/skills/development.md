# Developing reusable instructions

1. Define the requested outcome and evidence needed to prove each part.
2. Select an explicit device and compatible CLI/Operator; run doctor.
3. Observe current state and follow one bounded action at a time.
4. Save instructions with inputs, likely route, supported deviations and limits.
5. Validate optional helpers with focused tests of evidence and failure handling.
6. Follow the instructions live and verify the result from retained observations.

Use the branch-local CLI for repository development. Install a matching debug
APK when Android code or build identity changes. Never run concurrent controllers
on the target. Preserve raw failures and distinguish requested command IDs from
readiness probes. A timeout or uncertain dispatch requires observation before retry.

A human recording is optional evidence, not a mandatory authoring gate.
See [authoring](authoring.md), [examples](examples.md) and
[device readiness](runtime.md).
