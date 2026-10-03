import { describe, it } from "node:test";
import assert from "node:assert";
import { buildBroadcastShellCommand } from "../../adapters/android-bridge/broadcastAgentCommand.js";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";

const CONFIG: RuntimeConfig = {
  projectRoot: ".",
  adbPath: "adb",
  emulatorPath: "emulator",
  sdkmanagerPath: "sdkmanager",
  avdmanagerPath: "avdmanager",
  deviceId: "test-device-serial",
  operatorPackage: "com.androperator.operator.dev",
  actionAgentCommand: "app.androperator.operator.ACTION_AGENT_COMMAND",
  payloadExtraKey: "payload",
  runner: { run: async () => ({ code: 0, stdout: "", stderr: "" }), runShell: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => ({}) }
};

describe("buildBroadcastShellCommand", () => {
  it("single-quotes payload so JSON spacing is preserved on device shell", () => {
    const payload = `{"commandId":"cmd-1","taskId":"task-1","source":"debug","timeoutMs":5000,"actions":[{"id":"snap","type":"snapshot_ui"}]}`;
    const cmd = buildBroadcastShellCommand(CONFIG, payload);

    assert.ok(cmd.includes("--es 'payload' '{\"commandId\":\"cmd-1\""));
    assert.ok(cmd.endsWith("--receiver-foreground"));
  });

  it("escapes single quotes safely for device shell", () => {
    const payload = `{"commandId":"cmd-1","source":"it\\'s fine $HOME $(id) \`uname\`"}`;
    const cmd = buildBroadcastShellCommand(CONFIG, payload);

    assert.ok(cmd.includes("'\"'\"'"));
    assert.ok(!cmd.includes("\n"));
  });
});
