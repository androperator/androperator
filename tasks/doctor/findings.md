# Task: Doctor - SDK Installation Gap

Created: 2026-03-11

## Finding

The `doctor` command currently has no SDK installation logic. It assumes Android
SDK tools (`emulator`, `sdkmanager`, `avdmanager`) are already present on the
host machine. This is a gap: the stated goal is that `doctor` should install the
Android SDK if it is not found.

## Current behavior

`getDefaultRuntimeConfig` resolves SDK tool paths as follows:

1. Check `$ANDROID_HOME` (or `$ANDROID_SDK_ROOT`) - if set and the expected path
   exists under that root, use the full path.
2. Fall back to bare tool names (`"emulator"`, `"sdkmanager"`, `"avdmanager"`),
   which rely on the OS PATH lookup at spawn time.

`adb` has always been bare-name only (PATH-based), consistent with this design.

No platform-specific candidate paths are hardcoded. The resolution strategy is
intentionally portable.

## Required behavior (not yet implemented)

When `doctor` detects that SDK tools are missing (not found via `$ANDROID_HOME`
and not resolvable on PATH), it should:

1. Check `$ANDROID_HOME` / `$ANDROID_SDK_ROOT` first - if already set and valid,
   skip installation entirely.
2. Check if tools are resolvable on PATH - if they are, skip installation.
3. Only if both checks fail: download and install the Android command-line tools
   to a well-known Androperator-managed location (e.g. `~/.androperator/android-sdk/`).
4. After install, export `ANDROID_HOME=~/.androperator/android-sdk/` into the
   user's shell RC (same pattern as `ANDROPERATOR_SKILLS_REGISTRY` in `install.sh`).

## Contract for any doctor SDK install implementation

- Never overwrite an existing valid `$ANDROID_HOME`.
- Install location must be OS-agnostic (no macOS or Homebrew assumptions).
- After install, `getDefaultRuntimeConfig` must pick up the tools automatically
  via `$ANDROID_HOME` - no code changes to `runtimeConfig.ts` should be needed.
- The doctor check and the install step should be separated so the check can run
  read-only in diagnostic mode.

## System image installation

`provision emulator` requires the correct Android system image to be installed
on the host. The supported target is defined in
`apps/node/src/domain/android-emulators/constants.ts`:

```
SUPPORTED_EMULATOR_API_LEVEL = 35
DEFAULT_EMULATOR_SYSTEM_IMAGE = "system-images;android-35;google_apis_playstore;arm64-v8a"
```

If this image is absent, `provision emulator` will either:
- Fail with `ANDROID_SDK_TOOL_MISSING` (if `sdkmanager` is not on PATH), or
- Fail with `EMULATOR_UNSUPPORTED` if a `androperator-pixel` AVD already exists
  but was created against a different API level.

`doctor` should verify that the required system image is installed and, if not,
install it via `sdkmanager`:

```
sdkmanager "system-images;android-35;google_apis_playstore;arm64-v8a"
```

This check must run after SDK tools are confirmed present (step 2 above).

The system image check should be separated from the SDK tools check so it can
also run read-only in diagnostic mode (reporting "missing" vs. installing).

## Related files

- `apps/node/src/adapters/android-bridge/runtimeConfig.ts` - path resolution
- `apps/node/src/cli/commands/doctor.ts` - doctor command entry point
- `sites/androperator-public/install.sh` - shell RC export pattern to follow
