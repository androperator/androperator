import { test, describe, after, before } from "node:test";
import assert from "node:assert";
import { startServer } from "../../cli/commands/serve.js";
import { Server } from "node:http";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createAndroperatorLogger } from "../../adapters/logger.js";

describe("serve API integration", () => {
  let server: Server;
  let port: number;

  before(async () => {
    server = await startServer({
      port: 0,
      host: "localhost",
      verbose: false,
    });
    const addr = server.address();
    if (addr && typeof addr === "object") {
      port = addr.port;
    } else {
      throw new Error("Failed to get ephemeral port");
    }
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  test("unregistered package routes receive ordinary 404 responses", async () => {
    for (const [method, path] of [["GET", "/skills"], ["GET", "/skills/example"], ["POST", "/skills/example/run"], ["GET", "/unregistered"]]) {
      const response = await fetch(`http://localhost:${port}${path}`, { method });
      assert.equal(response.status, 404);
      assert.match(await response.text(), /Cannot (?:GET|POST)/);
    }
  });

  test("GET /devices returns success", async () => {
    const res = await fetch(`http://localhost:${port}/devices`);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as { ok: boolean };
    assert.strictEqual(body.ok, true);
  });

  test("GET /android/emulators returns a structured response", async () => {
    const res = await fetch(`http://localhost:${port}/android/emulators`);
    assert.ok(res.status === 200 || res.status === 500);
    const body = await res.json() as { ok: boolean; avds?: unknown[]; error?: { code?: string } };
    assert.strictEqual(typeof body.ok, "boolean");
    assert.ok(body.ok ? Array.isArray(body.avds) : body.error !== undefined);
  });

  test("GET /android/emulators/running returns a structured response", async () => {
    const res = await fetch(`http://localhost:${port}/android/emulators/running`);
    assert.ok(res.status === 200 || res.status === 500);
    const body = await res.json() as { ok: boolean; devices?: unknown[]; error?: { code?: string } };
    assert.strictEqual(typeof body.ok, "boolean");
    assert.ok(body.ok ? Array.isArray(body.devices) : body.error !== undefined);
  });

  test("POST /android/provision/emulator returns a structured response", async () => {
    const res = await fetch(`http://localhost:${port}/android/provision/emulator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.ok(res.status === 200 || res.status === 400 || res.status === 409 || res.status === 500);
    const body = await res.json() as { ok: boolean; serial?: string; error?: { code?: string } };
    assert.strictEqual(typeof body.ok, "boolean");
    assert.ok(body.ok ? typeof body.serial === "string" : body.error !== undefined);
  });

  test("POST /android/provision/emulator rejects non-gigabyte storage sizes", async () => {
    const res = await fetch(`http://localhost:${port}/android/provision/emulator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageSize: "12000M" }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json() as { ok: boolean; error: { code: string; message: string } };
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, "INVALID_BODY");
    assert.match(body.error.message, /positive integer followed by G or GB/);
  });

  test("POST /android/emulators/create rejects conflicting storage size aliases", async () => {
    const res = await fetch(`http://localhost:${port}/android/emulators/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageSize: "12G", diskSize: "16G" }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json() as { ok: boolean; error: { code: string; message: string } };
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, "INVALID_BODY");
    assert.match(body.error.message, /Use only one emulator storage size field/);
  });

  test("POST /execute with no body returns 400", async () => {
    const res = await fetch(`http://localhost:${port}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
  });

  test("POST /execute rejects press_key without params.key", async () => {
    const executionInput = {
      commandId: "test-press-key-missing",
      taskId: "test-task",
      source: "test-suite",
      expectedFormat: "android-ui-automator",
      timeoutMs: 1000,
      actions: [{ id: "k1", type: "press_key", params: {} }],
    };

    const res = await fetch(`http://localhost:${port}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ execution: executionInput }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json() as {
      ok: boolean;
      error: { code: string; details?: { path?: string } };
    };
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, "EXECUTION_VALIDATION_FAILED");
    assert.strictEqual(body.error.details?.path, "actions.0.params.key");
  });

  test("POST /execute rejects invalid N2 mutations before device resolution", async () => {
    for (const action of [
      { id: "a", type: "dismiss_notification", params: { notificationKey: " " } },
      { id: "a", type: "invoke_notification_action", params: { notificationKey: "k" } },
      { id: "a", type: "media_seek", params: { mediaSessionId: "s", positionMs: -1 } },
    ]) {
      const response = await fetch(`http://localhost:${port}/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "non-existent", execution: {
          commandId: "invalid-mutation", taskId: "test-task", source: "test-suite",
          expectedFormat: "android-ui-automator", timeoutMs: 1000, actions: [action],
        } }),
      });
      assert.strictEqual(response.status, 400);
      const body = await response.json() as { error: { code: string } };
      assert.strictEqual(body.error.code, "EXECUTION_VALIDATION_FAILED");
    }
  });

  test("POST /execute accepts key_press alias and reaches device resolution", async () => {
    const executionInput = {
      commandId: "test-key-press-alias",
      taskId: "test-task",
      source: "test-suite",
      expectedFormat: "android-ui-automator",
      timeoutMs: 1000,
      actions: [{ id: "k1", type: "key_press", params: { key: "home" } }],
    };

    const res = await fetch(`http://localhost:${port}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ execution: executionInput, deviceId: "non-existent" }),
    });

    assert.strictEqual(res.status, 404);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, "DEVICE_NOT_FOUND");
  });

  test("POST /execute normalizes exact on-screen-log action aliases through the canonical executor", async () => {
    const executionInput = {
      commandId: "test-on-screen-log-serve",
      taskId: "test-task",
      source: "test-suite",
      expectedFormat: "android-ui-automator",
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
    };

    const res = await fetch(`http://localhost:${port}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ execution: executionInput, deviceId: "non-existent" }),
    });

    // A device-resolution error proves the action passed the shared validator and reached
    // the same canonical executor as raw execution. A schema error would return HTTP 400.
    assert.strictEqual(res.status, 404);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, "DEVICE_NOT_FOUND");
  });

  test("POST /execute rejects malformed runId", async () => {
    const executionInput = {
      commandId: "test-bad-run-id",
      taskId: "test-task",
      source: "test-suite",
      expectedFormat: "android-ui-automator",
      timeoutMs: 1000,
      actions: [{ id: "s1", type: "sleep", params: { durationMs: 10 } }],
    };

    for (const runId of [null, 12, "", "  ", "not a run id", "x".repeat(241)]) {
      const res = await fetch(`http://localhost:${port}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execution: executionInput, runId }),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.error.code, "INVALID_RUN_ID");
    }
  });

  test("GET /events returns SSE stream", async () => {
    const res = await fetch(`http://localhost:${port}/events`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("Content-Type"), "text/event-stream");
    
    const reader = res.body?.getReader();
    try {
      // Read the first chunk (heartbeat)
      const { value } = await reader!.read();
      const text = new TextDecoder().decode(value);
      assert.ok(text.includes("CONNECTED"));
    } finally {
      await reader?.cancel();
    }
  });

  test("POST /snapshot returns success structure (dry-run)", async () => {
    // This will likely fail with NO_DEVICES in CI, but we test the structure/404/400 logic
    const res = await fetch(`http://localhost:${port}/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "non-existent" }),
    });
    // Should be 404 (DEVICE_NOT_FOUND) or 400 (if validation fails)
    assert.ok(res.status === 404 || res.status === 400);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    assert.strictEqual(body.ok, false);
    assert.ok(body.error.code !== undefined);
  });

  test("POST /screenshot returns success structure (dry-run)", async () => {
    const res = await fetch(`http://localhost:${port}/screenshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "non-existent" }),
    });
    assert.ok(res.status === 404 || res.status === 400);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    assert.strictEqual(body.ok, false);
    assert.ok(body.error.code !== undefined);
  });

  test("POST /screenshot rejects non-string path", async () => {
    const res = await fetch(`http://localhost:${port}/screenshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: 123 }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, "INVALID_PATH");
  });

  test("POST /screenshot rejects empty path", async () => {
    const res = await fetch(`http://localhost:${port}/screenshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "" }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json() as { ok: boolean; error: { code: string; message: string } };
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error.code, "INVALID_PATH");
    assert.strictEqual(body.error.message, "'path' must be a non-empty string");
  });

  test("Execution emits SSE events", async () => {
    // 1. Connect to SSE
    const sseRes = await fetch(`http://localhost:${port}/events`);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    try {
      // 2. Trigger an execution (even a failing one)
      const executionInput = {
        commandId: `test-sse-${Date.now()}`,
        taskId: "test-task",
        source: "test-suite",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [{ id: "s1", type: "sleep", params: { durationMs: 10 } }],
      };

      // We don't await the full execution here to avoid blocking, 
      // but we need it to start to trigger events.
      fetch(`http://localhost:${port}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execution: executionInput, deviceId: "non-existent" }),
      }).catch(() => {});

      // 3. Look for 'androperator:execution' in the stream
      let foundEvent = false;
      const startTime = Date.now();
      while (Date.now() - startTime < 3000) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        if (chunk.includes("event: androperator:execution")) {
          foundEvent = true;
          break;
        }
      }
      assert.ok(foundEvent, "Did not receive androperator:execution event in SSE stream");
    } finally {
      await reader.cancel();
    }
  });

  test("serve.server.started appears in log file when logger is provided", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-serve-log-"));
    const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "info" });

    const testServer = await startServer({ port: 0, host: "localhost", verbose: false, logger });
    const addr = testServer.address();
    const testPort = addr && typeof addr === "object" ? addr.port : 0;

    try {
      // Verify server is running
      assert.ok(testPort > 0, "Server should have started on an ephemeral port");

      // Read the log file and verify serve.server.started event
      const logPath = logger.logPath();
      assert.ok(logPath, "Logger should have a log path");

      const contents = await readFile(logPath, "utf8");
      const lines = contents.trimEnd().split("\n").map(line => JSON.parse(line) as { event: string; message?: string });

      const startedEvent = lines.find(line => line.event === "serve.server.started");
      assert.ok(startedEvent, "Log should contain serve.server.started event");
      assert.ok(startedEvent.message?.includes("listening"), "Message should indicate server is listening");
    } finally {
      await new Promise<void>((resolve, reject) => {
        testServer.close((err) => (err ? reject(err) : resolve()));
      });
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("POST /execute applies runId to request logs without daemon process inheritance", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-serve-skillrun-log-"));
    const logger = createAndroperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "info" });
    const runId = "request-scope-test";

    const testServer = await startServer({ port: 0, host: "localhost", verbose: false, logger });
    const addr = testServer.address();
    const testPort = addr && typeof addr === "object" ? addr.port : 0;

    try {
      const res = await fetch(`http://localhost:${testPort}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          execution: {
            commandId: "test-skillrun-request-log",
            taskId: "test-task",
            source: "test-suite",
            expectedFormat: "android-ui-automator",
            timeoutMs: 1000,
            actions: [{ id: "k1", type: "press_key", params: {} }],
          },
        }),
      });

      assert.strictEqual(res.status, 400);
      const logPath = logger.logPath();
      assert.ok(logPath, "Logger should have a log path");
      const contents = await readFile(logPath, "utf8");
      const lines = contents.trimEnd().split("\n").map(line => JSON.parse(line) as { event: string; runId?: string });
      const requestEvent = lines.find(line => line.event === "serve.http.request" && line.runId === runId);
      assert.ok(requestEvent, "POST /execute request log should carry the request-scoped runId");
    } finally {
      await new Promise<void>((resolve, reject) => {
        testServer.close((err) => (err ? reject(err) : resolve()));
      });
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
