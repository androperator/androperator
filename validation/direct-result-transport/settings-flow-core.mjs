// Pure measurement and endpoint helpers, shared with the offline regression tests.
export function statistics(values) {
  if (!values.length) return null;
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid measurement');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, min: sorted[0], max: sorted.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

export function trialSchedule(warmups, measured) {
  return ['warmup', 'measured'].flatMap(phase =>
    Array.from({ length: phase === 'warmup' ? warmups : measured }, (_, pair) =>
      (pair % 2 ? ['direct', 'logcat'] : ['logcat', 'direct']).map(transport => ({ phase, pair, transport }))).flat());
}

export function bounds(value) {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(value ?? '');
  if (!match) throw new Error('Missing or invalid node bounds');
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (right <= left || bottom <= top) throw new Error('Empty node bounds');
  return { left, top, right, bottom };
}

export function viewport(nodes, containerId) {
  const containers = nodes.filter(node => node.visibleToUser && node.resourceId === containerId);
  if (containers.length !== 1) throw new Error(`Expected one visible container: ${containerId}`);
  const container = containers[0];
  const area = bounds(container.bounds);
  const labels = nodes.filter(node => node.visibleToUser && node.text &&
    node.nodePath.startsWith(`${container.nodePath}.`) &&
    (node.resourceId === 'android:id/title' || node.resourceId === 'com.android.settings:id/settingslib_button'));
  if (!labels.length) throw new Error('No visible Settings labels inside the expected container');
  return { area, labels, signature: JSON.stringify(labels.map(node => [node.resourceId, node.text, node.bounds])) };
}

export function hasLabel(view, text) {
  return view.labels.some(node => node.text === text && bounds(node.bounds).top >= view.area.top &&
    bounds(node.bounds).bottom <= view.area.bottom);
}

export function endpointVisible(view, text) {
  return hasLabel(view, text) && view.labels.at(-1).text === text;
}

export function targetStable(before, after, text) {
  return hasLabel(before, text) && hasLabel(after, text) && before.signature === after.signature;
}

export function swipeParams(view, direction) {
  const { left, right, top, bottom } = view.area;
  const x = Math.round(left + (right - left) * 0.5);
  const high = Math.round(top + (bottom - top) * 0.2);
  const low = Math.round(top + (bottom - top) * 0.8);
  return { start: { x, y: direction === 'down' ? low : high },
    end: { x, y: direction === 'down' ? high : low }, durationMs: 300 };
}

export function summarize(trials) {
  return Object.fromEntries(['logcat', 'direct'].map(transport => {
    const measured = trials.filter(trial => trial.phase === 'measured' && trial.transport === transport);
    const passed = measured.filter(trial => trial.passed);
    const metric = name => statistics(passed.map(trial => trial[name]));
    const commands = passed.flatMap(trial => trial.commands.filter(command => command.stage !== 'reset' && command.stage !== 'verifyScreenshot'));
    const timingRows = commands.flatMap(command => command.transportTimings);
    const timingKeys = [...new Set(timingRows.flatMap(row => Object.keys(row).filter(key => typeof row[key] === 'number')))];
    const stageNames = [...new Set(passed.flatMap(trial => Object.keys(trial.stages)))];
    return [transport, { attempted: measured.length, passed: passed.length, failed: measured.length - passed.length,
      totalMs: metric('totalMs'), commandCount: metric('commandCount'), snapshotBytes: metric('snapshotBytes'),
      nodeCount: metric('nodeCount'), screenshotBytes: metric('screenshotBytes'),
      stages: Object.fromEntries(stageNames.map(stage => [stage, statistics(passed.map(trial => trial.stages[stage]))])),
      screenshotAdbMs: statistics(commands.flatMap(command => command.screenshotAdbMs ?? [])),
      directTimings: Object.fromEntries(timingKeys.map(key => [key, statistics(timingRows.map(row => row[key]).filter(value => value !== undefined))])),
      missingTimingConfirmations: timingRows.filter(row => row.timingConfirmation !== 'received').length,
      failures: measured.filter(trial => !trial.passed).map(({ pair, error, failedStage }) => ({ pair, error, failedStage })) }];
  }));
}

export function summarizeAndroidTimings(trials, log) {
  const rows = new Map();
  for (const line of log.split('\n')) {
    const match = /\[SnapshotTiming\] commandId=(\S+) (.*)/.exec(line);
    if (!match) continue;
    const fields = Object.fromEntries([...match[2].matchAll(/(\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)]));
    const existing = rows.get(match[1]) ?? [];
    existing.push(fields);
    rows.set(match[1], existing);
  }
  return Object.fromEntries(['logcat', 'direct'].map(transport => {
    const commands = trials.filter(trial => trial.phase === 'measured' && trial.transport === transport && trial.passed)
      .flatMap(trial => trial.commands.filter(command => command.snapshotExpected && command.stage !== 'verifyScreenshot'));
    const samples = commands.flatMap(command => rows.get(command.commandId) ?? []);
    const keys = [...new Set(samples.flatMap(row => Object.keys(row)))];
    return [transport, { expectedCommands: commands.length, observedCommands: commands.filter(command => rows.has(command.commandId)).length,
      samples: samples.length, fields: Object.fromEntries(keys.map(key => [key, statistics(samples.map(row => row[key]).filter(value => value !== undefined))])) }];
  }));
}
