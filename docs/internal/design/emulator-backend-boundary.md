# Emulator backend boundary

The emulator domain uses the consumer-owned `EmulatorBackend` contract in
`apps/node/src/adapters/android-emulator/contracts.ts`. The single composition
point is `adapters/android-emulator/index.ts`; it currently selects the in-tree
implementation in `legacy/`. No external emulator package, runtime backend
selector, dependency linking or package-version changes are introduced here.

## Responsibilities

The backend owns configured AVD inspection, running-emulator discovery, SDK
availability, image installation, creation, storage configuration, spawn,
registration and boot polling, stop and deletion. It returns SDK facts without
Androperator compatibility fields. Its runtime input is the existing consumer
`RuntimeConfig`, so the supplied process runner, device routing and ADB logging
remain in effect. The ordinary process runner and SDK client are unchanged.

The domain retains Pixel 7 / API 35 / Play Store ARM64 defaults, storage defaults,
compatibility classification, provisioning preferences, developer settings and
output contracts. Creation passes explicit image, profile, capacity, replacement
and license-acceptance policy to the backend. Optional domain values still use
nullish defaults, so blank strings are not silently replaced. CLI and HTTP callers
continue to use the domain facades; they do not import a concrete backend.

`ConfiguredAvd` and `RunningEmulator` extend raw backend facts with consumer
compatibility. Existing import paths for domain functions and types remain valid.
The backend interface is an internal migration boundary, not a new public CLI.

## Launch completion

`startAvd` now returns `Promise<void>`. All CLI, HTTP and provisioning callers
await it before registration and boot waits. The in-tree implementation resolves
a real child process's `spawn` event and converts its asynchronous launch error
to `EMULATOR_START_FAILED`; callers no longer risk an unhandled spawn error.
Spawn completion does not mean registration or Android boot completion. Test
runners without child-process events retain the existing immediate spawn behavior.

Direct imports of the domain launch helper must now await its result and handle
rejections. The CLI and HTTP response shapes are unchanged. Consumer tests cover
a delayed backend failure before any registration wait, both provisioning launch
paths, and HTTP service availability after the failure.

## Preserved behavior and migration follow-up

This preparatory change retains the existing backend's mechanics, including:

- AVD config lookup under the selected AVD directory, without following locator
  redirections. The shared package's locator-aware behavior is a later change.
- Existing installed-image matching and SDK installation behavior. The newer
  Android CLI shim's slash-separated installed-image output is not handled here.
  Use an installed legacy SDK manager via `SDKMANAGER_PATH` where needed.
- Existing stopped/running checks and replacement behavior. The shared library's
  stricter replacement/deletion safety must be evaluated in the migration.
- Both `sys.boot_completed` and `dev.bootcomplete` for readiness.
- Stop acknowledgement without waiting for shutdown, and storage configuration
  without resizing existing userdata or limiting host disk use.

The next migration should implement this interface using a controlled version
of the emulator package, then switch the composition point and delete `legacy/`
in the same runnable change. Adapt the consumer runtime to preserve ADB logging
and serial selection. Keep generic shared process-runner adoption separate unless
its effects on all device execution are explicitly validated. The contract suite
must continue to pass against that implementation.

Before the switch, include the shared package's Android CLI installed-image
parser fix, decide an exact release/artifact and development-linking policy, and
review locator, replacement and failed-install behavior differences. Validate
CLI and HTTP errors, real disposable lifecycle operations, and packed installation.
Catalogs, download progress/cancellation, shutdown waiting and storage resizing
remain separate capabilities. Removing the old implementation before wiring the
replacement would break the intermediate commit and is not the intended rollout.

## Validation

Existing configured/running AVD, lifecycle, provisioning and CLI tests exercise
the retained implementation through the new boundary. `emulatorBackend.test.ts`
checks policy separation and async launch failures at the consumer boundary.
Live host validation uses the branch-local CLI and an isolated `ANDROID_AVD_HOME`
with a disposable AVD. It does not install an Operator APK or alter existing AVDs.
