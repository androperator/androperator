import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseToastArgs } from "../../cli/registry.js";
import { cmdToast } from "../../cli/commands/action.js";
import { buildToastExecution } from "../../domain/actions/toast.js";
import { validateExecution } from "../../domain/executions/validateExecution.js";
import type { Execution } from "../../contracts/execution.js";
import type { RunExecutionResult } from "../../domain/executions/runExecution.js";

const success: RunExecutionResult = {
  ok: true, deviceId: "test-device", terminalSource: "androperator_result",
  envelope: { commandId: "test", taskId: "test", status: "success", stepResults: [], error: null },
};
function execution(type: string, params?: unknown) {
  return { ...buildToastExecution("cancel"), actions: [{ id: "a1", type, ...(params !== undefined ? { params } : {}) }] };
}
function cli(args: string[]) {
  return spawnSync(process.execPath, [fileURLToPath(new URL("../../cli/index.js", import.meta.url)), ...args],
    { encoding: "utf8", env: { ...process.env, ANDROPERATOR_DISABLE_STAR_SUGGESTIONS: "1" } });
}

describe("toast contracts", () => {
  it("preserves text and accepts native durations and no-op cancellation", () => {
    for (const duration of [undefined, "short", "long"] as const) {
      const params = { text: " Test run \nstarted ", ...(duration !== undefined ? { duration } : {}) };
      assert.deepEqual(validateExecution(execution("show_toast", params)).actions[0].params, params);
    }
    for (const params of [undefined, {}]) assert.equal(validateExecution(execution("cancel_toast", params)).actions[0].type, "cancel_toast");
    assert.equal(validateExecution(execution("show_toast", { text: "x".repeat(2048) })).actions[0].params?.text?.length, 2048);
  });
  it("rejects malformed raw input and omitted versus null fields consistently", () => {
    for (const params of [undefined, null, [], {}, { text: null }, { text: 12 }, { text: "" }, { text: " \t\n\uFEFF" },
      { text: "x".repeat(2049) }, { text: "x", duration: null }, { text: "x", duration: "" }, { text: "x", duration: "LONG" },
      { text: "x", duration: 2000 }, { text: "x", durationMs: 2000 }, { text: "x", retry: {} }, { value: "alias" }]) {
      assert.throws(() => validateExecution(execution("show_toast", params)), JSON.stringify(params));
    }
    for (const params of [null, [], "", { text: "x" }, { duration: "short" }]) assert.throws(() => validateExecution(execution("cancel_toast", params)));
  });
  it("maps CLI text, duration, cancellation and escaped text", () => {
    assert.deepEqual(parseToastArgs(["started"]), { operation: "show", params: { text: "started" } });
    for (const duration of ["short", "long"] as const) {
      assert.deepEqual(parseToastArgs(["--duration", duration, "started"]), { operation: "show", params: { text: "started", duration } });
      assert.deepEqual(parseToastArgs(["started", "--duration", duration]), { operation: "show", params: { text: "started", duration } });
    }
    assert.deepEqual(parseToastArgs(["--cancel"]), { operation: "cancel" });
    assert.deepEqual(parseToastArgs(["--", "--cancel"]), { operation: "show", params: { text: "--cancel" } });
  });
  it("validates before daemon or direct dispatch", async () => {
    const result = await cmdToast({ operation: "show", params: { text: " " }, format: "json",
      tryDaemonExecutionFn: async () => assert.fail("invalid daemon dispatch"),
      runExecutionFn: async () => assert.fail("invalid direct dispatch"),
    });
    assert.equal(JSON.parse(result).code, "EXECUTION_VALIDATION_FAILED");
  });
  for (const operation of ["show", "cancel"] as const) {
    for (const route of ["daemon", "fallback", "direct", "uncertain"] as const) {
      it(`${operation} uses ${route} without replaying an uncertain mutation`, async () => {
        let proxies = 0;
        let directs = 0;
        let proxied: Execution | undefined;
        const raw = await cmdToast({ operation, params: operation === "show" ? { text: "started", duration: "long" } : undefined,
          format: "json", deviceId: "test-device", operatorPackage: "com.androperator.operator.dev", timeoutMs: 4321, noDaemon: route === "direct",
          tryDaemonExecutionFn: async (payload, options) => {
            proxies++;
            proxied = validateExecution(payload);
            assert.equal(options.allowPostDispatchFallback, false);
            assert.equal(options.rawDeviceId, "test-device");
            assert.equal(options.operatorPackage, "com.androperator.operator.dev");
            if (route === "uncertain") throw { code: "DAEMON_REQUEST_FAILED", message: "Acknowledgement lost" };
            return route === "daemon" ? success : null;
          },
          runExecutionFn: async (payload, options) => {
            directs++;
            const validated = validateExecution(payload);
            if (proxied) assert.deepEqual(validated, proxied);
            assert.equal(validated.actions[0].type, operation === "show" ? "show_toast" : "cancel_toast");
            assert.equal(validated.timeoutMs, 4321);
            assert.equal(options?.deviceId, "test-device");
            assert.equal(options?.operatorPackage, "com.androperator.operator.dev");
            return success;
          },
        });
        assert.equal(proxies, route === "direct" ? 0 : 1);
        assert.equal(directs, route === "direct" || route === "fallback" ? 1 : 0);
        assert.equal(JSON.parse(raw).code, route === "uncertain" ? "DAEMON_REQUEST_FAILED" : undefined);
      });
    }
  }
  it("returns structured CLI failures with common options before or after the command", () => {
    const invalid = [[], ["--duration"], ["text", "--duration"], ["text", "--duration", ""], ["text", "--duration", "2000"],
      ["text", "--duration", "long", "--duration", "short"], ["--cancel", "text"], ["--cancel", "--duration", "long"],
      ["--cancel", "--cancel"], ["text", "extra"], [""], [" "], ["text", "--unknown"], ["--"]];
    const common = ["--device", "test-device", "--operator-package", "com.androperator.operator.dev", "--timeout", "4321", "--output", "json", "--no-daemon"];
    for (const args of invalid) {
      for (const before of [true, false]) {
        const result = cli(before ? [...common, "toast", ...args] : ["toast", ...common, ...args]);
        assert.equal(result.status, 1, JSON.stringify(args));
        assert.ok(JSON.parse(result.stdout).code, result.stdout);
      }
    }
    for (const flags of [["--duration", "long"], ["--cancel"]]) {
      const result = cli(["query", ...flags]);
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).code, "USAGE");
    }
    const help = cli(["toast", "--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--duration <short\|long>/);
  });
});
