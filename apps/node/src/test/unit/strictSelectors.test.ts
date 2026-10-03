import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateExecution } from "../../domain/executions/validateExecution.js";
import { buildClickExecution } from "../../domain/actions/click.js";
import { buildTypeTextExecution } from "../../domain/actions/typeText.js";
import { buildReadExecution } from "../../domain/actions/read.js";
import { buildWaitExecution } from "../../domain/actions/wait.js";
import { buildScrollExecution } from "../../domain/actions/scroll.js";
import { buildScrollUntilExecution } from "../../domain/actions/scrollUntil.js";
import { resolveContainerMatcherFromCli } from "../../cli/selectorFlags.js";
import { getNamedMcpTools } from "../../mcp/tools/named.js";

const matcher = { resourceId: "target" };
const container = { resourceId: "scope", descendant: { textEquals: "Child" } };
const cli = fileURLToPath(new URL("../../cli/index.js", import.meta.url));

it("all action builders preserve strict false true and omission with relational scope", () => {
  for (const strict of [undefined, false, true]) {
    for (const execution of [
      buildClickExecution(matcher, undefined, undefined, strict, container),
      buildTypeTextExecution({ selector: matcher, text: "value", strict, container }),
      buildReadExecution(matcher, true, container, strict),
      buildWaitExecution(matcher, undefined, strict, container),
      buildScrollExecution("down", undefined, container, strict),
      buildScrollUntilExecution("down", matcher, container, false, undefined, strict),
      buildScrollUntilExecution("down", matcher, container, true, undefined, strict),
    ]) {
      const params = validateExecution(execution).actions[0].params!;
      assert.equal(params.strict, strict);
      assert.deepEqual(params.container, container);
      for (const invalid of [null, "true", 1, {}]) {
        assert.throws(() => validateExecution({ ...execution, actions: [{ ...execution.actions[0], params: { ...params, strict: invalid } }] }), { code: "EXECUTION_VALIDATION_FAILED" });
      }
    }
  }
  assert.throws(() => validateExecution(buildClickExecution(undefined, undefined, { x: 1, y: 1 }, true)), { code: "EXECUTION_VALIDATION_FAILED" });
  assert.throws(() => validateExecution(buildClickExecution(undefined, undefined, { x: 1, y: 1 }, false, container)), { code: "EXECUTION_VALIDATION_FAILED" });
});

it("container JSON normalizes aliases validates relationships and rejects missing conflicting malformed values", () => {
  assert.deepEqual(resolveContainerMatcherFromCli(["--container-json", JSON.stringify(container)]), { ok: true, container });
  for (const flags of [
    ["--container-json"], ["--container-json", ""], ["--container-json", "{"],
    ["--container-json", "{}"], ["--container-json", "null"], ["--container-json", '{"ancestor":{}}'],
    ["--container-json", JSON.stringify(container), "--container-id", "other"],
    ["--container-json", JSON.stringify(container), "--container-selector", JSON.stringify(container)],
  ]) assert.equal(resolveContainerMatcherFromCli(flags).ok, false, JSON.stringify(flags));
});

it("every CLI action accepts strict scoped selectors with global device options on either side", () => {
  for (const command of [["click", "--id", "target"], ["type", "value", "--id", "target"], ["read", "--id", "target"], ["wait", "--id", "target"], ["scroll", "down"], ["scroll-until", "down", "--id", "target"], ["scroll-and-click", "down", "--id", "target"]]) {
    for (const prefix of [true, false]) {
      const global = ["--device", "nonexistent-strict-test-device", "--operator-package", "com.androperator.operator.dev"];
      const args = [...(prefix ? global : []), ...command, "--strict", "--container-json", JSON.stringify(container), ...(!prefix ? global : [])];
      const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ANDROPERATOR_NO_DAEMON: "1" } });
      assert.notEqual(result.status, 0);
      assert.equal(JSON.parse(result.stdout).code, "DEVICE_NOT_FOUND", result.stdout);
    }
  }
});

it("CLI rejects invalid container values and coordinate conflicts with structured failures", () => {
  for (const flags of [["--container-json"], ["--container-json", "{}"], ["--container-json", ""], ["--container-json", JSON.stringify(container), "--container-id", "other"]]) {
    const result = spawnSync(process.execPath, [cli, "click", "--id", "target", "--strict", ...flags], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(typeof JSON.parse(result.stdout).code, "string");
  }
  const result = spawnSync(process.execPath, [cli, "click", "--coordinate", "1", "1", "--strict"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).code, "EXECUTION_VALIDATION_FAILED");
});

it("every named MCP selection tool advertises and validates strict and container", async () => {
  for (const name of ["click", "type", "read", "wait", "scroll", "scroll_until", "scroll_and_click"]) {
    const tool = getNamedMcpTools().find(tool => tool.name === name)!;
    const properties = tool.inputSchema.properties as Record<string, unknown>;
    assert.deepEqual(properties.strict, { type: "boolean" });
    assert.ok(properties.container);
    const args = {
      ...(name === "scroll" ? {} : { selector: { id: "target" } }),
      ...(name === "type" ? { text: "value" } : {}),
      ...(name.startsWith("scroll") ? { direction: "down" } : {}),
      container: { id: "scope", descendant: { textEquals: "Child" } },
      deviceId: "nonexistent-strict-test-device",
    };
    for (const strict of ["true", null, 1]) {
      await assert.rejects(async () => tool.handler({ ...args, strict }), /strict/);
    }
    const response = await tool.handler({ ...args, strict: true });
    const payload = JSON.parse((response.content[0] as { text: string }).text);
    assert.equal(payload.code, "DEVICE_NOT_FOUND", JSON.stringify(payload));
  }
});
