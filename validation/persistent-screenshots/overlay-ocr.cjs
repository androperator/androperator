#!/usr/bin/env node
// Optional lab verifier for live.mjs's white-on-black, top-left FRAME overlay.
// Uses the existing pngjs dependency and a separately installed local Tesseract.
const { PNG } = require('../../apps/node/node_modules/pngjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const png = PNG.sync.read(fs.readFileSync(fs.realpathSync(process.argv[2])));
let top = -1, bottom = -1, left = png.width, right = 0;
for (let y = 0; y < png.height * 0.3; y++) {
  const dark = [];
  for (let x = 0; x < png.width * 0.45; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i] < 15 && png.data[i + 1] < 15 && png.data[i + 2] < 15) dark.push(x);
  }
  let longestRun = 0, run = 0, previous = -2;
  for (const x of dark) {
    run = x === previous + 1 ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
    previous = x;
  }
  // Start on an inset rectangle border, not a heading or edge-to-edge status bar.
  if ((top < 0 ? dark[0] > 0 && longestRun > png.width * 0.3 : dark.length > png.width * 0.2)) {
    if (top < 0) { top = y; left = dark[0]; right = dark.at(-1); }
    bottom = y;
  } else if (top >= 0) break;
}
if (top < 0) throw Error('Marker rectangle not found');
const scale = 3, margin = 20, width = right - left + 1, height = bottom - top + 1;
const crop = new PNG({ width: width * scale + margin * 2, height: height * scale + margin * 2 });
crop.data.fill(255);
for (let y = 0; y < height * scale; y++) {
  for (let x = 0; x < width * scale; x++) {
    const source = ((top + Math.floor(y / scale)) * png.width + left + Math.floor(x / scale)) * 4;
    const target = ((y + margin) * crop.width + x + margin) * 4;
    for (let channel = 0; channel < 3; channel++) crop.data[target + channel] = 255 - png.data[source + channel];
  }
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-marker-'));
try {
  const file = path.join(temporary, 'marker.png');
  fs.writeFileSync(file, PNG.sync.write(crop));
  const text = execFileSync(process.env.TESSERACT_PATH ?? 'tesseract', [file, 'stdout', '--psm', '6'], {
    encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
  });
  console.log(JSON.stringify(text.split('\n').map(line => ({ text: line.trim() }))));
} finally {
  fs.rmSync(temporary, { recursive: true });
}
