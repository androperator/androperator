import type { Execution } from "../../contracts/execution.js";

export function buildStopRecordingExecution(sessionId?: string): Execution {
  return {
    commandId: `stop_recording_${Date.now()}`,
    taskId: "cli-record-stop",
    source: "androperator-cli",
    timeoutMs: 15000,
    expectedFormat: "android-ui-automator",
    actions: [
      {
        id: "a1",
        type: "stop_recording",
        params: sessionId ? { sessionId } : {},
      },
    ],
  };
}
