# Logging

## Purpose

Androperator logs every significant event to a local NDJSON file for post-run diagnostics. An agent can inspect this file after a timeout or failure to determine what happened step by step.

## Log File Location

Logs are written to a daily file at:

```
~/.androperator/logs/androperator-YYYY-MM-DD.log
```

The path components are:

| Component | Value | Source |
|-----------|-------|--------|
| Base directory | `~/.androperator/logs` | Default, or `ANDROPERATOR_LOG_DIR` env var |
| Filename prefix | `androperator-` | Hardcoded in `formatLogPath()` in `contracts/logging.ts` |
| Date format | `YYYY-MM-DD` | Local calendar date of the log entry (from `formatDate()` in `contracts/logging.ts`) |
| Extension | `.log` | Hardcoded in `formatLogPath()` in `contracts/logging.ts` |

Example path: `/home/user/.androperator/logs/androperator-2026-03-28.log`

To change the base directory, set the `ANDROPERATOR_LOG_DIR` environment variable. See [Environment Variables](environment.md) for details.

## Doctor Log Diagnostics

`androperator doctor` includes the advisory `host.logs.writable` check. Its
`evidence` contains the resolved `logDir`, daily `logPath`, and boolean `writable`.
It uses the logger's destination: an explicit logger directory takes precedence
over `ANDROPERATOR_LOG_DIR`, then `~/.androperator/logs`. Existing blank-value
fallback behavior is unchanged. The resolved directory stays attached to the
logger and its children even if file logging becomes disabled.

Doctor creates the directory if needed and opens the daily file for append,
then closes it without truncating or adding synthetic content. Its normal
`doctor.check` event uses the configured logger and log-level rules. If opening
the destination fails, the check warns with `LOG_DIRECTORY_UNWRITABLE`, the exact
attempted path, and the `ANDROPERATOR_LOG_DIR` remedy. It does not redirect logs or
change permissions. Otherwise healthy device readiness still succeeds.

## NDJSON Format

Each line is a valid JSON object (NDJSON - Newline Delimited JSON). No wrapping array, no trailing commas. One event per line.

### Required Fields

Every log event has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp (e.g., `2026-03-28T12:34:56.789Z`) |
| `level` | string | One of: `debug`, `info`, `warn`, `error` |
| `event` | string | Dot-separated event name (e.g., `broadcast.dispatched`) |
| `message` | string | Human-readable summary |

### Optional Context Fields

Events may include additional context fields:

| Field | Type | Present When |
|-------|------|--------------|
| `commandId` | string | CLI command or execution has a correlation ID |
| `taskId` | string | Part of a larger task sequence |
| `deviceId` | string | Event targets a specific device |
| `skillRunId` | string | Caller-supplied helper run correlation |
| `logPath` | string | Event points at the active daily log file |
| `status` | string | Completion status (e.g., `pass`, `fail`) |
| `durationMs` | number | Operation completed, measured in milliseconds |

## Log Levels

Four levels are available, in order of increasing severity:

| Level | Numeric Value | Use Case |
|-------|---------------|----------|
| `debug` | 0 | Detailed diagnostic information |
| `info` | 1 | Normal operational events |
| `warn` | 2 | Unexpected but recoverable conditions |
| `error` | 3 | Failures that prevent intended operation |

### Threshold Behavior

The `--log-level` flag (or `ANDROPERATOR_LOG_LEVEL` env var) controls which events are written to the file. Events at or above the threshold are logged.

| Setting | Events Logged |
|---------|---------------|
| `debug` | All events (debug, info, warn, error) |
| `info` | info, warn, error (default) |
| `warn` | warn, error |
| `error` | error only |

Default: `info` (from `normalizeLogLevel()` in `adapters/logger.ts`)

Valid values: `debug`, `info`, `warn`, `error` (case-insensitive)

Invalid values fall back silently to `info`.


## Event Naming Conventions

Events use dot-separated names with prefix-based categories:

| Prefix | Category | Example |
|--------|----------|---------|
| `cli.` | CLI output | `cli.banner` |
| `doctor.` | Doctor diagnostics | `doctor.check` |
| `serve.` | HTTP/SSE server | `serve.server.started`, `serve.http.request` |

### Helper run correlation

Optional caller-owned helpers can supply `ANDROPERATOR_SKILL_RUN_ID` with a
`skillrun_` prefix and safe identifier characters. Short-lived CLI commands
inherit valid IDs. Daemon-backed commands pass the ID on each execute request;
the long-lived daemon does not inherit ambient run context. This is logging
metadata, not a workflow result contract. Command/task IDs remain execution
correlation authority.

<a id="the-androperator-logs-command"></a>

## The `androperator logs` Command

Stream the log file in real time.

### Usage

```bash
androperator logs
```

### Behavior

1. Dumps all existing content from the current daily log file to stdout
2. Streams new lines as they are written
3. Runs until interrupted

### Interrupt

Press `Ctrl+C` (SIGINT) to stop. The command exits with code 0.

### Output Format

Raw NDJSON lines on stdout. No formatting, no filtering, no color.

### No Flags

The command accepts no flags. It always operates on the current daily log file determined by `ANDROPERATOR_LOG_DIR` (or the default `~/.androperator/logs`).

### Missing File Behavior

If the log file does not exist, the command writes a message to stderr and exits with code 0:

```
No log file found at /home/user/.androperator/logs/androperator-2026-03-28.log
```

## Fail-Open Behavior

If the log directory cannot be written to (permissions, disk full, path does not exist), Androperator:

1. Writes one warning to stderr
2. Disables file logging for the remainder of the process
3. Continues normal operation

Example warning (includes the error message when available):

```
[androperator] WARN: logging disabled after write failure for /home/user/.androperator/logs/androperator-2026-03-28.log: EACCES: permission denied, mkdir '/home/user/.androperator'
```

The command continues normally. Only the log file is affected.

## Verification

Run `androperator snapshot` for an explicit target, then inspect the daily log
or use `androperator logs`. Execution events retain command/task correlation.
Check logger status when a file cannot be persisted; logging never establishes
that the requested Android operation succeeded.


## Environment Variables

See [Environment Variables](environment.md) for complete details on:

- `ANDROPERATOR_LOG_DIR` - Change the log directory base path
- `ANDROPERATOR_LOG_LEVEL` - Set the file logging threshold

## JSON Mode Cleanliness

When JSON output mode is active, the unified logger never writes to stdout. Log events go only to the file. This ensures the JSON output stream remains parseable without interleaved log lines.
