import { createHash } from "node:crypto";
import { RESULT_ENVELOPE_PREFIX } from "../../contracts/result.js";

const PUBLICATION_PREFIX = "[Androperator-Publication]";
const CHUNK_PREFIX = "[Androperator-Result-Chunk]";
const MAX_ENVELOPE_BYTES = 64 * 1024 * 1024;

interface Chunk {
  commandId: string;
  taskId: string;
  index: number;
  count: number;
  byteLength: number;
  sha256: string;
  data: string;
}

interface Publication {
  commandId: string;
  taskId: string;
  event: "started" | "writes_completed" | "write_failed";
  byteLength: number;
  recordCount: number;
  chunkCount: number;
  writtenRecords: number;
  elapsedMs: number;
}

export class IncompleteResultEnvelopeError extends Error {}

/** One reader owns one command; incomplete chunks never become a terminal result. */
export class ResultEnvelopeTransport {
  private header?: Chunk;
  private readonly chunks: Buffer[] = [];
  private receivedBytes = 0;
  private publication?: Publication;

  constructor(private readonly commandId: string, private readonly taskId?: string) {}

  diagnostics(): Record<string, unknown> {
    return { receivedChunks: this.chunks.length, receivedBytes: this.receivedBytes,
      expectedChunks: this.header?.count ?? this.publication?.chunkCount,
      expectedBytes: this.header?.byteLength ?? this.publication?.byteLength,
      ...(this.publication ? { publication: { ...this.publication } } : {}) };
  }

  private consumePublication(line: string): void {
    let value: Publication;
    try {
      value = JSON.parse(line.slice(PUBLICATION_PREFIX.length).trim());
    } catch {
      return;
    }
    // Publication is optional evidence. Invalid or foreign markers cannot end a wait.
    if (!value || value.commandId !== this.commandId ||
      typeof value.taskId !== "string" || value.taskId.length < 1 || value.taskId.length > 128 ||
      (this.taskId !== undefined && value.taskId !== this.taskId) ||
      !["started", "writes_completed", "write_failed"].includes(value.event) ||
      !Number.isSafeInteger(value.byteLength) || value.byteLength <= 0 || value.byteLength > MAX_ENVELOPE_BYTES ||
      (value.byteLength <= 3000
        ? value.chunkCount !== 0 || value.recordCount !== 1
        : value.chunkCount !== Math.ceil(value.byteLength / 1024) || value.recordCount !== value.chunkCount) ||
      !Number.isSafeInteger(value.writtenRecords) || value.writtenRecords < 0 || value.writtenRecords > value.recordCount ||
      !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0 ||
      (value.event === "started" && value.writtenRecords !== 0) ||
      (value.event === "writes_completed" && value.writtenRecords !== value.recordCount) ||
      (this.header && (value.taskId !== this.header.taskId || value.chunkCount !== this.header.count ||
        value.byteLength !== this.header.byteLength))) return;
    // Copy only the known metadata fields, never arbitrary data from log output.
    this.publication = { commandId: value.commandId, taskId: value.taskId, event: value.event,
      byteLength: value.byteLength, recordCount: value.recordCount, chunkCount: value.chunkCount,
      writtenRecords: value.writtenRecords, elapsedMs: value.elapsedMs };
    // The publisher emits these markers after its ordered writes have ended.
    // Logger completion is not host receipt or a canonical execution outcome.
    if (value.event !== "started" && this.chunks.length < value.chunkCount) {
      throw new IncompleteResultEnvelopeError(
        `Result publication ${value.event}, but received only ${this.chunks.length} of ${value.chunkCount} chunks. ` +
        "Execution outcome is unknown. Inspect current state before retrying; use a targeted query for a known UI element."
      );
    }
  }

  consume(line: string): string | null {
    if (line.startsWith(PUBLICATION_PREFIX)) {
      this.consumePublication(line);
      return null;
    }
    if (!line.startsWith(CHUNK_PREFIX)) return line;
    let chunk: Chunk;
    try {
      chunk = JSON.parse(line.slice(CHUNK_PREFIX.length).trim());
    } catch {
      if (line.includes(JSON.stringify(this.commandId))) throw new Error("Malformed result transport chunk");
      return null;
    }
    if (chunk?.commandId !== this.commandId) return null;
    if (
      typeof chunk.taskId !== "string" || chunk.taskId.length < 1 || chunk.taskId.length > 128 ||
      !Number.isInteger(chunk.index) || chunk.index !== this.chunks.length || chunk.index >= chunk.count ||
      !Number.isInteger(chunk.count) || chunk.count < 1 || chunk.count > MAX_ENVELOPE_BYTES / 1024 ||
      !Number.isInteger(chunk.byteLength) || chunk.byteLength < 1 || chunk.byteLength > MAX_ENVELOPE_BYTES ||
      chunk.count !== Math.ceil(chunk.byteLength / 1024) ||
      typeof chunk.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(chunk.sha256) ||
      typeof chunk.data !== "string" || chunk.data.length > 1368
    ) throw new Error(`Invalid result transport chunk (expectedIndex=${this.chunks.length}, receivedIndex=${chunk.index}, count=${chunk.count}, byteLength=${chunk.byteLength})`);
    if (this.header && ["taskId", "count", "byteLength", "sha256"].some(key =>
      chunk[key as keyof Chunk] !== this.header![key as keyof Chunk]
    )) throw new Error("Inconsistent result transport chunks");
    const bytes = Buffer.from(chunk.data, "base64");
    if (bytes.toString("base64") !== chunk.data || bytes.length !== Math.min(1024, chunk.byteLength - this.receivedBytes)) {
      throw new Error("Invalid result transport chunk data");
    }
    this.header = chunk;
    this.chunks.push(bytes);
    this.receivedBytes += bytes.length;
    if (this.chunks.length < chunk.count) return null;
    const result = Buffer.concat(this.chunks);
    if (result.length !== chunk.byteLength || createHash("sha256").update(result).digest("hex") !== chunk.sha256) {
      throw new Error("Result transport checksum mismatch");
    }
    const canonicalLine = result.toString("utf8");
    if (!canonicalLine.startsWith(`${RESULT_ENVELOPE_PREFIX} `)) throw new Error("Missing canonical result prefix");
    const envelope = JSON.parse(canonicalLine.slice(RESULT_ENVELOPE_PREFIX.length));
    if (envelope.commandId !== this.commandId || envelope.taskId !== chunk.taskId) {
      throw new Error("Result transport correlation mismatch");
    }
    return canonicalLine;
  }
}
