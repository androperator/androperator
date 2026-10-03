// Host run isolation and identity; no app navigation or model decisions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${name} must be explicitly configured`);
  return value.trim();
}
function prepareRun(env = process.env) {
  const model = required(env.VERSION_CODEX_MODEL, 'VERSION_CODEX_MODEL');
  const effort = env.VERSION_CODEX_EFFORT === undefined ? 'high' : required(env.VERSION_CODEX_EFFORT, 'VERSION_CODEX_EFFORT');
  if (!/^[a-z]+$/.test(effort)) throw Error('Invalid VERSION_CODEX_EFFORT');
  const device = required(env.ANDROPERATOR_DEVICE_ID, 'ANDROPERATOR_DEVICE_ID');
  const timeout = Number(env.ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS ?? 300000);
  if (!Number.isFinite(timeout) || timeout < 1000) throw Error('Invalid agent timeout');
  const directory = env.VERSION_RUN_DIR === undefined
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'version-details-'))
    : required(env.VERSION_RUN_DIR, 'VERSION_RUN_DIR');
  if (!path.isAbsolute(directory)) throw Error('VERSION_RUN_DIR must be absolute');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(path.join(directory, 'events.json'))) throw Error('Evidence directory already used');
  // Atomic claim also protects failed runs that never produced a device event.
  fs.writeFileSync(path.join(directory, 'run-identity.json'), JSON.stringify({
    startedAt: new Date().toISOString(), pid: process.pid, device, model, effort,
  }), { flag: 'wx' });
  const deviceHash = crypto.createHash('sha256').update(device).digest('hex');
  const lock = path.join(os.tmpdir(), `androperator-orchestration-${deviceHash}.lock`);
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error('Device already reserved by an orchestration run; inspect its lock before retrying');
    throw error;
  }
  try { fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, directory })); }
  catch (error) { fs.rmSync(lock, { recursive: true, force: true }); throw error; }
  return { directory, model, effort, timeout, release: () => fs.rmSync(lock, { recursive: true, force: true }) };
}
function sourceHashes(files) {
  return Object.fromEntries(files.map(([name, file]) => [name, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
}
module.exports = { prepareRun, sourceHashes };
