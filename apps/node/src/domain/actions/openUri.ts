import type { Execution } from "../../contracts/execution.js";

export function buildOpenUriExecution(uri: string): Execution {
    return {
        commandId: `open_uri_${Date.now()}`,
        taskId: "cli-action-open-uri",
        source: "androperator-cli",
        timeoutMs: 15000,
        expectedFormat: "android-ui-automator",
        actions: [
            {
                id: "a1",
                type: "open_uri",
                params: {
                    uri,
                },
            },
        ],
    };
}
