import { PNG } from "pngjs";
import type { ScreenshotMetadata } from "../../contracts/screenshot.js";

/** Advice is based on the saved image, independently of the acquisition method. */
export function screenshotHint(appliedScale: string): string {
  const open = "Open the PNG at data.path on the capture host with your image-reading tool; image bytes are not embedded in this result.";
  const detail = appliedScale === "25"
    ? "This image is at the default 25% scale per dimension for routine observation. If text or fine details are unclear, request a fresh image with --scale 50 or --scale 100 (Node: observeScreenshot({ scale: 50 }) or observeScreenshot({ scale: 100 }))."
    : appliedScale === "50"
      ? "This image is at 50% scale per dimension. If details are unclear, request a fresh image with --scale 100 (Node: observeScreenshot({ scale: 100 })). For routine observation, omit scale or use --scale 25 (Node: observeScreenshot({ scale: 25 }))."
      : "This image is already at full resolution (100%). For routine observation, omit scale or use --scale 25 (Node: observeScreenshot({ scale: 25 })); use --scale 50 (Node: observeScreenshot({ scale: 50 })) for intermediate detail.";
  return `${open} ${detail} Verify the intended screen has rendered; capture success does not establish task success. Retry observation, not the preceding action. Image coordinates use captureWidthPx/captureHeightPx; prefer semantic selectors, or map to nativeWidthPx/nativeHeightPx and verify current geometry before tapping.`;
}

/** Validate bounds before decoding; a PNG header alone is not capture evidence. */
export function decodeScreenshot(buffer: Buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid PNG signature");
  const captureWidthPx = buffer.readUInt32BE(16), captureHeightPx = buffer.readUInt32BE(20);
  if (captureWidthPx === 0 || captureHeightPx === 0 || captureWidthPx * captureHeightPx > 32_000_000) throw new Error("PNG dimensions exceed the 32-million-pixel decoding limit");
  const decoded = PNG.sync.read(buffer, { checkCRC: true });
  if (decoded.width !== captureWidthPx || decoded.height !== captureHeightPx || decoded.data.length !== captureWidthPx * captureHeightPx * 4) throw new Error("PNG decoding failed");
  return decoded;
}

export function verifyScreenshot(buffer: Buffer): ScreenshotMetadata {
  const { width: captureWidthPx, height: captureHeightPx } = decodeScreenshot(buffer);
  return { captureWidthPx, captureHeightPx, coordinateSpace: "screenshot_pixels", origin: "top_left" };
}
