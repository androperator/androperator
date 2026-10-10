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
async function fixture(mode = "valid") {
  const { sha256 } = await bundledCaptureHelper();
  const children: any[] = [];
  const commands: string[][] = [];
  let sequence = 0;
  const runner: ProcessRunner = {
    run: async (_cmd, args) => { commands.push(args); return { code: 0, stderr: "", stdout: args.includes("sha256sum") ? `${sha256} capture.dex` : "" }; },
    runShell: async () => { throw Error("Unexpected shell"); },
    spawn: (_cmd, args) => {
      const session = args.at(-1)!.match(/CaptureHelper ([a-f0-9-]+)/)![1];
      const child: any = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.ref = () => {}; child.unref = () => {};
      child.kill = () => { child.emit("close", 1); };
      child.stdin = new Writable({ write(chunk, _encoding, callback) {
        const [request, value] = chunk.toString().trim().split(" ");
        const scale = Number(value);
        const png = new PNG({ width: 8 * scale / 100, height: 8 * scale / 100 });
        png.data.fill(120);
        const buffer = PNG.sync.write(png);
        const header: any = { protocol: 1, session, request, status: "ok", length: buffer.length,
          sourceWidth: 8, sourceHeight: 8, physicalId: "12345678901234567890", rotation: 0,
          scale, sequence: ++sequence, captureNanos: String(sequence) };
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
          if (mode === "death") { child.emit("close", 1); return; }
          if (mode === "silent") return;
          child.stdout.write(bytes.subarray(0, 20));
          child.stdout.write(bytes.subarray(20));
          if (mode === "unsolicited") child.stdout.write(Buffer.from("late"));
        });
        callback();
      }});
      children.push(child);
      setImmediate(() => child.stdout.write(JSON.stringify({ protocol: 1, session, status: ["incompatible", "protected_composition"].includes(mode) ? "incompatible" : "ready", androidApi: 36,
        ...(mode === "protected_composition" ? { missingCapability: "protected_composition" } : {}) }) + "\n"));
      return child;
    },
  };
  return { config: getDefaultRuntimeConfig({ deviceId: "test-device", runner }), children, commands };
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
for (const mode of ["stale", "session", "geometry", "rotation", "sequence", "timestamp", "corrupt", "rejected", "death", "incompatible", "unsolicited"]) {
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
  const execution = buildScreenshotExecution({ scale: 25 });
  execution.actions.push({ id: "later", type: "press_key", params: { key: "home" } });
  assert.throws(() => validateExecution(execution), (error: any) => /single final/.test(error.message));
});

test("missing protected composition gives a hardware-aware failure and doctor diagnostic", async () => {
  const { config, commands } = await fixture("protected_composition");
  await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: 1000 }), (error: any) => {
    assert.equal(error.reason, "incompatible");
    assert.match(error.message, /protected GPU composition/);
    assert.match(error.message, /OS upgrade alone may not/);
    return true;
  });
  const probe = await probeCaptureHelper(config);
  assert.equal(probe.status, "incompatible");
  assert.match(probe.detail, /protected GPU composition/);
  assert.ok(commands.every(args => !args.includes("screencap")));
});
for (const reason of ["protected_content", "secure_content"]) {
  test(`${reason} rejects pixels with actionable diagnostics and no stock fallback`, async () => {
    const { config, commands } = await fixture(reason);
    await assert.rejects(captureWithHelper(config, { scale: 25, timeoutMs: 1000 }), (error: any) => {
      assert.equal(error.reason, "rejected");
      assert.match(error.message, /before pixel readback/);
      return true;
    });
    assert.ok(commands.every(args => !args.includes("screencap") && !args.includes("input")));
  });
}
