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
    config.runner = { ...config.runner, spawn: () => process };
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
