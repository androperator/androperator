import { PNG } from "pngjs";
import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { waitForResultEnvelope } from "../../adapters/android-bridge/logcatResultReader.js";
import { probeInteractiveState, isInteractiveAutomationReady } from "../doctor/checks/deviceInteractivity.js";
import { captureWithHelper, CaptureHelperError, type CaptureScale, type HelperImage } from "./captureHelper.js";
import { captureScreenshot } from "./captureScreenshot.js";
import { readActiveDisplay } from "./activeDisplay.js";
import { verifyScreenshot } from "./screenshotMetadata.js";

/** Area averaging preserves small text better than dropping three of four pixels. */
export function resizeScreenshot(buffer: Buffer, scale: CaptureScale): Buffer {
  verifyScreenshot(buffer);
  if (scale === 100) return buffer;
  const source = PNG.sync.read(buffer, { checkCRC: true });
  const output = new PNG({ width: Math.max(1, Math.floor(source.width * scale / 100)), height: Math.max(1, Math.floor(source.height * scale / 100)) });
  for (let y = 0; y < output.height; y++) {
    const top = Math.floor(y * source.height / output.height), bottom = Math.floor((y + 1) * source.height / output.height);
    for (let x = 0; x < output.width; x++) {
      const left = Math.floor(x * source.width / output.width), right = Math.floor((x + 1) * source.width / output.width);
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let sy = top; sy < bottom; sy++) for (let sx = left; sx < right; sx++) sum += source.data[(sy * source.width + sx) * 4 + channel];
        output.data[(y * output.width + x) * 4 + channel] = Math.round(sum / ((bottom - top) * (right - left)));
      }
    }
  }
  return PNG.sync.write(output);
}

const defaults = {
  helper: captureWithHelper,
  capture: captureScreenshot,
  display: readActiveDisplay,
  interactive: async (config: RuntimeConfig, remaining: () => number, signal?: AbortSignal) => {
    const result = await probeInteractiveState(config, (runtime, options, trigger) =>
      waitForResultEnvelope(runtime, { ...options, timeoutMs: Math.min(options.timeoutMs, remaining()) }, trigger), signal);
    remaining();
    if (!result.ok) throw new CaptureHelperError("unavailable", `Could not verify device state: ${result.message}`);
    if (!isInteractiveAutomationReady(result.state)) throw new CaptureHelperError("rejected", "Screenshot requires an unlocked, interactive device. Unlock the device and retry screenshot.");
  },
};

/** A setup-only fallback. This never replays an uncertain acquisition or a device action. */
export async function captureScaledScreenshot(config: RuntimeConfig,
  options: { scale: CaptureScale; timeoutMs: number; signal?: AbortSignal }, dependencies = defaults): Promise<HelperImage> {
  const deadline = performance.now() + options.timeoutMs;
  const remaining = () => {
    if (options.signal?.aborted) throw new CaptureHelperError("cancelled", "Screenshot cancelled.");
    const ms = deadline - performance.now();
    if (!Number.isFinite(ms) || ms <= 0) throw new CaptureHelperError("timeout", "Screenshot deadline exhausted.");
    return ms;
  };
  remaining();
  let reason: string;
  try { return await dependencies.helper(config, options); }
  catch (error) {
    if (!(error instanceof CaptureHelperError) || !error.fallbackAllowed || !["unavailable", "incompatible"].includes(error.reason)) throw error;
    reason = error.reason;
  }
  // The result reader starts its own timeout after attaching/broadcasting. An
  // absolute deadline signal also bounds that startup and its ADB broadcast.
  const deadlineAbort = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, deadlineAbort.signal]) : deadlineAbort.signal;
  const timer = setTimeout(() => deadlineAbort.abort(new CaptureHelperError("timeout", "Screenshot deadline exhausted.")), Math.max(0, Math.ceil(deadline - performance.now())));
  try {
    remaining();
    await dependencies.interactive(config, remaining, signal);
    const before = await dependencies.display(config, remaining(), signal);
    const native = await dependencies.capture(config, { timeoutMs: remaining(), signal });
    const dimensions = verifyScreenshot(native);
    const after = await dependencies.display(config, remaining(), signal);
    if (JSON.stringify(before) !== JSON.stringify(after) || (before &&
      (dimensions.captureWidthPx !== before.width || dimensions.captureHeightPx !== before.height))) {
      throw new CaptureHelperError("rejected", "Display changed during fallback capture. Retry screenshot; navigation was not replayed.");
    }
    await dependencies.interactive(config, remaining, signal);
    const buffer = resizeScreenshot(native, options.scale);
    const image = verifyScreenshot(buffer);
    remaining();
    if (image.captureWidthPx !== Math.max(1, Math.floor(dimensions.captureWidthPx * options.scale / 100)) ||
        image.captureHeightPx !== Math.max(1, Math.floor(dimensions.captureHeightPx * options.scale / 100))) throw new Error("Resized PNG dimensions mismatch");
    return { buffer, metadata: { captureMethod: "adb_screencap_resize", protectedContent: "unknown",
      fallbackAttempted: "true", fallbackReason: reason, requestedScale: String(options.scale), appliedScale: String(options.scale),
      nativeWidthPx: String(dimensions.captureWidthPx), nativeHeightPx: String(dimensions.captureHeightPx),
      ...(before ? { rotation: String(before.rotation), physicalDisplayId: before.physicalId, logicalDisplayId: "0" } : {}) } };
  } catch (cause) {
    const message = typeof cause === "object" && cause !== null && "message" in cause ? String(cause.message) : String(cause);
    const reason = options.signal?.aborted ? "cancelled" : performance.now() >= deadline ? "timeout" : "unavailable";
    const error = cause instanceof CaptureHelperError && reason === "unavailable" ? cause : new CaptureHelperError(reason, `Stock capture/resize failed: ${message}`);
    error.fallbackAttempted = true;
    throw error;
  } finally { clearTimeout(timer); }
}
