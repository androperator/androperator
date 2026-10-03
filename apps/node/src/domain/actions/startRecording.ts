import type { Execution } from "../../contracts/execution.js";

export function buildStartRecordingExecution(sessionId?: string): Execution {
  return {
    commandId: `start_recording_${Date.now()}`,
    taskId: "cli-record-start",
    source: "androperator-cli",
    timeoutMs: 10000,
    expectedFormat: "android-ui-automator",
    actions: [
      {
        id: "a1",
        type: "start_recording",
        params: sessionId ? { sessionId } : {},
      },
    ],
  };
}
