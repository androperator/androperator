/**
 * Tail the Androperator log file.
 * Dumps existing content then streams new lines as they arrive.
 */
import { createReadStream, existsSync, watchFile, unwatchFile, statSync } from "node:fs";
import { resolve } from "node:path";
import { expandHomePath, formatLogPath } from "../../contracts/logging.js";

// ---------------------------------------------------------------------------
// Log path resolution (uses shared utilities from contracts/logging.ts)
// ---------------------------------------------------------------------------

function resolveLogPath(logDir?: string): string {
  const configuredDir =
    logDir?.trim() ||
    process.env.ANDROPERATOR_LOG_DIR?.trim() ||
    "~/.androperator/logs";
  const resolvedDir = resolve(expandHomePath(configuredDir));
  return formatLogPath(resolvedDir);
}

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

export async function cmdLogs(options: { logDir?: string }): Promise<void> {
  const logPath = resolveLogPath(options.logDir);

  if (!existsSync(logPath)) {
    process.stderr.write(`No log file found at ${logPath}\n`);
    process.exitCode = 0;
    return;
  }

  // Set up combined dump and stream with no gap
  await dumpAndStreamContent(logPath);
}

async function dumpAndStreamContent(logPath: string): Promise<void> {
  return new Promise((resolve) => {
    let isRunning = true;
    let initialDumpComplete = false;
    let maxSizeDuringDump = 0;
    let pendingContentDuringDump: Array<{ start: number; end: number }> = [];

    // Handle SIGINT/SIGTERM gracefully - install BEFORE any I/O
    const handleSigint = () => {
      isRunning = false;
      unwatchFile(logPath);
      process.exitCode = 0;
      resolve();
    };

    process.on("SIGINT", handleSigint);
    process.on("SIGTERM", handleSigint);

    // Get initial file size before starting the watcher
    let initialSize = 0;
    try {
      initialSize = statSync(logPath).size;
      maxSizeDuringDump = initialSize;
    } catch {
      // If stat fails, we'll track from 0
    }

    // Start watching BEFORE the initial dump to avoid missing any events
    watchFile(logPath, { interval: 500 }, (curr, _prev) => {
      if (!isRunning) return;

      // Track the maximum size seen during the dump
      if (curr.size > maxSizeDuringDump) {
        const newContentStart = maxSizeDuringDump;
        maxSizeDuringDump = curr.size;

        if (!initialDumpComplete) {
          // Queue this content to be emitted after the dump completes
          pendingContentDuringDump.push({ start: newContentStart, end: curr.size - 1 });
          return;
        }

        // Emit new content immediately
        emitLogRange(logPath, newContentStart, curr.size - 1);
      }
    });

    // Dump existing content (only up to initialSize)
    const stream = createReadStream(logPath, { encoding: "utf8", start: 0, end: initialSize > 0 ? initialSize - 1 : undefined });
    let buffer = "";

    stream.on("data", (chunk: string | Buffer) => {
      buffer += chunk;
    });

    stream.on("end", () => {
      // Write existing lines to stdout
      if (buffer.length > 0) {
        // Ensure we end with a newline if the file doesn't
        if (!buffer.endsWith("\n")) {
          buffer += "\n";
        }
        process.stdout.write(buffer);
      }

      // Now emit any content that arrived during the dump
      for (const range of pendingContentDuringDump) {
        emitLogRange(logPath, range.start, range.end);
      }
      pendingContentDuringDump = [];

      initialDumpComplete = true;
    });

    stream.on("error", (err) => {
      process.stderr.write(`[androperator] Error reading log: ${String(err)}\n`);
      // Still mark as complete so streaming can continue
      initialDumpComplete = true;
    });
  });
}

function emitLogRange(logPath: string, start: number, end: number): void {
  if (start > end) return;

  const stream = createReadStream(logPath, {
    encoding: "utf8",
    start,
    end,
  });

  stream.on("data", (chunk: string | Buffer) => {
    process.stdout.write(chunk.toString());
  });

  stream.on("error", (err) => {
    process.stderr.write(`[androperator] Error reading log: ${String(err)}\n`);
  });
}
