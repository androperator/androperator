# Devices

## Purpose

Define the `androperator devices` output shape, document how Node resolves a target device for execution, and explain how `--device` and `--operator-package` keep routing deterministic across multiple connected targets.

## Sources

- Device listing: `apps/node/src/domain/devices/listDevices.ts`
- Device resolution: `apps/node/src/domain/devices/resolveDevice.ts`
- CLI wrapper: `apps/node/src/cli/commands/devices.ts`

<a id="androperator-devices"></a>

## `androperator devices`

`androperator devices` is a direct listing of `adb devices` output after Node parses each non-empty line into:

```json
{
  "serial": "device serial",
  "state": "adb state"
}
```

Successful CLI response:

```json
{
  "devices": [
    {
      "serial": "emulator-5554",
      "state": "device"
    },
    {
      "serial": "R58N12345AB",
      "state": "unauthorized"
    }
  ]
}
```

Meaning:

- `serial` is the adb device identifier used by `--device`
- `state` is whatever adb reported for that serial
- Node keeps all listed devices in this command output, even if they are not valid execution targets
- this command is observational only; it does not apply `resolveDevice.ts` selection rules

The HTTP server uses the same listing behavior on `GET /devices` and returns:

```json
{
  "ok": true,
  "devices": [
    { "serial": "emulator-5554", "state": "device" }
  ]
}
```

## Which Devices Count As Executable Targets

For actual command execution, Node filters the `devices` list down to entries where:

- `state == "device"`

That means:

- `device` is eligible for auto-selection or explicit selection
- `offline`, `unauthorized`, and other adb states are visible in `androperator devices` output but are not execution targets

Concrete example:

```json
{
  "devices": [
    { "serial": "emulator-5554", "state": "device" },
    { "serial": "R58N12345AB", "state": "offline" }
  ]
}
```

Execution consequence:

- Node can route commands to `emulator-5554`
- Node will reject `R58N12345AB` until it returns to adb state `device`

## `--device`

Primary flag:

```text
--device <serial>
```

Accepted legacy alias:

```text
--device-id <serial>
```

Use `--device` when:

- more than one connected target is in adb state `device`
- you want deterministic routing even if another emulator or physical device appears later
- you are scripting `exec`, `serve`, `doctor`, or setup calls and do not want auto-selection

## Resolution Rules

`resolveDevice.ts` applies these exact rules:

| Connected targets with `state == "device"` | `--device` provided | Result |
| --- | --- | --- |
| `0` | no | fail with `NO_DEVICES` |
| `1` | no | auto-select the only connected serial |
| `>1` | no | fail with `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED` |
| any | yes, serial exists in state `device` | use that serial |
| any | yes, serial missing or not in state `device` | fail with `DEVICE_NOT_FOUND` |

Concrete examples:

Auto-select single connected device:

```json
{
  "devices": [
    { "serial": "emulator-5554", "state": "device" }
  ]
}
```

Result:

- commands run on `emulator-5554` even without `--device`

Multiple connected devices without `--device`:

```json
{
  "devices": [
    { "serial": "emulator-5554", "state": "device" },
    { "serial": "R58N12345AB", "state": "device" }
  ]
}
```

Result:

- Node returns `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`
- `details.devices` includes the connected serials

Requested serial not usable:

```json
{
  "code": "DEVICE_NOT_FOUND",
  "message": "Device R58N12345AB not found or not in device state",
  "details": {
    "connected": ["emulator-5554"]
  }
}
```

## Deterministic Routing Pattern

For automation, prefer this pattern even when only one device is currently connected:

1. Run `androperator devices`
2. Select the intended `serial`
3. Reuse that `serial` through all subsequent commands with `--device <serial>`

Example:

```bash
androperator snapshot --device emulator-5554
```

Success condition:

- later commands continue using the same target even if a second device appears

## Operator Package Selection

Device routing and operator package selection are separate decisions.

Primary flag:

```text
--operator-package <package>
```

Common package values:

| Package | Typical use |
| --- | --- |
| `com.androperator.operator` | release Operator APK |
| `com.androperator.operator.dev` | local debug Operator APK |

Use `--operator-package com.androperator.operator.dev` when:

- the installed APK is a local debug build
- `doctor` reports `OPERATOR_VARIANT_MISMATCH`
- you are validating branch-local CLI changes against the debug Operator app

Recommended deterministic pairing:

```bash
androperator snapshot --device emulator-5554 --operator-package com.androperator.operator.dev
```

## Common Failure Modes

### `NO_DEVICES`

No connected targets in adb state `device`.

Recovery:

- connect a device or boot an emulator
- confirm `androperator devices` shows at least one entry with `state: "device"`

### `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED`

More than one connected target is in adb state `device`, and you did not pass `--device`.

Recovery:

- choose one serial from `details.devices`
- rerun with `--device <serial>`

### `DEVICE_NOT_FOUND`

You passed `--device`, but the requested serial was not present in adb state `device`.

Recovery:

- rerun `androperator devices`
- check that the serial matches exactly
- confirm the requested device is not `offline` or `unauthorized`

If you see the serial in `androperator devices` output but its state is not `device`, the fix is to repair that adb state first rather than retrying the same command.

## Example Commands

List devices:

```bash
androperator devices
```

Doctor on one target:

```bash
androperator doctor --device <device_serial>
```

Snapshot against the debug Operator package:

```bash
androperator snapshot --device <device_serial> --operator-package com.androperator.operator.dev
```

Execute a payload on one target:

```bash
androperator exec payload.json --device <device_serial>
```

## Related Pages

- [Setup](../setup.md)
- [Doctor](doctor.md)
- [Errors](errors.md)
- [Serve](serve.md)
