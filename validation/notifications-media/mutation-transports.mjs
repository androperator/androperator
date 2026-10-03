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
const [deviceId, mediaSessionId, notificationKey, actionId, output] = process.argv.slice(2);
assert.ok(output);
const operatorPackage = 'com.androperator.operator.dev';
const packageName = 'com.androperator.fixture.media';
const sample = () => JSON.parse(execFileSync('adb', ['-s', deviceId, 'shell', 'run-as', packageName, 'cat', 'files/media-proof.json'], { encoding: 'utf8' }));
const evidence = [];
const client = new Client({ name: 'mutation-proof', version: '1' });
const server = await startServer({ port: 0, host: '127.0.0.1', verbose: false, operatorPackage });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(root, 'apps/node/dist/cli/index.js'), 'mcp', 'serve'], env: { ...process.env, ANDROPERATOR_NO_DAEMON: '1' } }));
  let item = { key: notificationKey, actions: [{ actionId }] };
  for (const transport of ['typed', 'http', 'mcp']) {
    if (transport !== 'typed') {
      execFileSync('adb', ['-s', deviceId, 'shell', 'am', 'broadcast', '--receiver-foreground', '-n', "'" + packageName + "/androperator.operator.debug.MediaProofActivity$Control'", '--es', 'operation', 'post']);
      // Allow the repost and listener revision callback to settle before advertising a handle.
      await wait(1000);
      const listed = await runNotificationMedia('list_notifications', { applicationId: packageName }, { deviceId, operatorPackage });
      item = listed.payload.notifications.find(item => item.key.includes('|8124|'));
    }
    const before = sample();
    const actions = [
      { id: 'seek', type: 'media_seek', params: { mediaSessionId, positionMs: 15000, waitTimeoutMs: 2000, positionToleranceMs: 100 } },
      { id: 'button', type: 'invoke_notification_action', params: { notificationKey: item.key, actionId: item.actions[0].actionId } },
      { id: 'dismiss', type: 'dismiss_notification', params: { notificationKey: item.key, waitTimeoutMs: 2000 } },
    ];
    const commandId = `mutation-${transport}`;
    const taskId = `mutation-task-${transport}`;
    let envelope;
    if (transport === 'typed') {
      for (const action of actions) {
        const result = await runNotificationMedia(action.type, action.params, { deviceId, operatorPackage });
        evidence.push({ transport, result });
        assert.equal(result.result.ok, true);
        assert.ok(result.payload.dispatched);
        if (action.type === 'media_seek') assert.equal(result.payload.targetPositionObserved, true);
        if (action.type === 'dismiss_notification') assert.equal(result.payload.removalObserved, true);
      }
    } else if (transport === 'http') {
      const execution = { commandId, taskId, source: 'validation', expectedFormat: 'android-ui-automator', timeoutMs: 10000, actions };
      const response = await fetch(`http://127.0.0.1:${server.address().port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution, deviceId }) });
      const result = await response.json();
      evidence.push({ transport, result });
      assert.equal(response.status, 200);
      envelope = result.envelope ?? result;
      assert.equal(envelope.commandId, commandId);
      assert.equal(envelope.taskId, taskId);
    } else {
      const result = await client.callTool({ name: 'execute', arguments: { deviceId, operatorPackage, timeoutMs: 10000, actions } });
      evidence.push({ transport, result });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const body = JSON.parse(result.content.find(item => item.type === 'text').text);
      envelope = body.envelope ?? body;
    }
    if (envelope) {
      assert.equal(envelope.status, 'success', JSON.stringify(envelope));
      for (const step of envelope.stepResults) {
        assert.equal(step.success, true);
        const payload = decodeNotificationMediaPayload(step.data.payload);
        assert.equal(payload.dispatched, true);
      }
    }
    await wait(300);
    const after = sample();
    evidence.push({ transport, before, after });
    assert.equal(after.seekCommands, before.seekCommands + 1);
    assert.equal(after.buttonCommands, before.buttonCommands + 1);
    assert.ok(Math.abs(after.actualPositionMs - 15000) <= 100, JSON.stringify(after));
    const errorActions = [{ id: 'stale', type: 'invoke_notification_action', params: actions[1].params }];
    if (transport === 'typed') {
      const result = await runNotificationMedia('invoke_notification_action', actions[1].params, { deviceId, operatorPackage });
      assert.ok(JSON.stringify(result).includes('NOTIFICATION_EXPIRED'));
      evidence.push({ transport, expired: result });
    } else if (transport === 'http') {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, execution: { commandId: 'expired-http', taskId, source: 'validation', expectedFormat: 'android-ui-automator', timeoutMs: 10000, actions: errorActions } }) });
      const result = await response.json();
      assert.ok(JSON.stringify(result).includes('NOTIFICATION_EXPIRED'));
      evidence.push({ transport, expired: result });
    } else {
      const result = await client.callTool({ name: 'execute', arguments: { deviceId, operatorPackage, actions: errorActions } });
      assert.equal(result.isError, true);
      assert.ok(JSON.stringify(result).includes('NOTIFICATION_EXPIRED'));
      evidence.push({ transport, expired: result });
    }
  }
} finally {
  writeFileSync(output, JSON.stringify(evidence, null, 2));
  await client.close();
  await new Promise(resolve => server.close(resolve));
}
