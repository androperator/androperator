import { PNG } from "pngjs";
import type { ScreenshotMetadata } from "../../contracts/screenshot.js";

/** Decode before publishing dimensions; a PNG header alone is not capture evidence. */
export function verifyScreenshot(buffer: Buffer): ScreenshotMetadata {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid PNG signature");
  const captureWidthPx = buffer.readUInt32BE(16), captureHeightPx = buffer.readUInt32BE(20);
  if (captureWidthPx === 0 || captureHeightPx === 0 || captureWidthPx * captureHeightPx > 32_000_000) throw new Error("PNG dimensions exceed the 32-million-pixel decoding limit");
  const decoded = PNG.sync.read(buffer, { checkCRC: true });
  if (decoded.width !== captureWidthPx || decoded.height !== captureHeightPx || decoded.data.length !== captureWidthPx * captureHeightPx * 4) throw new Error("PNG decoding failed");
  return { captureWidthPx, captureHeightPx, coordinateSpace: "screenshot_pixels", origin: "top_left" };
}
