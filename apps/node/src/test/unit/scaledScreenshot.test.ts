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
