import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAndroperatorLogger, getLoggerDestination } from "../../adapters/logger.js";
import { ANDROPERATOR_SKILL_RUN_ID_ENV_VAR, type LogEvent } from "../../contracts/logging.js";

describe("createAndroperatorLogger", () => {
  let tempRoot: string;
  let originalStderrWrite: typeof process.stderr.write;
  let originalLogDir: string | undefined;
  let originalLogLevel: string | undefined;
  let originalSkillRunId: string | undefined;
  const stderrLines: string[] = [];

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "androperator-unified-logger-"));
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    originalLogDir = process.env.ANDROPERATOR_LOG_DIR;
    originalLogLevel = process.env.ANDROPERATOR_LOG_LEVEL;
    originalSkillRunId = process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
    stderrLines.length = 0;
    process.stderr.write = ((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    delete process.env.ANDROPERATOR_LOG_DIR;
    delete process.env.ANDROPERATOR_LOG_LEVEL;
    delete process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
  });

  afterEach(async () => {
    process.stderr.write = originalStderrWrite;
    if (originalLogDir === undefined) {
      delete process.env.ANDROPERATOR_LOG_DIR;
    } else {
      process.env.ANDROPERATOR_LOG_DIR = originalLogDir;
    }
    if (originalLogLevel === undefined) {
      delete process.env.ANDROPERATOR_LOG_LEVEL;
    } else {
      process.env.ANDROPERATOR_LOG_LEVEL = originalLogLevel;
    }
    if (originalSkillRunId === undefined) {
      delete process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR];
    } else {
      process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = originalSkillRunId;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  function makeEvent(overrides: Partial<LogEvent> = {}): LogEvent {
    return {
      ts: "2026-03-27T00:00:00.000Z",
      level: "info",
      event: "test.event",
      message: "test message",
      ...overrides,
    };
  }

  async function readLogLines(logDir: string): Promise<LogEvent[]> {
    const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });
    const path = getLoggerDestination(logger).logPath;
    try {
      const contents = await readFile(path, "utf8");
      return contents
        .trimEnd()
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // File routing
  // ---------------------------------------------------------------------------

  describe("file routing", () => {
    it("writes events at or above threshold to file", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir, logLevel: "info" });

      logger.emit(makeEvent({ level: "info", event: "test.info" }));
      logger.emit(makeEvent({ level: "warn", event: "test.warn" }));
      logger.emit(makeEvent({ level: "error", event: "test.error" }));

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 3);
      assert.deepStrictEqual(
        lines.map((l) => l.event),
        ["test.info", "test.warn", "test.error"]
      );
    });

    it("does not write events below threshold to file", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir, logLevel: "warn" });

      logger.emit(makeEvent({ level: "debug", event: "test.debug" }));
      logger.emit(makeEvent({ level: "info", event: "test.info" }));
      logger.emit(makeEvent({ level: "warn", event: "test.warn" }));

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].event, "test.warn");
    });

    it("writes execution.output to file only, not terminal", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({
        logDir,
        logLevel: "debug",
        outputFormat: "pretty",
      });

      logger.emit(
        makeEvent({
          event: "execution.output",
          message: "Launching app...",
        })
      );

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].event, "execution.output");
      // No terminal output for execution.output
      const terminalOutput = stderrLines.filter((l) => l.includes("Launching app"));
      assert.strictEqual(terminalOutput.length, 0);
    });

    it("writes serve.* events to file only", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({
        logDir,
        logLevel: "debug",
        outputFormat: "pretty",
      });

      logger.emit(
        makeEvent({
          event: "serve.server.started",
          message: "Server started on port 3400",
        })
      );

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].event, "serve.server.started");
      const terminalOutput = stderrLines.filter((l) => l.includes("Server started"));
      assert.strictEqual(terminalOutput.length, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Terminal routing
  // ---------------------------------------------------------------------------

  describe("terminal routing", () => {
    it("writes cli.banner to stderr in pretty mode", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({
        logDir,
        logLevel: "debug",
        outputFormat: "pretty",
      });

      logger.emit(
        makeEvent({
          level: "debug",
          event: "cli.banner",
          message: "[Androperator] v0.1.0  APK: OK",
        })
      );

      const terminalOutput = stderrLines.filter((l) =>
        l.includes("[Androperator] v0.1.0")
      );
      assert.strictEqual(terminalOutput.length, 1);
    });

    it("does NOT write cli.banner to stderr in JSON mode", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({
        logDir,
        logLevel: "debug",
        outputFormat: "json",
      });

      logger.emit(
        makeEvent({
          level: "debug",
          event: "cli.banner",
          message: "[Androperator] v0.1.0  APK: OK",
        })
      );

      const terminalOutput = stderrLines.filter((l) =>
        l.includes("[Androperator] v0.1.0")
      );
      assert.strictEqual(terminalOutput.length, 0);
      // But it should still go to file
      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].event, "cli.banner");
    });

    it("does NOT write doctor.check to stderr (cmdDoctor renders its own report)", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({
        logDir,
        logLevel: "debug",
        outputFormat: "pretty",
      });

      logger.emit(
        makeEvent({
          event: "doctor.check",
          message: "adb-reachable status=pass",
        })
      );

      // doctor.check goes to file only - cmdDoctor() handles terminal rendering
      const terminalOutput = stderrLines.filter((l) =>
        l.includes("adb-reachable status=pass")
      );
      assert.strictEqual(terminalOutput.length, 0);

      // But it should go to file
      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].event, "doctor.check");
    });
  });

  // ---------------------------------------------------------------------------
  // child() context propagation
  // ---------------------------------------------------------------------------

  describe("child() context", () => {
    it("merges default context into emitted events", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });

      const child = logger.child({
        commandId: "cmd-123",
        taskId: "task-456",
        deviceId: "device-789",
      });

      child.emit(makeEvent({ event: "test.child", message: "child event" }));

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].commandId, "cmd-123");
      assert.strictEqual(lines[0].taskId, "task-456");
      assert.strictEqual(lines[0].deviceId, "device-789");
      assert.strictEqual(lines[0].event, "test.child");
    });

    it("explicit event fields override child context", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });

      const child = logger.child({ deviceId: "default-device" });
      child.emit(
        makeEvent({
          event: "test.override",
          message: "override",
          deviceId: "specific-device",
        })
      );

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].deviceId, "specific-device");
    });

    it("inherits skillRunId from the process environment", async () => {
      const logDir = join(tempRoot, "logs");
      process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = "skillrun_test_123";
      const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });

      logger.emit(makeEvent({ event: "test.inherited-skill-run" }));

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].skillRunId, "skillrun_test_123");
    });

    it("can opt out of inherited skillRunId for long-lived daemon processes", async () => {
      const logDir = join(tempRoot, "logs");
      process.env[ANDROPERATOR_SKILL_RUN_ID_ENV_VAR] = "skillrun_test_123";
      const logger = createAndroperatorLogger({ logDir, logLevel: "debug", inheritSkillRunId: false });

      logger.emit(makeEvent({ event: "test.no-inherited-skill-run" }));

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].skillRunId, undefined);
    });

    it("does not mutate parent logger context", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });

      const child = logger.child({ commandId: "child-cmd" });
      child.emit(makeEvent({ event: "test.child-emit" }));
      logger.emit(makeEvent({ event: "test.parent-emit" }));

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 2);
      assert.strictEqual(lines[0].commandId, "child-cmd");
      assert.strictEqual(lines[1].commandId, undefined);
    });

    it("supports nested child() calls with accumulating context", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });

      const child1 = logger.child({ commandId: "cmd-1" });
      const child2 = child1.child({ taskId: "child-task" });
      child2.emit(makeEvent({ event: "test.nested" }));

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].commandId, "cmd-1");
      assert.strictEqual(lines[0].taskId, "child-task");
    });
  });

  // ---------------------------------------------------------------------------
  // Fail-open behavior
  // ---------------------------------------------------------------------------

  describe("fail-open", () => {
    it("warns once and disables file logging when log dir is not writable", async () => {
      const logDir = join(tempRoot, "blocked");
      await writeFile(logDir, "not a directory", "utf8");

      const logger = createAndroperatorLogger({
        logDir,
        logLevel: "debug",
        outputFormat: "pretty",
      });

      // Should not throw
      logger.emit(makeEvent({ event: "cli.banner", message: "first" }));
      logger.emit(makeEvent({ event: "cli.banner", message: "second" }));

      // One warning on stderr
      const warnings = stderrLines.filter((l) =>
        l.includes("logging disabled after write failure")
      );
      assert.strictEqual(warnings.length, 1);

      // logPath returns undefined when disabled
      assert.strictEqual(logger.logPath(), undefined);

      // Terminal routing still works even when file is disabled
      const bannerOutput = stderrLines.filter((l) => l.includes("first") || l.includes("second"));
      assert.strictEqual(bannerOutput.length, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // logPath()
  // ---------------------------------------------------------------------------

  describe("logPath()", () => {
    it("returns daily log path when file logging is active", () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir });

      assert.equal(logger.logPath(), undefined);
      logger.emit(makeEvent());
      const path = logger.logPath();
      assert.ok(path);
      assert.match(path, /androperator-\d{4}-\d{2}-\d{2}\.log$/);
      assert.ok(path.startsWith(logDir));
    });

    it("returns undefined when file logging is disabled", async () => {
      const logDir = join(tempRoot, "blocked");
      await writeFile(logDir, "not a directory", "utf8");

      const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });
      logger.emit(makeEvent()); // triggers fail-open

      assert.strictEqual(logger.logPath(), undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // NDJSON format
  // ---------------------------------------------------------------------------

  describe("NDJSON format", () => {
    it("writes valid JSON with all LogEvent fields", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });

      logger.emit({
        ts: "2026-03-27T12:00:00.000Z",
        level: "info",
        event: "execution.output",
        message: "Launching app...",
        commandId: "cmd-1",
        taskId: "task-1",
        deviceId: "device-1",
        durationMs: 1234,
        status: "complete",
      });

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 1);
      const line = lines[0];
      assert.strictEqual(line.ts, "2026-03-27T12:00:00.000Z");
      assert.strictEqual(line.level, "info");
      assert.strictEqual(line.event, "execution.output");
      assert.strictEqual(line.message, "Launching app...");
      assert.strictEqual(line.commandId, "cmd-1");
      assert.strictEqual(line.taskId, "task-1");
      assert.strictEqual(line.deviceId, "device-1");
      assert.strictEqual(line.durationMs, 1234);
      assert.strictEqual(line.status, "complete");
    });

    it("preserves append-only behavior across multiple emits", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({ logDir, logLevel: "debug" });

      logger.emit(makeEvent({ event: "test.first" }));
      logger.emit(makeEvent({ event: "test.second" }));
      logger.emit(makeEvent({ event: "test.third" }));

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 3);
      assert.deepStrictEqual(
        lines.map((l) => l.event),
        ["test.first", "test.second", "test.third"]
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Compatibility: log() shim
  // ---------------------------------------------------------------------------


  // ---------------------------------------------------------------------------
  // Default routing: lifecycle events go to file only
  // ---------------------------------------------------------------------------

  describe("default routing (file only)", () => {
    it("lifecycle events go to file but not terminal", async () => {
      const logDir = join(tempRoot, "logs");
      const logger = createAndroperatorLogger({
        logDir,
        logLevel: "debug",
        outputFormat: "pretty",
      });

      logger.emit(
        makeEvent({
          event: "skills.run.start",
          message: "Skill test started",
        })
      );
      logger.emit(
        makeEvent({
          event: "broadcast.dispatched",
          message: "Broadcast dispatched",
        })
      );

      const lines = await readLogLines(logDir);
      assert.strictEqual(lines.length, 2);

      // No terminal output for lifecycle events
      const terminalOutput = stderrLines.filter(
        (l) => l.includes("Skill test started") || l.includes("Broadcast dispatched")
      );
      assert.strictEqual(terminalOutput.length, 0);
    });
  });
});
