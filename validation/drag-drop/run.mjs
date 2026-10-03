#!/usr/bin/env node
// Live launcher regression through the branch-local drag and snapshot APIs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
const { SaxesParser } = createRequire(new URL('../../apps/node/package.json', import.meta.url))('saxes');

const { values } = parseArgs({ options: {
  device: { type: 'string' }, label: { type: 'string' },
  x: { type: 'string' }, y: { type: 'string' },
  'output-dir': { type: 'string' }, restore: { type: 'boolean', default: false },
  'operator-package': { type: 'string', default: 'com.androperator.operator.dev' },
}});
for (const key of ['device', 'label', 'x', 'y', 'output-dir', 'operator-package']) {
  if (values[key] === undefined || values[key].trim() === '') throw new Error(`Missing --${key}`);
}
const destination = [values.x, values.y].map(value => {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Coordinates must be non-negative integers');
  return Number(value);
});
const output = resolve(values['output-dir']);
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output); // Never overwrite earlier evidence.
const cli = fileURLToPath(new URL('../../apps/node/dist/cli/index.js', import.meta.url));
const pause = ms => new Promise(done => setTimeout(done, ms));

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ANDROPERATOR_LOG_DIR: resolve(output, 'logs') } });
}
function api(...args) {
  const result = JSON.parse(run(process.execPath, [cli, ...args, '--device', values.device,
    '--operator-package', values['operator-package'], '--no-daemon']));
  if (result.envelope?.status !== 'success') throw new Error(JSON.stringify(result));
  return result;
}
async function snapshot(name) {
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = api('snapshot');
      break;
    } catch (error) {
      const failure = error.stdout ? String(error.stdout) : String(error);
      writeFileSync(resolve(output, `${name}-failure-${attempt}.txt`), failure);
      let code;
      try { code = JSON.parse(failure).code; } catch { /* Preserve non-JSON failures above. */ }
      if (code !== 'RESULT_ENVELOPE_TIMEOUT' || attempt === 3) throw error;
      await pause(1200); // Retry only the read, never repeat a possibly applied drag.
    }
  }
  writeFileSync(resolve(output, `${name}.json`), JSON.stringify(result, null, 2));
  const xml = result.envelope.stepResults.find(step => step.actionType === 'snapshot')?.data?.text;
  if (!xml) throw new Error('Snapshot returned no hierarchy');
  writeFileSync(resolve(output, `${name}.xml`), xml);
  const stack = [];
  const matches = [];
  const parser = new SaxesParser();
  parser.on('opentag', tag => {
    const attr = tag.attributes;
    const parent = stack.at(-1);
    const visible = parent?.visible !== false && attr['visible-to-user'] !== 'false';
    const workspace = parent?.workspace === true || attr['resource-id'] === 'com.google.android.apps.nexuslauncher:id/workspace';
    stack.push({ visible, workspace });
    if (workspace && visible && attr.package === 'com.google.android.apps.nexuslauncher' &&
        attr.text === values.label && attr['long-clickable'] === 'true') {
      const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attr.bounds);
      if (bounds) {
        const box = bounds.slice(1).map(Number);
        if (box[2] > box[0] && box[3] > box[1]) matches.push(box);
      }
    }
  });
  parser.on('closetag', () => stack.pop());
  parser.write(xml).close();
  if (matches.length !== 1) throw new Error(`Expected exactly one visible workspace icon '${values.label}', got ${matches.length}`);
  return matches[0];
}
const center = box => [Math.floor((box[0] + box[2]) / 2), Math.floor((box[1] + box[3]) / 2)];
const contains = (box, point) => point[0] >= box[0] && point[0] < box[2] && point[1] >= box[1] && point[1] < box[3];
let dragCount = 0;
async function drag(start, end) {
  const name = `drag-${++dragCount}`;
  let result;
  try {
    result = api('drag', '--start', ...start.map(String), '--end', ...end.map(String),
      '--hold-duration-ms', '1200', '--move-duration-ms', '800');
  } catch (error) {
    writeFileSync(resolve(output, `${name}-failure.txt`), error.stdout ? String(error.stdout) : String(error));
    throw error;
  }
  writeFileSync(resolve(output, `${name}.json`), JSON.stringify(result, null, 2));
  const step = result.envelope.stepResults[0];
  if (!step.success || step.data.dispatch_accepted !== 'true') throw new Error('Drag was not accepted');
  await pause(1200);
}
async function verify(name, target, previous) {
  let box;
  for (let attempt = 1; attempt <= 3; attempt++) {
    box = await snapshot(`${name}-${attempt}`);
    if (contains(box, target) && JSON.stringify(box) !== JSON.stringify(previous)) return box;
    await pause(700);
  }
  throw new Error(`Drop was not verified: ${JSON.stringify({ target, box, previous })}`);
}
const before = await snapshot('before');
if (contains(before, destination)) throw new Error('Destination is already inside the source icon');
await drag(center(before), destination);
const after = await verify('after', destination, before);
api('press', 'home');
await pause(1000);
const persisted = await snapshot('persisted');
if (JSON.stringify(after) !== JSON.stringify(persisted)) throw new Error('Placement changed after pressing Home');
const result = { backend: 'operator-accessibility-drag', label: values.label, before, after, persisted };
if (values.restore) {
  await drag(center(persisted), center(before));
  result.restored = await verify('restored', center(before), after);
  if (JSON.stringify(result.restored) !== JSON.stringify(before)) throw new Error('Original bounds were not restored');
}
writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
