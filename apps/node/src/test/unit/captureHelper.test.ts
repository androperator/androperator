import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { PNG } from "pngjs";
import { captureWithHelper, closeCaptureHelpers, bundledCaptureHelper, probeCaptureHelper } from "../../domain/observe/captureHelper.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { buildScreenshotExecution } from "../../domain/observe/screenshot.js";
import { validateExecution } from "../../domain/executions/validateExecution.js";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";

afterEach(closeCaptureHelpers);
async function fixture(mode = "valid", interrupt?: (child: any, phase: "handshake" | "frame") => boolean) {
  const { sha256 } = await bundledCaptureHelper();
  const children: any[] = [];
  const commands: string[][] = [];
  let sequence = 0;
  let requests = 0;
  const runner: ProcessRunner = {
    run: async (_cmd, args) => { commands.push(args); return { code: 0, stderr: "", stdout: args.includes("sha256sum") ? `${sha256} capture.dex` : "" }; },
    runShell: async () => { throw Error("Unexpected shell"); },
    spawn: (_cmd, args) => {
      const session = args.at(-1)!.match(/CaptureHelper ([a-f0-9-]+)/)![1];
      const child: any = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.ref = () => {}; child.unref = () => {};
      child.kill = () => { child.emit("close", 1); };
      child.stdin = new Writable({ write(chunk, _encoding, callback) {
        requests++;
        const [request, value] = chunk.toString().trim().split(" ");
        const scale = Number(value);
        const png = new PNG({ width: 8 * scale / 100, height: 8 * scale / 100 });
        png.data.fill(120);
        const buffer = PNG.sync.write(png);
        const header: any = { protocol: 1, session, request, status: "ok", length: buffer.length,
          sourceWidth: 8, sourceHeight: 8, physicalId: "12345678901234567890", rotation: 0,
          protectedContent: mode === "unknown" ? "unknown" : "absent", scale, sequence: ++sequence, captureNanos: String(sequence) };
        if (mode === "invalid-protection") header.protectedContent = "present";
        if (mode === "stale") header.request = "old-request";
        if (mode === "session") header.session = "wrong-session";
        if (mode === "geometry") header.sourceWidth = 16;
        if (mode === "rotation") header.rotation = 4;
        if (mode === "sequence") header.sequence = 0;
        if (mode === "timestamp") header.captureNanos = "0";
        if (mode === "corrupt") buffer[buffer.length - 1] ^= 1;
        if (["rejected", "protected_content", "secure_content"].includes(mode)) {
          header.status = "capture_rejected"; header.length = 0; header.reason = mode;
        }
        const bytes = Buffer.concat([Buffer.from(JSON.stringify(header) + "\n"), header.status === "ok" ? buffer : Buffer.alloc(0)]);
        setImmediate(() => {
          if (interrupt?.(child, "frame")) return;
          if (mode === "death") { child.emit("close", 1); return; }
          if (mode === "silent") return;
          child.stdout.write(bytes.subarray(0, 20));
          child.stdout.write(bytes.subarray(20));
          if (mode === "unsolicited") child.stdout.write(Buffer.from("late"));
        });
        callback();
      }});
      children.push(child);
      setImmediate(() => {
        if (interrupt?.(child, "handshake")) return;
        child.stdout.write(JSON.stringify({ protocol: 1, session, status: ["incompatible", "protected_composition"].includes(mode) ? "incompatible" : mode === "unavailable" ? "unavailable" : "ready", androidApi: 36,
        ...(mode === "protected_composition" ? { missingCapability: "protected_composition" } : mode === "unavailable" ? { missingCapability: "hardware_buffer_initialization" } : {}) }) + "\n");
      });
      return child;
    },
  };
  return { config: getDefaultRuntimeConfig({ deviceId: "test-device", runner }), children, commands, requests: () => requests };
}

test("captures all scales, reuses only the owned session and reports decoded geometry", async () => {
  const { config, children, commands } = await fixture();
  const ids = new Set();
  for (const scale of [100, 50, 25] as const) {
    const image = await captureWithHelper(config, { scale, timeoutMs: 1000 });
    assert.equal(PNG.sync.read(image.buffer).width, 8 * scale / 100);
    assert.equal(image.metadata.appliedScale, String(scale));
    ids.add(image.metadata.captureId);
  }
  assert.equal(ids.size, 3); assert.equal(children.length, 1);
  assert.equal(commands.filter(args => args.includes("push")).length, 1);
});
for (const mode of ["stale", "invalid-protection", "session", "geometry", "rotation", "sequence", "timestamp", "corrupt", "rejected", "death", "incompatible", "unsolicited"]) {
  test(`rejects ${mode} without publishing or replaying any action`, async () => {
    const { config, commands } = await fixture(mode);
    await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: 1000 }));
    assert.ok(commands.every(args => !args.includes("input") && !args.includes("screencap")));
  });
}
test("cancellation discards the session and a later capture creates a new owner", async () => {
  const { config, children } = await fixture("silent");
  const controller = new AbortController();
  const pending = captureWithHelper(config, { scale: 25, timeoutMs: 1000, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: 25 }), /timed out|deadline/);
  assert.equal(children.length, 2);
});
test("concurrent capture fails promptly; next capture after death starts a fresh session", async () => {
  const { config, children } = await fixture("silent");
  const pending = captureWithHelper(config, { scale: 25, timeoutMs: 30 });
  await assert.rejects(captureWithHelper(config, { scale: 50, timeoutMs: 100 }), /already in progress/);
  await assert.rejects(pending);
  await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: 30 }));
  assert.equal(children.length, 2);
});
test("doctor differentiates supported capability from image verification", async () => {
  const { config } = await fixture();
  const probe = await probeCaptureHelper(config);
  assert.equal(probe.status, "supported"); assert.match(probe.detail, /unverified/);
});
test("scale contract preserves omission, rejects invalid types and ambiguous execution position", () => {
  assert.deepEqual(buildScreenshotExecution().actions[0].params, {});
  for (const scale of [100, 50, 25]) assert.equal(validateExecution(buildScreenshotExecution({ scale: scale as 25 })).actions[0].params?.scale, scale);
  for (const scale of [0, 1, 0.25, "25", "", null, NaN]) assert.throws(() => validateExecution(buildScreenshotExecution({ scale: scale as any })));
  for (const scale of [undefined, 25, 50, 100] as const) {
    const execution = buildScreenshotExecution({ scale });
    execution.actions.push({ id: "later", type: "press_key", params: { key: "home" } });
    assert.throws(() => validateExecution(execution), (error: any) => /single final/.test(error.message));
    execution.actions[1] = { id: "second", type: "take_screenshot", params: {} };
    assert.throws(() => validateExecution(execution), (error: any) => /single final/.test(error.message));
  }
});

test("unknown protection does not block ordinary scaled capture", async () => {
  const { config } = await fixture("unknown");
  const image = await captureWithHelper(config, { scale: 25, timeoutMs: 1000 });
  assert.equal(image.metadata.protectedContent, "unknown");
});
for (const reason of ["protected_content", "secure_content"]) {
  test(`${reason} rejects pixels with actionable diagnostics and no stock fallback`, async () => {
    const { config, commands } = await fixture(reason);
    await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: 1000 }), (error: any) => {
      assert.equal(error.reason, "rejected");
      assert.match(error.message, /before pixel readback/);
      assert.equal(error.protectedContent, reason === "protected_content" ? "present" : "unknown");
      return true;
    });
    assert.ok(commands.every(args => !args.includes("screencap") && !args.includes("input")));
  });
}

for (const stage of ["mkdir", "push", "sha256sum"]) {
  for (const interruption of ["cancelled", "timeout"]) {
    test(`${interruption} interrupts helper ${stage} without fallback or acquisition`, async () => {
      const { config, children } = await fixture();
      const run = config.runner.run.bind(config.runner);
      const controller = new AbortController();
      let interrupted = false;
      config.runner.run = async (command, args, options) => {
        if (!args.some(arg => arg.includes(stage))) return run(command, args, options);
        assert.ok(options?.signal, "deployment must pass cancellation to its process");
        return new Promise(resolve => {
          const finish = (timedOut = false) => { interrupted = true; clearTimeout(timer); resolve({ code: null, stdout: "", stderr: "interrupted", ...(timedOut ? { timedOut: true } : {}) }); };
          const timer = setTimeout(() => finish(true), Math.ceil(options.timeoutMs!));
          options.signal!.addEventListener("abort", () => finish(), { once: true });
          if (interruption === "cancelled") controller.abort();
        });
      };
      await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: interruption === "timeout" ? 30 : 5000, signal: controller.signal }), (error: any) => {
        assert.equal(error.reason, interruption);
        assert.equal(error.fallbackAllowed, false);
        return true;
      });
      assert.equal(interrupted, true);
      assert.equal(children.length, 0);
      config.runner.run = run;
      assert.equal((await captureWithHelper(config, { scale: 25, timeoutMs: 1000 })).metadata.appliedScale, "25");
    });
  }
}

for (const stage of ["mkdir", "push", "sha256sum"]) {
  test(`setup ${stage} preserves a process timeout before the clock reaches the deadline`, async (t) => {
    const { config, children, commands } = await fixture();
    const run = config.runner.run.bind(config.runner);
    // A timer can settle before the subsequent fractional-clock deadline check.
    // Freeze that boundary instead of relying on a real 30 ms scheduling race.
    t.mock.method(performance, "now", () => 0);
    config.runner.run = async (command, args, options) => {
      if (!args.some(arg => arg.includes(stage))) return run(command, args, options);
      return { code: null, stdout: "", stderr: "", timedOut: true };
    };
    await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: 30 }), (error: any) => {
      assert.equal(error.reason, "timeout");
      assert.equal(error.fallbackAllowed, false);
      return true;
    });
    assert.equal(children.length, 0);
    assert.ok(commands.every(args => !args.includes("screencap") && !args.includes("input")));
    t.mock.restoreAll();
    config.runner.run = run;
    assert.equal((await captureWithHelper(config, { scale: 25, timeoutMs: 1000 })).metadata.appliedScale, "25");
  });
}

test("buffer initialization failure permits fallback before any capture request", async () => {
  const { config, requests } = await fixture("unavailable");
  await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: 1000 }), error => {
    assert.equal((error as any).reason, "unavailable");
    assert.equal((error as any).fallbackAllowed, true);
    assert.match((error as Error).message, /hardware buffer.*no screen capture/);
    return true;
  });
  assert.equal(requests(), 0);
});

for (const phase of ["handshake", "frame"] as const) {
  for (const event of ["child_close", "stdin_error", "stdout_error", "stderr_error", "child_error"] as const) {
    test(`${event} during ${phase} retains safe lifecycle facts without retry`, async () => {
      const f = await fixture("valid", (child, current) => {
        if (current !== phase) return false;
        child.stderr.write("PRIVATE_SCREEN_AND_DEVICE_DETAILS");
        if (event === "child_close") { child.emit("exit", 17, null); child.emit("close", 17, null); }
        else (event === "child_error" ? child : event === "stdout_error" ? child.stdout : event === "stderr_error" ? child.stderr : child.stdin).emit("error", Object.assign(new Error("PRIVATE_PIPE_MESSAGE"), { code: "EPIPE", path: "/private/path" }));
        return true;
      });
      await assert.rejects(captureWithHelper(f.config, { scale: 50, timeoutMs: 1000 }), (error: any) => {
        assert.equal(error.reason, "transport");
        assert.equal(error.fallbackAllowed, false);
        assert.deepEqual(error.diagnostics, { phase, event, requestAttempted: phase === "frame",
          ...(event === "child_close" ? { exitCode: 17, exitSignal: null } : { errorCode: "EPIPE" }) });
        assert.ok(!JSON.stringify(error).includes("PRIVATE"));
        assert.ok(!error.message.includes("PRIVATE"));
        return true;
      });
      assert.equal(f.children.length, 1);
      assert.equal(f.requests(), phase === "frame" ? 1 : 0);
      assert.ok(f.commands.every(args => !args.includes("input") && !args.includes("screencap")));
    });
  }
}


test("first lifecycle failure survives cleanup and unknown error details are omitted", async () => {
  const f = await fixture("valid", (child, phase) => {
    if (phase !== "frame") return false;
    child.stdin.emit("error", Object.assign(new Error("PRIVATE_ERROR"), { code: "PRIVATE_CODE" }));
    child.emit("close", null, "SIGKILL");
    return true;
  });
  await assert.rejects(captureWithHelper(f.config, { scale: 50, timeoutMs: 1000 }), (error: any) => {
    assert.deepEqual(error.diagnostics, { phase: "frame", event: "stdin_error", requestAttempted: true });
    assert.ok(!JSON.stringify(error).includes("PRIVATE"));
    return true;
  });
});

test("signal exit and synchronous spawn failure retain only safe facts", async () => {
  const f = await fixture("valid", (child, phase) => {
    if (phase !== "handshake") return false;
    child.emit("close", null, "SIGTERM"); return true;
  });
  await assert.rejects(captureWithHelper(f.config, { scale: 50, timeoutMs: 1000 }), (error: any) => {
    assert.deepEqual(error.diagnostics, { phase: "handshake", event: "child_close", requestAttempted: false, exitCode: null, exitSignal: "SIGTERM" });
    return true;
  });
  f.config.runner.spawn = () => { throw Object.assign(new Error("PRIVATE_EXEC_PATH"), { code: "ENOENT" }); };
  await assert.rejects(captureWithHelper(f.config, { scale: 50, timeoutMs: 1000 }), (error: any) => {
    assert.equal(error.reason, "transport");
    assert.deepEqual(error.diagnostics, { phase: "handshake", event: "spawn_error", requestAttempted: false, errorCode: "ENOENT" });
    assert.ok(!error.message.includes("PRIVATE")); return true;
  });
});

test("a synchronous frame write failure is transport evidence, not a decoding error", async () => {
  const f = await fixture("valid", (child, phase) => {
    if (phase === "handshake") child.stdin.write = () => { throw Object.assign(new Error("PRIVATE_WRITE"), { code: "EPIPE" }); };
    return false;
  });
  await assert.rejects(captureWithHelper(f.config, { scale: 50, timeoutMs: 1000 }), (error: any) => {
    assert.equal(error.reason, "transport");
    assert.deepEqual(error.diagnostics, { phase: "frame", event: "stdin_error", requestAttempted: true, errorCode: "EPIPE" });
    return true;
  });
});
