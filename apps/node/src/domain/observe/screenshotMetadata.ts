import { PNG } from "pngjs";
import type { ScreenshotMetadata } from "../../contracts/screenshot.js";

/** Advice is based on the saved image, independently of the acquisition method. */
export function screenshotHint(appliedScale: string): string {
  const open = "Open the PNG at data.path on the capture host to inspect it; image bytes are not embedded in this result.";
  if (appliedScale === "25") {
    return `${open} This image is at 25% scale, recommended for routine observation loops. If details are unclear, capture again with --scale 50 or --scale 100 (Node: observeScreenshot({ scale: 50 }) or observeScreenshot({ scale: 100 })).`;
  }
  if (appliedScale === "50") {
    return `${open} This image is at 50% scale. If details are unclear, capture again with --scale 100 (Node: observeScreenshot({ scale: 100 })). For routine observation loops, use --scale 25 (Node: observeScreenshot({ scale: 25 })).`;
  }
  return `${open} This image is already at full resolution (100%). For routine observation loops, use --scale 25 (Node: observeScreenshot({ scale: 25 })); use --scale 50 (Node: observeScreenshot({ scale: 50 })) when more detail is needed.`;
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
