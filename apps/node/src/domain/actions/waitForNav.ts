import type { Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";

export function buildWaitForNavExecution(
  expectedPackage?: string,
  expectedNode?: NodeMatcher,
  navTimeoutMs?: number,
): Execution {
  const commandId = `wait-for-nav-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const params: Record<string, unknown> = {};

  if (expectedPackage !== undefined) {
    params.expectedPackage = expectedPackage;
  }
  if (expectedNode !== undefined) {
    params.expectedNode = expectedNode;
  }
  if (navTimeoutMs !== undefined) {
    params.timeoutMs = navTimeoutMs;
  }

  // Execution timeout = max(navTimeout + 5000, defaultTimeout) to prevent envelope killing wait early
  const defaultTimeout = 30_000;
  const executionTimeoutMs = navTimeoutMs !== undefined
    ? Math.max(navTimeoutMs + 5000, defaultTimeout)
    : defaultTimeout;

  return {
    commandId,
    taskId: commandId,
    source: "androperator-action",
    expectedFormat: "android-ui-automator",
    timeoutMs: executionTimeoutMs,
    actions: [
      {
        id: "wait-for-nav",
        type: "wait_for_navigation",
        params,
      },
    ],
    mode: "direct",
  };
}
