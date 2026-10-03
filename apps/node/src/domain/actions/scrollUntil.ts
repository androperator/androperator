import type { Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";

export function buildScrollUntilExecution(
  direction: string,
  matcher: NodeMatcher,
  container: NodeMatcher | undefined,
  clickAfter: boolean,
  timeoutMs = 30000,
  strict?: boolean,
): Execution {
  const actionType = clickAfter ? "scroll_and_click" : "scroll_until";
  const commandId = `scroll-until-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    commandId,
    taskId: commandId,
    source: "androperator-cli",
    timeoutMs,
    expectedFormat: "android-ui-automator",
    actions: [
      {
        id: "a1",
        type: actionType,
        params: {
          direction,
          ...(strict !== undefined ? { strict } : {}),
          matcher,
          ...(container !== undefined ? { container } : {}),
          ...(clickAfter ? { clickAfter: true } : {}),
        },
      },
    ],
  };
}
