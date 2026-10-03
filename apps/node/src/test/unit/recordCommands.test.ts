import { describe, it } from "node:test";
import assert from "node:assert";
import { cmdRecordStart } from "../../cli/commands/record.js";

describe("cmdRecordStart", () => {
  it("adds a recovery hint when the operator reports recording is already in progress", async () => {
    const output = await cmdRecordStart(
      {
        format: "json",
        deviceId: "emulator-5554",
        operatorPackage: "com.androperator.operator.dev",
      },
      {
        runExecutionImpl: async () => ({
          ok: true,
          deviceId: "emulator-5554",
          terminalSource: "androperator_result",
          envelope: {
            commandId: "start_recording_123",
            taskId: "cli-record-start",
            status: "failed",
            error: "Step a1 (start_recording) failed: RECORDING_ALREADY_IN_PROGRESS",
            stepResults: [
              {
                id: "a1",
                actionType: "start_recording",
                success: false,
                data: {
                  error: "RECORDING_ALREADY_IN_PROGRESS",
                  message: "Recording is already in progress",
                  sessionId: "record-123",
                  filePath: "/storage/emulated/0/Android/data/com.androperator.operator.dev/files/recordings/record-123.ndjson",
                },
              },
            ],
          },
        }),
      }
    );

    const parsed = JSON.parse(output) as {
      envelope?: {
        hint?: string;
        stepResults?: Array<{
          data?: {
            error?: string;
            message?: string;
            sessionId?: string;
            filePath?: string;
            hint?: string;
          };
        }>;
      };
    };

    assert.match(parsed.envelope?.hint ?? "", /recording stop --session-id record-123 --device emulator-5554 --operator-package com\.androperator\.operator\.dev/);
    assert.doesNotMatch(parsed.envelope?.hint ?? "", /--json/);
    assert.match(parsed.envelope?.stepResults?.[0]?.data?.hint ?? "", /recording stop --session-id record-123 --device emulator-5554 --operator-package com\.androperator\.operator\.dev/);
    assert.doesNotMatch(parsed.envelope?.stepResults?.[0]?.data?.hint ?? "", /--json/);
    assert.strictEqual(parsed.envelope?.stepResults?.[0]?.data?.sessionId, "record-123");
    assert.strictEqual(
      parsed.envelope?.stepResults?.[0]?.data?.filePath,
      "/storage/emulated/0/Android/data/com.androperator.operator.dev/files/recordings/record-123.ndjson"
    );
  });

  it("adds a recovery hint in pretty output when the operator reports recording is already in progress", async () => {
    const output = await cmdRecordStart(
      {
        format: "pretty",
        deviceId: "emulator-5554",
        operatorPackage: "com.androperator.operator.dev",
      },
      {
        runExecutionImpl: async () => ({
          ok: true,
          deviceId: "emulator-5554",
          terminalSource: "androperator_result",
          envelope: {
            commandId: "start_recording_123",
            taskId: "cli-record-start",
            status: "failed",
            error: "Step a1 (start_recording) failed: RECORDING_ALREADY_IN_PROGRESS",
            stepResults: [
              {
                id: "a1",
                actionType: "start_recording",
                success: false,
                data: {
                  error: "RECORDING_ALREADY_IN_PROGRESS",
                  message: "Recording is already in progress",
                  sessionId: "record-123",
                  filePath: "/storage/emulated/0/Android/data/com.androperator.operator.dev/files/recordings/record-123.ndjson",
                },
              },
            ],
          },
        }),
      }
    );

    const parsed = JSON.parse(output) as {
      envelope?: {
        hint?: string;
        stepResults?: Array<{
          data?: {
            hint?: string;
          };
        }>;
      };
    };

    assert.match(parsed.envelope?.hint ?? "", /recording stop --session-id record-123 --device emulator-5554 --operator-package com\.androperator\.operator\.dev/);
    assert.doesNotMatch(parsed.envelope?.hint ?? "", /--json/);
    assert.match(parsed.envelope?.stepResults?.[0]?.data?.hint ?? "", /recording stop --session-id record-123 --device emulator-5554 --operator-package com\.androperator\.operator\.dev/);
    assert.doesNotMatch(parsed.envelope?.stepResults?.[0]?.data?.hint ?? "", /--json/);
  });
});
