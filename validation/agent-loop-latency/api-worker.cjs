const {parentPort, workerData} = require('node:worker_threads');
const control = new Int32Array(workerData.buffer, 0, 2);
const bytes = new Uint8Array(workerData.buffer, 8);

parentPort.on('message', async ({args, options}) => {
  let stderr = '';
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk, encoding, callback) => {
    stderr += String(chunk);
    if (typeof encoding === 'function') encoding();
    else if (callback) callback();
    return true;
  };
  let result;
  try {
    const {execute} = require(workerData.modulePath);
    result = {...await execute(args, options), stderr};
  }
  catch (error) {
    result = {status: 1, signal: null, stdout: '', stderr: stderr + String(error),
      error: {code: 'API_EXECUTION_FAILED'}};
  } finally { process.stderr.write = originalWrite; }
  let encoded = Buffer.from(JSON.stringify(result));
  if (encoded.length > bytes.length) {
    encoded = Buffer.from(JSON.stringify({status: null, signal: null, stdout: '', stderr: 'API output exceeded buffer', error: {code: 'ENOBUFS'}}));
  }
  bytes.set(encoded);
  Atomics.store(control, 1, encoded.length);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
});
