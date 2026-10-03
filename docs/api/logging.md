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
| `event` | string | Dot-separated event name (e.g., `skills.run.start`) |
| `message` | string | Human-readable summary |

### Optional Context Fields

Events may include additional context fields:

| Field | Type | Present When |
|-------|------|--------------|
| `commandId` | string | CLI command or execution has a correlation ID |
| `taskId` | string | Part of a larger task sequence |
| `deviceId` | string | Event targets a specific device |
| `skillId` | string | Skill execution event |
| `skillRunId` | string | Events belong to one `androperator skills run` invocation |
| `logPath` | string | Event points at the active daily log file |
| `tailCommand` | string | Event supplies a ready-to-run command for observing the log |
| `stream` | string | `stdout` or `stderr` for skill output lines |
| `status` | string | Completion status (e.g., `pass`, `fail`) |
| `durationMs` | number | Operation completed, measured in milliseconds |
| `exitCode` | number | Process exit code for skill/execution events |

### Example Log Lines

```jsonl
{"ts":"2026-03-28T10:15:30.100Z","level":"info","event":"skills.run.log_location","message":"Skill com.example.app.get-status run skillrun_1777600000000_00000000-0000-4000-8000-000000000000 logging to /home/user/.androperator/logs/androperator-2026-03-28.log; observe with: tail -f '/home/user/.androperator/logs/androperator-2026-03-28.log'","skillId":"com.example.app.get-status","skillRunId":"skillrun_1777600000000_00000000-0000-4000-8000-000000000000","logPath":"/home/user/.androperator/logs/androperator-2026-03-28.log","tailCommand":"tail -f '/home/user/.androperator/logs/androperator-2026-03-28.log'"}
{"ts":"2026-03-28T10:15:30.123Z","level":"info","event":"skills.run.start","message":"Skill com.example.app.get-status started","skillId":"com.example.app.get-status","skillRunId":"skillrun_1777600000000_00000000-0000-4000-8000-000000000000","commandId":"cmd-123"}
{"ts":"2026-03-28T10:15:30.456Z","level":"info","event":"skills.run.output","message":"Opening app...","skillId":"com.example.app.get-status","skillRunId":"skillrun_1777600000000_00000000-0000-4000-8000-000000000000","stream":"stdout"}
{"ts":"2026-03-28T10:15:32.789Z","level":"info","event":"skills.run.complete","message":"Skill com.example.app.get-status completed successfully in 2345ms","skillId":"com.example.app.get-status","skillRunId":"skillrun_1777600000000_00000000-0000-4000-8000-000000000000","durationMs":2345,"exitCode":0}
```

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

**Exception:** Skill output events (`skills.run.output`) are always written to the file regardless of level threshold, so agents can diagnose timeouts even when `--log-level error` is set.

## Event Naming Conventions

Events use dot-separated names with prefix-based categories:

| Prefix | Category | Example |
|--------|----------|---------|
| `skills.run.` | Skill execution lifecycle | `skills.run.start`, `skills.run.complete` |
| `cli.` | CLI output | `cli.banner` |
| `doctor.` | Doctor diagnostics | `doctor.check` |
| `serve.` | HTTP/SSE server | `serve.server.started`, `serve.http.request` |

### Skill Run Correlation

Every `androperator skills run` invocation creates a `skillRunId` and emits a
`skills.run.log_location` event at `info` level as the run starts, before
validation, readiness preflight, or child process execution. That event
contains the daily `logPath` and a `tailCommand` for human or agent observers.
JSON errors from early validation or preflight failures include the same
additive `logs` object when the CLI has a logger available.

The log file remains the same daily NDJSON file. Androperator does not create a
separate per-run log file. The `skillRunId` is additive correlation metadata
for filtering events that belong to one invocation.

Skill scripts receive the same value in `ANDROPERATOR_SKILL_RUN_ID`. When a
script invokes nested Androperator CLI commands, those short-lived child CLI
processes inherit the id and attach it to their log events.

Long-lived daemon processes do not inherit `ANDROPERATOR_SKILL_RUN_ID` from the
script that happened to start them. For daemon-backed execution, the nested CLI
passes the id on the individual daemon `/execute` request instead. This keeps
request-specific execution events such as `serve.http.request`,
`preflight.apk.pass`, `broadcast.dispatched`, and `envelope.received`
correlated to the skill run without permanently tagging unrelated future daemon
events.

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

The command or skill still executes normally. Only the log file is affected.

## Verification

Confirm logging is active:

```bash
# Check the log file exists and has recent content
ls -la ~/.androperator/logs/

# Stream logs in real time
androperator logs
```

Generate log entries:

```bash
# Skill runs produce lifecycle and output events
androperator skills run <skill_id> --device <device_serial>

# Snapshot commands produce execution lifecycle events
androperator snapshot --device <device_serial>
```

Verify entries appear:

```bash
# Check for skill lifecycle events
grep '"event":"skills.run.start"' ~/.androperator/logs/androperator-$(date +%F).log

# Check for the CLI banner (emitted at debug level during skill runs)
grep '"event":"cli.banner"' ~/.androperator/logs/androperator-$(date +%F).log

# Parse the NDJSON file with jq to see all events from a specific category
jq -c 'select(.event | startswith("skills.run."))' ~/.androperator/logs/androperator-$(date +%F).log

# Filter one skill invocation by run id
jq -c 'select(.skillRunId == "skillrun_1777600000000_00000000-0000-4000-8000-000000000000")' ~/.androperator/logs/androperator-$(date +%F).log
```

Note: `cli.banner` is logged at `debug` level. To see it in the file, use `--log-level debug`.

## Environment Variables

See [Environment Variables](environment.md) for complete details on:

- `ANDROPERATOR_LOG_DIR` - Change the log directory base path
- `ANDROPERATOR_LOG_LEVEL` - Set the file logging threshold

## JSON Mode Cleanliness

When JSON output mode is active, the unified logger never writes to stdout. Log events go only to the file. This ensures the JSON output stream remains parseable without interleaved log lines.
