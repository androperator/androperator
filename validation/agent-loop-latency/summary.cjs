const fs = require('node:fs');
const path = require('node:path');

function statistics(values) {
  if (values.length === 0) return {count: 0};
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw Error('Invalid timing sample');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {count: values.length, totalMs: values.reduce((a, b) => a + b, 0),
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    minMs: sorted[0], maxMs: sorted.at(-1)};
}

// Explicit allowlist: no command arguments, device IDs, UI values, prompts or errors.
function summarize(directory, trial) {
  const read = (name, fallback) => fs.existsSync(path.join(directory, name))
    ? JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) : fallback;
  const events = read('events.json', []);
  const provider = read('jev.json', []);
  const timingPath = path.join(directory, 'timings.ndjson');
  const spans = fs.existsSync(timingPath) ? fs.readFileSync(timingPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const commandNames = ['open', 'click', 'scroll', 'screenshot', 'snapshot', 'read-value'];
  const commands = Object.fromEntries(commandNames.map(name => [name,
    statistics(events.filter(event => event.args[0] === name).map(event => event.elapsedMs))]));
  const spanNames = ['command', 'observation', 'operation.open', 'operation.jev', 'operation.finish'];
  const timings = Object.fromEntries(spanNames.map(name => [name,
    statistics(spans.filter(span => span.name === name).map(span => span.elapsedMs))]));
  const cli = statistics(events.map(event => event.elapsedMs));
  const requests = statistics(provider.map(event => event.elapsedMs));
  return {schemaVersion: 1, status: trial.status, stoppedAt: trial.stoppedAt, taskMs: trial.taskMs,
    operations: trial.operations.map(({operation, elapsedMs, exitCode, signal}) => ({operation, elapsedMs, exitCode, signal})),
    commandCount: events.length, failedCommands: events.filter(event => event.failure || event.exitCode !== 0).length,
    navigationActions: events.filter(event => ['click', 'scroll'].includes(event.args[0])).length,
    provider: {requests, acceptedChoices: provider.filter(event => event.choice !== undefined).length,
      failedAttempts: provider.filter(event => event.error !== undefined).length,
      httpStatuses: provider.map(event => event.httpStatus ?? null)},
    cli, commands, spans: timings,
    otherMs: trial.taskMs === null ? null : trial.taskMs - (cli.totalMs ?? 0) - (requests.totalMs ?? 0),
    terminalEvidencePresent: fs.existsSync(path.join(directory, 'verified-result.json')),
  };
}

module.exports = {statistics, summarize};
