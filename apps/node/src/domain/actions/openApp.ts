import type { Execution } from "../../contracts/execution.js";

export function buildOpenAppExecution(
  applicationId: string,
  options: {
    skipNavigationWait?: boolean;
    navigationTimeoutMs?: number;
  } = {},
): Execution {
  return {
    commandId: `open_app_${Date.now()}`,
    taskId: "cli-action-open-app",
    source: "androperator-cli",
    timeoutMs: 15000,
    expectedFormat: "android-ui-automator",
    actions: [
      {
        id: "a1",
        type: "open_app",
        params: {
          applicationId,
          skipNavigationWait: options.skipNavigationWait ?? false,
          navigationTimeoutMs: options.navigationTimeoutMs ?? 15_000,
        },
      },
    ],
  };
}
