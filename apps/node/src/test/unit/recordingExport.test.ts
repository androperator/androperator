import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  exportRecording,
  exportRecordingFile,
  getDefaultRecordingExportPath,
} from "../../domain/recording/exportRecording.js";
import { ERROR_CODES } from "../../contracts/errors.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const tempDirs: string[] = [];

function buildHeader(overrides?: { schemaVersion?: number; sessionId?: string }): string {
  return JSON.stringify({
    type: "recording_header",
    schemaVersion: overrides?.schemaVersion ?? 1,
    sessionId: overrides?.sessionId ?? "export-session-001",
    startedAt: 1710000000000,
    operatorPackage: "com.androperator.operator.dev",
  });
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const cliPath = join(packageRoot, "dist", "cli", "index.js");
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: packageRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("exportRecording", () => {
  it("exports all supported event types and derives counts, deltas, transitions, and timeline", () => {
    const ndjson = [
      buildHeader({ sessionId: "demo-session" }),
      JSON.stringify({
        ts: 1710000000200,
        seq: 2,
        type: "click",
        packageName: "com.example.a",
        resourceId: "com.example:id/button",
        text: "Tap me",
        contentDesc: "Button",
        bounds: { left: 1, top: 2, right: 3, bottom: 4 },
        snapshot: "<click />",
      }),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.example.a",
        className: "MainActivity",
        title: "Home",
        snapshot: "<window />",
      }),
      JSON.stringify({
        ts: 1710000000300,
        seq: 3,
        type: "scroll",
        packageName: "com.example.b",
        resourceId: "com.example:id/list",
        scrollX: 0,
        scrollY: 50,
        maxScrollX: 0,
        maxScrollY: 100,
        snapshot: "",
      }),
      JSON.stringify({
        ts: 1710000000400,
        seq: 4,
        type: "press_key",
        key: "back",
        snapshot: "<key />",
      }),
      JSON.stringify({
        ts: 1710000000500,
        seq: 5,
        type: "text_change",
        packageName: "com.example.a",
        resourceId: "com.example:id/input",
        text: "hello",
        snapshot: null,
      }),
    ].join("\n");

    const result = exportRecording(ndjson);

    assert.strictEqual(result.exportVersion, 1);
    assert.strictEqual(result.snapshotMode, "omit");
    assert.deepStrictEqual(result.events.map((event) => event.seq), [0, 2, 3, 4, 5]);
    assert.deepStrictEqual(result.events.map((event) => event.deltaMsSincePrevious), [null, 200, 100, 100, 100]);
    assert.deepStrictEqual(result.counts, {
      totalEvents: 5,
      byType: {
        window_change: 1,
        click: 1,
        scroll: 1,
        press_key: 1,
        text_change: 1,
      },
    });
    assert.deepStrictEqual(result.packageTransitions, [
      {
        seq: 3,
        ts: 1710000000300,
        fromPackageName: "com.example.a",
        toPackageName: "com.example.b",
      },
      {
        seq: 5,
        ts: 1710000000500,
        fromPackageName: "com.example.b",
        toPackageName: "com.example.a",
      },
    ]);
    assert.deepStrictEqual(result.timeline, {
      firstEventTs: 1710000000000,
      lastEventTs: 1710000000500,
      durationMs: 500,
    });
    assert.deepStrictEqual(result.events[0].snapshot, { present: true, xml: null });
    assert.deepStrictEqual(result.events[2].snapshot, { present: false, xml: null });
    assert.deepStrictEqual(result.events[3].snapshot, { present: true, xml: null });
  });

  it("exports header-only recordings as an empty artifact", () => {
    const result = exportRecording(buildHeader());
    assert.deepStrictEqual(result.events, []);
    assert.deepStrictEqual(result.counts, { totalEvents: 0, byType: {} });
    assert.deepStrictEqual(result.packageTransitions, []);
    assert.deepStrictEqual(result.timeline, {
      firstEventTs: null,
      lastEventTs: null,
      durationMs: null,
    });
  });

  it("exports recordings that only contain scroll, text_change, and press_key events", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "scroll",
        packageName: "com.example.a",
        resourceId: null,
        scrollX: 0,
        scrollY: 100,
        maxScrollX: 0,
        maxScrollY: 1000,
      }),
      JSON.stringify({
        ts: 1710000000200,
        seq: 2,
        type: "press_key",
        key: "back",
      }),
      JSON.stringify({
        ts: 1710000000300,
        seq: 3,
        type: "text_change",
        packageName: "com.example.a",
        resourceId: "com.example:id/input",
        text: "abc",
      }),
    ].join("\n");

    const result = exportRecording(ndjson);
    assert.deepStrictEqual(result.events.map((event) => event.type), [
      "scroll",
      "press_key",
      "text_change",
    ]);
  });

  it("preserves XML only when snapshots include is requested", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.example.a",
        className: "MainActivity",
        title: "Home",
        snapshot: "<window />",
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "press_key",
        key: "back",
        snapshot: "<key />",
      }),
    ].join("\n");

    const result = exportRecording(ndjson, "include");
    assert.deepStrictEqual(result.events[0].snapshot, { present: true, xml: "<window />" });
    assert.deepStrictEqual(result.events[1].snapshot, { present: true, xml: "<key />" });
  });

  it("uses the default export path rule", () => {
    assert.strictEqual(getDefaultRecordingExportPath("/tmp/demo.ndjson"), "/tmp/demo.export.json");
    assert.strictEqual(getDefaultRecordingExportPath("/tmp/demo-recording"), "/tmp/demo-recording.export.json");
  });

  it("writes a known-good export file that reads back exactly", async () => {
    const dir = await makeTempDir("androperator-recording-export-");
    const inputFile = join(dir, "demo.ndjson");
    const outputFile = join(dir, "nested", "demo.export.json");
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(inputFile, [
      buildHeader({ sessionId: "demo-session" }),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.example.a",
        className: "MainActivity",
        title: "Home",
        snapshot: "<window />",
      }),
      JSON.stringify({
        ts: 1710000000200,
        seq: 1,
        type: "click",
        packageName: "com.example.a",
        resourceId: "com.example:id/button",
        text: "Tap me",
        contentDesc: null,
        bounds: { left: 10, top: 20, right: 30, bottom: 40 },
        snapshot: "<click />",
      }),
    ].join("\n"), "utf8");

    const result = await exportRecordingFile(inputFile, outputFile, "include");
    const written = JSON.parse(await readFile(outputFile, "utf8"));

    assert.strictEqual(result.outputFile, outputFile);
    assert.deepStrictEqual(written, {
      exportVersion: 1,
      session: {
        sessionId: "demo-session",
        schemaVersion: 1,
        startedAt: 1710000000000,
        operatorPackage: "com.androperator.operator.dev",
      },
      snapshotMode: "include",
      events: [
        {
          seq: 0,
          ts: 1710000000000,
          deltaMsSincePrevious: null,
          type: "window_change",
          packageName: "com.example.a",
          className: "MainActivity",
          title: "Home",
          snapshot: { present: true, xml: "<window />" },
        },
        {
          seq: 1,
          ts: 1710000000200,
          deltaMsSincePrevious: 200,
          type: "click",
          packageName: "com.example.a",
          resourceId: "com.example:id/button",
          text: "Tap me",
          contentDesc: null,
          bounds: { left: 10, top: 20, right: 30, bottom: 40 },
          snapshot: { present: true, xml: "<click />" },
        },
      ],
      counts: {
        totalEvents: 2,
        byType: {
          window_change: 1,
          click: 1,
        },
      },
      packageTransitions: [],
      timeline: {
        firstEventTs: 1710000000000,
        lastEventTs: 1710000000200,
        durationMs: 200,
      },
    });
  });

  it("exports a pulled session directory by choosing the newest NDJSON file", async () => {
    const dir = await makeTempDir("androperator-recording-export-dir-");
    const pulledDir = join(dir, "pulled");
    await mkdir(pulledDir, { recursive: true });

    const olderFile = join(pulledDir, "older.ndjson");
    const newerFile = join(pulledDir, "newer.ndjson");
    await writeFile(olderFile, [
      buildHeader({ sessionId: "older-session" }),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.example.old",
        className: "MainActivity",
        title: "Old",
      }),
    ].join("\n"), "utf8");
    await writeFile(newerFile, [
      buildHeader({ sessionId: "newer-session" }),
      JSON.stringify({
        ts: 1710000001000,
        seq: 0,
        type: "window_change",
        packageName: "com.example.new",
        className: "MainActivity",
        title: "New",
      }),
    ].join("\n"), "utf8");
    await utimes(olderFile, 1710000000, 1710000000);
    await utimes(newerFile, 1710000001, 1710000001);

    const result = await exportRecordingFile(pulledDir);
    const written = JSON.parse(await readFile(join(pulledDir, "newer.export.json"), "utf8"));

    assert.strictEqual(result.outputFile, join(pulledDir, "newer.export.json"));
    assert.strictEqual(written.session.sessionId, "newer-session");
    assert.deepStrictEqual(written.counts, {
      totalEvents: 1,
      byType: { window_change: 1 },
    });
  });

  it("fails malformed headers, malformed events, and unsupported schema versions", async () => {
    const dir = await makeTempDir("androperator-recording-export-errors-");
    const malformedHeader = join(dir, "bad-header.ndjson");
    const malformedEvent = join(dir, "bad-event.ndjson");
    const badSchema = join(dir, "bad-schema.ndjson");
    await writeFile(malformedHeader, "{\"type\":\"not_header\"}\n", "utf8");
    await writeFile(malformedEvent, `${buildHeader()}\n{"type":"click"}\n`, "utf8");
    await writeFile(badSchema, `${buildHeader({ schemaVersion: 99 })}\n`, "utf8");

    await assert.rejects(
      () => exportRecordingFile(malformedHeader),
      (error: unknown) => (error as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED,
    );
    await assert.rejects(
      () => exportRecordingFile(malformedEvent),
      (error: unknown) => (error as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED,
    );
    await assert.rejects(
      () => exportRecordingFile(badSchema),
      (error: unknown) => (error as { code?: string }).code === ERROR_CODES.RECORDING_SCHEMA_VERSION_UNSUPPORTED,
    );
  });

  it("surfaces RECORDING_EXPORT_FAILED when the output path cannot be written", async () => {
    const dir = await makeTempDir("androperator-recording-export-write-fail-");
    const inputFile = join(dir, "demo.ndjson");
    const outputPath = join(dir, "occupied");
    await writeFile(inputFile, `${buildHeader()}\n`, "utf8");
    await mkdir(outputPath, { recursive: true });

    await assert.rejects(
      () => exportRecordingFile(inputFile, outputPath),
      (error: unknown) => (error as { code?: string }).code === ERROR_CODES.RECORDING_EXPORT_FAILED,
    );
  });

  it("surfaces RECORDING_EXPORT_FAILED when the input file does not exist", async () => {
    await assert.rejects(
      () => exportRecordingFile("/tmp/does-not-exist-recording.ndjson"),
      (error: unknown) => {
        const typed = error as { code?: string; message?: string };
        return typed.code === ERROR_CODES.RECORDING_EXPORT_FAILED
          && /Failed to inspect recording export input/.test(typed.message ?? "");
      },
    );
  });
});

describe("recording export CLI", () => {
  it("supports both recording export and record export without parser stderr output", async () => {
    const dir = await makeTempDir("androperator-recording-export-cli-");
    const inputFile = join(dir, "demo.ndjson");
    const pulledDir = join(dir, "pulled");
    await mkdir(pulledDir, { recursive: true });
    await writeFile(inputFile, [
      buildHeader({ sessionId: "cli-demo" }),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.example.a",
        className: "MainActivity",
        title: "Home",
        snapshot: "<window />",
      }),
    ].join("\n"), "utf8");

    const first = await runCli(["recording", "export", "--input", inputFile, "--json"]);
    assert.strictEqual(first.code, 0, first.stdout);
    assert.strictEqual(first.stderr, "");
    const firstJson = JSON.parse(first.stdout) as { outputFile?: string; sessionId?: string; eventCount?: number; packageTransitionCount?: number; byType?: Record<string, number> };
    assert.strictEqual(firstJson.outputFile, join(dir, "demo.export.json"));
    assert.strictEqual(firstJson.sessionId, "cli-demo");
    assert.strictEqual(firstJson.eventCount, 1);
    assert.strictEqual(firstJson.packageTransitionCount, 0);
    assert.deepStrictEqual(firstJson.byType, { window_change: 1 });

    const secondOutput = join(dir, "explicit.json");
    const second = await runCli([
      "record",
      "export",
      "--input",
      inputFile,
      "--out",
      secondOutput,
      "--snapshots",
      "include",
      "--json",
    ]);
    assert.strictEqual(second.code, 0, second.stdout);
    assert.strictEqual(second.stderr, "");
    const secondJson = JSON.parse(second.stdout) as { outputFile?: string };
    assert.strictEqual(secondJson.outputFile, secondOutput);

    const written = JSON.parse(await readFile(secondOutput, "utf8"));
    assert.strictEqual(written.snapshotMode, "include");
    assert.strictEqual(written.events[0].snapshot.xml, "<window />");

    const directoryOutput = join(dir, "pulled.export.json");
    await writeFile(join(pulledDir, "export-demo.ndjson"), [
      buildHeader({ sessionId: "pulled-cli-demo" }),
      JSON.stringify({
        ts: 1710000001000,
        seq: 0,
        type: "window_change",
        packageName: "com.example.dir",
        className: "MainActivity",
        title: "Dir",
      }),
    ].join("\n"), "utf8");

    const third = await runCli(["recording", "export", "--input", pulledDir, "--out", directoryOutput, "--json"]);
    assert.strictEqual(third.code, 0, third.stdout);
    assert.strictEqual(third.stderr, "");
    const thirdJson = JSON.parse(third.stdout) as { outputFile?: string; sessionId?: string };
    assert.strictEqual(thirdJson.outputFile, directoryOutput);
    assert.strictEqual(thirdJson.sessionId, "pulled-cli-demo");
  });

  it("uses the resolved NDJSON file when deriving the default output path for directory input", async () => {
    const dir = await makeTempDir("androperator-recording-export-cli-dir-default-");
    const pulledDir = join(dir, "pulled");
    await mkdir(pulledDir, { recursive: true });
    await writeFile(join(pulledDir, "export-demo.ndjson"), [
      buildHeader({ sessionId: "pulled-cli-default" }),
      JSON.stringify({
        ts: 1710000001000,
        seq: 0,
        type: "window_change",
        packageName: "com.example.dir",
        className: "MainActivity",
        title: "Dir",
      }),
    ].join("\n"), "utf8");

    const result = await runCli(["recording", "export", "--input", pulledDir, "--json"]);
    assert.strictEqual(result.code, 0, result.stdout);
    assert.strictEqual(result.stderr, "");

    const parsed = JSON.parse(result.stdout) as { outputFile?: string; sessionId?: string };
    assert.strictEqual(parsed.outputFile, join(pulledDir, "export-demo.export.json"));
    assert.strictEqual(parsed.sessionId, "pulled-cli-default");
    await readFile(join(pulledDir, "export-demo.export.json"), "utf8");
  });

  it("returns RECORDING_EXPORT_FAILED for missing input files", async () => {
    const result = await runCli(["recording", "export", "--input", "/tmp/does-not-exist-recording.ndjson", "--json"]);
    assert.notStrictEqual(result.code, 0);
    assert.strictEqual(result.stderr, "");
    const parsed = JSON.parse(result.stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, ERROR_CODES.RECORDING_EXPORT_FAILED);
    assert.match(parsed.message ?? "", /Failed to inspect recording export input/);
  });
});
