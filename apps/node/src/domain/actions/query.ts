import { randomUUID } from "node:crypto";
import type { Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";

export interface QueryOptions {
  matcher?: NodeMatcher;
  visibility?: "on_screen" | "all";
  limit?: number;
}

export function buildQueryExecution(options: QueryOptions = {}, timeoutMs = 30_000): Execution {
  const commandId = `query-${randomUUID()}`;
  return {
    commandId, taskId: commandId, source: "androperator-action",
    expectedFormat: "android-ui-automator", timeoutMs, mode: "direct",
    actions: [{ id: "query", type: "query_ui", params: { ...options } }],
  };
}
