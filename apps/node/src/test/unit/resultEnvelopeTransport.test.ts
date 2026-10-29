import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { ResultEnvelopeTransport } from "../../adapters/android-bridge/resultEnvelopeTransport.js";
import { parseResultEnvelope } from "../../adapters/android-bridge/envelopeParser.js";
import { waitForResultEnvelope } from "../../adapters/android-bridge/logcatResultReader.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";

const commandId = "query-command";
const taskId = "query-task";
const query = JSON.stringify({ label: "界😀".repeat(30000), checked: false });
const canonical = `[Androperator-Result] ${JSON.stringify({ commandId, taskId, status: "success", error: null,
  stepResults: [{ id: "query", actionType: "query_ui", success: true, data: { query } }] })}`;

function chunks(line = canonical) {
  const bytes = Buffer.from(line);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return Array.from({ length: Math.ceil(bytes.length / 1024) }, (_, index) => ({
    commandId, taskId, index, count: Math.ceil(bytes.length / 1024), byteLength: bytes.length, sha256,
    data: bytes.subarray(index * 1024, (index + 1) * 1024).toString("base64"),
  }));
}
function frame(chunk: unknown) { return `[Androperator-Result-Chunk] ${JSON.stringify(chunk)}`; }

describe("large query result transport", () => {
  it("reassembles a complete Unicode query while preserving the canonical envelope", () => {
    const reader = new ResultEnvelopeTransport(commandId);
    const frames = chunks();
    for (const chunk of frames.slice(0, -1)) assert.equal(reader.consume(frame(chunk)), null);
    const result = reader.consume(frame(frames.at(-1)));
    assert.equal(result, canonical);
    const envelope = parseResultEnvelope(result!, commandId);
    assert.ok(envelope && envelope !== "malformed");
    assert.equal(envelope.stepResults[0].data?.query, query);
  });

  it("ignores other commands, retains small lines and never completes a missing chunk", () => {
    const reader = new ResultEnvelopeTransport(commandId);
    assert.equal(reader.consume("ordinary log"), "ordinary log");
    const nestedMarker = '[Androperator-Result] {"label":"[Androperator-Result-Chunk]"}';
    assert.equal(reader.consume(nestedMarker), nestedMarker);
    assert.equal(reader.consume(frame({ ...chunks()[0], commandId: "other" })), null);
    assert.equal(reader.consume(frame(chunks()[0])), null);
    assert.equal(reader.consume(frame({ commandId: "other" })), null);
  });

  it("rejects reorder, duplication, inconsistent headers, bad base64 and oversized declarations", () => {
    const frames = chunks();
    assert.throws(() => new ResultEnvelopeTransport(commandId).consume(frame(frames[1])));
    for (const invalid of [frames[0], { ...frames[1], taskId: "other" }, { ...frames[1], sha256: "0".repeat(64) },
      { ...frames[1], data: "???" }, { ...frames[1], byteLength: 1000000000, count: 1000000 }]) {
      const reader = new ResultEnvelopeTransport(commandId);
      reader.consume(frame(frames[0]));
      assert.throws(() => reader.consume(frame(invalid)));
    }
    const reader = new ResultEnvelopeTransport(commandId);
    const corrupt = frames.map(chunk => ({ ...chunk, sha256: "0".repeat(64) }));
    assert.throws(() => corrupt.forEach(chunk => reader.consume(frame(chunk))), /checksum/);
  });

  it("rejects a reconstructed envelope with mismatched task identity", () => {
    const reader = new ResultEnvelopeTransport(commandId);
    assert.throws(() => chunks(canonical.replace('"taskId":"query-task"', '"taskId":"other"'))
      .forEach(chunk => reader.consume(frame(chunk))), /correlation/);
  });

  it("the actual logcat reader resolves chunks split across stdout buffers", async () => {
    const process = new EventEmitter() as ChildProcess;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    Object.assign(process, { stdout, stderr, kill: () => true });
    const config = getDefaultRuntimeConfig();
    config.runner = { ...config.runner, spawn: () => { queueMicrotask(() => stdout.write("I/Boot: reader ready\n")); return process; } };
    let dispatches = 0;
    const result = await waitForResultEnvelope(config, { commandId, timeoutMs: 3000, broadcastDelayMs: 0 }, async () => {
      dispatches++;
      setTimeout(() => {
        const output = Buffer.from(chunks().map(chunk => `09-12 12:00:00.000 1234 5678 I Result: ${frame(chunk)}`).join("\n") + "\n");
        for (let offset = 0; offset < output.length; offset += 137) stdout.write(output.subarray(offset, offset + 137));
      }, 5);
      return { success: true };
    });
    assert.equal(dispatches, 1);
    assert.ok(result.ok);
    assert.equal(result.envelope.stepResults[0].data?.query, query);
    stdout.destroy(); stderr.destroy();
  });
});

it("reports missing chunk progress and rejects truncated metadata and size mismatch", () => {
  const frames = chunks();
  const reader = new ResultEnvelopeTransport(commandId);
  reader.consume(frame(frames[0]));
  assert.deepEqual(reader.diagnostics(), { receivedChunks: 1, receivedBytes: 1024,
    expectedChunks: frames.length, expectedBytes: Buffer.byteLength(canonical) });
  assert.throws(() => reader.consume(frame(frames[1]).slice(0, -10)), /Malformed/);
  const invalid = { ...frames[0], byteLength: 1, count: 1 };
  assert.throws(() => new ResultEnvelopeTransport(commandId).consume(frame(invalid)), /chunk data/);
});

function publication(event = "writes_completed", overrides: Record<string, unknown> = {}) {
  const frames = chunks();
  return `[Androperator-Publication] ${JSON.stringify({ commandId, taskId, event,
    byteLength: Buffer.byteLength(canonical), recordCount: frames.length, chunkCount: frames.length,
    writtenRecords: frames.length, elapsedMs: 50, ...overrides })}`;
}

async function readPublicationOutput(lines: string[]) {
  const process = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let kills = 0;
  Object.assign(process, { stdout, stderr, kill: () => { kills++; return true; } });
  const config = getDefaultRuntimeConfig();
  config.runner = { ...config.runner, spawn: () => { queueMicrotask(() => stdout.write("I/Boot: reader ready\n")); return process; } };
  const result = await waitForResultEnvelope(config, { commandId, taskId, timeoutMs: 30, broadcastDelayMs: 0 }, async begin => {
    begin();
    // Split lines across pipe buffers, including the publication event.
    const output = lines.join("\n") + "\n";
    for (let offset = 0; offset < output.length; offset += 137) stdout.write(output.slice(offset, offset + 137));
    return { success: true };
  });
  stdout.destroy(); stderr.destroy();
  assert.equal(kills, 1);
  return result;
}

for (const received of [0, 1, 45]) {
  it(`reports incomplete delivery when publication completes after ${received} chunks`, async () => {
    const result = await readPublicationOutput([...chunks().slice(0, received).map(frame), publication()]);
    assert.ok(!result.ok && "error" in result);
    assert.equal(result.code, "RESULT_ENVELOPE_INCOMPLETE");
    const transport = result.diagnostics?.transport as Record<string, unknown>;
    assert.equal(transport.receivedChunks, received);
    assert.equal(transport.expectedChunks, chunks().length);
    assert.equal(transport.receivedBytes, received * 1024);
    assert.equal((transport.publication as Record<string, unknown>).event, "writes_completed");
    assert.equal(result.diagnostics?.executionPosition, "unknown");
    assert.equal(result.diagnostics?.dispatchAttempted, true);
    assert.match(result.error, /Inspect current state before retrying/);
    const reader = result.diagnostics?.reader as { events: { event: string }[] };
    assert.ok(!reader.events.some(event => event.event === "deadline_reached"));
  });
}

it("reports publication write failure separately from writes completed", async () => {
  const result = await readPublicationOutput([frame(chunks()[0]), publication("write_failed", { writtenRecords: 1 })]);
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_ENVELOPE_INCOMPLETE");
  const transport = result.diagnostics?.transport as Record<string, unknown>;
  assert.equal((transport.publication as Record<string, unknown>).event, "write_failed");
  assert.equal((transport.publication as Record<string, unknown>).writtenRecords, 1);
});

it("keeps the original deadline when no publication completion arrives", async () => {
  const result = await readPublicationOutput([frame(chunks()[0]), publication("started", { writtenRecords: 0 })]);
  assert.ok(!result.ok && "timeout" in result);
  assert.equal(result.diagnostics.code, "RESULT_ENVELOPE_TIMEOUT");
  const transport = result.diagnostics.details?.transport as Record<string, unknown>;
  assert.equal(transport.receivedChunks, 1);
  assert.equal((transport.publication as Record<string, unknown>).event, "started");
});

it("ignores foreign, malformed and inconsistent publication markers", async () => {
  const result = await readPublicationOutput([frame(chunks()[0]),
    publication("writes_completed", { commandId: "other" }),
    publication("writes_completed", { taskId: "other" }),
    publication("writes_completed", { byteLength: Buffer.byteLength(canonical) - 1 }),
    publication("writes_completed", { writtenRecords: 0 }),
    publication("writes_completed", { elapsedMs: -1 }),
    publication("unknown"), "[Androperator-Publication] {", "[Androperator-Publication] null",
  ]);
  assert.ok(!result.ok && "timeout" in result);
  const transport = result.diagnostics.details?.transport as Record<string, unknown>;
  assert.equal(transport.publication, undefined);
  assert.equal(transport.receivedChunks, 1);
});

it("a complete envelope remains authoritative with publication markers", async () => {
  const result = await readPublicationOutput([publication("started", { writtenRecords: 0 }),
    ...chunks().map(frame), publication()]);
  assert.ok(result.ok);
  assert.equal(result.envelope.stepResults[0].data?.query, query);
});

for (const byteLength of [1, 376, 3000]) {
  for (const [event, writtenRecords] of [["started", 0], ["writes_completed", 1], ["write_failed", 0], ["write_failed", 1]] as const) {
    it(`retains ${event} diagnostics for an unchunked ${byteLength}-byte result`, () => {
      const reader = new ResultEnvelopeTransport(commandId, taskId);
      assert.equal(reader.consume(publication(event, { byteLength, recordCount: 1, chunkCount: 0, writtenRecords })), null);
      assert.deepEqual(reader.diagnostics(), {
        receivedChunks: 0, receivedBytes: 0, expectedChunks: 0, expectedBytes: byteLength,
        publication: { commandId, taskId, event, byteLength, recordCount: 1, chunkCount: 0, writtenRecords, elapsedMs: 50 },
      });
    });
  }
}

it("rejects inconsistent unchunked publication metadata", () => {
  for (const overrides of [
    { byteLength: 0 }, { byteLength: -1 }, { byteLength: 1.5 }, { byteLength: 3001 },
    { recordCount: 0 }, { recordCount: 2 }, { chunkCount: 1 },
    { writtenRecords: -1 }, { writtenRecords: 2 }, { writtenRecords: 0.5 },
    { event: "started", writtenRecords: 1 }, { event: "writes_completed", writtenRecords: 0 },
    { commandId: "other" }, { taskId: "other" },
  ]) {
    const reader = new ResultEnvelopeTransport(commandId, taskId);
    reader.consume(publication("writes_completed", { byteLength: 376, recordCount: 1, chunkCount: 0, writtenRecords: 1, ...overrides }));
    assert.equal(reader.diagnostics().publication, undefined, JSON.stringify(overrides));
  }
});

for (const event of ["started", "writes_completed", "write_failed"]) {
  it(`small ${event} marker alone keeps waiting for a canonical result`, async () => {
    const result = await readPublicationOutput([publication(event, {
      byteLength: 376, recordCount: 1, chunkCount: 0, writtenRecords: event === "writes_completed" ? 1 : 0,
    })]);
    assert.ok(!result.ok && "timeout" in result);
    assert.equal(result.diagnostics.code, "RESULT_ENVELOPE_TIMEOUT");
    const transport = result.diagnostics.details?.transport as Record<string, unknown>;
    assert.equal((transport.publication as Record<string, unknown>).event, event);
  });
}

it("a small canonical result remains authoritative after publication metadata", async () => {
  const small = `[Androperator-Result] ${JSON.stringify({ commandId, taskId, status: "success", error: null, stepResults: [] })}`;
  const result = await readPublicationOutput([
    publication("started", { byteLength: Buffer.byteLength(small), recordCount: 1, chunkCount: 0, writtenRecords: 0 }),
    small,
  ]);
  assert.ok(result.ok);
  assert.equal(result.envelope.commandId, commandId);
});
