import assert from "node:assert/strict";
import { it } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { waitForResultEnvelope } from "../../adapters/android-bridge/logcatResultReader.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";

const options = { commandId: "transport-command", taskId: "transport-task", timeoutMs: 1000, broadcastDelayMs: 0 };
const config = () => getDefaultRuntimeConfig({ deviceId: "test-device", operatorPackage: "com.test.operator" });
const terminal = '[Clawperator-Result] {"commandId":"transport-command","taskId":"transport-task","status":"success","stepResults":[],"error":null}';
function fake() {
  const proc = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let kills = 0;
  Object.assign(proc, { stdout, stderr, kill: () => { kills++; return true; } });
  const runtime = config();
  runtime.runner = { ...runtime.runner, spawn: () => proc };
  return { proc, stdout, stderr, runtime, kills: () => kills };
}

for (const [label, script, exitCode, signal] of [
  ["exit status", 'process.stderr.write("transport unavailable"); process.exit(255)', 255, null],
  ["signal", 'process.stderr.write("transport unavailable"); process.kill(process.pid, "SIGTERM")', null, "SIGTERM"],
] as const) {
  it(`preserves subprocess ${label} and dispatch uncertainty`, async () => {
    const runtime = config();
    runtime.runner = { ...runtime.runner, spawn: () => spawn(process.execPath, ["-e", script]) };
    let dispatches = 0;
    const result = await waitForResultEnvelope(runtime, options, async begin => {
      begin(); dispatches++; return { success: true };
    });
    assert.ok(!result.ok && "error" in result);
    assert.equal(result.code, "RESULT_TRANSPORT_EXITED");
    assert.equal(result.diagnostics?.exitCode, exitCode);
    assert.equal(result.diagnostics?.signal, signal);
    assert.equal(result.diagnostics?.stderr, "transport unavailable");
    assert.equal(result.diagnostics?.commandId, options.commandId);
    assert.equal(result.diagnostics?.taskId, options.taskId);
    assert.equal(result.diagnostics?.deviceId, "test-device");
    assert.equal(result.diagnostics?.operatorPackage, "com.test.operator");
    assert.equal(result.diagnostics?.executionPosition, "unknown");
    assert.equal(result.diagnostics?.dispatchAttempted, true);
    assert.equal(dispatches, 1);
  });
}

it("classifies real spawn failure without dispatch", async () => {
  const runtime = config();
  runtime.runner = { ...runtime.runner, spawn: () => spawn("/nonexistent/result-reader-adb", []) };
  let dispatches = 0;
  const result = await waitForResultEnvelope(runtime, { ...options, broadcastDelayMs: 100 }, async () => {
    dispatches++; return { success: true };
  });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "ADB_NOT_FOUND");
  assert.equal(result.diagnostics?.processErrorCode, "ENOENT");
  assert.equal(result.diagnostics?.dispatchAttempted, false);
  assert.equal(dispatches, 0);
});

it("classifies synchronous and asynchronous non-ENOENT spawn errors", async () => {
  for (const synchronous of [true, false]) {
    const f = fake();
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
    if (synchronous) f.runtime.runner.spawn = () => { throw error; };
    else queueMicrotask(() => f.proc.emit("error", error));
    const result = await waitForResultEnvelope(f.runtime, options, async () => ({ success: true }));
    assert.ok(!result.ok && "error" in result);
    assert.equal(result.code, "RESULT_TRANSPORT_SPAWN_FAILED");
    assert.equal(result.diagnostics?.processErrorCode, "EACCES");
    assert.equal(result.diagnostics?.originalMessage, "permission denied");
  }
});

it("blocks deferred mutation dispatch after the reader exits", async () => {
  const f = fake();
  let release!: () => void;
  let dispatches = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const result = await waitForResultEnvelope(f.runtime, options, async begin => {
    f.proc.emit("close", 255, null);
    await gate;
    begin();
    dispatches++;
    return { success: true };
  });
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.diagnostics?.dispatchAttempted, false);
  assert.equal(dispatches, 0);
});

for (const dispatched of [false, true]) {
  it(`cancels with truthful dispatch state (${dispatched}) and cleans up`, async () => {
    const f = fake();
    const controller = new AbortController();
    if (!dispatched) controller.abort();
    const result = await waitForResultEnvelope(f.runtime, { ...options, cancelSignal: controller.signal }, async begin => {
      begin(); controller.abort(); return { success: true };
    });
    assert.ok(!result.ok && "error" in result);
    assert.equal(result.code, "RESULT_TRANSPORT_CANCELLED");
    assert.equal(result.diagnostics?.dispatchAttempted, dispatched);
    assert.equal(f.kills(), dispatched ? 1 : 0);
  });
}

it("drains a final unterminated envelope before close and resolves only once", async () => {
  const f = fake();
  const result = await waitForResultEnvelope(f.runtime, options, async begin => {
    begin();
    const bytes = Buffer.from(terminal);
    for (const byte of bytes) f.stdout.write(Buffer.from([byte]));
    f.proc.emit("close", 0, null);
    return { success: true };
  });
  assert.ok(result.ok);
  f.proc.emit("close", 255, null);
  assert.equal(f.kills(), 1);
});

it("retains bounded stderr and rejected chunk evidence without replay", async () => {
  const f = fake();
  let dispatches = 0;
  const result = await waitForResultEnvelope(f.runtime, { ...options, timeoutMs: 10 }, async begin => {
    begin(); dispatches++;
    f.stderr.write("x".repeat(20000));
    f.stdout.write('I/Result: [Clawperator-Result-Chunk] {"commandId":"transport-command","index":1}\n');
    return { success: true };
  });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_ENVELOPE_MALFORMED");
  assert.equal(String(result.diagnostics?.stderr).length, 8192);
  assert.match(result.error, /expectedIndex=0, receivedIndex=1/);
  assert.equal(dispatches, 1);
});

it("blocks deferred dispatch between process exit and pipe close while retaining late diagnostics", async () => {
  const f = fake();
  let dispatches = 0;
  const result = await waitForResultEnvelope(f.runtime, options, async begin => {
    f.proc.emit("exit", 255, null);
    // Node can report exit before inherited stdout/stderr pipes close.
    setImmediate(() => {
      f.stderr.write("late reader diagnostic");
      f.proc.emit("close", 255, null);
    });
    begin();
    dispatches++;
    return { success: true };
  });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_TRANSPORT_EXITED");
  assert.equal(result.diagnostics?.dispatchAttempted, false);
  assert.equal(result.diagnostics?.stderr, "late reader diagnostic");
  assert.equal(dispatches, 0);
});

it("does not start a broadcast when the process exits before its pipes close", async () => {
  const f = fake();
  let dispatches = 0;
  const waiting = waitForResultEnvelope(f.runtime, options, async begin => {
    begin(); dispatches++; return { success: true };
  });
  f.proc.emit("exit", 255, null);
  await new Promise(resolve => setTimeout(resolve, 20));
  f.proc.emit("close", 255, null);
  const result = await waiting;
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_TRANSPORT_EXITED");
  assert.equal(dispatches, 0);
});

it("accepts an already dispatched complete result drained after exit", async () => {
  const f = fake();
  const result = await waitForResultEnvelope(f.runtime, options, async begin => {
    begin();
    f.proc.emit("exit", 255, null);
    f.stdout.write(terminal);
    f.proc.emit("close", 255, null);
    return { success: true };
  });
  assert.ok(result.ok);
});

it("blocks dispatch after a real subprocess exits while inherited pipes remain open", async () => {
  const runtime = config();
  let exited!: Promise<void>;
  runtime.runner = { ...runtime.runner, spawn: () => {
    const child = spawn(process.execPath, ["-e", `
      require('node:child_process').spawn(process.execPath,
        ['-e', 'setTimeout(() => process.stderr.write("late diagnostic"), 100)'],
        { stdio: ['ignore', 1, 2] });
      process.exit(255);
    `]);
    exited = new Promise(resolve => child.once("exit", () => resolve()));
    return child;
  } };
  let dispatches = 0;
  const result = await waitForResultEnvelope(runtime, options, async begin => {
    await exited;
    begin(); dispatches++;
    return { success: true };
  });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_TRANSPORT_EXITED");
  assert.equal(result.diagnostics?.exitCode, 255);
  assert.equal(result.diagnostics?.dispatchAttempted, false);
  assert.equal(result.diagnostics?.stderr, "late diagnostic");
  assert.equal(dispatches, 0);
});

it("preserves an independent broadcast error while exited pipes are draining", async () => {
  const f = fake();
  const result = await waitForResultEnvelope(f.runtime, options, async begin => {
    begin();
    f.proc.emit("exit", 255, null);
    throw new Error("broadcast connection failed");
  });
  assert.ok(!result.ok && "broadcastFailed" in result);
  assert.equal(result.diagnostics.code, "BROADCAST_FAILED");
  assert.match(result.diagnostics.message, /broadcast connection failed/);
});

for (const phase of ["startup", "deferred-preflight", "after-dispatch"]) {
  it(`bounds inherited output pipes after exit during ${phase}`, { timeout: 1000 }, async () => {
    const f = fake();
    let dispatches = 0;
    const waiting = waitForResultEnvelope(f.runtime, { ...options, timeoutMs: 20 }, async begin => {
      if (phase === "deferred-preflight") f.proc.emit("exit", 255, null);
      begin();
      dispatches++;
      f.proc.emit("exit", 255, null);
      f.stderr.write("last reader diagnostic");
      return { success: true };
    });
    if (phase === "startup") f.proc.emit("exit", 255, null);
    const result = await waiting;
    assert.ok(!result.ok && "error" in result);
    assert.equal(result.code, "RESULT_TRANSPORT_EXITED");
    assert.equal(result.diagnostics?.exitCode, 255);
    assert.equal(result.diagnostics?.signal, null);
    assert.equal(result.diagnostics?.outputDrainIncomplete, true);
    assert.equal(result.diagnostics?.dispatchAttempted, phase === "after-dispatch");
    assert.equal(dispatches, phase === "after-dispatch" ? 1 : 0);
    if (phase === "after-dispatch") assert.equal(result.diagnostics?.stderr, "last reader diagnostic");
    assert.equal(f.stdout.destroyed, true);
    assert.equal(f.stderr.destroyed, true);
    assert.equal(f.kills(), 1);
  });
}

it("accepts a complete buffered result at the exit-drain deadline", { timeout: 1000 }, async () => {
  const f = fake();
  const result = await waitForResultEnvelope(f.runtime, { ...options, timeoutMs: 20 }, async begin => {
    begin();
    f.proc.emit("exit", null, "SIGTERM");
    f.stdout.write(terminal);
    return { success: true };
  });
  assert.ok(result.ok);
  assert.equal(f.stdout.destroyed, true);
  assert.equal(f.stderr.destroyed, true);
});

it("preserves a signal and rejected framing at the exit-drain deadline", { timeout: 1000 }, async () => {
  for (const malformed of [false, true]) {
    const f = fake();
    const result = await waitForResultEnvelope(f.runtime, { ...options, timeoutMs: 20 }, async begin => {
      begin();
      f.proc.emit("exit", null, "SIGTERM");
      if (malformed) f.stdout.write('[Clawperator-Result-Chunk] {"commandId":"transport-command","index":1}');
      return { success: true };
    });
    assert.ok(!result.ok && "error" in result);
    assert.equal(result.code, malformed ? "RESULT_ENVELOPE_MALFORMED" : "RESULT_TRANSPORT_EXITED");
    if (!malformed) assert.equal(result.diagnostics?.signal, "SIGTERM");
    assert.equal(f.stdout.destroyed, true);
    assert.equal(f.stderr.destroyed, true);
  }
});

it("reports stdout observed when command-start arrives after fallback dispatch", async () => {
  const f = fake();
  let dispatches = 0;
  const result = await waitForResultEnvelope(f.runtime, options, async begin => {
    begin(); dispatches++;
    f.stdout.write(`[Clawperator-Command] start commandId=${options.commandId}\n`);
    f.proc.emit("exit", 255, null);
    f.proc.emit("close", 255, null);
    return { success: true };
  });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_TRANSPORT_EXITED");
  assert.equal(result.diagnostics?.stdoutObserved, true);
  assert.equal(result.diagnostics?.dispatchAttempted, true);
  assert.equal(dispatches, 1);
});

it("retains a correlated metadata-only failure timeline and late cleanup lifecycle", async () => {
  const f = fake();
  const logged: import("../../contracts/logging.js").LogEvent[] = [];
  f.runtime.logger = { emit: event => { logged.push(event); }, status: () => ({ status: "disabled" }), child() { return this; }, logPath: () => undefined };
  Object.assign(f.proc, { pid: 12345 });
  const result = await waitForResultEnvelope(f.runtime, { ...options, timeoutMs: 10 }, async begin => {
    begin();
    f.stdout.write("private UI text\n");
    f.stderr.write("private stderr text");
    return { success: true };
  });
  assert.ok(!result.ok && "timeout" in result);
  const failure = logged.find(event => event.event === "result_reader.failure")!;
  assert.equal(failure.level, "warn");
  assert.equal(failure.commandId, options.commandId);
  assert.equal(failure.taskId, options.taskId);
  assert.ok(!failure.message.includes("private"));
  const { reader, transport } = JSON.parse(failure.message);
  assert.deepEqual(transport, { receivedChunks: 0, receivedBytes: 0 });
  assert.equal(reader.readerPid, 12345);
  assert.equal(reader.stdoutBytes, Buffer.byteLength("private UI text\n"));
  assert.equal(reader.stderrBytes, Buffer.byteLength("private stderr text"));
  const names = reader.events.map((event: { event: string }) => event.event);
  assert.ok(names.indexOf("dispatch_started") < names.indexOf("first_stdout"));
  assert.ok(names.indexOf("deadline_reached") < names.indexOf("cleanup_requested"));
  assert.equal(reader.events.find((event: { event: string }) => event.event === "cleanup_requested").reason, "RESULT_ENVELOPE_TIMEOUT");
  assert.deepEqual((result.diagnostics.details?.reader as typeof reader).events, reader.events);
  f.proc.emit("exit", null, "SIGTERM");
  f.proc.emit("close", null, "SIGTERM");
  assert.equal(logged.filter(event => event.event === "result_reader.failure").length, 1);
  const closed = JSON.parse(logged.find(event => event.event === "result_reader.close")!.message);
  assert.equal(closed.reader.events.at(-1).event, "close");
  assert.equal(closed.reader.events.at(-2).event, "exit");
  assert.ok(!reader.events.some((event: { event: string }) => event.event === "exit"));
});

it("records unexpected exit before its own cleanup without changing the exit failure", async () => {
  const f = fake();
  const result = await waitForResultEnvelope(f.runtime, options, async begin => {
    begin();
    f.proc.emit("exit", 255, null);
    f.proc.emit("close", 255, null);
    return { success: true };
  });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_TRANSPORT_EXITED");
  const reader = result.diagnostics?.reader as { events: Array<{ event: string; code?: number }> };
  const names = reader.events.map(event => event.event);
  assert.ok(names.indexOf("exit") < names.indexOf("cleanup_requested"));
  assert.equal(reader.events.find(event => event.event === "exit")?.code, 255);
});

it("timeline logger failure cannot replace a result", async () => {
  const f = fake();
  f.runtime.logger = { emit: event => { if (event.event.startsWith("result_reader.")) throw new Error("unavailable logger"); },
    status: () => ({ status: "disabled" }), child() { return this; }, logPath: () => undefined };
  const result = await waitForResultEnvelope(f.runtime, options, async begin => {
    begin(); f.proc.emit("close", 255, null); return { success: true };
  });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "RESULT_TRANSPORT_EXITED");
});


for (const terminalFirst of [true, false]) {
  it(`preserves the first settlement when a capture deadline races a terminal (terminalFirst=${terminalFirst})`, async () => {
    const f = fake();
    const controller = new AbortController();
    const result = await waitForResultEnvelope(f.runtime, { ...options, cancelSignal: controller.signal }, async begin => {
      begin();
      const complete = () => f.stdout.write(terminal + "\n");
      const expire = () => controller.abort({ code: "COMMAND_TIMEOUT", message: "Evidence capture budget exhausted", details: { deadlineOwner: "evidence_capture" } });
      if (terminalFirst) { complete(); expire(); } else { expire(); complete(); }
      return { success: true };
    });
    assert.equal(result.ok, terminalFirst);
    if (!result.ok && "error" in result) {
      assert.equal(result.code, "COMMAND_TIMEOUT");
      assert.equal(result.diagnostics?.deadlineOwner, "evidence_capture");
      assert.equal(result.diagnostics?.dispatchAttempted, true);
    }
  });
}

it("does not spawn or dispatch after an already expired capture deadline", async () => {
  const f = fake();
  f.runtime.runner.spawn = () => { throw new Error("must not spawn"); };
  const controller = new AbortController();
  controller.abort({ code: "COMMAND_TIMEOUT", message: "Evidence capture budget exhausted", details: { deadlineOwner: "evidence_capture" } });
  const result = await waitForResultEnvelope(f.runtime, { ...options, cancelSignal: controller.signal }, async () => { throw new Error("must not dispatch"); });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "COMMAND_TIMEOUT");
  assert.equal(result.diagnostics?.dispatchAttempted, false);
});


it("retains the deadline cause when the budget expires synchronously inside spawn", async () => {
  const f = fake();
  const controller = new AbortController();
  f.runtime.runner.spawn = () => {
    controller.abort({ code: "COMMAND_TIMEOUT", message: "Evidence capture budget exhausted", details: { deadlineOwner: "evidence_capture" } });
    throw controller.signal.reason;
  };
  const result = await waitForResultEnvelope(f.runtime, { ...options, cancelSignal: controller.signal }, async () => { throw new Error("must not dispatch"); });
  assert.ok(!result.ok && "error" in result);
  assert.equal(result.code, "COMMAND_TIMEOUT");
  assert.equal(result.diagnostics?.deadlineOwner, "evidence_capture");
  assert.equal(result.diagnostics?.dispatchAttempted, false);
});
