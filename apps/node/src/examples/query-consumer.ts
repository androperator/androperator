/** Runnable from a checkout after building: node apps/node/dist/examples/query-consumer.js --device <device_serial> */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { NodeQueryResult } from "../contracts/selectors.js";

const identifier = z.string().refine(value => value.trim().length > 0, "Must not be blank");
const nullableBoolean = z.boolean().nullable();
const count = z.number().int().nonnegative().safe();
// Local consumer validation mirrors NodeQueryResult without changing the wire contract.
const querySchema: z.ZodType<NodeQueryResult> = z.object({
  schemaVersion: z.literal(1), snapshotId: identifier, capturedAt: z.string().datetime(),
  totalMatches: count, returnedCount: count, truncated: z.boolean(),
  nodes: z.array(z.object({
    nodePath: identifier, parentPath: z.string().nullable(), resourceId: z.string().nullable(),
    className: z.string(), role: z.string(), label: z.string(), contentDescription: z.string().nullable(),
    bounds: z.object({ left: z.number().finite(), top: z.number().finite(), right: z.number().finite(), bottom: z.number().finite() }),
    visibleToUser: nullableBoolean, onScreen: z.boolean(), enabled: nullableBoolean,
    clickable: nullableBoolean, checkable: nullableBoolean, checked: nullableBoolean,
    selected: nullableBoolean, scrollable: nullableBoolean,
    accessibilityDataSensitive: nullableBoolean.optional(),
  })),
});
const responseSchema = z.object({
  terminalSource: z.literal("androperator_result"), isCanonicalTerminal: z.literal(true),
  envelope: z.object({
    commandId: identifier, taskId: identifier, status: z.literal("success"),
    error: z.null().optional(), errorCode: z.null().optional(),
    stepResults: z.array(z.object({
      id: identifier, actionType: identifier, success: z.literal(true), data: z.record(z.string()),
    })),
  }),
});

export interface QueryProcessOutput {
  status: number | null;
  signal: string | null;
  error?: Error;
  stdout: string;
  stderr: string;
}

export class QueryConsumptionError extends Error {
  constructor(message: string, readonly diagnostics: QueryProcessOutput) {
    super(message);
    this.name = "QueryConsumptionError";
  }
}

/** Accept only a complete inventory for the requested query step in this capture. */
export function consumeQuery(output: QueryProcessOutput, queryStepId = "query") {
  try {
    if (output.error !== undefined || output.signal !== null || output.status !== 0) {
      throw new Error("Query process failed or did not finish normally");
    }
    const response = responseSchema.parse(JSON.parse(output.stdout));
    const steps = response.envelope.stepResults.filter(step => step.id === queryStepId);
    if (steps.length !== 1 || steps[0].actionType !== "query_ui") {
      throw new Error("Expected exactly one query_ui step with the requested ID");
    }
    const query = querySchema.parse(JSON.parse(steps[0].data.query));
    if (query.returnedCount !== query.nodes.length || query.totalMatches < query.returnedCount ||
        query.truncated !== (query.totalMatches > query.returnedCount)) {
      throw new Error("Query counts or truncation flag are inconsistent");
    }
    if (query.truncated) {
      throw new Error("Truncated query cannot establish a complete inventory, absence, or uniqueness");
    }
    return { commandId: response.envelope.commandId, taskId: response.envelope.taskId, query, diagnostics: output };
  } catch (error) {
    throw new QueryConsumptionError(error instanceof Error ? error.message : String(error), output);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = spawnSync(process.execPath, [
    fileURLToPath(new URL("../cli/index.js", import.meta.url)), "query", ...process.argv.slice(2),
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  try {
    console.log(JSON.stringify(consumeQuery(output), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      diagnostics: output,
    }, null, 2));
    process.exitCode = 1;
  }
}
