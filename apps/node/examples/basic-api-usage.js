/**
 * Basic HTTP usage for a caller that cannot launch CLI commands on the device host.
 * Run serve on that host and protect remote access externally.
 * The HTTP response contains completion; SSE is optional live observation.
 * See https://docs.androperator.com/api/serve/ for stream and artifact boundaries.
 */
const API_BASE = 'http://127.0.0.1:3000';

async function runSample() {
  const commandId = `sample-${Date.now()}`;
  const payload = {
    deviceId: '<device_serial>', // Replace with a serial on the server host.
    operatorPackage: 'com.androperator.operator.dev', // Use the matching installed Operator.
    execution: {
      commandId,
      taskId: 'sample-task',
      source: 'sample-script',
      expectedFormat: 'android-ui-automator',
      timeoutMs: 30000,
      actions: [
        { id: 'open', type: 'open_app', params: { applicationId: 'com.android.settings' } },
        { id: 'wait', type: 'sleep', params: { durationMs: 2000 } },
        { id: 'snap', type: 'snapshot_ui', params: { format: 'ascii' } }
      ]
    }
  };

  const response = await fetch(`${API_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok || !result.ok) {
    process.exitCode = 1;
  }
  // If the connection fails, execution may still have effects. Inspect state
  // before retrying. Reusing commandId does not deduplicate execution.
}

runSample().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
