import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'apps/node/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const [deviceId, sessionId, expectedError, output] = process.argv.slice(2);
if (!deviceId || !sessionId || !expectedError || !output) throw new Error('Usage: mcp-error.mjs <device> <session or -> <expected-error> <output>');
const client = new Client({ name: 'notification-error-proof', version: '1' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(root, 'apps/node/dist/cli/index.js'), 'mcp', 'serve'], env: { ...process.env, ANDROPERATOR_NO_DAEMON: '1' } }));
  const result = await client.callTool({ name: 'execute', arguments: {
    deviceId, operatorPackage: 'com.androperator.operator.dev', timeoutMs: 3000,
    actions: [sessionId === '-' ? { id: 'read', type: 'list_notifications' } : { id: 'read', type: 'get_media_status', params: { mediaSessionId: sessionId } }],
  } });
  writeFileSync(output, JSON.stringify(result, null, 2));
  assert.equal(result.isError, true, JSON.stringify(result));
  const body = JSON.parse(result.content.find(item => item.type === 'text').text);
  assert.ok(JSON.stringify(body).includes(expectedError), JSON.stringify(body));
} finally { await client.close(); }
