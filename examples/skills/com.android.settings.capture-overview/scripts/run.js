#!/usr/bin/env node
const {mkdtempSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {spawnSync} = require('node:child_process');
const {resolveAndroperatorBin,resolveOperatorPackage} = require('../../utils/common');
const directory = mkdtempSync(join(tmpdir(), 'androperator-settings-starter-'));
try {
  const device = process.env.ANDROPERATOR_DEVICE_ID;
  if (typeof device !== 'string' || !device.trim()) throw Error('Explicit device is required');
  const bin = resolveAndroperatorBin();
  for (const [index,args] of [['open','--app','com.android.settings'],['snapshot']].entries()) {
    const child = spawnSync(bin.cmd,[...bin.args,...args,'--device',device,
      '--operator-package',resolveOperatorPackage(),'--no-daemon','--output','json'],
      {encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
    writeFileSync(join(directory, `command-${index}.stdout`), child.stdout ?? '');
    writeFileSync(join(directory, `command-${index}.stderr`), child.stderr ?? '');
    const result = JSON.parse(child.stdout ?? '');
    if (child.status !== 0 || result.envelope?.status !== 'success'
        || !Array.isArray(result.envelope.stepResults)
        || result.envelope.stepResults.some(step => step.success !== true)) {
      throw Error(`Command ${index} failed; inspect retained evidence`);
    }
  }
  console.log(JSON.stringify({evidenceDirectory:directory,observationOnly:true}));
} catch (error) {
  console.error(JSON.stringify({message:error.message,evidenceDirectory:directory}));
  process.exitCode = 1;
}
