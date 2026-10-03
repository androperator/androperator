import type { Execution } from "../../contracts/execution.js";
import type { NodeMatcher } from "../../contracts/selectors.js";

export interface ReadOptions {
  selector: NodeMatcher;
  strict?: boolean;
  readAll?: boolean;
  container?: NodeMatcher;
  validator?: string;
  validatorPattern?: string;
}

function isReadOptions(value: NodeMatcher | ReadOptions): value is ReadOptions {
  return "selector" in value;
}

export function buildReadExecution(
  selectorOrOptions: NodeMatcher | ReadOptions,
  readAll?: boolean,
  container?: NodeMatcher,
  strict?: boolean,
): Execution {
  const options: ReadOptions = isReadOptions(selectorOrOptions)
    ? selectorOrOptions
    : { selector: selectorOrOptions, readAll, container, strict };

  const commandId = `read-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const params: Record<string, unknown> = { matcher: options.selector };
  if (options.strict !== undefined) params.strict = options.strict;
  if (options.readAll) {
    params.all = true;
  }
  if (options.container !== undefined) {
    params.container = options.container;
  }
  if (options.validator !== undefined) {
    params.validator = options.validator;
  }
  if (options.validatorPattern !== undefined) {
    params.validatorPattern = options.validatorPattern;
  }
  return {
    commandId,
    taskId: commandId,
    source: "androperator-action",
    expectedFormat: "android-ui-automator",
    timeoutMs: 30_000,
    actions: [
      {
        id: "read",
        type: "read_text",
        params,
      },
    ],
    mode: "direct",
  };
}
