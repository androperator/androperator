import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, writeFile, mkdir, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("logs command", () => {
  let tempRoot: string;
  let originalStderrWrite: typeof process.stderr.write;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalExitCode: typeof process.exitCode;
  let stderrOutput: string[];
  let stdoutOutput: string[];

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "androperator-logs-test-"));
    stderrOutput = [];
    stdoutOutput = [];
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes message to stderr when log file does not exist and exits 0", async () => {
    process.stderr.write = (chunk: string | Buffer) => {
      stderrOutput.push(chunk.toString());
      return true;
    };

    const nonExistentDir = join(tempRoot, "nonexistent");
    const { cmdLogs } = await import("../../cli/commands/logs.js");
    await cmdLogs({ logDir: nonExistentDir });

    const stderr = stderrOutput.join("");
    assert.ok(stderr.includes("No log file found at"), `Expected "No log file found" in stderr, got: ${stderr}`);
    assert.ok(stderr.includes(nonExistentDir), `Expected path in stderr, got: ${stderr}`);
    assert.strictEqual(process.exitCode, 0, "exitCode should be 0 for missing file");
  });

  it("dumps existing log content to stdout", async () => {
    process.stdout.write = (chunk: string | Buffer) => {
      stdoutOutput.push(chunk.toString());
      return true;
    };
    process.stderr.write = () => true;

    const logDir = join(tempRoot, "logs");
    const today = new Date();
    const year = String(today.getFullYear());
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;
    const logPath = join(logDir, `androperator-${dateStr}.log`);

    await mkdir(logDir, { recursive: true });
    const logLines = [
      '{"ts":"2026-03-28T00:00:00Z","level":"info","event":"test.start","message":"Test started"}',
      '{"ts":"2026-03-28T00:00:01Z","level":"info","event":"test.end","message":"Test ended"}',
    ].join("\n") + "\n";
    await writeFile(logPath, logLines);

    assert.ok(existsSync(logPath), "Log file should exist");

    const { cmdLogs } = await import("../../cli/commands/logs.js");
    const logsPromise = cmdLogs({ logDir });

    // Wait for dump to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Trigger SIGINT
    process.emit("SIGINT" as any);

    await Promise.race([logsPromise, new Promise((resolve) => setTimeout(resolve, 500))]);

    const stdout = stdoutOutput.join("");
    assert.ok(stdout.includes('"event":"test.start"'), `Expected test.start event in stdout, got: ${stdout}`);
    assert.ok(stdout.includes('"event":"test.end"'), `Expected test.end event in stdout, got: ${stdout}`);
  });

  it("streams new content after initial dump", async () => {
    process.stdout.write = (chunk: string | Buffer) => {
      stdoutOutput.push(chunk.toString());
      return true;
    };
    process.stderr.write = () => true;

    const logDir = join(tempRoot, "logs-stream");
    const today = new Date();
    const year = String(today.getFullYear());
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;
    const logPath = join(logDir, `androperator-${dateStr}.log`);

    await mkdir(logDir, { recursive: true });
    const initialLine = '{"ts":"2026-03-28T00:00:00Z","level":"info","event":"initial","message":"Initial"}\n';
    await writeFile(logPath, initialLine);

    const { cmdLogs } = await import("../../cli/commands/logs.js");
    const logsPromise = cmdLogs({ logDir });

    // Wait for initial dump
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify initial content was dumped
    let stdout = stdoutOutput.join("");
    assert.ok(stdout.includes('"event":"initial"'), `Expected initial event in stdout, got: ${stdout}`);

    // Append a new line to the file
    const newLine = '{"ts":"2026-03-28T00:00:05Z","level":"info","event":"appended","message":"Appended after start"}\n';
    await appendFile(logPath, newLine);

    // Wait for the watchFile to detect the change and stream the new content
    await new Promise((resolve) => setTimeout(resolve, 700));

    // Verify the new line was streamed
    stdout = stdoutOutput.join("");
    assert.ok(stdout.includes('"event":"appended"'), `Expected appended event in stdout after streaming, got: ${stdout}`);

    // Clean up
    process.emit("SIGINT" as any);
    await Promise.race([logsPromise, new Promise((resolve) => setTimeout(resolve, 300))]);
  });

  it("sets exitCode to 0 on SIGINT", async () => {
    process.stdout.write = () => true;
    process.stderr.write = () => true;

    const logDir = join(tempRoot, "logs-exit");
    const today = new Date();
    const year = String(today.getFullYear());
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;
    const logPath = join(logDir, `androperator-${dateStr}.log`);

    await mkdir(logDir, { recursive: true });
    await writeFile(logPath, '{"ts":"2026-03-28T00:00:00Z","level":"info","event":"test","message":"Test"}\n');

    const { cmdLogs } = await import("../../cli/commands/logs.js");
    const logsPromise = cmdLogs({ logDir });

    // Wait for dump
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify exitCode is not set yet
    assert.strictEqual(process.exitCode, undefined, "exitCode should be undefined before SIGINT");

    // Trigger SIGINT
    process.emit("SIGINT" as any);

    await Promise.race([logsPromise, new Promise((resolve) => setTimeout(resolve, 300))]);

    // Verify exitCode is set to 0
    assert.strictEqual(process.exitCode, 0, "exitCode should be 0 after SIGINT");
  });

  it("uses ANDROPERATOR_LOG_DIR environment variable", async () => {
    process.stderr.write = (chunk: string | Buffer) => {
      stderrOutput.push(chunk.toString());
      return true;
    };

    const envLogDir = join(tempRoot, "env-logs");
    const originalEnv = process.env.ANDROPERATOR_LOG_DIR;
    process.env.ANDROPERATOR_LOG_DIR = envLogDir;

    try {
      const { cmdLogs } = await import("../../cli/commands/logs.js");
      await cmdLogs({});
      const stderr = stderrOutput.join("");
      assert.ok(stderr.includes("No log file found at"), `Expected "No log file found" in stderr, got: ${stderr}`);
      assert.ok(stderr.includes(envLogDir), `Expected envLogDir in stderr, got: ${stderr}`);
    } finally {
      if (originalEnv) {
        process.env.ANDROPERATOR_LOG_DIR = originalEnv;
      } else {
        delete process.env.ANDROPERATOR_LOG_DIR;
      }
    }
  });
});

describe("logs command log path format", () => {
  it("matches the expected daily filename format", () => {
    const today = new Date();
    const year = String(today.getFullYear());
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const expectedDate = `${year}-${month}-${day}`;
    const expectedFilename = `androperator-${expectedDate}.log`;

    assert.ok(/androperator-\d{4}-\d{2}-\d{2}\.log/.test(expectedFilename));
  });
});
