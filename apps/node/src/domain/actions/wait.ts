import type { Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";

export function buildWaitExecution(
  selector: NodeMatcher,
  waitTimeoutMs?: number,
  strict?: boolean,
  container?: NodeMatcher,
): Execution {
  const commandId = `wait-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const actionParams: Record<string, unknown> = { matcher: selector };
  if (strict !== undefined) actionParams.strict = strict;
  if (container !== undefined) actionParams.container = container;
  if (waitTimeoutMs !== undefined) {
    actionParams.timeoutMs = waitTimeoutMs;
  }
  // Execution timeout = max(waitTimeout + 5000, defaultTimeout) to prevent envelope killing wait early
  const defaultTimeout = 30_000;
  const executionTimeoutMs = waitTimeoutMs !== undefined
    ? Math.max(waitTimeoutMs + 5000, defaultTimeout)
    : defaultTimeout;
  return {
    commandId,
    taskId: commandId,
    source: "androperator-action",
    expectedFormat: "android-ui-automator",
    timeoutMs: executionTimeoutMs,
    actions: [
      {
        id: "wait",
        type: "wait_for_node",
        params: actionParams,
      },
    ],
    mode: "direct",
  };
}
