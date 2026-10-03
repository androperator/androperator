# Unified Logging System Design

## Purpose

Provide deterministic, structured logging for all Androperator operations. An agent can inspect the log after a timeout or failure to reconstruct exactly what happened step by step.

## Design Principles

1. **Always Log**: Every significant operation is logged. No silent paths.
2. **Structured**: NDJSON format for machine parsing. No custom text formats.
3. **Fail-Open**: If logging fails, warn once and continue. Logging must never block execution.
4. **Terminal-Clean**: JSON output mode must not be polluted with log lines.
5. **Daily Rotation**: One file per day prevents unbounded growth and simplifies cleanup.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   CLI Commands  │────▶│                  │────▶│  NDJSON File    │
│   Skill Runner  │────▶│  Unified Logger  │     │  (~/.androperator│
│   HTTP Server   │────▶│                  │     │   /logs/...)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  Terminal (stderr│
                        │   in pretty mode)│
                        └──────────────────┘
```

### Key Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `AndroperatorLogger` interface | `contracts/logging.ts` | Contract for all logging operations |
| Logger implementation | `adapters/logger.ts` | File sink, terminal routing, level filtering |
| Log path utilities | `contracts/logging.ts` | Shared path resolution between logger and logs command |
| `androperator logs` command | `cli/commands/logs.ts` | Dump-then-stream behavior for log inspection |

## LogEvent Schema

All events share a common schema defined in `contracts/logging.ts`:

```typescript
interface LogEvent {
  ts: string;        // ISO 8601 timestamp
  level: LogLevel;   // "debug" | "info" | "warn" | "error"
  event: string;     // Dot-separated event name
  message: string;   // Human-readable summary
  
  // Optional context
  commandId?: string;
  taskId?: string;
  deviceId?: string;
  skillId?: string;
  stream?: "stdout" | "stderr";
  status?: string;
  durationMs?: number;
  exitCode?: number;
}
```

## Event Naming Conventions

Events use dot-separated prefixes for categorization:

| Prefix | Category | Examples |
|--------|----------|----------|
| `skills.run.` | Skill execution lifecycle | `start`, `output`, `complete`, `failed`, `timeout` |
| `cli.` | CLI command output | `banner`, `validation` |
| `doctor.` | Doctor diagnostics | `check` |
| `serve.` | HTTP/SSE server | `server.started`, `http.request`, `sse.client.connected` |

## Routing Rules

Routing determines where events go (file, terminal, or both). Terminal routing is independent of log level - it respects output format instead.

| Event Category | File | Terminal | In JSON Mode |
|----------------|------|----------|--------------|
| `skills.run.output` | Yes | No | No |
| `cli.*` | Yes | Yes | No |
| `doctor.*` | Yes | No | No |
| `serve.*` | Yes | No | No |
| `*` (default) | Yes | No | No |

**Design Rationale**:

- `skills.run.output` is file-only because skill terminal streaming is live interactive I/O handled by the `onOutput` callback (see below)
- `cli.*` events appear on stderr in pretty mode for user feedback, but are suppressed in JSON mode to keep output parseable
- Most server events are file-only to avoid terminal noise during long-running serve

### Why Skill Terminal Streaming Stays on `onOutput`

Skill execution produces two distinct output streams:

1. **Live Interactive I/O**: The skill's stdout/stderr lines as they happen, for real-time user feedback during long-running operations.
2. **Structured Log Events**: NDJSON records for post-hoc debugging and agent inspection.

These are intentionally separate:

- **Live stream** (`onOutput` callback) is immediate, unbuffered, and may be lossy if the consumer is slow. It's for human eyes.
- **Log events** (`skills.run.output`) are persisted, ordered, and complete. They're for machine analysis.

If we routed skill stdout through the logger's terminal output, we'd lose this separation:
- Real-time feedback would be gated by log level (file threshold)
- Interactive progress indicators would be interleaved with other log events
- JSON output mode would become unparseable

The `skills.run.output` event is file-only, while the live stream uses the existing `onOutput` callback pattern. This preserves both use cases without compromise.

## Level Threshold Behavior

The log level threshold applies **only to the file sink**. Terminal output respects the routing rules and output format, not the level threshold.

| Threshold | File Events Written |
|-----------|---------------------|
| `debug` | All levels |
| `info` | info, warn, error (default) |
| `warn` | warn, error |
| `error` | error only |

Invalid level values fall back silently to `info`.

## The `androperator logs` Command

### Design Goals

1. **No Flags**: Simple, predictable behavior. Always dump-then-stream.
2. **No Gap**: Watch the file before reading to prevent missing events between dump and stream.
3. **Clean Exit**: Ctrl+C exits 0 (user-initiated, not an error).

### Implementation Details

```
┌─────────────────────────────────────────────────────────────┐
│  cmdLogs()                                                   │
│  ├── Resolve log path                                        │
│  ├── Check existence (stderr + exit 0 if missing)           │
│  └── dumpAndStreamContent()                                  │
│      ├── Install SIGINT/SIGTERM handlers FIRST               │
│      ├── Start fs.watchFile() BEFORE reading                 │
│      ├── Read entire file (the "dump")                       │
│      ├── Emit queued events that arrived during dump         │
│      └── Stream new lines as they arrive                     │
└─────────────────────────────────────────────────────────────┘
```

The watch-before-read ordering guarantees no events are lost between the initial read and the start of streaming.

### Why File-Based Tailing?

The `androperator logs` command reads from the file system rather than subscribing to an in-process stream for architectural reasons:

1. **Process Independence**: The CLI process that generated logs may have exited. A separate `androperator logs` invocation can still retrieve the complete history.

2. **Post-Mortem Debugging**: After a skill timeout or crash, agents can inspect what happened without requiring a persistent in-memory event stream.

3. **No Shared Runtime**: Different CLI invocations share no memory. File system is the natural shared substrate.

4. **Simplicity**: No IPC, no WebSocket, no daemon process. Files are simple, inspectable, and work across process boundaries.

The trade-off is polling latency (via `fs.watchFile`), which is acceptable for human-readable tailing and agent inspection workflows.

## Fail-Open Behavior

If the log directory cannot be written to:

1. **One warning** to stderr with the format:
   ```
   [androperator] WARN: logging disabled after write failure for <path>
   ```
2. **Disable file logging** for the remainder of the process
3. **Continue normal operation** - commands and skills execute normally

This ensures logging problems never cascade into execution failures.

## Shared Path Utilities

To avoid drift between the logger and the logs command, path utilities live in `contracts/logging.ts`:

- `expandHomePath()`: Expand `~` to home directory
- `formatDate()`: Format as `YYYY-MM-DD`
- `formatLogPath()`: Build the daily file path

Both the logger factory and the logs command use these utilities, ensuring they always agree on where logs live.

## Child Logger Pattern

The `AndroperatorLogger` interface provides a `child()` method for creating scoped loggers with inherited context. This is the preferred pattern for correlating events across a call chain.

### Usage Pattern

```typescript
// Root logger created at CLI entry
const logger = createAndroperatorLogger({ logDir, logLevel });

// Child logger for a specific command execution
const cmdLogger = logger.child({ commandId: "cmd-123", deviceId: "abc" });

// Events automatically include commandId and deviceId
cmdLogger.emit({
  ts: new Date().toISOString(),
  level: "info",
  event: "skills.run.start",
  message: "Skill started",
  skillId: "com.example.app",
});
// Logged: {..., "commandId":"cmd-123", "deviceId":"abc", "skillId":"com.example.app"}
```

### Context Inheritance Rules

1. **Merging**: Child context is shallow-merged with parent defaults. Child values override parent values for the same key.
2. **Immutability**: The parent logger is unchanged; `child()` returns a new instance.
3. **Nesting**: Child loggers can create their own children for deeper nesting (e.g., command → task → sub-operation).

### When to Use Child Loggers

| Scenario | Pattern |
|----------|---------|
| Command execution | `logger.child({ commandId })` at command start |
| Skill run | `logger.child({ skillId, commandId })` in skill runner |
| Device-specific operations | `logger.child({ deviceId })` when device resolved |
| HTTP request context | `logger.child({ requestId })` in middleware |

Child loggers ensure all events in a scope carry consistent correlation IDs without manual repetition.

## Separation of Concerns: Logger vs EventEmitter

Androperator has two distinct event systems:

| System | Purpose | Transport | Data |
|--------|---------|-----------|------|
| `AndroperatorLogger` | Structured logging | NDJSON file, stderr | LogEvent objects |
| `androperatorEvents` (EventEmitter) | SSE transport | HTTP SSE stream | Rich result objects |

**Why Two Systems?**

- The logger handles NDJSON-serializable events for persistent logs
- The EventEmitter carries complex in-memory objects (`ResultEnvelope`, `RunExecutionResult`) to SSE clients
- Mixing them would force either: (a) making LogEvents handle circular references, or (b) losing rich object structure in SSE

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANDROPERATOR_LOG_DIR` | Base directory for log files | `~/.androperator/logs` |
| `ANDROPERATOR_LOG_LEVEL` | File logging threshold | `info` |

Only `ANDROPERATOR_LOG_LEVEL` has a CLI flag equivalent (`--log-level`), which takes precedence. There is no `--log-dir` CLI flag - set the env var to change the log directory.

## Future Considerations

Potential extensions (not implemented):

- **Log rotation by size**: Currently rotation is daily only
- **Structured query interface**: `androperator logs --since 1h --level error`
- **Remote log aggregation**: Ship to external collector
- **Log compression**: Gzip old daily files automatically

These are intentionally deferred until concrete use cases emerge. The current design is sufficient for agent-driven debugging and operational visibility.

### Deferred: EventEmitter–Logger Unification (Optional Future)

Currently, the EventEmitter (`androperatorEvents`) and the logger are separate systems. A future refactor could unify them:

- Emit rich objects through a single pipeline
- Serialize to NDJSON for file sink
- Forward to SSE clients for live streaming
- Avoid dual event paths in skill runner and serve

This would simplify the codebase but is not required for the current feature set. The separation is stable and well-tested. Unification would require careful handling of circular references and performance characteristics of the SSE transport.

## Testing Strategy

The unified logging system has comprehensive unit tests covering:

1. **Level gating**: Events filtered by threshold
2. **Routing rules**: Correct destinations for each event category
3. **JSON mode cleanliness**: No terminal output when JSON output mode is active
4. **Fail-open behavior**: Single warning, then disabled logging
5. **Child loggers**: Context inheritance and isolation
6. **File rotation**: Daily path changes at midnight boundary

See `test/unit/unifiedLogger.test.ts` and `test/unit/logger.test.ts` for implementation.
