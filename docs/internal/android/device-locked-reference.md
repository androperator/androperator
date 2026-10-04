# Android Device Locked And Screen State Reference

## Purpose

Capture the Android platform distinctions and Androperator-specific findings
around:

- screen on vs screen off
- interactive vs asleep
- keyguard showing vs device actually locked
- host-side wake behavior

This page exists so future agents do not have to rediscover these semantics
when working on doctor, readiness checks, operator diagnostics, or skill
preflight behavior.

## Key Platform Distinctions

These states are related, but they are not interchangeable.

### `screen on` / `interactive`

For Androperator's purposes, the most useful "is the device awake enough to
interact?" signal is `PowerManager.isInteractive()`.

In this repo, that is wrapped by:

- [`PowerManagerSystem.kt`](../../../apps/android/shared/core/common/src/main/kotlin/action/power/PowerManagerSystem.kt)
- [`DeviceStateSystem.kt`](../../../apps/android/shared/core/common/src/main/kotlin/action/devicestate/DeviceStateSystem.kt)

Relevant API:

- `queryScreenOn()`
- `isScreenOn`

Practical meaning:

- `true` means the device is awake / interactive
- `false` means the device is asleep or dozing and must be woken before UI
  automation can proceed

### `keyguard showing`

Android `KeyguardManager.isKeyguardLocked()` answers whether the keyguard is
showing.

Important nuance:

- this is not the same as "the device requires authentication"
- keyguard may be showing even when the screen is trivially dismissible
- screen-off transitions can make the keyguard "showing" even on devices
  without a meaningful secure lock screen

### `device locked`

Android `KeyguardManager.isDeviceLocked()` is the better signal for "is the
device actually locked for this user right now?"

In this repo, that is wrapped by:

- [`KeyguardManagerSystem.kt`](../../../apps/android/shared/core/common/src/main/kotlin/action/keyguard/KeyguardManagerSystem.kt)
- [`DeviceStateSystem.kt`](../../../apps/android/shared/core/common/src/main/kotlin/action/devicestate/DeviceStateSystem.kt)

Relevant API:

- `queryDeviceLocked`
- `isDeviceLocked`

### `user unlocked after boot`

`UserManagerCompat.isUserUnlocked(context)` answers whether the Android user
has completed the post-boot unlock.

This matters because a device can be awake while still not fully available for
normal app/storage behavior after boot.

In this repo, that is exposed as:

- `isUserUnlocked`

## Current Androperator Android State Model

The current Androperator Operator App already has the primitives needed to model readiness:

- `queryScreenOn()` via `PowerManager.isInteractive()`
- `queryDeviceLocked` via `KeyguardManager.isDeviceLocked()`
- `isUserUnlocked`

Primary code path:

- [`DeviceStateSystem.kt`](../../../apps/android/shared/core/common/src/main/kotlin/action/devicestate/DeviceStateSystem.kt)

It also listens for:

- `Intent.ACTION_SCREEN_ON`
- `Intent.ACTION_SCREEN_OFF`
- `Intent.ACTION_USER_PRESENT`

## Important Repo-Specific Caveat

Before the device interactivity foundation work landed,
[`DeviceStateSystem.kt`](../../../apps/android/shared/core/common/src/main/kotlin/action/devicestate/DeviceStateSystem.kt)
used to set:

```kotlin
Intent.ACTION_SCREEN_OFF -> {
    isScreenOn.value = false
    isDeviceLocked.value = true
}
```

That was an overreach.

`ACTION_SCREEN_OFF` does not prove that the device is actually locked. It only
proves that the screen turned off.

Consequences of the old behavior:

- the evented `isDeviceLocked` flow could temporarily report a false locked
  state
- this was especially relevant on devices with no secure lock screen
  configured
- a plain screen-off event could be misdiagnosed as "device on lock screen"

Shipped behavior after the fix:

- `ACTION_SCREEN_OFF` updates only `isScreenOn`
- `ACTION_SCREEN_ON` refreshes the evented lock flow from `queryDeviceLocked`
- `ACTION_USER_PRESENT` clears the evented lock flow
- point-in-time truth for diagnostics should still come from direct queries such
  as `queryScreenOn()`, `queryDeviceLocked`, and `isUserUnlocked`

## Host-Side Wake Research

On 2026-04-21, live-device probing against the connected Samsung device
confirmed that host-side wake is feasible and deterministic enough to use as a
recovery primitive.

Validated commands:

1. `adb shell cmd power sleep`
2. `adb shell cmd power wakeup`
3. `adb shell input keyevent KEYCODE_WAKEUP`
4. `adb shell input keyevent KEYCODE_HOME`

Observed behavior:

- `cmd power sleep` moved the device to `Asleep` / `SCREEN_STATE_OFF` /
  `INTERACTIVE_STATE_SLEEP`
- `cmd power wakeup` returned the device to `Awake` / `SCREEN_STATE_ON` /
  `INTERACTIVE_STATE_AWAKE`
- `KEYCODE_WAKEUP` also woke the device successfully
- `KEYCODE_HOME` also woke the device successfully on this Samsung device

Host-side validation commands used:

```bash
adb shell dumpsys power | rg "mWakefulness="
adb shell dumpsys window policy | rg "showing=|screenState=|interactiveState="
```

## Wake Primitive Ranking

Based on the live-device probe, prefer host-side wake in this order:

1. `adb shell cmd power wakeup`
2. `adb shell input keyevent KEYCODE_WAKEUP`
3. `adb shell input keyevent KEYCODE_HOME`

Reasoning:

- `cmd power wakeup` is the most semantically direct
- `KEYCODE_WAKEUP` is also direct and worked on the probed Samsung
- `KEYCODE_HOME` worked, but it is less clearly a wake-only operation across
  OEMs and Android versions

Avoid using `KEYCODE_POWER` as the primary recovery primitive because it is a
toggle and therefore less deterministic.

## Shipped Foundation

The device interactivity foundation work added two internal-only seams that
later readiness work can depend on:

- Android `doctor_ping` now reports:
  - `screen_on`
  - `device_locked`
  - `user_unlocked`
- those `doctor_ping` fields come from direct `DeviceState` queries in
  [`UiActionEngine.kt`](../../../apps/android/shared/data/task/src/main/kotlin/androperator/task/runner/UiActionEngine.kt),
  not from event flows
- Node now has internal helpers in
  [`deviceInteractivity.ts`](../../../apps/node/src/domain/doctor/checks/deviceInteractivity.ts)
  for:
  - strict parsing of the `doctor_ping` booleans
  - probing current interactivity state
  - bounded host-side wake attempts

These helpers are internal building blocks. They do not add a public wake or
unlock API.

### Internal Wake Helper Semantics

The shipped Node wake helper:

1. probes interactive state first
2. returns a no-op result when the device is already awake
3. when the device is asleep, tries host-side wake in this order:
   1. `adb shell cmd power wakeup`
   2. `adb shell input keyevent KEYCODE_WAKEUP`
   3. `adb shell input keyevent KEYCODE_HOME`
4. after each attempt, re-probes the structured interactive state
5. stops immediately when the device becomes awake and reports whether it is
   actually ready or still locked
6. if the device becomes awake but `deviceLocked == true` or
   `userUnlocked == false`, returns that state
   without attempting authentication bypass
7. fails closed when probe data is missing or malformed

## 2026-04-21 Samsung Validation

Live validation on a physical Samsung device used the debug package
`com.androperator.operator.dev` and the branch-local Node build.

What was verified:

- baseline host state:
  - `mWakefulness=Awake`
  - `screenState=SCREEN_STATE_ON`
  - `interactiveState=INTERACTIVE_STATE_AWAKE`
- baseline internal probe:
  - `screenOn=true`
  - `interactive=true`
  - `deviceLocked=false`
  - `userUnlocked=true`
- `ensureDeviceAwake()` returns `already_awake` and skips adb wake commands
  when the device is already interactive
- after `adb shell cmd power sleep`, host state changed to:
  - `mWakefulness=Asleep`
  - `screenState=SCREEN_STATE_OFF`
  - `interactiveState=INTERACTIVE_STATE_SLEEP`
- the internal probe also reported:
  - `screenOn=false`
  - `interactive=false`
  - `deviceLocked=false`
  - `userUnlocked=true`
- `ensureDeviceAwake()` woke the device successfully on the first retry step
  using `adb shell cmd power wakeup`
- post-wake host state returned to:
  - `mWakefulness=Awake`
  - `screenState=SCREEN_STATE_ON`
  - `interactiveState=INTERACTIVE_STATE_AWAKE`
- post-wake internal probe returned:
  - `screenOn=true`
  - `interactive=true`
  - `deviceLocked=false`
  - `userUnlocked=true`

What was not reproduced in this run:

- an `awake but locked` secure-keyguard state
- fallback use of `KEYCODE_WAKEUP` or `KEYCODE_HOME` from the shipped helper

Those fallback commands were already validated manually on this Samsung during
the host-side wake research above, but the shipped helper did not need them in
this proof run.

## Accessibility Wake Notes

The current Androperator Operator App has accessibility global-action support, but that is
not the same thing as having a clean public "wake screen" action.

Current supported accessibility system actions in this repo:

- notification panel
- quick settings
- recents
- lock screen

Relevant code:

- [`SystemAccessibilityActionType.kt`](../../../apps/android/shared/core/common/src/main/kotlin/action/system/accessibility/SystemAccessibilityActionType.kt)
- [`SystemAccessibilityActionTypeExt.kt`](../../../apps/android/shared/app/app-adapter/src/main/kotlin/androperator/system/accessibility/SystemAccessibilityActionTypeExt.kt)

There is no current wake-screen accessibility action in the Androperator Operator App.

Even though a host-injected `HOME` key woke the Samsung device during probing,
that should not be conflated with a documented operator-side accessibility wake
primitive.

## Guidance For Future Readiness Work

For readiness and doctor-style surfaces, keep these outputs separate:

- `screenOn`
- `interactive`
- `deviceLocked`
- `userUnlocked`

Do not collapse `screenOff` into `deviceLocked`.

If automatic recovery is attempted, the likely best model is:

1. detect `screenOn=false` / `interactive=false`
2. attempt host-side wake
3. re-check `screenOn` / `interactive`
4. separately report actual `deviceLocked` state

That keeps the readiness contract honest:

- sleeping device
- awake but locked device
- awake and unlocked device

These are different states and should remain distinguishable in diagnostics.

## References

- [PowerManager](https://developer.android.com/reference/android/os/PowerManager.html)
- [KeyguardManager](https://developer.android.com/reference/android/app/KeyguardManager)
- [AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)
- [Manifest.permission.TURN_SCREEN_ON](https://developer.android.com/reference/android/Manifest.permission)
