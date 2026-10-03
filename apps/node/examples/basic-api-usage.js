/**
 * Basic Androperator API Integration Sample
 * 
 * Demonstrates the recommended 'Connect-then-Dispatch' pattern:
 * 1. Subscribe to the SSE event stream to listen for results.
 * 2. Dispatch an execution via REST POST.
 * 3. Match the incoming result via commandId.
 */

const API_BASE = 'http://localhost:3000';

async function runSample() {
  const commandId = `sample-${Date.now()}`;
  
  // 1. Start listening for events (SSE)
  console.log('📡 Connecting to Androperator SSE stream...');
  const eventSource = await fetch(`${API_BASE}/events`);
  const reader = eventSource.body.getReader();
  const decoder = new TextDecoder();

  // 2. Dispatch the execution
  // NOTE: In a production agent, you should wait for the SSE 'CONNECTED' heartbeat
  // or a small delay to ensure the stream is established before dispatching,
  // otherwise you might miss the result event if it finishes extremely fast.
  const payload = {
    deviceId: '<device_serial>', // Replace with your device serial
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

  console.log(`🚀 Dispatching execution: ${commandId}...`);
  const dispatchRes = await fetch(`${API_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!dispatchRes.ok) {
    const error = await dispatchRes.json();
    console.error('❌ Dispatch failed:', error);
    await reader.cancel();
    process.exit(1);
  }

  // 3. Process the stream until we find our result (with a safety timeout)
  console.log('⏳ Waiting for result in SSE stream...');
  const timeout = setTimeout(async () => {
    console.error('❌ Script timed out waiting for result.');
    await reader.cancel();
    process.exit(1);
  }, 60000);

  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // Keep partial line

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          
          // Match our specific commandId
          if (data.envelope && data.envelope.commandId === commandId) {
            clearTimeout(timeout);
            console.log('✅ Received Result for', commandId);
            console.log(JSON.stringify(data.envelope, null, 2));
            await reader.cancel();
            process.exit(0);
          }
        } catch (e) {
          console.warn('⚠️ Failed to parse SSE data line:', line);
        }
      }
    }
  }
}

runSample().catch(console.error);
