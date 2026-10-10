// Explicit physical-device fault injection. Restores rotation and changes no app navigation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { getDefaultRuntimeConfig } from '../../apps/node/dist/adapters/android-bridge/runtimeConfig.js';
import { NodeProcessRunner } from '../../apps/node/dist/adapters/android-bridge/processRunner.js';
import { captureWithHelper, closeCaptureHelpers, probeCaptureHelper } from '../../apps/node/dist/domain/observe/captureHelper.js';
import { verifyScreenshot } from '../../apps/node/dist/domain/observe/screenshotMetadata.js';
const [deviceId, output] = process.argv.slice(2);
if (!deviceId || !output || !isAbsolute(output)) throw Error('Usage: node faults.mjs <device> <absolute-private-output>');
const run = promisify(execFile);
const adb = async (...args) => (await run('adb', ['-s', deviceId, ...args], {timeout:15000})).stdout.trim();
const config = getDefaultRuntimeConfig({ deviceId, operatorPackage: 'com.androperator.operator.dev' });
await mkdir(output, { recursive:true });
const rows = [];
const record = async row => { rows.push(row); console.log(JSON.stringify(row)); await writeFile(`${output}/faults.json`, JSON.stringify(rows,null,2)); };
const capture = async (name, scale=25, extra={}) => {
  const started = performance.now();
  try {
    const image = await captureWithHelper(config, { scale, timeoutMs:10000, ...extra });
    const geometry = verifyScreenshot(image.buffer);
    await writeFile(`${output}/${name}.png`,image.buffer);
    const row = {name,ok:true,totalMs:performance.now()-started,...geometry,...image.metadata};
    await record(row); return row;
  } catch(error) { const row={name,ok:false,reason:error.reason,message:error.message,totalMs:performance.now()-started};await record(row);return row; }
};
const rotation = await adb('shell','settings','get','system','user_rotation');
const automatic = await adb('shell','settings','get','system','accelerometer_rotation');
try {
  const initial = await capture('baseline');
  if (!initial.ok) throw Error('Baseline capture failed');
  await adb('shell','settings','put','system','accelerometer_rotation','0');
  await adb('shell','settings','put','system','user_rotation','1');
  await new Promise(resolve=>setTimeout(resolve,700));
  const rotated = await capture('rotated');
  if (!rotated.ok || rotated.rotation === initial.rotation || rotated.nativeWidthPx !== initial.nativeHeightPx) throw Error('Rotation did not produce the intended geometry');
  await adb('shell','settings','put','system','user_rotation',rotation);
  await new Promise(resolve=>setTimeout(resolve,700));
  const restored = await capture('restored');
  const listing = await adb('shell','ps','-A','-o','PID,ARGS');
  const line = listing.split('\n').find(line=>new RegExp(`^\\s*\\d+\\s+app_process /system/bin CaptureHelper ${restored.captureSessionId}$`).test(line));
  if (!line) throw Error('Owned helper PID not found');
  const pid = line.trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw Error('Invalid PID');
  await adb('shell','kill','-9',pid);
  await new Promise(resolve=>setTimeout(resolve,100));
  let recovered = await capture('after-death');
  if (!recovered.ok && recovered.reason === 'transport') recovered = await capture('after-death-retry');
  if (!recovered.ok || recovered.captureSessionId===restored.captureSessionId) throw Error('Helper death recovery failed');
  const controller = new AbortController();
  const cancelled = capture('cancelled',100,{signal:controller.signal});
  setTimeout(()=>controller.abort(),5);
  if ((await cancelled).ok) throw Error('Cancellation unexpectedly published an image');
  if (!(await capture('after-cancellation')).ok) throw Error('Cancellation recovery failed');
  const interrupted = capture('disconnect-inflight',100);
  await adb('reconnect');
  await interrupted;
  await adb('wait-for-device');
  if (!(await capture('after-reconnect')).ok) throw Error('Reconnect recovery failed');
  closeCaptureHelpers();
  // Fault boundary: alter only the response request UUID from a real device capture.
  class StaleRunner extends NodeProcessRunner {
    spawn(command,args,options) {
      const child=super.spawn(command,args,options);
      const emit=child.stdout.emit.bind(child.stdout);
      child.stdout.emit=(event,...values)=>{
        if(event==='data') {
          const bytes=values[0], text=bytes.toString('utf8');
          if(text.includes('"request":"')) { const end=bytes.indexOf(10); if(end>=0) values[0]=Buffer.concat([Buffer.from(bytes.subarray(0,end+1).toString('utf8').replace(/"request":"[a-f0-9-]{36}"/,'"request":"00000000-0000-0000-0000-000000000000"')),bytes.subarray(end+1)]); }
        }
        return emit(event,...values);
      };
      return child;
    }
  }
  const staleConfig = getDefaultRuntimeConfig({deviceId,runner:new StaleRunner()});
  try { await captureWithHelper(staleConfig,{scale:25,timeoutMs:10000}); throw Error('Injected stale response accepted'); }
  catch(error) { if(error.reason!=='protocol') throw error;await record({name:'stale-response',ok:false,reason:error.reason}); }
  await record({name:'capability',...await probeCaptureHelper(config)});
} finally {
  closeCaptureHelpers();
  await adb('shell','settings',rotation==='null'?'delete':'put','system','user_rotation',...(rotation==='null'?[]:[rotation]));
  await adb('shell','settings',automatic==='null'?'delete':'put','system','accelerometer_rotation',...(automatic==='null'?[]:[automatic]));
}
