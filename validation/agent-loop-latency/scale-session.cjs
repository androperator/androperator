const {spawn} = require('node:child_process');

// One outstanding read-only capture request. A protocol failure poisons the
// session; no retry or stale-frame reuse is allowed.
function startScaleSession(device, display, remoteDex) {
  const started = performance.now();
  const child = spawn('adb', ['-s', device, 'shell', '-T', 'env', `CLASSPATH=${remoteDex}`,
    'app_process', '/system/bin', 'ScaleCapture', 'session', display], {stdio: ['pipe', 'pipe', 'pipe']});
  let pending, fatal, bytes = Buffer.alloc(0), first = true;
  function fail(error) {
    fatal = error;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; }
    child.kill('SIGKILL');
  }
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('close', () => { if (pending) fail(Error('Capture session closed during request')); });
  child.stderr.on('data', () => fail(Error('Unexpected host stderr from capture session')));
  child.stdout.on('data', chunk => {
    if (!pending) return fail(Error('Unsolicited capture bytes'));
    pending.firstByteMs ??= performance.now() - pending.start;
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.length > 64 * 1024 * 1024) return fail(Error('Capture exceeds byte limit'));
    if (bytes.length < 8) return;
    if (!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return fail(Error('Invalid capture signature'));
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      const end = offset + size + 12;
      if (end > bytes.length) return;
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IEND') {
        const newline = bytes.indexOf(10, end);
        if (newline < 0) return;
        if (newline !== bytes.length - 1) return fail(Error('Unexpected bytes after frame trailer'));
        const request = pending;
        pending = undefined;
        clearTimeout(request.timer);
        request.resolve({code:0, stopped:false, firstByteMs:request.firstByteMs,
          captureMs:performance.now() - request.start, buffer:bytes, stderr:''});
        bytes = Buffer.alloc(0);
        return;
      }
      offset = end;
    }
  });
  return {
    capture(percent) {
      if (fatal) return Promise.reject(fatal);
      if (pending) return Promise.reject(Error('Concurrent capture request'));
      return new Promise((resolve, reject) => {
        const start = first ? started : performance.now();
        first = false;
        pending = {resolve, reject, start, firstByteMs:null,
          timer:setTimeout(() => fail(Error('Capture session timed out')), 20000)};
        child.stdin.write(`${percent}\n`);
      });
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.stdin.end();
      });
    },
  };
}

module.exports = {startScaleSession};
