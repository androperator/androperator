import type { Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";

export function buildScrollExecution(
  direction: string,
  timeoutMs = 30000,
  container?: NodeMatcher,
  strict?: boolean,
): Execution {
  return {
    commandId: `scroll-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    taskId: "cli-action-scroll",
    source: "androperator-cli",
    timeoutMs,
    expectedFormat: "android-ui-automator",
    actions: [
      {
        id: "a1",
        type: "scroll",
        params: {
          direction,
          ...(strict !== undefined ? { strict } : {}),
          ...(container !== undefined ? { container } : {}),
        },
      },
    ],
  };
}
