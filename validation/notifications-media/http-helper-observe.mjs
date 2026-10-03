import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { runNotificationMedia, decodeNotificationMediaPayload } from '../../apps/node/dist/domain/notifications/service.js';
import { startServer } from '../../apps/node/dist/cli/commands/serve.js';
const [deviceId, sessionId, output] = process.argv.slice(2);
if (!deviceId || !sessionId || !output) throw new Error('Usage: http-helper-observe.mjs <device> <session> <output.json>');
const operatorPackage = 'com.androperator.operator.dev';
const typed = await runNotificationMedia('observe_media', { mediaSessionId: sessionId, durationMs: 1000 }, { deviceId, operatorPackage });
assert.equal(typed.result.ok, true);
assert.equal(typed.payload.deviceState.screenOn, false);
assert.equal(typed.payload.newPlayerReportCount, 0);
assert.deepEqual(typed.payload.samples, []);
const execution = { commandId: 'http-observation-proof', taskId: 'http-observation-proof', source: 'validation', expectedFormat: 'android-ui-automator', timeoutMs: 10000, actions: [
  { id: 'notifications', type: 'list_notifications', params: { applicationId: "com.androperator.fixture.media" } },
  { id: 'sessions', type: 'list_media_sessions' },
  { id: 'status', type: 'get_media_status', params: { mediaSessionId: sessionId } },
  { id: 'observe', type: 'observe_media', params: { mediaSessionId: sessionId, durationMs: 1000 } },
] };
const server = await startServer({ port: 0, host: '127.0.0.1', verbose: false, operatorPackage });
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution, deviceId }) });
  const result = await response.json();
  writeFileSync(output, JSON.stringify({ typed, http: result }, null, 2));
  assert.equal(response.status, 200, JSON.stringify(result));
  const envelope = result.envelope ?? result;
  assert.equal(envelope.commandId, execution.commandId);
  assert.equal(envelope.taskId, execution.taskId);
  assert.equal(envelope.status, 'success');
  for (const step of envelope.stepResults) {
    assert.equal(step.success, true);
    const payload = decodeNotificationMediaPayload(step.data.payload);
    assert.equal(payload.deviceState.screenOn, false);
    if (step.id === 'observe') {
      assert.equal(payload.newPlayerReportCount, 0);
      assert.deepEqual(payload.samples, []);
    }
    if ('session' in payload) {
      assert.equal(payload.session.mediaSessionId, typed.payload.session.mediaSessionId);
      assert.equal(payload.session.reportedPositionMs, typed.payload.session.reportedPositionMs);
      assert.equal(payload.session.positionUpdatedElapsedMs, typed.payload.session.positionUpdatedElapsedMs);
    }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
