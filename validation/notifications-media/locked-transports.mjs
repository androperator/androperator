import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runNotificationMedia, decodeNotificationMediaPayload } from '../../apps/node/dist/domain/notifications/service.js';
import { startServer } from '../../apps/node/dist/cli/commands/serve.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'apps/node/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const [deviceId, mediaSessionId, output, selectedTransport] = process.argv.slice(2);
const transports = ["typed", "http", "mcp"];
assert.ok(selectedTransport === undefined || transports.includes(selectedTransport));
assert.ok(output);
const operatorPackage = 'com.androperator.operator.dev';
const records = [];
const sample = () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return JSON.parse(execFileSync('adb', ['-s', deviceId, 'shell', 'run-as', 'com.androperator.fixture.media', 'cat', 'files/media-proof.json'], { encoding: 'utf8' }));
    } catch (error) {
      records.push({ sampleReadFailure: { attempt, status: error.status ?? null, message: error.message } });
      if (attempt === 2) throw error;
    }
  }
};
const initial = sample();
assert.equal(initial.deviceLocked, true);
const client = new Client({ name: 'locked-controls', version: '1' });
const server = await startServer({ port: 0, host: '127.0.0.1', verbose: false, operatorPackage });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(root, 'apps/node/dist/cli/index.js'), 'mcp', 'serve'], env: { ...process.env, ANDROPERATOR_NO_DAEMON: '1' } }));
  for (const transport of selectedTransport === undefined ? transports : [selectedTransport]) {
    for (const operation of ['pause', 'seek', 'play']) {
      const before = sample();
      const type = `media_${operation}`;
      const params = { mediaSessionId, waitTimeoutMs: 2000, ...(operation === 'seek' ? { positionMs: 10000, positionToleranceMs: 100 } : {}) };
      const commandId = `locked-${transport}-${operation}`;
      const actions = [
        { id: 'read', type: 'get_media_status', params: { mediaSessionId } },
        { id: 'control', type, params },
        { id: 'after', type: 'get_media_status', params: { mediaSessionId } },
      ];
      let result;
      if (transport === 'typed') {
        result = await runNotificationMedia(type, params, { deviceId, operatorPackage });
        assert.equal(result.result.ok, true);
        assert.equal(result.payload.dispatched, true);
      } else {
        let envelope;
        if (transport === 'http') {
          const response = await fetch(`http://127.0.0.1:${server.address().port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, execution: { commandId, taskId: 'locked-controls', source: 'validation', expectedFormat: 'android-ui-automator', timeoutMs: 10000, actions } }) });
          result = await response.json();
          assert.equal(response.status, 200);
          envelope = result.envelope ?? result;
          assert.equal(envelope.commandId, commandId);
          assert.equal(envelope.taskId, 'locked-controls');
        } else {
          result = await client.callTool({ name: 'execute', arguments: { deviceId, operatorPackage, timeoutMs: 10000, actions } });
          assert.notEqual(result.isError, true, JSON.stringify(result));
          const body = JSON.parse(result.content.find(item => item.type === 'text').text);
          envelope = body.envelope ?? body;
        }
        assert.equal(envelope.status, 'success', JSON.stringify(envelope));
        assert.equal(envelope.stepResults.length, 3);
        for (const step of envelope.stepResults) {
          assert.equal(step.success, true);
          const payload = decodeNotificationMediaPayload(step.data.payload);
          assert.equal(payload.session.mediaSessionId, mediaSessionId);
          assert.equal(payload.deviceState.deviceLocked, true);
          assert.equal(payload.deviceState.screenOn, initial.screenOn);
        }
      }
      const after = sample();
      records.push({ transport, operation, result, before, after });
      assert.equal(after[`${operation}Commands`], before[`${operation}Commands`] + 1);
      if (operation === 'seek') assert.ok(Math.abs(after.actualPositionMs - 10000) <= 100);
      else assert.equal(after.actualPlaying, operation === 'play');
      for (const field of ['deviceLocked', 'screenOn', 'screenOnEvents', 'screenOffEvents']) assert.equal(after[field], initial[field], field);
    }
  }
} finally {
  writeFileSync(output, JSON.stringify(records, null, 2));
  await client.close();
  await new Promise(resolve => server.close(resolve));
}
