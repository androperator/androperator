const fs = require('node:fs');
const path = require('node:path');
const {failureError,localFailure} = require('./settings_version_failure');
// Called by the helper inside the actual child sandbox, before device commands.
function prepareLogging(directory) {
  const destination = path.join(directory,'logs');
  const metadata = {destination,checkedByPid:process.pid,checkedAt:new Date().toISOString(),status:'unavailable',artifacts:[]};
  try {
    fs.mkdirSync(destination,{recursive:true});
    const probe = path.join(destination,`.write-probe-${process.pid}`);
    fs.writeFileSync(probe,'logging readiness',{flag:'wx'});
    fs.unlinkSync(probe);
    metadata.status='ready';
  } catch {
    metadata.code='LOGGING_SETUP_FAILED';
  }
  try {fs.writeFileSync(path.join(directory,'logging.json'),JSON.stringify(metadata,null,2));}
  catch {metadata.status='unavailable';metadata.code='LOGGING_SETUP_FAILED';}
  if(metadata.status!=='ready') throw failureError(localFailure('LOGGING_SETUP_FAILED','command_execution','Child-local logging is unavailable; no device command was started.'));
  return metadata;
}
function loggingAfter(directory, metadata, response, stderr = '') {
  const structured = response?.diagnostics?.logging ?? response?.envelope?.diagnostics?.logging;
  const disabled = /logging disabled after write failure/.test(stderr) || ['disabled','unavailable','write_failed'].includes(structured?.status);
  const result = {...metadata,status:disabled?'unavailable':'ready',artifacts:[]};
  if(disabled) result.code=/logging disabled after write failure/.test(stderr) || structured?.status==='write_failed' ? 'LOGGING_WRITE_FAILED' : 'LOGGING_UNAVAILABLE';
  if(!disabled) {
    try {result.artifacts=fs.readdirSync(metadata.destination).filter(name=>!name.startsWith('.') && fs.statSync(path.join(metadata.destination,name)).isFile()).slice(0,16).map(name=>path.join('logs',name));}
    catch {result.status='unavailable';result.code='LOGGING_WRITE_FAILED';}
  }
  try {fs.writeFileSync(path.join(directory,'logging.json'),JSON.stringify(result,null,2));}
  catch {result.metadataWarning='LOGGING_STATUS_WRITE_FAILED';}
  return result;
}
module.exports = {prepareLogging,loggingAfter};
