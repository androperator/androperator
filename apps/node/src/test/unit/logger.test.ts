import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAndroperatorLogger } from "../../adapters/logger.js";

describe("createAndroperatorLogger (compat tests)", () => {
  let tempRoot: string;
  let stderrWrite: typeof process.stderr.write;
  let originalHome: string | undefined;
  let originalLogDir: string | undefined;
  const stderrLines: string[] = [];

  function currentLogPath(root: string): string {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return join(root, ".androperator", "logs", `androperator-${yyyy}-${mm}-${dd}.log`);
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "androperator-logger-"));
    stderrWrite = process.stderr.write.bind(process.stderr);
    originalHome = process.env.HOME;
    originalLogDir = process.env.ANDROPERATOR_LOG_DIR;
    stderrLines.length = 0;
    process.stderr.write = ((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.env.HOME = tempRoot;
    delete process.env.ANDROPERATOR_LOG_DIR;
  });

  afterEach(async () => {
    process.stderr.write = stderrWrite;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalLogDir === undefined) {
      delete process.env.ANDROPERATOR_LOG_DIR;
    } else {
      process.env.ANDROPERATOR_LOG_DIR = originalLogDir;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes parseable NDJSON entries", async () => {
    const logDir = join(tempRoot, "logs");
    const logger = createAndroperatorLogger({ logDir, logLevel: "info" });

    logger.emit({
      ts: "2026-03-22T00:00:00.000Z",
      level: "info",
      event: "test.event",
      commandId: "cmd-1",
      taskId: "task-1",
      deviceId: "device-1",
      message: "hello",
    });

    const path = logger.logPath();
    assert.ok(path);
    const contents = await readFile(path, "utf8");
    const lines = contents.trimEnd().split("\n");
    assert.strictEqual(lines.length, 1);
    assert.deepStrictEqual(JSON.parse(lines[0]), {
      ts: "2026-03-22T00:00:00.000Z",
      level: "info",
      event: "test.event",
      commandId: "cmd-1",
      taskId: "task-1",
      deviceId: "device-1",
      message: "hello",
    });
  });

  it("preserves inherited deviceId when child context omits it", async () => {
    const logDir = join(tempRoot, "logs");
    const parentLogger = createAndroperatorLogger({ logDir, logLevel: "info" }).child({
      deviceId: "device-parent",
    });
    const childLogger = parentLogger.child({
      skillId: "skill-child",
      deviceId: undefined,
    });

    childLogger.emit({
      ts: "2026-03-22T00:00:00.000Z",
      level: "info",
      event: "test.child",
      message: "child",
    });

    const contents = await readFile(parentLogger.logPath()!, "utf8");
    const entry = JSON.parse(contents.trimEnd()) as { deviceId?: string; skillId?: string };
    assert.strictEqual(entry.deviceId, "device-parent");
    assert.strictEqual(entry.skillId, "skill-child");
  });

  it("appends entries instead of overwriting the file", async () => {
    const logDir = join(tempRoot, "logs");
    const logger = createAndroperatorLogger({ logDir, logLevel: "info" });

    logger.emit({
      ts: "2026-03-22T00:00:00.000Z",
      level: "info",
      event: "test.first",
      message: "first",
    });
    logger.emit({
      ts: "2026-03-22T00:00:01.000Z",
      level: "warn",
      event: "test.second",
      message: "second",
    });

    const contents = await readFile(logger.logPath()!, "utf8");
    const lines = contents.trimEnd().split("\n");
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(JSON.parse(lines[0]), {
      ts: "2026-03-22T00:00:00.000Z",
      level: "info",
      event: "test.first",
      message: "first",
    });
    assert.deepStrictEqual(JSON.parse(lines[1]), {
      ts: "2026-03-22T00:00:01.000Z",
      level: "warn",
      event: "test.second",
      message: "second",
    });
  });

  it("creates the missing log directory on first write", async () => {
    const logDir = join(tempRoot, "nested", "logs", "deep");
    const logger = createAndroperatorLogger({ logDir, logLevel: "info" });

    logger.emit({
      ts: "2026-03-22T00:00:00.000Z",
      level: "info",
      event: "test.mkdir",
      message: "mkdir",
    });

    const contents = await readFile(logger.logPath()!, "utf8");
    assert.match(contents, /test\.mkdir/);
  });

  it("defaults to ~/.androperator/logs when no log dir is configured", async () => {
    const logger = createAndroperatorLogger({ logLevel: "info" });

    assert.strictEqual(logger.logPath(), undefined);

    logger.emit({
      ts: "2026-03-22T00:00:00.000Z",
      level: "info",
      event: "test.default-path",
      message: "default path",
    });

    assert.strictEqual(logger.logPath(), currentLogPath(tempRoot));
    const contents = await readFile(logger.logPath()!, "utf8");
    assert.match(contents, /test\.default-path/);
  });

  it("warns once and fails open when log directory creation fails", async () => {
    const logDir = join(tempRoot, "blocked");
    await writeFile(logDir, "not a directory", "utf8");
    const logger = createAndroperatorLogger({ logDir, logLevel: "info" });

    assert.doesNotThrow(() => {
      logger.emit({
        ts: "2026-03-22T00:00:00.000Z",
        level: "info",
        event: "test.fail-open",
        message: "blocked",
      });
      logger.emit({
        ts: "2026-03-22T00:00:01.000Z",
        level: "info",
        event: "test.fail-open-2",
        message: "blocked again",
      });
    });

    assert.strictEqual(stderrLines.length, 1);
    assert.match(stderrLines[0], /logging disabled after write failure/);
    assert.strictEqual(logger.logPath(), undefined);
  });
});

it("reports disabled and failed logging without claiming an unpersisted artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "logging-status-"));
  try {
    const disabled = createAndroperatorLogger({ logDir: root, fileLogging: false });
    disabled.emit({ ts: "now", level: "error", event: "test", message: "test" });
    assert.deepStrictEqual(disabled.status(), { status: "disabled" });
    assert.equal(disabled.logPath(), undefined);
    const logger = createAndroperatorLogger({ logDir: join(root, "logs") });
    assert.deepStrictEqual(logger.status(), { status: "available" });
    logger.emit({ ts: "now", level: "error", event: "test", message: "first" });
    const persisted = logger.logPath();
    assert.ok(persisted);
    assert.equal(logger.child({ taskId: "task" }).status().logPath, persisted);
    await rm(join(root, "logs"), { recursive: true });
    await writeFile(join(root, "logs"), "blocked");
    logger.emit({ ts: "now", level: "error", event: "test", message: "second" });
    assert.deepStrictEqual(logger.status(), { status: "write_failed", code: "LOGGING_WRITE_FAILED" });
    assert.equal(logger.logPath(), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
