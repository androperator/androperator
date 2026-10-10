// Experimental sequential CLI host. Never used by the shipped executable.
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [entry, socketPath] = process.argv.slice(2);
if (!path.isAbsolute(entry ?? '') || !path.isAbsolute(socketPath ?? '')) throw Error('Absolute built entry and private socket required');
const original = await fs.readFile(entry, 'utf8');
const marker = '\nmain().catch((e) => {';
if (original.split(marker).length !== 2 || !original.includes('async function main()')) throw Error('Unsupported CLI build');
const temporary = path.join(path.dirname(entry), `.persistent-probe-${process.pid}.mjs`);
const program = original.slice(0, original.indexOf(marker)).replace(/^#![^\n]*\n/, '').replace('async function main()', 'export async function main()').replaceAll('process.exit(', 'finishProbe(');
await fs.writeFile(temporary, `function finishProbe(code) { throw Object.assign(new Error('CLI exit'), {probeExit: code}); }\n${program}`, {flag: 'wx', mode: 0o600});
let main;
try { ({main} = await import(pathToFileURL(temporary).href)); }
finally { await fs.unlink(temporary); }
let busy = false;
const server = net.createServer(socket => {
  let input = '', accepted = false;
  socket.setEncoding('utf8');
  socket.setTimeout(120000, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('data', async bytes => {
    if (accepted) return;
    input += bytes.toString('utf8');
    if (Buffer.byteLength(input) > 131072) return socket.destroy();
    if (!input.endsWith('\n')) return;
    accepted = true;
    if (busy) return socket.end(JSON.stringify({stdout:'', stderr:'Prototype worker busy\n', status:1})+'\n');
    let request;
    try {
      request = JSON.parse(input);
      if (!Array.isArray(request.args) || !request.args.every(x => typeof x === 'string') ||
          !['open','close','click','scroll','snapshot','screenshot','read-value','press','--help','--version'].includes(request.args[0]) ||
          !request.context || Object.keys(request.context).some(k => !['ANDROPERATOR_RUN_ID','ANDROPERATOR_LOG_DIR'].includes(k)) ||
          Object.values(request.context).some(v => typeof v !== 'string')) throw Error('Unsupported prototype request');
    } catch { return socket.end(JSON.stringify({stdout:'',stderr:'Invalid prototype request\n',status:1})+'\n'); }
    busy = true;
    const saved = {argv:process.argv, exitCode:process.exitCode, stdout:process.stdout.write, stderr:process.stderr.write};
    const environment = Object.fromEntries(['ANDROPERATOR_RUN_ID','ANDROPERATOR_LOG_DIR'].map(k=>[k,process.env[k]]));
    let stdout = '', stderr = '';
    const capture = append => (data, encoding, callback) => {
      append(Buffer.isBuffer(data) ? data.toString() : String(data));
      if (typeof encoding === 'function') encoding(); else callback?.();
      return true;
    };
    try {
      process.argv = [process.execPath,entry,...request.args]; process.exitCode = 0;
      for (const k of Object.keys(environment)) { if (request.context[k] === undefined) delete process.env[k]; else process.env[k] = request.context[k]; }
      process.stdout.write = capture(s=>stdout+=s); process.stderr.write = capture(s=>stderr+=s);
      try { await main(); }
      catch (e) { if (Number.isInteger(e.probeExit)) process.exitCode=e.probeExit; else { stderr+=JSON.stringify({code:'UNKNOWN',message:String(e)})+'\n';process.exitCode=1; } }
      socket.end(JSON.stringify({stdout,stderr,status:Number(process.exitCode ?? 0)})+'\n');
    } finally {
      process.argv=saved.argv;process.exitCode=saved.exitCode;process.stdout.write=saved.stdout;process.stderr.write=saved.stderr;
      for (const [k,v] of Object.entries(environment)) { if(v===undefined)delete process.env[k];else process.env[k]=v; }
      busy=false;
    }
  });
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
await fs.chmod(socketPath,0o600);
process.send?.({ready:true});
