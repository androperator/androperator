import type { Execution } from "../../contracts/execution.js";

export function buildPressKeyExecution(key: string): Execution {
    return {
        commandId: `press_key_${Date.now()}`,
        taskId: "cli-action-press-key",
        source: "androperator-cli",
        timeoutMs: 10000,
        expectedFormat: "android-ui-automator",
        actions: [
            {
                id: "a1",
                type: "press_key",
                params: { key },
            },
        ],
    };
}
