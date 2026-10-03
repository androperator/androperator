import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

interface JsonRpcResponse {
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface DevicePayload {
  devices?: Array<{ serial: string; state: string }>;
  code?: string;
}

class McpIntegrationClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  private readBuffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
  }>();

  constructor() {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    this.child = spawn(process.execPath, ["dist/cli/index.js", "mcp", "serve"], {
      cwd: packageRoot,
      env: {
        ...process.env,
        ANDROPERATOR_NO_DAEMON: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutChunks.push(chunk);
      this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
      this.drainMessages();
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk);
    });
    this.child.on("exit", () => {
      const error = new Error(`MCP server exited early.\nstderr:\n${this.stderrText}`);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  get stdoutBytes(): number {
    return this.stdoutChunks.reduce((total, chunk) => total + chunk.length, 0);
  }

  get stderrText(): string {
    return Buffer.concat(this.stderrChunks).toString("utf8");
  }

  async waitForSilence(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async initialize(): Promise<JsonRpcResponse> {
    const response = await this.request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "androperator-test",
        version: "1.0.0",
      },
    });

    this.notify("notifications/initialized", {});
    return response;
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    const response = await this.requestTool(name, args);

    if (!response.result) {
      throw new Error(`Missing tool result for ${name}`);
    }

    return response.result as ToolCallResult;
  }

  async requestTool(name: string, args?: Record<string, unknown>): Promise<JsonRpcResponse> {
    return await this.request("tools/call", {
      name,
      arguments: args ?? {},
    });
  }

  request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0" as const,
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writeMessage(payload);
    });
  }

  notify(method: string, params?: unknown): void {
    const payload = {
      jsonrpc: "2.0" as const,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    this.writeMessage(payload);
  }

  async closeStdin(): Promise<number | null> {
    this.child.stdin.end();
    return await new Promise((resolve) => {
      this.child.once("exit", (code) => resolve(code));
    });
  }

  kill(): void {
    this.child.kill("SIGTERM");
  }

  private writeMessage(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private drainMessages(): void {
    while (true) {
      const messageEnd = this.readBuffer.indexOf("\n");
      if (messageEnd === -1) {
        return;
      }

      const messageBuffer = this.readBuffer.subarray(0, messageEnd);
      this.readBuffer = this.readBuffer.subarray(messageEnd + 1);

      const message = JSON.parse(messageBuffer.toString("utf8")) as JsonRpcResponse;
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending.resolve(message);
        }
      }
    }
  }
}

describe("mcp stdio integration", () => {
  let client: McpIntegrationClient;

  beforeEach(() => {
    client = new McpIntegrationClient();
  });

  afterEach(() => {
    client.kill();
  });

  it("emits zero stdout bytes before initialize", async () => {
    await client.waitForSilence(150);
    assert.strictEqual(client.stdoutBytes, 0, client.stderrText);
  });

  it("completes initialize over stdio after the silence window", async () => {
    await client.waitForSilence(150);
    assert.strictEqual(client.stdoutBytes, 0, client.stderrText);

    const response = await client.initialize();

    assert.ok(response.result);
    assert.ok(client.stdoutBytes > 0);
  });

  it("completes initialize and returns server info", async () => {
    const response = await client.initialize();
    const result = response.result as {
      serverInfo?: { name?: string };
      protocolVersion?: string;
    };

    assert.ok(response.result);
    assert.strictEqual(result.serverInfo?.name, "androperator");
    assert.strictEqual(typeof result.protocolVersion, "string");
  });

  it("lists tools over the stdio protocol", async () => {
    await client.initialize();

    const response = await client.request("tools/list", {});

    const tools = (response.result as { tools?: Array<{ name: string; inputSchema?: Record<string, unknown> }> }).tools ?? [];
    assert.ok(Array.isArray(tools));
    assert.deepStrictEqual(
      tools.map(tool => tool.name),
      ["devices", "snapshot", "execute", "configure", "query_ui", "open", "swipe", "drag", "click", "type", "read", "press", "wait", "scroll", "scroll_until", "scroll_and_click", "evidence_capture", "evidence_video_start", "evidence_video_status", "evidence_video_stop"],
    );

    const execute = tools.find((tool) => tool.name === "execute");
    const open = tools.find((tool) => tool.name === "open");
    const drag = tools.find((tool) => tool.name === "drag");
    assert.deepStrictEqual(drag?.inputSchema?.required, ["start", "end", "holdDurationMs", "moveDurationMs"]);
    const swipe = tools.find((tool) => tool.name === "swipe");
    assert.deepStrictEqual(swipe?.inputSchema?.required, ["start", "end", "durationMs"]);
    const click = tools.find((tool) => tool.name === "click");
    const typeTool = tools.find((tool) => tool.name === "type");

    assert.strictEqual(execute?.inputSchema?.additionalProperties, false);
    assert.deepStrictEqual(execute?.inputSchema?.required, ["actions"]);
    assert.ok(Array.isArray(open?.inputSchema?.oneOf));
    assert.ok(Array.isArray(click?.inputSchema?.oneOf));
    assert.deepStrictEqual(typeTool?.inputSchema?.required, ["selector", "text"]);
  });

  async function getPreferredExecutionArgs(): Promise<Record<string, unknown>> {
    const result = await client.callTool("devices");
    if (result.isError) {
      return {};
    }

    const payload = JSON.parse(result.content[0]?.text ?? "{}") as DevicePayload;
    const devices = payload.devices ?? [];
    if (devices.length === 0) {
      return {};
    }

    const preferred = devices.find(device => !device.serial.startsWith("emulator-")) ?? devices[0];
    return {
      deviceId: preferred?.serial,
      operatorPackage: process.env.ANDROPERATOR_OPERATOR_PACKAGE ?? "com.androperator.operator.dev",
    };
  }

  function parseToolPayload(result: ToolCallResult): Record<string, unknown> | string | unknown[] {
    return JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown> | string | unknown[];
  }

  function assertRuntimeStructuredError(result: ToolCallResult): void {
    const payload = parseToolPayload(result) as { code?: string };
    assert.strictEqual(result.isError, true);
    assert.strictEqual(typeof payload.code, "string");
  }

  function assertInvalidParams(response: JsonRpcResponse): void {
    assert.ok(response.error);
    assert.strictEqual(response.error?.code, -32602);
    assert.strictEqual(typeof response.error?.message, "string");
  }

  it("calls devices over the stdio protocol", async () => {
    await client.initialize();

    const result = await client.callTool("devices");
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { devices?: unknown[]; code?: string };

    if (result.isError) {
      assert.ok(typeof payload.code === "string");
      return;
    }

    assert.ok(Array.isArray(payload.devices));
  });

  it("rejects compact snapshot option conflicts and caller-controlled raw paths over stdio", async () => {
    await client.initialize();
    for (const args of [{ compact: true, maxChars: 100 }, { maxNodes: 20 }, { maxTextChars: 10 },
      { rawPath: "/tmp/caller-controlled.xml" }, { compact: true, maxNodes: 1001 }, { saveRaw: "yes" }]) {
      assertInvalidParams(await client.requestTool("snapshot", args));
    }
  });

  it("teaches how to correct compact dependencies over stdio", async () => {
    await client.initialize();
    for (const field of ["maxNodes", "maxTextChars"]) {
      for (const compact of [undefined, false]) {
        const response = await client.requestTool("snapshot", { [field]: 20, ...(compact === undefined ? {} : { compact }) });
        assertInvalidParams(response);
        assert.match(response.error!.message, new RegExp(`${field} requires compact: true`));
        assert.match(response.error!.message, /or omit/);
      }
    }
    const conflict = await client.requestTool("snapshot", { compact: true, maxChars: 20 });
    assertInvalidParams(conflict);
    assert.match(conflict.error!.message, /Omit maxChars and use maxNodes or maxTextChars/);
  });

  it("rejects evidence output paths and invalid context over stdio", async () => {
    await client.initialize();
    for (const args of [{ outputDir: "/tmp/forbidden" }, { rawPath: "/tmp/forbidden" },
      { context: [] }, { context: null }, { context: { text: "x".repeat(16384) } }, { label: "x".repeat(2049) }]) {
      assertInvalidParams(await client.requestTool("evidence_capture", args));
    }
  });

  it("calls snapshot over the stdio protocol", async () => {
    await client.initialize();

    const result = await client.callTool("snapshot", await getPreferredExecutionArgs());
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      snapshot?: string;
      code?: string;
      envelope?: unknown;
    };

    if (result.isError) {
      assert.ok(typeof payload.code === "string");
      return;
    }

    assert.strictEqual(typeof payload.snapshot, "string");
    assert.ok(payload.envelope);
  });

  it("calls execute over the stdio protocol", async () => {
    await client.initialize();

    const result = await client.callTool("execute", {
      ...(await getPreferredExecutionArgs()),
      actions: [
        {
          id: "sleep-1",
          type: "sleep",
          params: { durationMs: 1 },
        },
      ],
    });
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { code?: string; envelope?: unknown };

    if (result.isError) {
      assert.ok(typeof payload.code === "string");
      return;
    }

    assert.ok(payload.envelope);
  });

  it("normalizes exact on-screen-log action aliases through the execute tool", async () => {
    await client.initialize();

    const result = await client.callTool("execute", {
      deviceId: "non-existent",
      timeoutMs: 1000,
      actions: [
        {
          id: "set-panel",
          type: "on_screen_log_set",
          params: {
            template: "{{foreground_app.icon}} {{foreground_app.package_name}}",
            anchor: "right",
            textAlign: "left",
            topOffsetDp: 0,
            edgeOffsetDp: 12,
            widthDp: 320,
            fontSizeSp: 16,
            textColor: "#a1b2c3",
            backgroundColor: "#7f0a0b0c",
            ttlMs: 12000,
          },
        },
        {
          id: "clear-panel",
          type: "on_screen_log_clear",
        },
      ],
    });

    // The generic MCP action schema leaves field validation to the canonical executor. A
    // device-resolution error therefore proves these exact raw fields passed that boundary.
    const payload = parseToolPayload(result) as { code?: string };
    assert.strictEqual(result.isError, true);
    assert.strictEqual(payload.code, "DEVICE_NOT_FOUND");
  });

  it("rejects padded on-screen-log action types instead of normalizing them", async () => {
    await client.initialize();

    const result = await client.callTool("execute", {
      deviceId: "non-existent",
      timeoutMs: 1000,
      actions: [
        {
          id: "set-panel",
          type: " set_on_screen_log ",
          params: { text: "strict canonical action" },
        },
      ],
    });

    const payload = parseToolPayload(result) as { code?: string };
    assert.strictEqual(result.isError, true);
    assert.strictEqual(payload.code, "EXECUTION_VALIDATION_FAILED");
  });

  it("preserves notification/media validation errors through generic execute", async () => {
    await client.initialize();
    for (const action of [
      { id: "a", type: "get_media_status", params: { applicationId: "p", mediaSessionId: "s" } },
      { id: "a", type: "list_notifications", params: { limit: 101 } },
      { id: "a", type: "media_seek", params: { mediaSessionId: "s", positionMs: -1 } },
      { id: "a", type: "dismiss_notification", params: { notificationKey: " " } },
      { id: "a", type: "invoke_notification_action", params: { notificationKey: "k" } },
      { id: "a", type: "media_play", params: { mediaSessionId: "s", waitTimeoutMs: -1 } },
    ]) {
      const result = await client.callTool("execute", { deviceId: "non-existent", actions: [action] });
      assert.strictEqual(result.isError, true);
      assert.strictEqual((parseToolPayload(result) as { code: string }).code, "EXECUTION_VALIDATION_FAILED");
    }
  });

  it("delegates non-object raw action params to the canonical execution validator", async () => {
    await client.initialize();

    for (const params of [null, [], "not-an-object"]) {
      const result = await client.callTool("execute", {
        deviceId: "non-existent",
        timeoutMs: 1000,
        actions: [
          {
            id: "clear-panel",
            type: "clear_on_screen_log",
            params,
          },
        ],
      });

      const payload = parseToolPayload(result) as { code?: string };
      assert.strictEqual(result.isError, true);
      assert.strictEqual(payload.code, "EXECUTION_VALIDATION_FAILED");
    }
  });

  it("returns canonical validation errors for malformed generic action params", async () => {
    await client.initialize();

    const result = await client.callTool("execute", {
      deviceId: "non-existent",
      timeoutMs: 1000,
      actions: [
        {
          id: "open-app",
          type: "open_app",
          params: { applicationId: 1 },
        },
      ],
    });

    const payload = parseToolPayload(result) as { code?: string };
    assert.strictEqual(result.isError, true);
    assert.strictEqual(payload.code, "EXECUTION_VALIDATION_FAILED");
  });

  it("configure with no args returns empty session state", async () => {
    await client.initialize();

    const result = await client.callTool("configure", {});
    assert.strictEqual(result.isError, undefined);

    const payload = parseToolPayload(result) as { session?: Record<string, unknown> };
    assert.deepStrictEqual(payload.session, {});
  });

  it("configure stores deviceId and returns it in session state", async () => {
    await client.initialize();

    const result = await client.callTool("configure", { deviceId: "test-device-abc" });
    assert.strictEqual(result.isError, undefined);

    const payload = parseToolPayload(result) as { session?: Record<string, unknown> };
    assert.deepStrictEqual(payload.session, { deviceId: "test-device-abc" });
  });

  it("rejects configure when deviceId is blank", async () => {
    await client.initialize();

    const response = await client.requestTool("configure", { deviceId: "" });
    assertInvalidParams(response);
  });

  it("rejects configure when timeoutMs is below the execution minimum", async () => {
    await client.initialize();

    const response = await client.requestTool("configure", { timeoutMs: 999 });
    assertInvalidParams(response);
  });

  it("rejects execute when actions is missing", async () => {
    await client.initialize();

    const response = await client.requestTool("execute", {});
    assertInvalidParams(response);
  });

  it("rejects open when both appId and uri are provided", async () => {
    await client.initialize();

    const response = await client.requestTool("open", {
      appId: "com.android.settings",
      uri: "https://example.com",
    });
    assertInvalidParams(response);
  });

  it("rejects open when neither appId nor uri is provided", async () => {
    await client.initialize();

    const response = await client.requestTool("open", {});
    assertInvalidParams(response);
  });

  it("rejects open when appId is blank", async () => {
    await client.initialize();

    const response = await client.requestTool("open", { appId: "" });
    assertInvalidParams(response);
  });

  it("rejects open when appId is whitespace only", async () => {
    await client.initialize();

    const response = await client.requestTool("open", { appId: "   " });
    assertInvalidParams(response);
  });

  it("accepts open with only appId", async () => {
    await client.initialize();

    const result = await client.callTool("open", {
      ...(await getPreferredExecutionArgs()),
      appId: "com.android.settings",
    });

    if (result.isError) {
      assertRuntimeStructuredError(result);
      return;
    }

    const payload = parseToolPayload(result) as { envelope?: unknown };
    assert.ok(payload.envelope);
  });

  it("accepts open with only uri", async () => {
    await client.initialize();

    const result = await client.callTool("open", {
      ...(await getPreferredExecutionArgs()),
      uri: "https://example.com",
    });

    if (result.isError) {
      assertRuntimeStructuredError(result);
      return;
    }

    const payload = parseToolPayload(result) as { envelope?: unknown };
    assert.ok(payload.envelope);
  });

  it("rejects click when both selector and coordinate are provided", async () => {
    await client.initialize();

    const response = await client.requestTool("click", {
      selector: { text: "Settings" },
      coordinate: { x: 1, y: 1 },
    });
    assertInvalidParams(response);
  });

  it("rejects click when neither selector nor coordinate is provided", async () => {
    await client.initialize();

    const response = await client.requestTool("click", {});
    assertInvalidParams(response);
  });

  it("rejects click when selector is empty", async () => {
    await client.initialize();

    const response = await client.requestTool("click", {
      selector: {},
    });
    assertInvalidParams(response);
  });

  it("rejects type when selector is missing", async () => {
    await client.initialize();

    const response = await client.requestTool("type", { text: "hello" });
    assertInvalidParams(response);
  });

  it("rejects type when text is missing", async () => {
    await client.initialize();

    const response = await client.requestTool("type", {
      selector: { text: "Field" },
    });
    assertInvalidParams(response);
  });

  it("rejects press when key is unsupported", async () => {
    await client.initialize();

    const response = await client.requestTool("press", { key: "volume_up" });
    assertInvalidParams(response);
  });

  it("accepts press with each supported key", async () => {
    await client.initialize();

    for (const key of ["back", "home", "recents"] as const) {
      const result = await client.callTool("press", {
        ...(await getPreferredExecutionArgs()),
        key,
      });

      if (result.isError) {
        assertRuntimeStructuredError(result);
        continue;
      }

      const payload = parseToolPayload(result) as { envelope?: unknown };
      assert.ok(payload.envelope);
    }
  });

  it("returns a single string for read when all is omitted", async () => {
    await client.initialize();

    const result = await client.callTool("read", {
      ...(await getPreferredExecutionArgs()),
      selector: { textContains: "Settings" },
    });

    if (result.isError) {
      assertRuntimeStructuredError(result);
      return;
    }

    const payload = parseToolPayload(result);
    assert.strictEqual(typeof payload, "string");
  });

  it("returns an array for read when all is true", async () => {
    await client.initialize();

    const result = await client.callTool("read", {
      ...(await getPreferredExecutionArgs()),
      selector: { textContains: "Settings" },
      all: true,
    });

    if (result.isError) {
      assertRuntimeStructuredError(result);
      return;
    }

    const payload = parseToolPayload(result);
    assert.ok(Array.isArray(payload));
  });

  it("rejects wait when selector is empty", async () => {
    await client.initialize();

    const response = await client.requestTool("wait", {
      selector: {},
    });
    assertInvalidParams(response);
  });

  it("accepts scroll_until when clickAfter is omitted", async () => {
    await client.initialize();

    const result = await client.callTool("scroll_until", {
      ...(await getPreferredExecutionArgs()),
      selector: { textContains: "Settings" },
      direction: "down",
    });

    if (result.isError) {
      assertRuntimeStructuredError(result);
      return;
    }

    const payload = parseToolPayload(result) as { envelope?: { stepResults?: Array<{ actionType?: string }> } };
    const actionType = payload.envelope?.stepResults?.[0]?.actionType;
    assert.strictEqual(actionType, "scroll_until");
  });

  it("accepts scroll_until when clickAfter is true", async () => {
    await client.initialize();

    const result = await client.callTool("scroll_until", {
      ...(await getPreferredExecutionArgs()),
      selector: { textContains: "Settings" },
      direction: "down",
      clickAfter: true,
    });

    if (result.isError) {
      assertRuntimeStructuredError(result);
      return;
    }

    const payload = parseToolPayload(result) as { envelope?: { stepResults?: Array<{ actionType?: string }> } };
    const actionType = payload.envelope?.stepResults?.[0]?.actionType;
    assert.strictEqual(actionType, "scroll_and_click");
  });

  it("rejects scroll_until when direction is invalid", async () => {
    await client.initialize();

    const response = await client.requestTool("scroll_until", {
      selector: { text: "Item" },
      direction: "diagonal",
    });
    assertInvalidParams(response);
  });

  it("rejects execute when an action is missing type", async () => {
    await client.initialize();

    const response = await client.requestTool("execute", {
      actions: [{ id: "broken" }],
    });
    assertInvalidParams(response);
  });

  it("rejects execute when operatorPackage is blank", async () => {
    await client.initialize();

    const response = await client.requestTool("execute", {
      operatorPackage: "",
      actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 1 } }],
    });
    assertInvalidParams(response);
  });

  it("rejects execute when deviceId is blank", async () => {
    await client.initialize();

    const response = await client.requestTool("execute", {
      deviceId: "",
      actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 1 } }],
    });
    assertInvalidParams(response);
  });

  it("rejects execute when timeoutMs is negative", async () => {
    await client.initialize();

    const response = await client.requestTool("execute", {
      timeoutMs: -1,
      actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 1 } }],
    });
    assertInvalidParams(response);
  });

  it("rejects execute when timeoutMs is below the execution minimum", async () => {
    await client.initialize();

    const response = await client.requestTool("execute", {
      timeoutMs: 999,
      actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 1 } }],
    });
    assertInvalidParams(response);
  });

  it("rejects execute when take_screenshot includes a caller path", async () => {
    await client.initialize();

    const response = await client.requestTool("execute", {
      actions: [{ id: "shot-1", type: "take_screenshot", params: { path: "/tmp/owned.png" } }],
    });
    assertInvalidParams(response);
  });

  it("rejects execute when screenshot aliases include a caller path alias", async () => {
    await client.initialize();

    const response = await client.requestTool("execute", {
      actions: [{ id: "shot-1", type: "screenshot", params: { filePath: "/tmp/owned.png" } }],
    });
    assertInvalidParams(response);
  });

  it("returns an MCP error for an unknown tool name", async () => {
    await client.initialize();

    const response = await client.request("tools/call", {
      name: "missing_tool",
      arguments: {},
    });

    assert.ok(response.error);
    assert.strictEqual(response.error?.code, -32601);
  });

  it("returns a JSON-RPC error for an invalid request", async () => {
    await client.initialize();

    const response = await client.request("androperator/not-a-real-method", {});

    assert.ok(response.error);
    assert.strictEqual(typeof response.error?.message, "string");
  });

  it("exits cleanly when stdin closes", async () => {
    await client.initialize();

    const exitCode = await client.closeStdin();

    assert.strictEqual(exitCode, 0);
  });
});
