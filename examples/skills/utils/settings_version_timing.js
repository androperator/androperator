const fs = require('node:fs');
const path = require('node:path');

// Opt-in local measurements. Spans overlap; never sum parent and child spans.
function start(name) {
  if (process.env.VERSION_TIMING !== '1') return undefined;
  const directory = process.env.VERSION_RUN_DIR;
  if (!directory || !path.isAbsolute(directory)) throw Error('VERSION_RUN_DIR must be absolute for timing');
  return {name, directory, startedAt: new Date().toISOString(), started: performance.now()};
}

function finish(span, outcome) {
  if (!span) return;
  const elapsedMs = performance.now() - span.started;
  fs.appendFileSync(path.join(span.directory, 'timings.ndjson'), JSON.stringify({
    name: span.name, startedAt: span.startedAt, elapsedMs, outcome,
  }) + '\n');
}

function measureSync(name, operation) {
  const span = start(name);
  let outcome = 'failed';
  try {
    const result = operation();
    outcome = 'returned';
    return result;
  } finally { finish(span, outcome); }
}

async function measureAsync(name, operation) {
  const span = start(name);
  let outcome = 'failed';
  try {
    const result = await operation();
    outcome = 'returned';
    return result;
  } finally { finish(span, outcome); }
}

module.exports = {measureSync, measureAsync};
