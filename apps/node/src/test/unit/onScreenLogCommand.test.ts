import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseOnScreenLogArgs, ON_SCREEN_LOG_FLAGS, COMMANDS, resolveHelpFromRegistry } from "../../cli/registry.js";
import { cmdOnScreenLog } from "../../cli/commands/action.js";
import { buildOnScreenLogExecution } from "../../domain/actions/onScreenLog.js";
import { validateExecution } from "../../domain/executions/validateExecution.js";
import type { Execution } from "../../contracts/execution.js";
import type { RunExecutionResult } from "../../domain/executions/runExecution.js";

const success: RunExecutionResult = {
  ok: true, deviceId: "test-device", terminalSource: "androperator_result",
  envelope: { commandId: "test", taskId: "test", status: "success", stepResults: [], error: null },
};
const cliPath = fileURLToPath(new URL("../../cli/index.js", import.meta.url));

function cli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", env: { ...process.env, ANDROPERATOR_DISABLE_STAR_SUGGESTIONS: "1" } });
}

describe("on-screen-log command", () => {
  it("maps every flag and preserves omitted defaults, whitespace and zero offsets", () => {
    const parsed = parseOnScreenLogArgs(["set", "--text", " label\n\tsecond ", "--anchor", "right", "--text-align", "left",
      "--top-offset-dp", "0", "--edge-offset-dp", "0.0", "--width-dp", "2.8e2", "--font-size-sp", "12.0",
      "--text-color", "#aabbcc", "--background-color", "#7f123456", "--ttl-ms", "1e3"]);
    const built = buildOnScreenLogExecution(parsed.operation, parsed.params, 4321);
    const normalized = validateExecution(built);
    assert.equal(normalized.timeoutMs, 4321);
    assert.deepEqual(normalized.actions, [{ id: "a1", type: "set_on_screen_log", params: {
      text: " label\n\tsecond ", anchor: "right", textAlign: "left", topOffsetDp: 0, edgeOffsetDp: 0,
      widthDp: 280, fontSizeSp: 12, textColor: "#FFAABBCC", backgroundColor: "#7F123456", ttlMs: 1000,
    } }]);
    assert.deepEqual(validateExecution(buildOnScreenLogExecution("set", { text: "default" })).actions[0].params, { text: "default" });
    assert.deepEqual(validateExecution(buildOnScreenLogExecution("clear")).actions, [{ id: "a1", type: "clear_on_screen_log" }]);
  });

  it("rejects every duplicate/missing panel flag and all panel flags on clear", () => {
    for (const flag of Object.keys(ON_SCREEN_LOG_FLAGS)) {
      assert.throws(() => parseOnScreenLogArgs(["set", "--text", "label", flag]));
      assert.throws(() => parseOnScreenLogArgs(["set", flag, "12", flag, "12"]));
      assert.throws(() => parseOnScreenLogArgs(["clear", flag, "12"]));
    }
    for (const args of [[], ["append"], ["set"], ["set", "label"], ["set", "--text", "x", "extra"], ["clear", "extra"], ["set", "--unknown", "x"]]) {
      assert.throws(() => parseOnScreenLogArgs(args));
    }
  });

  it("rejects malformed whole numeric tokens and leaves range validation canonical", () => {
    for (const flag of ["--top-offset-dp", "--edge-offset-dp", "--width-dp", "--font-size-sp", "--ttl-ms"]) {
      for (const token of ["", " ", "0x10", "12px", "1.5", "NaN", "Infinity", "1e999", "1e-3"]) {
        assert.throws(() => parseOnScreenLogArgs(["set", "--text", "label", flag, token]), `${flag} ${token}`);
      }
    }
    const parsed = parseOnScreenLogArgs(["set", "--text", "range", "--width-dp", "601"]);
    assert.throws(() => validateExecution(buildOnScreenLogExecution(parsed.operation, parsed.params)));
  });

  it("validates before either dispatch path, including API text limits", async () => {
    for (const params of [{ text: "" }, { text: " " }, { text: "x".repeat(2049) }, { text: "bad\rtext" }, { text: "x", widthDp: 79 }, { text: "x", textColor: "red" }]) {
      const raw = await cmdOnScreenLog({ operation: "set", params, format: "json",
        tryDaemonExecutionFn: async () => { assert.fail("must not proxy invalid input"); },
        runExecutionFn: async () => { assert.fail("must not dispatch invalid input"); },
      });
      assert.equal(JSON.parse(raw).code, "EXECUTION_VALIDATION_FAILED");
    }
    const raw = await cmdOnScreenLog({ operation: "set", params: { text: "x".repeat(2048) }, format: "json", noDaemon: true,
      runExecutionFn: async execution => { assert.equal(validateExecution(execution).actions[0].params?.text?.length, 2048); return success; },
    });
    assert.equal(JSON.parse(raw).envelope.status, "success");
  });

  for (const operation of ["set", "clear"] as const) {
    for (const route of ["daemon", "pre-dispatch-fallback", "no-daemon", "uncertain"] as const) {
      it(`${operation} preserves mutation semantics through ${route}`, async () => {
        let proxies = 0;
        let directs = 0;
        let proxyPayload: Execution | undefined;
        const raw = await cmdOnScreenLog({ operation, params: operation === "set" ? { text: "label", textColor: "#aabbcc" } : undefined,
          format: "json", deviceId: "test-device", operatorPackage: "com.androperator.operator.dev", timeoutMs: 4321,
          noDaemon: route === "no-daemon",
          tryDaemonExecutionFn: async (execution, options) => {
            proxies++;
            proxyPayload = validateExecution(execution);
            assert.equal(options.allowPostDispatchFallback, false);
            assert.equal(options.rawDeviceId, "test-device");
            assert.equal(options.operatorPackage, "com.androperator.operator.dev");
            if (route === "uncertain") throw { code: "DAEMON_REQUEST_FAILED", message: "Acknowledgement lost after dispatch" };
            return route === "daemon" ? success : null;
          },
          runExecutionFn: async (execution, options) => {
            directs++;
            if (proxyPayload) assert.deepEqual(execution, proxyPayload);
            assert.equal(validateExecution(execution).timeoutMs, 4321);
            assert.equal(options?.deviceId, "test-device");
            assert.equal(options?.operatorPackage, "com.androperator.operator.dev");
            assert.equal(options?.timeoutMs, 4321);
            if (operation === "set") assert.equal(validateExecution(execution).actions[0].params?.textColor, "#FFAABBCC");
            return success;
          },
        });
        assert.equal(proxies, route === "no-daemon" ? 0 : 1);
        assert.equal(directs, route === "pre-dispatch-fallback" || route === "no-daemon" ? 1 : 0);
        assert.equal(JSON.parse(raw).code, route === "uncertain" ? "DAEMON_REQUEST_FAILED" : undefined);
      });
    }
  }

  it("formats pretty execution output", async () => {
    const result = await cmdOnScreenLog({ operation: "clear", format: "pretty", noDaemon: true, runExecutionFn: async () => success });
    assert.match(result, /success/i);
  });

  it("registers family/subcommand help without changing host logs", () => {
    for (const rest of [["on-screen-log"], ["on-screen-log", "set"], ["on-screen-log", "clear"]]) {
      assert.match(resolveHelpFromRegistry(rest, COMMANDS), /--ttl-ms/);
    }
    assert.match(resolveHelpFromRegistry([], COMMANDS), /on-screen-log set\|clear/);
    assert.doesNotMatch(COMMANDS.logs.help, /--ttl-ms|on-screen-log set/);
  });

  it("returns structured nonzero subprocess errors for malformed public syntax", () => {
    const cases = [[], ["append"], ["set"], ["clear", "extra"], ["clear", "--text", "x"],
      ["set", "--text", "x", "--text", "y"], ["set", "--text"], ["set", "--text", "x", "extra"],
      ["set", "--text", "x", "--unknown", "y"], ["set", "--text", "x", "--width-dp", "12px"],
      ["set", "--text", ""], ["set", "--text", "x", "--width-dp", "601"]];
    for (const args of cases) {
      const result = cli(["on-screen-log", ...args]);
      assert.equal(result.status, 1, JSON.stringify(args));
      assert.ok(JSON.parse(result.stdout).code, result.stdout);
    }
    for (const common of [["--device", "test-device", "--operator-package", "com.androperator.operator.dev", "--timeout", "4321", "--no-daemon", "--output", "json"]]) {
      for (const args of [[...common, "on-screen-log", "set", "--text", " "], ["on-screen-log", "set", ...common, "--text", " "]]) {
        const result = cli(args);
        assert.equal(result.status, 1);
        assert.equal(JSON.parse(result.stdout).code, "EXECUTION_VALIDATION_FAILED");
      }
    }
    for (const args of [["on-screen-log", "--help"], ["on-screen-log", "set", "--help"], ["on-screen-log", "clear", "--help"]]) {
      const result = cli(args);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /--text-align/);
    }
  });
});

describe("on-screen-log template command", () => {
  it("carries the template and styles without resolving placeholders", () => {
    const parsed = parseOnScreenLogArgs(["set", "--template", "{{foreground_app.icon}} {{device.model}}", "--anchor", "right"]);
    const execution = validateExecution(buildOnScreenLogExecution(parsed.operation, parsed.params));
    assert.deepEqual(execution.actions[0].params, { template: "{{foreground_app.icon}} {{device.model}}", anchor: "right" });
  });
  it("rejects both forms, missing values, repeated flags and invalid placeholders with structured CLI errors", () => {
    for (const args of [["--template"], ["--template", "x", "--template", "y"], ["--text", "x", "--template", "y"], ["--template", "{{unknown}}"]]) {
      for (const before of [true, false]) {
        const common = ["--device", "test-device", "--operator-package", "com.androperator.operator.dev", "--output", "json"];
        const result = cli(before ? [...common, "on-screen-log", "set", ...args] : ["on-screen-log", "set", ...args, ...common]);
        assert.notEqual(result.status, 0);
        assert.ok(JSON.parse(result.stdout).code);
      }
    }
  });
});
