import { createHash } from "node:crypto";
import { RESULT_ENVELOPE_PREFIX } from "../../contracts/result.js";

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

/** One reader owns one command; incomplete chunks never become a terminal result. */
export class ResultEnvelopeTransport {
  private header?: Chunk;
  private readonly chunks: Buffer[] = [];
  private receivedBytes = 0;

  constructor(private readonly commandId: string) {}

  diagnostics(): Record<string, unknown> {
    return { receivedChunks: this.chunks.length, receivedBytes: this.receivedBytes,
      expectedChunks: this.header?.count, expectedBytes: this.header?.byteLength };
  }

  consume(line: string): string | null {
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
