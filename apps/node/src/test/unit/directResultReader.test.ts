import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { DirectFrameReader, MAX_DIRECT_RESULT_BYTES, waitForDirectResult, writeDirectFrame } from "../../adapters/android-bridge/directResultReader.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";

async function fixture(mode = "success", deviceId = "test-device") {
  let request: Record<string, unknown> = {};
  let client: Socket | undefined;
  let dispatchCount = 0;
  let removed = false;
  const logs: { event: string; message?: string }[] = [];
  let deliver!: () => void;
  const dispatch = new Promise<void>(resolve => { deliver = resolve; });
  const content = "界😀".repeat(300_000);
  const server = createServer(socket => {
    client = socket;
    socket.on("error", () => {});
    void (async () => {
      const reader = new DirectFrameReader(socket);
      writeDirectFrame(socket, { type: "ready", ...request, operatorPackage: mode === "wrong-package" ? "wrong" : "com.clawperator.operator.dev" });
      await reader.control("ping");
      writeDirectFrame(socket, { type: "pong" });
      await dispatch;
      if (mode === "disconnect") { socket.destroy(); return; }
      if (mode === "stall") return;
      const bytes = Buffer.from('[Clawperator-Result] ' + JSON.stringify({ commandId: "command", taskId: mode === "wrong-task" ? "other" : "task",
        status: "success", error: null, stepResults: [{ id: "snapshot", actionType: "snapshot_ui", success: true, data: { text: content } }] }));
      writeDirectFrame(socket, { type: "result", sessionId: request.sessionId, commandId: "command", taskId: "task",
        byteLength: bytes.length, sha256: mode === "bad-hash" ? "incorrect" : createHash("sha256").update(bytes).digest("hex") });
      const length = Buffer.alloc(4);
      length.writeUInt32BE(mode === "oversized" ? MAX_DIRECT_RESULT_BYTES + 1 : bytes.length);
      socket.write(length.subarray(0, 1));
      socket.write(length.subarray(1));
      if (mode === "oversized") return;
      if (mode === "truncated") { socket.end(bytes.subarray(0, 5000)); return; }
      for (let offset = 0; offset < bytes.length; offset += 4093) {
        if (!socket.write(bytes.subarray(offset, offset + 4093))) await once(socket, "drain");
      }
      await reader.control("ack");
      if (mode !== "missing-timing") writeDirectFrame(socket, { type: "timing", androidResultWriteMs: 2.5, androidResultAckRoundTripMs: 4.5 });
      socket.end();
    })().catch(() => socket.destroy());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const runner: ProcessRunner = {
    async run(_command, args) {
      assert.deepEqual(args.slice(0, 2), ["-s", deviceId]);
      if (args[2] === "shell") {
        request = JSON.parse(args[3].match(/--es 'payload' '([^']+)'/)![1]);
      } else if (args[3] === "--remove") {
        assert.equal(args[4], `tcp:${port}`);
        removed = true;
      } else {
        assert.deepEqual(args.slice(2), ["forward", "tcp:0", `localabstract:com.clawperator.operator.dev.result.${request.sessionId}`]);
        return { code: 0, stdout: String(port), stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    async runShell() { throw new Error("Unexpected shell"); },
    spawn() { throw new Error("Direct transport must not start logcat"); },
  };
  const config = getDefaultRuntimeConfig({ deviceId, operatorPackage: "com.clawperator.operator.dev", runner,
    logger: { emit(event) { logs.push(event); }, logPath() { return undefined; },
      status() { return { status: "disabled" }; }, child() { return this; } } });
  return {
    content, logs,
    get removed() { return removed; },
    get dispatchCount() { return dispatchCount; },
    run(signal?: AbortSignal) { return waitForDirectResult(config, { commandId: "command", taskId: "task", timeoutMs: mode === "stall" ? 30 : 3000, cancelSignal: signal }, async (_begin, session) => {
      assert.equal(session, request.sessionId);
      dispatchCount++;
      deliver();
      return { success: true };
    }); },
    async close() { client?.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

test("direct transport validates a fragmented large Unicode result and logs distinct timing stages", async () => {
  const f = await fixture();
  try {
    const result = await f.run();
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.envelope.stepResults[0].data.text, f.content);
    assert.equal(f.dispatchCount, 1);
    assert.equal(f.removed, true);
    const timing = JSON.parse(f.logs.find(x => x.event === "transport.direct.timing")!.message!);
    for (const key of ["connectionSetupMs", "handshakeRoundTripMs", "resultReceiveMs", "resultReceiveAndValidateMs"]) assert.ok(timing[key] >= 0);
    assert.equal(timing.androidResultAckRoundTripMs, 4.5);
    assert.ok(timing.resultBytes > 2_000_000);
  } finally { await f.close(); }
});

for (const mode of ["wrong-package", "wrong-task", "bad-hash", "oversized", "truncated", "disconnect", "stall"]) {
  test(`direct transport rejects ${mode}, cleans up, and never retries dispatch`, async () => {
    const f = await fixture(mode);
    try {
      const result = await f.run();
      assert.equal(result.ok, false);
      assert.equal(f.dispatchCount, mode === "wrong-package" ? 0 : 1);
      assert.equal(f.removed, true);
    } finally { await f.close(); }
  });
}

test("a missing timing confirmation cannot erase an already verified result", async () => {
  const f = await fixture("missing-timing");
  try { assert.equal((await f.run()).ok, true); } finally { await f.close(); }
});

test("cancellation before setup never dispatches", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.run(AbortSignal.abort())).ok, false);
    assert.equal(f.dispatchCount, 0);
  } finally { await f.close(); }
});

test("concurrent devices remain isolated when one connection fails", async () => {
  const first = await fixture("disconnect", "device-one");
  const second = await fixture("success", "device-two");
  try {
    const results = await Promise.all([first.run(), second.run()]);
    assert.equal(results[0].ok, false);
    assert.equal(results[1].ok, true);
    assert.ok(first.removed && second.removed);
  } finally { await first.close(); await second.close(); }
});


test("cancellation during result wait retains deadline owner code without replay", async () => {
  const f = await fixture("stall");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort({ code: "COMMAND_TIMEOUT", message: "Evidence capture budget expired" }), 15);
  try {
    const result = await f.run(controller.signal);
    assert.equal(result.ok, false);
    if (!result.ok && "code" in result) assert.equal(result.code, "COMMAND_TIMEOUT");
    assert.equal(f.dispatchCount, 1);
    assert.equal(f.removed, true);
  } finally { clearTimeout(timer); await f.close(); }
});

test("independent sessions on the same device do not share a result reader or forward", async () => {
  const first = await fixture();
  const second = await fixture();
  try {
    assert.ok((await Promise.all([first.run(), second.run()])).every(result => result.ok));
    assert.ok(first.removed && second.removed);
  } finally { await first.close(); await second.close(); }
});

test("invalid experimental transport values fail before ADB dispatch", async () => {
  const { runExecution } = await import("../../domain/executions/runExecution.js");
  for (const value of ["", "socket", " direct "]) {
    const result = await runExecution({ commandId: "command", taskId: "task", source: "debug", expectedFormat: "android-ui-automator", timeoutMs: 5000,
      actions: [{ id: "snapshot", type: "snapshot" }] }, {
      resultTransport: value as "direct",
      runner: { run: async () => { throw new Error("Must not run ADB"); }, runShell: async () => { throw new Error("Must not run shell"); }, spawn: () => { throw new Error("Must not spawn"); } },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "EXECUTION_VALIDATION_FAILED");
  }
});
