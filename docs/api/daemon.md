# Daemon

## Purpose

Define the lifecycle contract for the Androperator background daemon. The daemon is a long-running Node process that binds the same Express app used by `androperator serve` to a Unix domain socket instead of a TCP port.

The daemon also handles transparent proxying for `exec`, `snapshot`, `screenshot`, and the flat action commands such as `open`, `click`, `type`, `read`, `wait`, `press`, `back`, `close`, `sleep`, `scroll`, `scroll-until`, `wait-for-nav`, and `read-value`.

## Sources

- CLI registration and global flag parsing: `apps/node/src/cli/registry.ts`, `apps/node/src/cli/index.ts`
- Daemon command implementation: `apps/node/src/cli/commands/daemon.ts`
- Daemon proxy implementation: `apps/node/src/cli/daemonProxy.ts`
- Proxied CLI commands: `apps/node/src/cli/commands/execute.ts`, `apps/node/src/cli/commands/observe.ts`, `apps/node/src/cli/commands/action.ts`
- Daemon path and process helpers: `apps/node/src/domain/daemon/lifecycle.ts`
- Serve app, `/ping`, and `/version`: `apps/node/src/cli/commands/serve.ts`
- CLI version source: `apps/node/src/domain/version/compatibility.ts`
- Error codes: `apps/node/src/contracts/errors.ts`

## Commands

All daemon lifecycle commands return JSON on stdout by default. `--output pretty` pretty-prints the same object.

| Command | Purpose | Success status values |
| --- | --- | --- |
| `androperator daemon start [--device <id>] [--operator-package <package>]` | Spawn `daemon run` as a detached background process and wait for `/ping`. | `started`, `already_running` |
| `androperator daemon stop [--device <id>]` | Send `SIGTERM` to a verified managed PID and remove its PID/socket files. | `stopped`, `not_running` |
| `androperator daemon status [--device <id>]` | Check `/ping`, read metadata, call `/version`, and report state. | `running`, `not_running`, `unowned` |
| `androperator daemon restart [--device <id>] [--operator-package <package>]` | Stop, then start. | `started`, `already_running` |

Internal command:

| Command | Public support |
| --- | --- |
| `androperator daemon run` | Internal foreground server process. It is registered so `daemon start` can spawn it, but it is intentionally omitted from help output. |

## Device Key And Paths

The daemon lifecycle is keyed by the raw `--device` value before device resolution. If `--device` is omitted or blank, the key is `default`.

Sanitization from `sanitizeDaemonKey()`:

| Raw device value | Daemon key |
| --- | --- |
| omitted | `default` |
| `""` | `default` |
| `192.168.1.1:5555` | `id-MTkyLjE2OC4xLjE6NTU1NQ` |

Nonblank device keys use base64url encoding of the raw `--device` value so similar serials such as `host:5555` and `host-5555` cannot collide. A daemon key is a filesystem identifier, not an authentication secret; its encoding is reversible. For example, `emulator-5554` becomes `id-ZW11bGF0b3ItNTU1NA`, as used in the metadata and socket-path examples below.

Path formulas from `apps/node/src/domain/daemon/lifecycle.ts`:

| File | Formula |
| --- | --- |
| socket | `~/.androperator/daemon/daemon-<daemon_key>.sock` |
| PID metadata | `~/.androperator/daemon/daemon-<daemon_key>.pid` |
| log | `~/.androperator/daemon/daemon-<daemon_key>.log` |
| lifecycle lock | `~/.androperator/daemon/daemon-<daemon_key>.lock` |

The daemon directory is created with mode `0700`. The PID metadata file is JSON:

```json
{
  "pid": 12345,
  "startedAt": 1777176000000,
  "daemonKey": "id-ZW11bGF0b3ItNTU1NA",
  "cliEntryPath": "/Users/<local_user>/src/androperator/apps/node/dist/cli/index.js",
  "rawDeviceId": "emulator-5554"
}
```

`daemon status` uses `startedAt` to compute `daemon.uptimeSeconds`. Lifecycle commands also use the ownership fields to avoid treating an unrelated reused PID as the managed daemon. If a socket responds to `/ping` but its metadata does not identify a live managed daemon, status reports `unowned`; it does not claim that the daemon is absent or take ownership of the listener.

Daemon lifecycle lock files are created next to the PID metadata and socket. A lock file includes the owning process PID so later daemon commands can reclaim a stale lock when that process no longer exists.

## Output Shapes

### Start

Started:

```json
{
  "ok": true,
  "daemon": {
    "status": "started",
    "socketPath": "/Users/<local_user>/.androperator/daemon/daemon-id-ZW11bGF0b3ItNTU1NA.sock"
  }
}
```

Already running:

```json
{
  "ok": true,
  "daemon": {
    "status": "already_running",
    "socketPath": "/Users/<local_user>/.androperator/daemon/daemon-id-ZW11bGF0b3ItNTU1NA.sock"
  }
}
```

### Status

Running:

```json
{
  "ok": true,
  "daemon": {
    "status": "running",
    "pid": 12345,
    "version": "0.7.9",
    "buildIdentity": {
      "entryPath": "/Users/<local_user>/src/androperator/apps/node/dist/cli/index.js",
      "mtimeMs": 1777176000000,
      "size": 12345
    },
    "uptimeSeconds": 4,
    "socketPath": "/Users/<local_user>/.androperator/daemon/daemon-id-ZW11bGF0b3ItNTU1NA.sock"
  }
}
```

Not running:

```json
{
  "ok": true,
  "daemon": {
    "status": "not_running",
    "socketPath": "/Users/<local_user>/.androperator/daemon/daemon-id-ZW11bGF0b3ItNTU1NA.sock"
  }
}
```

Unowned responding socket:

```json
{
  "ok": true,
  "daemon": {
    "status": "unowned",
    "socketPath": "/Users/<local_user>/.androperator/daemon/daemon-id-ZW11bGF0b3ItNTU1NA.sock"
  }
}
```

### Stop

Stopped:

```json
{
  "ok": true,
  "daemon": {
    "status": "stopped",
    "socketPath": "/Users/<local_user>/.androperator/daemon/daemon-id-ZW11bGF0b3ItNTU1NA.sock"
  }
}
```

Stop when not running:

```json
{
  "ok": true,
  "daemon": {
    "status": "not_running",
    "socketPath": "/Users/<local_user>/.androperator/daemon/daemon-id-ZW11bGF0b3ItNTU1NA.sock"
  }
}
```

## Version Policy

The daemon exposes `GET /version` on its Unix socket and returns:

```json
{
  "version": "0.7.9",
  "buildIdentity": {
    "entryPath": "/Users/<local_user>/src/androperator/apps/node/dist/cli/index.js",
    "mtimeMs": 1777176000000,
    "size": 12345
  }
}
```

The `version` value comes from `getCliVersion()` in `apps/node/src/domain/version/compatibility.ts`. The `buildIdentity` value is captured when the Node process starts and identifies the CLI entrypoint path, entrypoint mtime, and entrypoint size.

Lifecycle status reports these values. The proxy layer compares the daemon `/version` response with the current CLI process version and build identity before dispatching. If either value differs, or if the daemon returns invalid version metadata, the proxy stops the old daemon, starts a new daemon, waits up to `3000` ms, and only dispatches after the restarted daemon reports the same version and build identity.

## Transparent Proxy

Daemon proxying is active for:

| CLI command | Proxied endpoint | Post-dispatch fallback |
| --- | --- | --- |
| `androperator exec <json-or-file>` | `POST /execute` on the daemon socket | no |
| `androperator snapshot` | synthetic `snapshot` payload sent to `POST /execute` | yes |
| `androperator screenshot` | synthetic `take_screenshot` payload sent to `POST /execute` | no |
| Flat action commands such as `open`, `click`, `type`, `read`, `wait`, `press`, `back`, `close`, `sleep`, `scroll`, `scroll-until`, `wait-for-nav`, and `read-value` | action payload sent to `POST /execute` | no |

Dry-run and validation-only `exec` modes do not need the daemon because they do not dispatch to Android.

If an execution contains `take_screenshot` with a caller-relative `params.path`, the command runs direct before daemon startup. This preserves the normal CLI behavior where relative screenshot paths resolve from the caller's current working directory, not from the daemon process working directory.

Proxy selection rules:

1. If `--no-daemon` or `ANDROPERATOR_NO_DAEMON=1` is set, the command runs direct.
2. If the execution includes `take_screenshot` with a relative output path, the command runs direct.
3. If the platform is Windows, the command runs direct because this task uses Unix domain sockets only.
4. If the socket is missing, the proxy serializes daemon startup with the lifecycle lock, spawns `daemon run`, polls `/ping` every `100` ms, and waits up to `3000` ms.
5. If the socket exists but connection is refused, the proxy deletes the stale socket and starts a new daemon.
6. If `/version` does not match the current CLI version and build identity, the proxy stops the old daemon and starts a new one.
7. If the daemon is ready and the version and build identity match, the command sends the execution payload to `POST /execute`.
8. If a responding socket is not owned by the managed daemon, the command runs direct for that call and leaves the listener untouched.
9. If the daemon cannot become ready before dispatch, the command runs direct for that call.

The proxy sends the caller's effective Operator package in the request body. Precedence is:

1. explicit `--operator-package`
2. nonblank `ANDROPERATOR_OPERATOR_PACKAGE`
3. `com.androperator.operator`

This preserves caller behavior even when an already-running daemon was started with a different environment.

## Opt Out

Global placement:

```bash
androperator --no-daemon snapshot --device emulator-5554
```

Command-local placement:

```bash
androperator snapshot --no-daemon --device emulator-5554
```

Environment:

```bash
ANDROPERATOR_NO_DAEMON=1 androperator snapshot --device emulator-5554
```

Success condition for an opt-out verification:

- the command returns the same CLI JSON shape as normal direct execution
- `androperator daemon status --device emulator-5554` is unchanged by the opt-out command

## Dispatch Boundary

Pre-dispatch failures can safely fall back to direct mode because no action was sent to Android.

Post-dispatch failures are different. After the HTTP request body is written to the daemon socket, a lost response may mean the action already executed. Retrying a mutating action can duplicate side effects.

Fallback policy:

| Command category | Post-dispatch response loss behavior |
| --- | --- |
| `exec` | return `DAEMON_PROXY_ERROR`; do not run direct |
| Flat action commands | return `DAEMON_PROXY_ERROR`; do not run direct |
| `snapshot` | may run direct once because the synthetic action is read-only |
| `screenshot` | return `DAEMON_PROXY_ERROR`; do not run direct because it can write a host output file |

`DAEMON_PROXY_ERROR` shape:

```json
{
  "code": "DAEMON_PROXY_ERROR",
  "message": "Daemon response lost; action may have executed",
  "details": {
    "error": "Error: socket hang up"
  }
}
```

## Failure Modes

| Failure | Output code | Exit code | Recovery |
| --- | --- | --- | --- |
| `daemon start` spawns `daemon run` but `/ping` does not become reachable within `3000` ms | `DAEMON_START_FAILED` | `1` | Inspect `~/.androperator/daemon/daemon-<daemon_key>.log`, then retry `androperator daemon start --device <id>`. |
| `daemon start` cannot spawn the background process | `DAEMON_START_FAILED` | `1` | Verify the branch-local CLI entrypoint exists and retry from the same checkout. |
| `daemon stop` cannot signal or clean up the process | `DAEMON_STOP_FAILED` | `1` | Inspect the PID metadata file and socket path, stop the process manually if needed, then retry `daemon stop`. |
| `daemon status` reports `unowned` | none | `0` | A responding socket is present but is not verified as this managed daemon. Do not delete its socket or signal its process; inspect its owner or use the checkout that started it. |
| `exec` or a flat mutating action was dispatched through the daemon but the response was lost | `DAEMON_PROXY_ERROR` | `1` | Do not blindly retry. Inspect device state first because the action may already have executed. |

Top-level daemon failures use the same CLI error shape as other Node-side failures:

```json
{
  "code": "DAEMON_START_FAILED",
  "message": "Daemon did not become ready within 3000ms.",
  "details": {
    "socketPath": "/Users/<local_user>/.androperator/daemon/daemon-id-ZW11bGF0b3ItNTU1NA.sock",
    "timeoutMs": 3000
  }
}
```

## Verification

Use the installed CLI when validating daemon behavior:

```bash
androperator daemon start --device emulator-5554
androperator daemon status --device emulator-5554
androperator daemon stop --device emulator-5554
androperator daemon status --device emulator-5554
```

Success conditions:

- start exits `0` and `daemon.status` is `started` or `already_running`
- status while running exits `0`, `daemon.status == "running"`, `daemon.pid` is a number, `daemon.version` is a string, `daemon.buildIdentity.entryPath` is a string, and `daemon.uptimeSeconds >= 0`
- stop exits `0` and `daemon.status` is `stopped` or `not_running`
- final status exits `0` and `daemon.status == "not_running"`

Verify the internal command is hidden from help:

```bash
androperator --help | grep "daemon run"
```

Success condition: no matches.
