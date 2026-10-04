# Performance

## Purpose

Use this page to choose the fastest Androperator calling pattern for repeated
Android observations and actions.

Current guidance:

- use an emulator when the target app supports it
- use the [Serve API](../api/serve.md) for repeated caller traffic
- avoid tight loops that start a fresh `androperator` process each time
- treat physical USB results as device-and-transport-specific

Maintainers who need to reproduce the measurements should use the repo-local
[`test-io-speeds` skill](https://github.com/androperator/androperator/tree/main/.agents/skills/test-io-speeds).
The skill owns release APK setup, device selection, timing logs, output
locations, and raw artifact handling.

## Current Timing Snapshot

These values come from a `test-io-speeds` validation run after the `0.9.5`
release, using release package `com.androperator.operator`, 10 measured calls per
app, and these apps: Android Settings, Google Play Store, YouTube, and Google
Home.

| Path | Mean snapshot latency | Cost versus fastest | What it means |
|------|-----------------------|---------------------|---------------|
| Emulator + direct daemon | about 78 ms | baseline | Fastest measured diagnostic path |
| Emulator + fresh CLI through daemon | about 220 ms | about +142 ms | Cost of starting/parsing/formatting a fresh `androperator` process instead of reusing a persistent caller |
| Physical USB + direct daemon | about 197 ms | about +119 ms | Physical device and USB transport penalty versus emulator on the direct-daemon path |
| Physical USB + fresh CLI through daemon | about 326 ms | about +248 ms | Physical USB plus fresh CLI overhead together |

Average deltas from the same run:

| Comparison | Observed delta |
|------------|----------------|
| Fresh CLI overhead on emulator | about +142 ms |
| Fresh CLI overhead on physical USB | about +129 ms |
| Physical USB penalty versus emulator, direct daemon path | about +119 ms |
| Physical USB penalty versus emulator, fresh CLI path | about +106 ms |

Detailed per-app means from the same run:

| Device path | Settings | Play Store | YouTube | Google Home |
|-------------|---------:|-----------:|--------:|------------:|
| Emulator fresh CLI | 199.7 ms | 198.8 ms | 283.9 ms | 196.1 ms |
| Emulator direct daemon | 78.4 ms | 76.3 ms | 77.9 ms | 78.7 ms |
| Physical USB fresh CLI | 293.1 ms | 298.0 ms | 371.0 ms | 340.1 ms |
| Physical USB direct daemon | 187.1 ms | 214.3 ms | 188.1 ms | 197.9 ms |

## What Direct Daemon Means

Direct daemon is a diagnostic measurement path. It means the timing harness
posts the execution payload directly to the already-running Androperator daemon
over the daemon's internal Unix socket, using that internal server's `/execute`
route.

Direct daemon is not the public [Serve API `POST /execute`](../api/serve.md#endpoint-post-execute),
and it is not the same as running `androperator execute` from a fresh shell. It
bypasses fresh CLI process startup, CLI argument parsing, stdout formatting, and
other per-command CLI wrapper work.

Do not build user-facing skills or integrations against the daemon's internal
Unix socket. Use the [Serve API](../api/serve.md) for persistent caller traffic.

## Calling Patterns

| Path | Command surface | Persistence | Use for |
|------|-----------------|-------------|---------|
| Fresh CLI through daemon | `androperator snapshot` | Starts a new process for each call, then proxies through the daemon when available | Human terminal use and one-off checks |
| [Serve API](../api/serve.md) | `androperator serve`, then HTTP requests such as [`POST /snapshot`](../api/serve.md#endpoint-post-snapshot) | One long-running process | Repeated agent loops and throughput-sensitive callers |
| Direct daemon socket | Internal daemon Unix socket under `~/.androperator/daemon/` | One daemon process | Diagnostics only |
| Direct execution | `--no-daemon` or `ANDROPERATOR_NO_DAEMON=1` | No daemon proxy | Debugging daemon behavior |

Fresh CLI means each call starts a new `androperator` process, parses CLI
arguments, resolves configuration, checks or starts the daemon, proxies the
request, parses the result, formats stdout, and exits. The daemon still helps,
but the caller pays per-process overhead.

Serve means the caller starts one local HTTP server and sends repeated requests
to that same process. This avoids fresh process startup and CLI formatting on
every call.

## Replace Fresh CLI Observe-Act-Observe

A common slow skill pattern is observe, act, then observe again by shelling out
for each step:

```bash
before="$(androperator snapshot)"

if printf '%s' "$before" | grep -q 'Activate'; then
  androperator click --text "Activate"
fi

after="$(androperator snapshot)"
printf '%s' "$after" | grep -q 'Activated'
```

That starts a fresh process for each observation and action. In retries or
bounded polling, the cost repeats.

Instead, start one Serve API process:

```bash
androperator serve
```

Then keep the caller process alive. Use
[`POST /snapshot`](../api/serve.md#endpoint-post-snapshot) for observation:

```bash
before="$(curl -s http://127.0.0.1:3000/snapshot \
  -H 'Content-Type: application/json' \
  -d '{}')"
```

When ready to act and verify, send the action and verification as one
[`POST /execute`](../api/serve.md#endpoint-post-execute) payload:

```bash
curl -s http://127.0.0.1:3000/execute \
  -H 'Content-Type: application/json' \
  -d @- <<'JSON'
{
  "execution": {
    "commandId": "activate-flow",
    "taskId": "activate-flow",
    "source": "performance-doc",
    "expectedFormat": "android-ui-automator",
    "timeoutMs": 30000,
    "actions": [
      {
        "id": "tap-activate",
        "type": "click",
        "params": { "matcher": { "textEquals": "Activate" } }
      },
      {
        "id": "wait-activated",
        "type": "wait_for_node",
        "params": {
          "matcher": { "textContains": "Activated" },
          "timeoutMs": 15000
        }
      },
      { "id": "verify", "type": "snapshot" }
    ]
  }
}
JSON
```

This mirrors real skill structure: observe, click by selector, wait for the
target UI state, and capture the final snapshot, while keeping process startup
out of the repeated path.

## Practical Guidance

1. Use an emulator baseline when the target app supports emulator use.
2. Use `androperator serve` for repeated caller API traffic.
3. Use fresh CLI timing only when measuring terminal command experience.
4. Keep physical-device measurements as compatibility and transport data.
5. Re-measure with the `test-io-speeds` skill after changes to snapshot,
   transport, daemon proxying, output formatting, or Androperator Operator App timing.
