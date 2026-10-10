const path = require('node:path');
const {Worker} = require('node:worker_threads');

// The existing helper is synchronous. A single long-lived worker runs async Node
// API calls without rewriting its observation/recovery/deadline policy.
function createBridge(modulePath = path.join(__dirname, 'node-api.cjs')) {
  const buffer = new SharedArrayBuffer(8 + 8 * 1024 * 1024);
  const control = new Int32Array(buffer, 0, 2);
  const bytes = new Uint8Array(buffer, 8);
  const worker = new Worker(path.join(__dirname, 'api-worker.cjs'), {workerData: {buffer, modulePath}});
  let closed = false;
  let workerError;
  worker.on('error', error => { workerError = error; closed = true; });
  async function close() { closed = true; await worker.terminate(); }
  function execute(args, options) {
    if (closed) throw workerError ?? Error('API worker is closed; no command replay permitted');
    if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw Error('Finite positive command deadline required');
    Atomics.store(control, 0, 0);
    worker.postMessage({args, options});
    if (Atomics.wait(control, 0, 0, options.timeout) === 'timed-out') {
      // Same outer command budget as the subprocess backend. The device may
      // already have acted. Poison this worker and never continue or replay.
      void close();
      return {status: null, signal: null, stdout: '', stderr: 'API worker command deadline exceeded; outcome may be unknown', error: {code: 'ETIMEDOUT'}};
    }
    const length = Atomics.load(control, 1);
    return JSON.parse(Buffer.from(bytes.subarray(0, length)).toString('utf8'));
  }
  return {execute, close};
}

module.exports = {createBridge};
