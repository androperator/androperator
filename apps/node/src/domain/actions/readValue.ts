import type { Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";

export function buildReadValueExecution(
  labelMatcher: NodeMatcher,
  readAll?: boolean,
): Execution {
  const commandId = `read-value-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const params: Record<string, unknown> = { labelMatcher };
  if (readAll) {
    params.all = true;
  }
  return {
    commandId,
    taskId: commandId,
    source: "androperator-action",
    expectedFormat: "android-ui-automator",
    timeoutMs: 30_000,
    actions: [
      {
        id: "read-value",
        type: "read_key_value_pair",
        params,
      },
    ],
    mode: "direct",
  };
}
