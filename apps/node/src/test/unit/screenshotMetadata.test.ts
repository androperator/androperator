import assert from "node:assert/strict";
import { it } from "node:test";
import { PNG } from "pngjs";
import { verifyScreenshot } from "../../domain/observe/screenshotMetadata.js";

for (const [width, height] of [[3, 7], [7, 3]]) {
  it(`reports decoded original dimensions for ${width}x${height} PNG`, () => {
    const bytes = PNG.sync.write(new PNG({ width, height }));
    assert.deepEqual(verifyScreenshot(bytes), { captureWidthPx: width, captureHeightPx: height, coordinateSpace: "screenshot_pixels", origin: "top_left" });
    assert.throws(() => verifyScreenshot(bytes.subarray(0, 24)));
    const oversized = Buffer.from(bytes);
    oversized.writeUInt32BE(32_000_001, 16);
    assert.throws(() => verifyScreenshot(oversized), /decoding limit/);
  });
}
