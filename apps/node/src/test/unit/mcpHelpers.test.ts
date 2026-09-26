import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import assert from "node:assert";
import { describe, it } from "node:test";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { LIMITS } from "../../contracts/limits.js";
import type { ResultEnvelope } from "../../contracts/result.js";
import { createMcpExecutionIds } from "../../mcp/executionIds.js";
import { buildMcpErrorResult, buildMcpSuccessResult, normalizeMcpError } from "../../mcp/errors.js";
import { buildReadSuccessResult, extractStepDataValue, parseReadAllResult } from "../../mcp/results.js";
import { mapSelectorToNodeMatcher, mcpSelectorSchema } from "../../mcp/selectors.js";
import { createSessionDefaults } from "../../mcp/session.js";
import { applySnapshotMaxChars, applySnapshotMaxCharsToEnvelope, getCoreMcpTools } from "../../mcp/tools/core.js";
import { getNamedMcpTools } from "../../mcp/tools/named.js";
import { buildExecutionToolFailureResult, executionToolOptionsSchema, mergeWithSessionDefaults, type ExecutionToolOptions } from "../../mcp/tools/common.js";

describe("createMcpExecutionIds", () => {
  it("generates distinct IDs with the expected prefix", () => {
    const first = createMcpExecutionIds("snapshot");
    const second = createMcpExecutionIds("snapshot");

    assert.match(first.commandId, /^mcp-snapshot-/);
    assert.match(first.taskId, /^mcp-snapshot-/);
    assert.notStrictEqual(first.commandId, second.commandId);
    assert.notStrictEqual(first.taskId, second.taskId);
  });
});

describe("mapSelectorToNodeMatcher", () => {
  it("maps each MCP selector field to the canonical NodeMatcher field", () => {
    const matcher = mapSelectorToNodeMatcher({
      id: "com.example:id/cta",
      role: "button",
      text: "Continue",
      textContains: "Cont",
      desc: "Continue button",
      descContains: "button",
    });

    assert.deepStrictEqual(matcher, {
      resourceId: "com.example:id/cta",
      role: "button",
      textEquals: "Continue",
      textContains: "Cont",
      contentDescEquals: "Continue button",
      contentDescContains: "button",
    });
  });

  it("rejects an all-empty selector instead of passing it through", () => {
    assert.throws(
      () => mapSelectorToNodeMatcher({}, "selector"),
      /selector must include at least one non-empty selector field/
    );
  });

  it("rejects whitespace-only selector fields at the MCP boundary", () => {
    const parsed = mcpSelectorSchema.safeParse({ text: "   " });
    assert.strictEqual(parsed.success, false);
  });

  it("rejects an empty selector object at the MCP boundary", () => {
    const parsed = mcpSelectorSchema.safeParse({});
    assert.strictEqual(parsed.success, false);
  });
});

describe("extractStepDataValue", () => {
  it("extracts snapshot text when present", () => {
    const envelope: ResultEnvelope = {
      commandId: "c1",
      taskId: "t1",
      status: "success",
      stepResults: [
        { id: "snap", actionType: "snapshot", success: true, data: { text: "<hierarchy />" } },
      ],
    };

    const extracted = extractStepDataValue(envelope, {
      actionType: "snapshot",
      dataKey: "text",
      errorKey: "error",
    });

    assert.deepStrictEqual(extracted, {
      ok: true,
      step: envelope.stepResults[0],
      value: "<hierarchy />",
    });
  });

  it("returns the snapshot extraction error when text is missing", () => {
    const envelope: ResultEnvelope = {
      commandId: "c1",
      taskId: "t1",
      status: "failed",
      stepResults: [
        { id: "snap", actionType: "snapshot", success: false, data: { error: "SNAPSHOT_EXTRACTION_FAILED" } },
      ],
      error: "failed",
    };

    const extracted = extractStepDataValue(envelope, {
      actionType: "snapshot",
      dataKey: "text",
      errorKey: "error",
    });

    assert.deepStrictEqual(extracted, {
      ok: false,
      error: "SNAPSHOT_EXTRACTION_FAILED",
      message: "snapshot step result did not include text.",
      step: envelope.stepResults[0],
    });
  });

  it("extracts read_text data from the canonical text key", () => {
    const envelope: ResultEnvelope = {
      commandId: "c1",
      taskId: "t1",
      status: "success",
      stepResults: [
        { id: "read", actionType: "read_text", success: true, data: { text: "[\"alpha\",\"beta\"]", all: "true" } },
      ],
    };

    const extracted = extractStepDataValue(envelope, {
      actionType: "read_text",
      dataKey: "text",
      errorKey: "error",
    });

    assert.deepStrictEqual(extracted, {
      ok: true,
      step: envelope.stepResults[0],
      value: "[\"alpha\",\"beta\"]",
    });
  });

  it("returns a defined missing-data error instead of undefined", () => {
    const envelope: ResultEnvelope = {
      commandId: "c1",
      taskId: "t1",
      status: "success",
      stepResults: [
        { id: "read", actionType: "read_text", success: true, data: {} },
      ],
    };

    const extracted = extractStepDataValue(envelope, {
      actionType: "read_text",
      dataKey: "text",
      errorKey: "error",
    });

    assert.deepStrictEqual(extracted, {
      ok: false,
      error: "MCP_STEP_DATA_MISSING",
      message: "read_text step result did not include text.",
      step: envelope.stepResults[0],
    });
  });

  it("returns MCP_STEP_NOT_FOUND when no matching step exists", () => {
    const envelope: ResultEnvelope = {
      commandId: "c1",
      taskId: "t1",
      status: "success",
      stepResults: [
        { id: "press", actionType: "press_key", success: true, data: {} },
      ],
    };

    const extracted = extractStepDataValue(envelope, {
      actionType: "read_text",
      dataKey: "text",
      errorKey: "error",
    });

    assert.deepStrictEqual(extracted, {
      ok: false,
      error: "MCP_STEP_NOT_FOUND",
      message: "No read_text step result was present in the envelope.",
    });
  });
});

describe("parseReadAllResult", () => {
  it("returns MCP_STEP_DATA_INVALID when read all=true value is not valid JSON", () => {
    const result = parseReadAllResult("not-json");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "MCP_STEP_DATA_INVALID");
    assert.strictEqual(result.message, "read returned invalid JSON array data");
  });

  it("returns MCP_STEP_DATA_INVALID when read all=true value parses to a non-array", () => {
    const result = parseReadAllResult("\"a string\"");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "MCP_STEP_DATA_INVALID");
    assert.strictEqual(result.message, "read returned non-array data for all=true");
  });

  it("returns MCP_STEP_DATA_INVALID when read all=true array contains a non-string", () => {
    const result = parseReadAllResult("[1,2,3]");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "MCP_STEP_DATA_INVALID");
    assert.strictEqual(result.message, "read returned non-string items in array for all=true");
  });

  it("returns ok with string array when read all=true value is a valid string array", () => {
    const result = parseReadAllResult("[\"a\",\"b\"]");
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual(result.values, ["a", "b"]);
    }
  });
});

describe("executionToolOptionsSchema", () => {
  it("trims deviceId and operatorPackage at the MCP boundary", () => {
    const parsed = executionToolOptionsSchema.parse({
      deviceId: " emulator-5554 ",
      operatorPackage: " com.clawperator.operator.dev ",
    });

    assert.deepStrictEqual(parsed, {
      deviceId: "emulator-5554",
      operatorPackage: "com.clawperator.operator.dev",
    });
  });

  it("rejects negative timeoutMs", () => {
    const parsed = executionToolOptionsSchema.safeParse({
      timeoutMs: -1,
    });

    assert.strictEqual(parsed.success, false);
  });

  it("rejects timeoutMs below the execution minimum", () => {
    const parsed = executionToolOptionsSchema.safeParse({
      timeoutMs: LIMITS.MIN_EXECUTION_TIMEOUT_MS - 1,
    });

    assert.strictEqual(parsed.success, false);
  });
});

describe("applySnapshotMaxChars", () => {
  it("returns full snapshot when maxChars is undefined", () => {
    const result = applySnapshotMaxChars("abcde", undefined);
    assert.strictEqual(result.snapshot, "abcde");
    assert.strictEqual(result.truncated, undefined);
  });

  it("returns full snapshot when length is below maxChars", () => {
    const result = applySnapshotMaxChars("abc", 10);
    assert.strictEqual(result.snapshot, "abc");
    assert.strictEqual(result.truncated, undefined);
  });

  it("returns full snapshot when length equals maxChars", () => {
    const result = applySnapshotMaxChars("abcde", 5);
    assert.strictEqual(result.snapshot, "abcde");
    assert.strictEqual(result.truncated, undefined);
  });

  it("truncates and sets truncated when length exceeds maxChars", () => {
    const result = applySnapshotMaxChars("abcdefgh", 4);
    assert.strictEqual(result.snapshot, "abcd");
    assert.strictEqual(result.truncated, true);
  });

  it("handles maxChars of 1", () => {
    const result = applySnapshotMaxChars("abc", 1);
    assert.strictEqual(result.snapshot, "a");
    assert.strictEqual(result.truncated, true);
  });
});

describe("applySnapshotMaxCharsToEnvelope", () => {
  it("truncates the snapshot text inside the returned envelope copy", () => {
    const envelope: ResultEnvelope = {
      commandId: "cmd-1",
      taskId: "task-1",
      status: "success",
      stepResults: [
        {
          id: "snap",
          actionType: "snapshot",
          success: true,
          data: {
            text: "<hierarchy>abcdef</hierarchy>",
            safe: "ok",
          },
        },
      ],
    };

    const result = applySnapshotMaxCharsToEnvelope(
      envelope,
      envelope.stepResults[0],
      envelope.stepResults[0].data.text!,
      10,
    );

    assert.strictEqual(result.snapshot, "<hierarchy");
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.envelope.stepResults[0].data.text, "<hierarchy");
    assert.strictEqual(result.envelope.stepResults[0].data.safe, "ok");
    assert.strictEqual(envelope.stepResults[0].data.text, "<hierarchy>abcdef</hierarchy>");

    const transport = buildMcpSuccessResult({
      envelope: result.envelope,
      snapshot: result.snapshot,
      truncated: result.truncated,
    });
    assert.match(transport.content[0].text, /"snapshot":"<hierarchy"/);
    assert.doesNotMatch(transport.content[0].text, /<hierarchy>abcdef<\/hierarchy>/);
  });

  it("returns the original envelope object when no truncation is needed", () => {
    const envelope: ResultEnvelope = {
      commandId: "cmd-1",
      taskId: "task-1",
      status: "success",
      stepResults: [
        {
          id: "snap",
          actionType: "snapshot",
          success: true,
          data: {
            text: "abc",
          },
        },
      ],
    };

    const result = applySnapshotMaxCharsToEnvelope(
      envelope,
      envelope.stepResults[0],
      "abc",
      10,
    );

    assert.strictEqual(result.snapshot, "abc");
    assert.strictEqual(result.truncated, undefined);
    assert.strictEqual(result.envelope, envelope);
  });
});

describe("mergeWithSessionDefaults", () => {
  it("uses session deviceId when per-call deviceId is absent", () => {
    const session = createSessionDefaults();
    session.deviceId = "session-device";

    const result = mergeWithSessionDefaults({} as ExecutionToolOptions, session);
    assert.strictEqual(result.deviceId, "session-device");
  });

  it("uses per-call deviceId over session default", () => {
    const session = createSessionDefaults();
    session.deviceId = "session-device";

    const result = mergeWithSessionDefaults({ deviceId: "call-device" }, session);
    assert.strictEqual(result.deviceId, "call-device");
  });

  it("uses session operatorPackage when per-call operatorPackage is absent", () => {
    const session = createSessionDefaults();
    session.operatorPackage = "com.session.operator";

    const result = mergeWithSessionDefaults({} as ExecutionToolOptions, session);
    assert.strictEqual(result.operatorPackage, "com.session.operator");
  });

  it("uses per-call operatorPackage over session default", () => {
    const session = createSessionDefaults();
    session.operatorPackage = "com.session.operator";

    const result = mergeWithSessionDefaults({ operatorPackage: "com.call.operator" }, session);
    assert.strictEqual(result.operatorPackage, "com.call.operator");
  });

  it("uses session timeoutMs when per-call timeoutMs is absent", () => {
    const session = createSessionDefaults();
    session.timeoutMs = 1234;

    const result = mergeWithSessionDefaults({} as ExecutionToolOptions, session);
    assert.strictEqual(result.timeoutMs, 1234);
  });

  it("applies precedence independently across all three fields", () => {
    const session = createSessionDefaults();
    session.deviceId = "session-device";
    session.operatorPackage = "com.session.operator";
    session.timeoutMs = 2000;

    const result = mergeWithSessionDefaults({
      deviceId: "call-device",
      timeoutMs: 500,
    } as ExecutionToolOptions, session);

    assert.strictEqual(result.deviceId, "call-device");
    assert.strictEqual(result.operatorPackage, "com.session.operator");
    assert.strictEqual(result.timeoutMs, 500);
  });

  it("leaves all fields undefined when both sources are absent", () => {
    const result = mergeWithSessionDefaults({} as ExecutionToolOptions, createSessionDefaults());
    assert.strictEqual(result.deviceId, undefined);
    assert.strictEqual(result.operatorPackage, undefined);
    assert.strictEqual(result.timeoutMs, undefined);
  });

  it("two separate SessionDefaults objects do not share state", () => {
    const first = createSessionDefaults();
    const second = createSessionDefaults();
    first.deviceId = "device-one";
    first.operatorPackage = "com.one";
    first.timeoutMs = 111;

    assert.strictEqual(second.deviceId, undefined);
    assert.strictEqual(second.operatorPackage, undefined);
    assert.strictEqual(second.timeoutMs, undefined);
  });
});

describe("MCP tool schemas", () => {
  it("requires selector-bearing tools to advertise at least one selector field", () => {
    const clickTool = getNamedMcpTools().find(tool => tool.name === "click");
    assert.ok(clickTool);

    const selectorSchema = (clickTool!.inputSchema as {
      properties?: { selector?: { minProperties?: number; properties?: Record<string, { pattern?: string }> } };
    }).properties?.selector;

    assert.strictEqual(selectorSchema?.minProperties, 1);
    assert.strictEqual(selectorSchema?.properties?.id?.pattern, "\\S");
    assert.strictEqual(selectorSchema?.properties?.text?.pattern, "\\S");
  });

  it("requires open tool string arguments to reject whitespace-only values in the published schema", () => {
    const openTool = getNamedMcpTools().find(tool => tool.name === "open");
    assert.ok(openTool);

    const schema = openTool!.inputSchema as {
      properties?: { appId?: { pattern?: string }; uri?: { pattern?: string } };
    };

    assert.strictEqual(schema.properties?.appId?.pattern, "\\S");
    assert.strictEqual(schema.properties?.uri?.pattern, "\\S");
  });

  it("includes maxChars on the snapshot tool schema", () => {
    const snapshotTool = getCoreMcpTools().find(tool => tool.name === "snapshot");
    assert.ok(snapshotTool);

    const schema = snapshotTool!.inputSchema as {
      properties?: { maxChars?: { minimum?: number } };
    };

    assert.strictEqual(schema.properties?.maxChars?.minimum, 1);
  });

  it("includes configure in the core tool list with the canonical session schema", () => {
    const configureTool = getCoreMcpTools().find(tool => tool.name === "configure");
    assert.ok(configureTool);

    const schema = configureTool!.inputSchema as {
      properties?: {
        deviceId?: { pattern?: string };
        operatorPackage?: { pattern?: string };
        timeoutMs?: { minimum?: number };
      };
    };

    assert.strictEqual(schema.properties?.deviceId?.pattern, "\\S");
    assert.strictEqual(schema.properties?.operatorPackage?.pattern, "\\S");
    assert.strictEqual(schema.properties?.timeoutMs?.minimum, LIMITS.MIN_EXECUTION_TIMEOUT_MS);
  });

  it("rejects empty execute action ids and types before dispatch", async () => {
    const executeTool = getCoreMcpTools().find(tool => tool.name === "execute");
    assert.ok(executeTool);

    await assert.rejects(
      async () => executeTool!.handler({
        actions: [
          {
            id: " ",
            type: "tap",
          },
        ],
      }),
      (error: unknown) => {
        if (!(error instanceof McpError)) {
          return false;
        }
        return error.code === ErrorCode.InvalidParams;
      },
    );
  });
});

describe("normalizeMcpError", () => {
  it("redacts raw stdout and stderr from MCP error payloads", () => {
    const payload = normalizeMcpError({
      code: "ADB_FAILED",
      message: "adb failed",
      hint: "Check adb",
      details: {
        stdout: "secret",
        stderr: "secret",
        command: "adb shell",
        safe: "ok",
      },
    });

    assert.deepStrictEqual(payload, {
      code: "ADB_FAILED",
      message: "adb failed",
      hint: "Check adb",
      details: {
        safe: "ok",
      },
    });
  });

  it("returns an MCP error result for DEVICE_NOT_INTERACTIVE preflight failures", () => {
    const result = buildExecutionToolFailureResult({
      code: "DEVICE_NOT_INTERACTIVE",
      message: "Device is not interactive.",
      details: {
        deviceLocked: true,
        screenOn: false,
        userUnlocked: true,
      },
      deviceId: "device-123",
    });

    assert.strictEqual(result.isError, true);
    assert.deepStrictEqual(result.structuredContent, {
      code: "DEVICE_NOT_INTERACTIVE",
      message: "Device is not interactive.",
      details: {
        deviceLocked: true,
        screenOn: false,
        userUnlocked: true,
      },
      deviceId: "device-123",
    });
  });

  it("preserves envelope and execution context fields needed for MCP diagnostics", () => {
    const payload = normalizeMcpError({
      code: "SNAPSHOT_EXTRACTION_FAILED",
      message: "snapshot extraction failed",
      envelope: {
        commandId: "cmd-1",
        stepResults: [
          {
            id: "snap",
            actionType: "snapshot",
            success: false,
            data: {
              error: "SNAPSHOT_EXTRACTION_FAILED",
              stderr: "secret",
            },
          },
        ],
      },
      deviceId: "device-123",
      terminalSource: "broadcast",
    });

    assert.deepStrictEqual(payload, {
      code: "SNAPSHOT_EXTRACTION_FAILED",
      message: "snapshot extraction failed",
      envelope: {
        commandId: "cmd-1",
        stepResults: [
          {
            id: "snap",
            actionType: "snapshot",
            success: false,
            data: {
              error: "SNAPSHOT_EXTRACTION_FAILED",
            },
          },
        ],
      },
      deviceId: "device-123",
      terminalSource: "broadcast",
    });
  });
});

describe("MCP transport redaction", () => {
  it("redacts host path fields from successful tool payloads", () => {
    const result = buildMcpSuccessResult({
      envelope: {
        stepResults: [
          {
            id: "shot",
            actionType: "take_screenshot",
            success: true,
            data: {
              path: "/tmp/owned.png",
              screenshotPath: "/tmp/owned-again.png",
              safe: "ok",
            },
          },
        ],
      },
      details: {
        logPath: "/tmp/clawperator.log",
      },
      safe: "still-ok",
    });

    const content = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.deepStrictEqual(content, {
      envelope: {
        stepResults: [
          {
            id: "shot",
            actionType: "take_screenshot",
            success: true,
            data: {
              safe: "ok",
            },
          },
        ],
      },
      details: {},
      safe: "still-ok",
    });
    assert.deepStrictEqual(result.structuredContent, content);
  });

  it("redacts host path fields from error payloads", () => {
    const result = buildMcpErrorResult({
      code: "TIMEOUT",
      message: "timed out",
      details: {
        logPath: "/tmp/clawperator.log",
        stdout: "secret",
        nested: {
          filePath: "/tmp/owned.txt",
          safe: "ok",
        },
      },
      envelope: {
        stepResults: [
          {
            id: "shot",
            actionType: "take_screenshot",
            success: false,
            data: {
              path: "/tmp/owned.png",
              safe: "ok",
            },
          },
        ],
      },
    });

    const content = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.deepStrictEqual(content, {
      code: "TIMEOUT",
      message: "timed out",
      details: {
        nested: {
          safe: "ok",
        },
      },
      envelope: {
        stepResults: [
          {
            id: "shot",
            actionType: "take_screenshot",
            success: false,
            data: {
              safe: "ok",
            },
          },
        ],
      },
    });
    assert.deepStrictEqual(result.structuredContent, content);
    assert.strictEqual(result.isError, true);
  });
});

it("read preserves scalar and array results while surfacing duplicate-selection advice", () => {
  for (const value of ["first", ["first", "second"]]) {
    const plain = buildReadSuccessResult(value);
    assert.deepStrictEqual(plain, buildMcpSuccessResult(value));
    const warning = "Multiple candidates matched. Use --strict (params.strict=true).";
    const advised = buildReadSuccessResult(value, warning);
    assert.strictEqual(advised.isError, undefined);
    assert.deepStrictEqual(advised.content[0], plain.content[0]);
    assert.deepStrictEqual(advised.content.slice(1), [{ type: "text", text: JSON.stringify({ selection_warning: warning }) }]);
  }
});


describe("snapshot presentation schema guidance", () => {
  const tool = getCoreMcpTools().find(tool => tool.name === "snapshot")!;
  const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema);

  it("accepts raw defaults and compact limits without inserting mode-dependent defaults", () => {
    for (const args of [{}, { compact: false }, { maxChars: 20 }, { saveRaw: true },
      { compact: true }, { compact: true, maxNodes: 1, maxTextChars: 4096 },
      { compact: true, maxNodes: 1000, maxTextChars: 1, saveRaw: true }]) {
      const before = JSON.stringify(args);
      assert.strictEqual(validate(args).valid, true, before);
      assert.strictEqual(JSON.stringify(args), before);
    }
  });

  it("rejects missing or false compact and conflicting or invalid limits in the published schema", () => {
    for (const args of [{ maxNodes: 20 }, { maxTextChars: 10 }, { compact: false, maxNodes: 20 },
      { compact: false, maxTextChars: 10 }, { compact: true, maxChars: 20 },
      { compact: true, maxNodes: 0 }, { compact: true, maxNodes: 1001 },
      { compact: true, maxTextChars: 4097 }, { compact: true, maxNodes: 1.5 },
      { compact: true, maxTextChars: "10" }]) {
      assert.strictEqual(validate(args).valid, false, JSON.stringify(args));
    }
  });

  it("publishes a valid minimal example and descriptions for every presentation option", () => {
    const schema = tool.inputSchema as { examples: Record<string, unknown>[]; properties: Record<string, { description?: string }> };
    for (const example of schema.examples) assert.strictEqual(validate(example).valid, true);
    for (const field of ["compact", "maxNodes", "maxTextChars", "saveRaw", "maxChars"]) {
      assert.ok(schema.properties[field].description);
    }
    assert.match(tool.description, /compact.*true/);
  });
});
