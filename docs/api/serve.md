# Serve API

Optional `/execute` requests may include `runId` for caller-owned logging
correlation. It must contain 1 to 240 safe identifier characters (letters,
digits, dot, underscore, colon or hyphen); no prefix is required. Invalid values
return HTTP 400 with `INVALID_RUN_ID`. It does not replace execution `commandId`
or `taskId`.

## Purpose

Define the local HTTP and SSE contract exposed by `androperator serve`, including request bodies, success responses, status-code mapping, and how the serve layer wraps `runExecution` and emulator operations.

## Sources

- HTTP server and handlers: `apps/node/src/cli/commands/serve.ts`
- Execution result contract: `apps/node/src/domain/executions/runExecution.ts`
- Result envelope source: `apps/node/src/contracts/result.ts`; canonical docs:
  [Result Envelope](overview.md#result-envelope)
- SSE event names: `apps/node/src/domain/observe/events.ts`
- Emulator response types: `apps/node/src/domain/android-emulators/types.ts`

## Start The Server

```bash
androperator serve [--host <string>] [--port <number>]
```

Defaults:

| Field | Value |
| --- | --- |
| host | `127.0.0.1` |
| port | `3000` |
| JSON request body limit | `100kb` |

When the server starts successfully, it listens until the process exits. There is no structured JSON startup response because this is a long-running command.

## Response Shapes

Most REST endpoints return one of these shapes.

Important boundary:

- `/execute`, `/snapshot`, and `/screenshot` pass through `runExecution()` results on success and on cross-surface execution failures; read `envelope` fields through the canonical [Result Envelope](overview.md#result-envelope) contract
- malformed request bodies and route-local validation failures are serve-layer wrappers only and are not part of the shared execution contract

### Success wrapper

```json
{
  "ok": true
}
```

and then endpoint-specific fields such as `devices`, `avds`, `output`, or emulator state.

### Execution result passthrough

`/execute`, `/snapshot`, and `/screenshot` return the `runExecution()` result object directly:

Successful shape:

```json
{
  "ok": true,
  "deviceId": "emulator-5554",
  "terminalSource": "androperator_result",
  "envelope": {
    "commandId": "serve-snap-1710000000000",
    "taskId": "serve-snap-1710000000000",
    "status": "success",
    "stepResults": [
      {
        "id": "snap",
        "actionType": "snapshot",
        "success": true,
        "data": {
          "text": "<hierarchy rotation=\"0\">...</hierarchy>"
        }
      }
    ],
    "error": null
  }
}
```

Failure shape:

```json
{
  "ok": false,
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "Device emulator-9999 not found or not in device state",
    "details": {
      "connected": ["emulator-5554"]
    }
  }
}
```

Success conditions for execution endpoints:

- HTTP status is `200`
- response body has `"ok": true`
- `envelope.status == "success"`
- every `envelope.stepResults[i].success == true`

## Endpoint Summary

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/ping` | health probe for the local serve process |
| `GET` | `/version` | report the CLI version and build identity |
| `GET` | `/devices` | list adb-visible devices |
| `POST` | `/execute` | run a caller-supplied execution payload |
| `POST` | `/snapshot` | run a synthetic one-step `snapshot` execution |
| `POST` | `/screenshot` | run a synthetic one-step `take_screenshot` execution |
| `GET` | `/android/emulators` | list configured AVDs |
| `GET` | `/android/emulators/running` | list running emulators |
| `GET` | `/android/emulators/:name` | inspect one configured AVD |
| `POST` | `/android/emulators/create` | create an AVD |
| `POST` | `/android/emulators/:name/start` | start an AVD and wait for boot |
| `POST` | `/android/emulators/:name/stop` | stop a running AVD |
| `DELETE` | `/android/emulators/:name` | delete an AVD |
| `POST` | `/android/provision/emulator` | create or reuse a supported emulator and boot it |
| `GET` | `/events` | subscribe to SSE execution events |

<a id="endpoint-get-ping"></a>
## `GET /ping`

Health probe for the serve process.

Response:

```json
{
  "ok": true
}
```

Meaning:

- the Express app is running and can answer requests
- no adb, device, Operator APK, or execution readiness check is performed

<a id="endpoint-get-version"></a>
## `GET /version`

Reports the CLI version and build identity for the running server process.

Response:

```json
{
  "version": "0.9.4",
  "buildIdentity": {
    "entryPath": "/path/to/androperator/dist/cli/index.js",
    "mtimeMs": 1710000000000,
    "size": 123456
  }
}
```

Meaning:

- `version` is the same package version returned by the CLI version helper
- `buildIdentity.entryPath` is the resolved CLI entrypoint path when Node can resolve it
- `buildIdentity.mtimeMs` and `buildIdentity.size` come from `statSync()` and are `null` when the entrypoint cannot be inspected
- no device or Operator APK check is performed

<a id="endpoint-get-devices"></a>
## `GET /devices`

Returns the same parsed adb listing used by [Devices](devices.md).

Success response:

```json
{
  "ok": true,
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

- this is observational output only
- it does not apply the execution-time `resolveDevice()` filtering rules

Failure behavior:

- server-side listing failures return HTTP `500`
- this route does not use the `errors.ts` status mapping table

<a id="endpoint-post-execute"></a>
## `POST /execute`

### Request body

```json
{
  "execution": {
    "commandId": "open-settings",
    "taskId": "open-settings",
    "source": "agent-http",
    "expectedFormat": "android-ui-automator",
    "timeoutMs": 30000,
    "actions": [
      {
        "id": "a1",
        "type": "open_app",
        "params": {
          "applicationId": "com.android.settings"
        }
      },
      {
        "id": "a2",
        "type": "snapshot"
      }
    ]
  },
  "deviceId": "emulator-5554",
  "operatorPackage": "com.androperator.operator.dev"
}
```

Valid body rules enforced by the route:

- request body must be a JSON object
- `execution` is required
- `deviceId`, when present, must be a string
- `operatorPackage`, when present, must be a non-empty string

Operator package resolution:

- if `operatorPackage` is present in the request, the server uses it verbatim
- otherwise it falls back to `process.env.ANDROPERATOR_OPERATOR_PACKAGE` when that env var is non-blank
- otherwise it uses `com.androperator.operator`

Then `runExecution()` applies full execution validation. See [Actions](actions.md), [Selectors](selectors.md), and [API Overview](overview.md).

`params.template` carries live overlay templates unchanged to Android, using the
same validation and styling as literal `params.text`. Exactly one is required.

`show_toast` and `cancel_toast` also use `/execute`, without separate toast routes.
See [Toast actions](actions.md#action-show-toast) for parameters and submission semantics.

`/execute` is also the generic HTTP transport for `set_on_screen_log` and
`clear_on_screen_log`. Inside `execution.actions`, it accepts exact lower-case
`on_screen_log_set` and `on_screen_log_clear` input aliases and normalizes them
to the canonical action types. It does not provide separate panel endpoints,
accept case or whitespace variants, or translate on-screen log parameter
aliases. See [On-screen logs](on-screen-logs.md) for the raw payload contract
and result fields. The `on-screen-log set` and `clear` CLI commands are
conveniences over these same actions, not additional HTTP routes.

Representative serve-layer `400` wrappers for this route:

```json
{
  "ok": false,
  "error": {
    "code": "MISSING_EXECUTION",
    "message": "Missing 'execution' in body"
  }
}
```

### Success response

```json
{
  "ok": true,
  "deviceId": "emulator-5554",
  "terminalSource": "androperator_result",
  "envelope": {
    "commandId": "open-settings",
    "taskId": "open-settings",
    "status": "success",
    "stepResults": [
      {
        "id": "a1",
        "actionType": "open_app",
        "success": true,
        "data": {}
      },
      {
        "id": "a2",
        "actionType": "snapshot",
        "success": true,
        "data": {
          "text": "<hierarchy rotation=\"0\">...</hierarchy>"
        }
      }
    ],
    "error": null
  }
}
```

### Failure response

Validation failure example:

```json
{
  "ok": false,
  "error": {
    "code": "EXECUTION_VALIDATION_FAILED",
    "message": "press_key requires params.key",
    "details": {
      "path": "actions.0.params.key",
      "actionId": "k1",
      "actionType": "press_key"
    }
  }
}
```

Device-resolution failure example:

```json
{
  "ok": false,
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "Device non-existent not found or not in device state",
    "details": {
      "connected": ["emulator-5554"]
    }
  }
}
```

<a id="endpoint-post-snapshot"></a>
## `POST /snapshot`

This route builds a synthetic execution with:

- `source: "serve-api"`
- `expectedFormat: "android-ui-automator"`
- `timeoutMs: 30000`
- one action: `{ "id": "snap", "type": "snapshot" }`

### Request body

```json
{
  "deviceId": "emulator-5554",
  "operatorPackage": "com.androperator.operator.dev"
}
```

Notes:

- body must still be a JSON object, but `{}` is valid
- omitted `operatorPackage` follows the same fallback chain as `/execute`

### Success response

```json
{
  "ok": true,
  "deviceId": "emulator-5554",
  "terminalSource": "androperator_result",
  "envelope": {
    "commandId": "serve-snap-1710000000000",
    "taskId": "serve-snap-1710000000000",
    "status": "success",
    "stepResults": [
      {
        "id": "snap",
        "actionType": "snapshot",
        "success": true,
        "data": {
          "text": "<hierarchy rotation=\"0\">...</hierarchy>"
        }
      }
    ],
    "error": null
  }
}
```

<a id="endpoint-post-screenshot"></a>
## `POST /screenshot`

This route builds a synthetic execution with:

- `source: "serve-api"`
- `expectedFormat: "android-ui-automator"`
- `timeoutMs: 30000`
- one action: `{ "id": "shot", "type": "take_screenshot" }`
- optional `params.path` when `path` was supplied

### Request body

```json
{
  "deviceId": "emulator-5554",
  "operatorPackage": "com.androperator.operator.dev",
  "path": "/tmp/settings.png"
}
```

Route validation:

- request body must be a JSON object
- `path`, when present, must be a non-empty string
- omitted `operatorPackage` follows the same fallback chain as `/execute`

### Success response

```json
{
  "ok": true,
  "deviceId": "emulator-5554",
  "terminalSource": "androperator_result",
  "envelope": {
    "commandId": "serve-shot-1710000000000",
    "taskId": "serve-shot-1710000000000",
    "status": "success",
    "stepResults": [
      {
        "id": "shot",
        "actionType": "take_screenshot",
        "success": true,
        "data": {
          "path": "/tmp/settings.png"
        }
      }
    ],
    "error": null
  }
}
```

## Error Layers

Serve has three distinct error layers. Keep them separate when recovering from a
failure.

| Layer | Where it comes from | Shape | Recovery |
| --- | --- | --- | --- |
| Route-local wrapper error | Express JSON parsing or per-route request checks in `serve.ts` | `{ "ok": false, "error": { "code": "INVALID_BODY", ... } }` or similar route-local codes | Fix the HTTP request shape and retry. These codes are not the shared execution contract. |
| Shared execution error | `runExecution()` returns `ok: false` for `/execute`, `/snapshot`, or `/screenshot` | `{ "ok": false, "error": { "code": "<errors.ts code>", ... } }` | Branch on `error.code` and use [Errors](errors.md) for recovery. |
| Failed result envelope | Android returned an execution envelope with `envelope.status == "failed"` | `{ "ok": true, "envelope": { "status": "failed", ... } }` in success-wrapper passthrough cases | Read [Result Envelope](overview.md#result-envelope), then branch on `envelope.errorCode` or failed `stepResults[].data.error`. |

Machine-checkable rule:

- first check HTTP status and top-level `ok`
- for execution endpoints, also inspect `envelope.status` when an envelope is present
- do not treat route-local codes such as `INVALID_BODY`, `INVALID_DEVICE_ID`, or
  `MISSING_EXECUTION` as public `errors.ts` codes

## Global Serve-Layer Failures

These wrappers come from Express middleware rather than a specific endpoint handler:

| HTTP status | Code | When it appears |
| --- | --- | --- |
| `400` | `INVALID_JSON` | request body is malformed JSON |
| `413` | `PAYLOAD_TOO_LARGE` | request body exceeds the `100kb` Express limit |
| `500` | `INTERNAL_SERVER_ERROR` | unhandled server-side exception reached the catch-all middleware |

Many individual route handlers also return `INTERNAL_ERROR` from local `catch` blocks. Treat both `INTERNAL_ERROR` and `INTERNAL_SERVER_ERROR` as host-side `500` failures rather than as stable execution-contract codes.

## Emulator Endpoints

<a id="endpoint-get-android-emulators"></a>
### `GET /android/emulators`

Lists configured AVDs, merged with running-state information:

```json
{
  "ok": true,
  "avds": [
    {
      "name": "androperator-pixel",
      "exists": true,
      "running": false,
      "apiLevel": 35,
      "abi": "arm64-v8a",
      "playStore": true,
      "deviceProfile": "pixel_8",
      "systemImage": "system-images;android-35;google_apis_playstore;arm64-v8a",
      "supported": true,
      "unsupportedReasons": []
    }
  ]
}
```

<a id="endpoint-get-android-emulators-running"></a>
### `GET /android/emulators/running`

```json
{
  "ok": true,
  "devices": [
    {
      "type": "emulator",
      "avdName": "androperator-pixel",
      "serial": "emulator-5554",
      "booted": true,
      "supported": true,
      "unsupportedReasons": []
    }
  ]
}
```

<a id="endpoint-get-android-emulators-name"></a>
### `GET /android/emulators/:name`

Returns one `ConfiguredAvd` object merged into the success wrapper:

```json
{
  "ok": true,
  "name": "androperator-pixel",
  "exists": true,
  "running": false,
  "apiLevel": 35,
  "abi": "arm64-v8a",
  "playStore": true,
  "deviceProfile": "pixel_8",
  "systemImage": "system-images;android-35;google_apis_playstore;arm64-v8a",
  "supported": true,
  "unsupportedReasons": []
}
```

<a id="endpoint-post-android-emulators-create"></a>
### `POST /android/emulators/create`

Request body:

```json
{
  "apiLevel": 35,
  "abi": "arm64-v8a",
  "deviceProfile": "pixel_8",
  "playStore": true,
  "storageSize": "12G"
}
```

Defaults when omitted:

| Field | Default |
| --- | --- |
| `name` | derived from storage size, for example `androperator-pixel-12gb` |
| `apiLevel` | `SUPPORTED_EMULATOR_API_LEVEL` (`35`) |
| `abi` | `arm64-v8a` |
| `deviceProfile` | `DEFAULT_EMULATOR_DEVICE_PROFILE` (`pixel_7`) |
| `playStore` | `true` unless explicitly `false` |
| `storageSize` | `12G` |

`storageSize` accepts positive integer gigabyte values such as `12G`, `12GB`,
or `16G`. The aliases `size`, `diskSize`, and `dataPartitionSize` are also
accepted. Only one storage size field may be provided.

When `name` is omitted, the server derives the AVD name from the normalized
storage size. For example, `12G` and `12GB` both default to
`androperator-pixel-12gb`.

Success response:

```json
{
  "ok": true,
  "name": "androperator-pixel-12gb",
  "exists": true,
  "running": false,
  "apiLevel": 35,
  "abi": "arm64-v8a",
  "playStore": true,
  "deviceProfile": "pixel_8",
  "systemImage": "system-images;android-35;google_apis_playstore;arm64-v8a",
  "supported": true,
  "unsupportedReasons": []
}
```

<a id="endpoint-post-android-emulators-name-start"></a>
### `POST /android/emulators/:name/start`

Success response:

```json
{
  "ok": true,
  "type": "emulator",
  "avdName": "androperator-pixel",
  "serial": "emulator-5554",
  "booted": true
}
```

Behavior:

- verifies the AVD exists
- rejects already-running AVDs
- starts the emulator, waits for adb registration, waits for boot completion, then enables developer settings

<a id="endpoint-post-android-emulators-name-stop"></a>
### `POST /android/emulators/:name/stop`

```json
{
  "ok": true,
  "avdName": "androperator-pixel",
  "stopped": true
}
```

<a id="endpoint-delete-android-emulators-name"></a>
### `DELETE /android/emulators/:name`

```json
{
  "ok": true,
  "avdName": "androperator-pixel",
  "deleted": true
}
```

<a id="endpoint-post-android-provision-emulator"></a>
### `POST /android/provision/emulator`

This route calls `provisionEmulator()` and may reuse a supported running emulator, start an existing supported AVD, or create and start a new one.

Optional request body:

```json
{
  "storageSize": "16GB"
}
```

When a new AVD is created, `storageSize` controls the internal app storage data
partition. It accepts the same gigabyte-only values and aliases as
`POST /android/emulators/create`. Omit it to use `12G`.

When a new AVD is created and no name is provided by the caller, provisioning
uses the same storage-derived default name, such as `androperator-pixel-12gb`
for the default `12G` size.

Success response:

```json
{
  "ok": true,
  "type": "emulator",
  "avdName": "androperator-pixel",
  "serial": "emulator-5554",
  "booted": true,
  "created": false,
  "started": true,
  "reused": true
}
```

Meaning of flags:

- `created`: a new AVD had to be created
- `started`: the emulator process was started during this request
- `reused`: an existing supported emulator or AVD was reused

<a id="endpoint-get-events"></a>
## `GET /events` SSE Stream

The server responds with:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

Initial heartbeat event:

```text
event: heartbeat
data: {"code":"CONNECTED","message":"Androperator SSE stream active"}
```

Execution-related events:

| Event name | Data shape |
| --- | --- |
| `androperator:result` | `{ "deviceId": "<serial>", "envelope": <ResultEnvelope> }` |
| `androperator:execution` | `{ "deviceId": "<serial>", "input": <unknown>, "result": <RunExecutionResult> }` |

Host transport failures appear in `androperator:execution` with `result.ok: false`
and structured error diagnostics. They do not emit a synthetic
`androperator:result` envelope. Subscribe to execution events to observe every
host outcome, including failures before a terminal Android result is available.

Use `/events` when:

- you want push-style result observation instead of polling
- you need both raw execution outcomes and envelope-only results

## HTTP Status Mapping

When a handler returns an enum-backed error from `errors.ts`, `serve.ts` maps it to HTTP status like this:

| Error code | HTTP status |
| --- | --- |
| `EXECUTION_CONFLICT_IN_FLIGHT` | `423` |
| `DEVICE_NOT_FOUND` | `404` |
| `NO_DEVICES` | `404` |
| `MULTIPLE_DEVICES_DEVICE_ID_REQUIRED` | `400` |
| `EXECUTION_VALIDATION_FAILED` | `400` |
| `PAYLOAD_TOO_LARGE` | `413` |
| `RESULT_ENVELOPE_TIMEOUT` | `504` |
| `DEVICE_NOT_INTERACTIVE` | `409` |
| `EMULATOR_NOT_FOUND` | `404` |
| `EMULATOR_NOT_RUNNING` | `404` |
| `EMULATOR_UNSUPPORTED` | `409` |
| `EMULATOR_ALREADY_RUNNING` | `409` |
| anything else | `500` |

Machine-checkable rule:

- for execution endpoints, use both HTTP status and `error.code`
- branch primarily on `error.code`, not only on the HTTP status

## Error Handling Notes

Two classes of failures exist:

1. Stable enum-backed failures from `apps/node/src/contracts/errors.ts`
2. Route-local HTTP validation failures for malformed or missing request bodies

For long-term agent logic, prefer branching on the enum-backed errors above. Route-local validation failures should be treated as “fix the request body and retry” rather than as durable cross-surface contract codes.

Examples of route-local validation failures:

- malformed JSON body -> HTTP `400`
- body is missing or not a JSON object on POST routes -> HTTP `400`
- `/execute` without `execution` -> HTTP `400`
- `/screenshot` with blank `path` -> HTTP `400`

## Related Pages

- [API Overview](overview.md)
- [Actions](actions.md)
- [Selectors](selectors.md)
- [Devices](devices.md)
- [Errors](errors.md)
