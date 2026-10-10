const {createBridge} = require('./api-bridge.cjs');
const runtime = require('../../examples/skills/utils/settings_version_runtime');
const {performOperation} = require('../../examples/skills/utils/settings_version_tool');
const {measureAsync} = require('../../examples/skills/utils/settings_version_timing');
const fs = require('node:fs');

async function main() {
  const screenshots = process.env.VERSION_SCREENSHOTS;
  const bridge = createBridge(screenshots ? require('node:path').join(__dirname, 'jev-screenshots.cjs') : undefined);
  runtime.setCommandRunner(bridge.execute);
  const operations = [];
  let status = 'failed';
  let stoppedAt;
  try {
    for (const operation of ['open', 'jev', 'finish']) {
      stoppedAt = operation;
      const started = performance.now();
      let result;
      let exitCode = 0;
      let stderr = '';
      try {
        result = await measureAsync(`operation.${operation}`, () => performOperation(operation));
      } catch (error) {
        exitCode = 1;
        const failure = {reason: error.message, failure: error.failure, recovery: error.recovery};
        runtime.save('last-tool-failure.json', failure);
        stderr = JSON.stringify({...failure, state: runtime.fallbackState()});
      }
      fs.writeFileSync(runtime.file(`${operation}.stdout`), result === undefined ? '' : JSON.stringify(result));
      fs.writeFileSync(runtime.file(`${operation}.stderr`), stderr);
      operations.push({operation, elapsedMs: performance.now() - started, exitCode, signal: null,
        status: result?.status, reason: result?.reason});
      if (exitCode !== 0 || result?.status === 'overlay_review_required' ||
          (operation === 'jev' && result?.status !== 'complete') ||
          (operation === 'finish' && result?.status !== 'success')) break;
      if (operation === 'finish') status = 'verified';
    }
  } finally {
    runtime.setCommandRunner(undefined);
    try { if (screenshots) bridge.execute(['__close'], {timeout: 5000}); }
    finally { await bridge.close(); }
  }
  console.log(JSON.stringify({status, stoppedAt, operations}));
  process.exitCode = status === 'verified' ? 0 : 1;
}
main().catch(error => {console.error(String(error)); process.exitCode = 1;});
