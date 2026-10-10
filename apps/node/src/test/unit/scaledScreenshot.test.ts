import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { captureScaledScreenshot, resizeScreenshot } from "../../domain/observe/scaledScreenshot.js";
import { CaptureHelperError } from "../../domain/observe/captureHelper.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";

const config = getDefaultRuntimeConfig({ deviceId: "test-device" });
function fixture() {
  const png = new PNG({ width: 9, height: 13 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 40; png.data[i + 1] = 100; png.data[i + 2] = 200; png.data[i + 3] = 255; }
  const bytes = PNG.sync.write(png);
  let captures = 0;
  const deps = {
    helper: async () => { const error = new CaptureHelperError("incompatible", "missing API"); error.fallbackAllowed = true; throw error; },
    capture: async () => { captures++; return bytes; },
    display: async () => ({ width: 9, height: 13, rotation: 0, physicalId: "123" }),
    interactive: async () => {},
  };
  return { bytes, deps, captures: () => captures };
}
for (const scale of [100, 50, 25] as const) test(`fallback returns actual requested ${scale}% dimensions, pixels and unknown protection`, async () => {
  const f = fixture();
  const result = await captureScaledScreenshot(config, { scale, timeoutMs: 1000 }, f.deps);
  const image = PNG.sync.read(result.buffer);
  assert.equal(image.width, Math.floor(9 * scale / 100));
  assert.equal(image.height, Math.floor(13 * scale / 100));
  assert.deepEqual([...image.data.subarray(0, 4)], [40, 100, 200, 255]);
  assert.equal(result.metadata.captureMethod, "adb_screencap_resize");
  assert.equal(result.metadata.protectedContent, "unknown");
  assert.equal(result.metadata.appliedScale, String(scale));
  assert.equal(result.metadata.fallbackAttempted, "true");
  assert.equal(result.metadata.nativeWidthPx, "9");
  assert.equal(f.captures(), 1);
});
test("resize averages source pixels instead of choosing a corner", () => {
  const png = new PNG({ width: 2, height: 2 });
  png.data.set([0,0,0,255, 100,100,100,255, 200,200,200,255, 100,100,100,255]);
  assert.deepEqual([...PNG.sync.read(resizeScreenshot(PNG.sync.write(png), 50)).data], [100,100,100,255]);
});
for (const reason of ["protocol", "transport", "rejected", "cancelled", "timeout", "busy"] as const) test(`never falls back after ${reason}`, async () => {
  const f = fixture(); f.deps.helper = async () => { throw new CaptureHelperError(reason, reason); };
  await assert.rejects(captureScaledScreenshot(config, { scale: 25, timeoutMs: 1000 }, f.deps));
  assert.equal(f.captures(), 0);
});
test("fallback rejects changing geometry without another capture", async () => {
  const f = fixture(); let reads = 0;
  f.deps.display = async () => ({ width: ++reads === 1 ? 9 : 13, height: 13, rotation: 0, physicalId: "123" });
  await assert.rejects(captureScaledScreenshot(config, { scale: 25, timeoutMs: 1000 }, f.deps), (error: any) => error.fallbackAttempted && error.reason === "rejected");
  assert.equal(f.captures(), 1);
});
test("fallback rejects locked state and corrupt PNG", async () => {
  const f = fixture(); f.deps.interactive = async () => { throw new CaptureHelperError("rejected", "locked"); };
  await assert.rejects(captureScaledScreenshot(config, { scale: 25, timeoutMs: 1000 }, f.deps), /locked/);
  assert.equal(f.captures(), 0);
  f.deps.interactive = async () => {}; f.deps.capture = async () => Buffer.from("not PNG");
  await assert.rejects(captureScaledScreenshot(config, { scale: 25, timeoutMs: 1000 }, f.deps), /Invalid PNG/);
});
test("fallback respects cancellation and a shared deadline", async () => {
  const f = fixture(); const controller = new AbortController();
  f.deps.capture = async () => { controller.abort(); return f.bytes; };
  await assert.rejects(captureScaledScreenshot(config, { scale: 25, timeoutMs: 1000, signal: controller.signal }, f.deps), (e: any) => e.reason === "cancelled" && e.fallbackAttempted);
  const g = fixture(); g.deps.helper = async () => { await new Promise(resolve => setTimeout(resolve, 15)); const e = new CaptureHelperError("unavailable", "setup"); e.fallbackAllowed = true; throw e; };
  await assert.rejects(captureScaledScreenshot(config, { scale: 25, timeoutMs: 5 }, g.deps), (e: any) => e.reason === "timeout");
  assert.equal(g.captures(), 0);
});

// Use the production probe/result reader and ADB adapters, not the injected
// interactive no-op above: cancellation must reach their actual pending work.
for (const stage of ["reader", "broadcast", "before-display", "capture-display", "after-display"]) {
  for (const interruption of ["cancelled", "timeout"]) {
    test(`fallback ${interruption} interrupts ${stage} and stops further work`, async () => {
      const { scaledCaptureRunner } = await import("./fakes/scaledCaptureRunner.js");
      const f = await scaledCaptureRunner(true);
      const controller = new AbortController();
      const run = f.runner.run.bind(f.runner), spawn = f.runner.spawn.bind(f.runner);
      let displayReads = 0, stopped = false, probeKilled = false;
      const displayTarget = stage === "before-display" ? 1 : stage === "capture-display" ? 2 : 3;
      f.runner.run = async (command, args, options) => {
        const isBroadcast = args.join(" ").includes("am broadcast");
        const isDisplay = args.slice(-2).join(" ") === "dumpsys display";
        if (isDisplay) displayReads++;
        const block = stage === "broadcast" ? isBroadcast : stage.endsWith("display") && isDisplay && displayReads === displayTarget;
        if (!block) return run(command, args, options);
        assert.ok(options?.signal, "pending subprocess must receive cancellation");
        return new Promise(resolve => {
          options.signal!.addEventListener("abort", () => { stopped = true; resolve({ code: null, stdout: "", stderr: "interrupted" }); }, { once: true });
          if (interruption === "cancelled") controller.abort();
        });
      };
      f.runner.spawn = (command, args, options) => {
        const child = spawn(command, args, options);
        if (args.includes("logcat")) {
          const kill = child.kill.bind(child);
          child.kill = () => { probeKilled = true; return kill(); };
          if (stage === "reader" && interruption === "cancelled") setImmediate(() => controller.abort());
        }
        return child;
      };
      const runtime = getDefaultRuntimeConfig({ deviceId: "test-device", runner: f.runner });
      await assert.rejects(captureScaledScreenshot(runtime, {
        scale: 25, timeoutMs: stage === "reader" && interruption === "timeout" ? 30 : 500,
        signal: controller.signal,
      }), (error: any) => error.reason === interruption && error.fallbackAttempted === true);
      assert.equal(probeKilled, true);
      if (stage === "reader") assert.equal(f.calls.some(args => args.join(" ").includes("am broadcast")), false);
      else assert.equal(stopped, true);
      assert.equal(f.captures(), stage === "after-display" ? 1 : 0);
    });
  }
}
