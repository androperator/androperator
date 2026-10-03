import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildQueryExecution } from "../../domain/actions/query.js";
import { validateExecution } from "../../domain/executions/validateExecution.js";
import { resolveElementMatcherFromCli, hasElementSelectorFlag } from "../../cli/selectorFlags.js";
import { cmdQuery } from "../../cli/commands/action.js";
import { getNamedMcpTools } from "../../mcp/tools/named.js";
import { buildMcpSuccessResult } from "../../mcp/errors.js";
import { mapSelectorToNodeMatcher, mcpSelectorSchema } from "../../mcp/selectors.js";

const matcher = { resourceId: "row", ancestor: { role: "list" }, descendant: { textEquals: "Unique" } };
const cli = fileURLToPath(new URL("../../cli/index.js", import.meta.url));

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ANDROPERATOR_NO_DAEMON: "1" } });
  return { ...result, payload: JSON.parse(result.stdout) as { code?: string; message?: string; error?: { code?: string } } };
}

const invalidParams = [
  { matcher: {} }, { matcher: null }, { matcher: [] }, { matcher: { textEquals: " " } },
  { matcher: { unknown: "x" } }, { matcher: { textEquals: false } }, { matcher: { textEquals: null } },
  { matcher: { ancestor: {} } }, { matcher: { descendant: { ancestor: { textEquals: "x" } } } },
  { matcher: { ancestor: { textEquals: "" } } }, { matcher: { descendant: false } },
  { visibility: "hidden" }, { visibility: null }, { limit: 0 }, { limit: 1001 },
  { limit: 1.5 }, { limit: "1" }, { limit: null }, { strict: true },
];

describe("query and relational selector contracts", () => {
  it("accepts omitted matcher, bounded query params and relational action selectors", () => {
    for (const options of [{}, { matcher: { role: "switch", textEquals: "" } }, { matcher }, { matcher, visibility: "all" as const, limit: 1 }, { limit: 1000 }]) {
      const execution = buildQueryExecution(options);
      assert.deepEqual(validateExecution(execution).actions[0].params, options);
    }
    const click = buildQueryExecution({ matcher });
    click.actions[0].type = "click";
    assert.deepEqual(validateExecution(click).actions[0].params?.matcher, matcher);
    assert.notEqual(buildQueryExecution().commandId, buildQueryExecution().commandId);
  });

  it("rejects malformed predicates and query parameters in raw execution and MCP", async () => {
    const tool = getNamedMcpTools().find(tool => tool.name === "query_ui")!;
    for (const params of invalidParams) {
      const execution = buildQueryExecution();
      execution.actions[0].params = params as never;
      assert.throws(() => validateExecution(execution), { code: "EXECUTION_VALIDATION_FAILED" }, JSON.stringify(params));
      await assert.rejects(async () => tool.handler(params), JSON.stringify(params));
    }
  });

  it("keeps canonical relationship fields through CLI and existing MCP selectors", () => {
    const flags = ["--matcher-json", JSON.stringify(matcher)];
    assert.equal(hasElementSelectorFlag(flags), true);
    assert.deepEqual(resolveElementMatcherFromCli(flags), { ok: true, matcher });
    assert.deepEqual(mapSelectorToNodeMatcher(mcpSelectorSchema.parse({ id: "row", ancestor: matcher.ancestor, descendant: matcher.descendant })), matcher);
    for (const suffix of [["--text", "x"], ["--selector", '{"textEquals":"x"}'], ["--matcher-json", '{"textEquals":"x"}']]) {
      assert.equal(resolveElementMatcherFromCli([...flags, ...suffix]).ok, false);
    }
    for (const value of ["{", "{}", "null", '{"ancestor":{}}', '{"descendant":{"descendant":{"role":"button"}}}']) {
      assert.equal(resolveElementMatcherFromCli(["--matcher-json", value]).ok, false);
    }
  });

  it("preserves true false null and older APK omission through MCP transport", () => {
    const nodes = [true, false, null, undefined].map(value =>
      value === undefined ? { label: "" } : { label: "", accessibilityDataSensitive: value });
    const result = buildMcpSuccessResult({ query: { schemaVersion: 1, nodes } });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    assert.deepEqual(payload.query.nodes, nodes);
    assert.equal(payload.query.nodes[3].accessibilityDataSensitive ?? null, null);
  });

  it("forwards canonical query data and target options without modifying response JSON", async () => {
    const query = JSON.stringify({ schemaVersion: 1, snapshotId: "capture", capturedAt: "2026-01-01T00:00:00Z", totalMatches: 4, returnedCount: 4, truncated: false, nodes: [true, false, null, undefined].map(value => value === undefined ? {} : { accessibilityDataSensitive: value }) });
    let dispatched = false;
    const response = await cmdQuery({
      format: "json", matcher, visibility: "all", limit: 7,
      deviceId: "test-device", operatorPackage: "com.androperator.operator.dev", noDaemon: true,
      runExecutionFn: async (input, options) => {
        const execution = validateExecution(input);
        dispatched = true;
        assert.deepEqual(execution.actions[0].params, { matcher, visibility: "all", limit: 7 });
        assert.equal(options?.deviceId, "test-device");
        assert.equal(options?.operatorPackage, "com.androperator.operator.dev");
        return { ok: true, deviceId: "test-device", terminalSource: "logcat", envelope: {
          commandId: execution.commandId, taskId: execution.taskId, status: "success",
          stepResults: [{ id: "query", actionType: "query_ui", success: true, data: { query } }],
        } } as never;
      },
    });
    assert.equal(dispatched, true);
    assert.equal(JSON.parse(response).envelope.stepResults[0].data.query, query);
  });

  it("CLI rejects invalid and missing flag values with structured errors and nonzero exits", () => {
    for (const flags of [
      ["--visibility"], ["--visibility", "hidden"], ["--visibility", ""],
      ["--limit"], ["--limit", "0"], ["--limit", "1001"], ["--limit", "1.5"], ["--limit", ""],
      ["--matcher-json"], ["--matcher-json", "{}"],
      ["--matcher-json", "{"], ["--matcher-json", JSON.stringify(matcher), "--text", "x"],
    ]) {
      const result = runCli(["query", ...flags]);
      assert.equal(result.status, 1, flags.join(" "));
      assert.equal(result.payload.code, flags[0] === "--matcher-json" ? "EXECUTION_VALIDATION_FAILED" : "USAGE", result.stdout);
    }
  });

  it("CLI rejects duplicate query options before device selection", () => {
    for (const [flag, first, second] of [
      ["--limit", "1", "1"], ["--limit", "1", "2"],
      ["--visibility", "all", "all"], ["--visibility", "all", "on_screen"],
    ]) {
      for (const globalFirst of [true, false]) {
        const globals = ["--device", "non-existent", "--operator-package", "com.androperator.operator.dev"];
        const query = ["query", flag, first, flag, second];
        const result = runCli(globalFirst ? [...globals, ...query] : [...query, ...globals]);
        assert.equal(result.status, 1, result.stdout);
        assert.equal(result.payload.code, "USAGE", result.stdout);
        assert.equal(result.payload.message, `${flag} must not appear more than once`);
      }
    }
  });

  it("CLI accepts valid selectors and global device flags before or after the command", () => {
    for (const args of [
      ["--device", "non-existent", "query", "--matcher-json", JSON.stringify(matcher), "--visibility", "all", "--limit", "1"],
      ["query", "--device", "non-existent", "--text", "Unique", "--limit", "1000"],
      ["query", "--device", "non-existent"],
    ]) {
      const result = runCli(args);
      assert.notEqual(result.status, 0);
      assert.equal(result.payload.code, "DEVICE_NOT_FOUND", result.stdout);
    }
  });
});


describe("empty matcher recovery guidance", () => {
  it("rejects both aliases for query and click with an actionable structured error", () => {
    for (const command of ["query", "click"]) {
      for (const alias of ["--selector", "--matcher-json"]) {
        for (const globalFirst of [true, false]) {
          const flags = ["--device", "non-existent", "--operator-package", "com.androperator.operator.dev"];
          const result = runCli(globalFirst ? [...flags, command, alias, "{}"] : [command, alias, "{}", ...flags]);
          assert.equal(result.status, 1);
          assert.equal(result.payload.code, "EXECUTION_VALIDATION_FAILED");
          assert.match(result.stdout, /query without a matcher/);
        }
      }
    }
  });
});
