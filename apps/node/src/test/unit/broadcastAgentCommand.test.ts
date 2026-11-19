import { describe, it } from "node:test";
import assert from "node:assert";
import { broadcastAgentCommand, buildBroadcastShellCommand } from "../../adapters/android-bridge/broadcastAgentCommand.js";
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

  it("pins the broadcast to the staged Android user when supplied", () => {
    assert.match(buildBroadcastShellCommand({ ...CONFIG, androidUserId: 10 }, "{}"), /^am broadcast --user '10' -a /);
    assert.match(buildBroadcastShellCommand(CONFIG, "{}"), /^am broadcast -a /);
  });

  it("omits the foreground flag for a pending background receiver", () => {
    assert.doesNotMatch(buildBroadcastShellCommand(CONFIG, "{}", false), /--receiver-foreground/);
  });

  it("allows a held broadcast to outlast the default ADB timeout", async () => {
    const config: RuntimeConfig = {
      ...CONFIG,
      runner: {
        ...CONFIG.runner,
        async run(_command, args, options) {
          assert.doesNotMatch(args.at(-1) ?? "", /--receiver-foreground/);
          assert.equal(options?.timeoutMs, 96000);
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    };
    const result = await broadcastAgentCommand(config, "{}", undefined, { foregroundReceiver: false, timeoutMs: 96000 });
    assert.equal(result.success, true);
  });

  it("escapes single quotes safely for device shell", () => {
    const payload = `{"commandId":"cmd-1","source":"it\\'s fine $HOME $(id) \`uname\`"}`;
    const cmd = buildBroadcastShellCommand(CONFIG, payload);

    assert.ok(cmd.includes("'\"'\"'"));
    assert.ok(!cmd.includes("\n"));
  });
});
