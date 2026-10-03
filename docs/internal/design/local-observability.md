# Local Android observability

The Operator has no Firebase SDK, Google Services or Crashlytics integration.
It requires no Firebase registration or remote task-status service.

`MainApplication` retains the uncaught-exception handler and writes
`files/crash-log.txt` through `LocalCrashLog`. `CrashTrackingLocal` records
non-fatal exceptions and diagnostic messages there and in logcat. Fatal
exceptions retain their caller-visible behavior. Logging stays on the device.

`TaskStatusReporter` remains the task lifecycle interface. Its default
implementation writes a JSON event to logcat under `[Androperator-TaskStatus]`,
including task ID, device ID, status, message, progress, result and error code.
It reports success only after the local sink accepts the event, and returns
logging failures to its caller. It never performs an HTTP request.

Agents can inspect the private log through `adb shell run-as` for development
builds and observe logcat on the selected device. This does not introduce a
cloud telemetry replacement.
