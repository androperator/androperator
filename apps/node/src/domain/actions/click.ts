import type { Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";

export function buildClickExecution(
  selector?: NodeMatcher,
  clickType?: "default" | "long_click" | "focus",
  coordinate?: { x: number; y: number },
  strict?: boolean,
  container?: NodeMatcher,
): Execution {
  const commandId = `click-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const params: Record<string, unknown> = {};
  if (selector && Object.keys(selector).length > 0) params.matcher = selector;
  if (strict !== undefined) params.strict = strict;
  if (container !== undefined) params.container = container;
  if (coordinate) params.coordinate = coordinate;
  if (clickType && clickType !== "default") {
    params.clickType = clickType;
  }
  return {
    commandId,
    taskId: commandId,
    source: "androperator-action",
    expectedFormat: "android-ui-automator",
    timeoutMs: 30_000,
    actions: [
      {
        id: "click",
        type: "click",
        params,
      },
    ],
    mode: "direct",
  };
}
