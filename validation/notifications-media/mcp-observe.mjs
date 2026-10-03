import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'apps/node/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const [deviceId, sessionId, output, expectedScreenOn = "false"] = process.argv.slice(2);
if (!deviceId || !sessionId || !output) throw new Error('Usage: mcp-observe.mjs <device> <session> <output.json>');
const client = new Client({ name: 'notification-media-proof', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(root, 'apps/node/dist/cli/index.js'), 'mcp', 'serve'], env: { ...process.env, ANDROPERATOR_NO_DAEMON: '1' } });
try {
  await client.connect(transport);
  const result = await client.callTool({ name: 'execute', arguments: {
    deviceId, operatorPackage: 'com.androperator.operator.dev', actions: [
      { id: 'notifications', type: 'list_notifications', params: { applicationId: 'com.androperator.fixture.media' } },
      { id: 'sessions', type: 'list_media_sessions' },
      { id: 'status', type: 'get_media_status', params: { mediaSessionId: sessionId } },
    ],
  } });
  writeFileSync(output, JSON.stringify(result, null, 2));
  assert.equal(result.isError, undefined, JSON.stringify(result));
  const value = JSON.parse(result.content.find(item => item.type === 'text').text);
  const envelope = value.envelope ?? value;
  assert.equal(envelope.status, 'success');
  assert.equal(envelope.stepResults.length, 3);
  for (const step of envelope.stepResults) assert.equal(JSON.parse(step.data.payload).deviceState.screenOn, expectedScreenOn === "true");
} finally { await client.close(); }
