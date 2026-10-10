import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// A fresh process is essential: another test's module cache can conceal eager imports.
function checkClient(mode: string): void {
  const registry = new URL("../../../cli/registry.js", import.meta.url).href;
  const action = new URL("../../../cli/commands/action.js", import.meta.url).href;
  const observe = new URL("../../../cli/commands/observe.js", import.meta.url).href;
  const execute = new URL("../../../cli/commands/execute.js", import.meta.url).href;
  const script = `
    import { registerHooks } from 'node:module';
    import assert from 'node:assert/strict';
    const mode = ${JSON.stringify(mode)};
    globalThis.directLoads = 0;
    globalThis.directCalls = 0;
    globalThis.success = execution => ({
      ok: true, deviceId: 'test-device', terminalSource: 'androperator_result',
      envelope: {commandId: execution.commandId, taskId: execution.taskId,
        status: 'success', stepResults: [], error: null}
    });
    registerHooks({load(url, context, nextLoad) {
      if (url.includes('/android-emulator/') || url.includes('/android-emulators/')) {
        throw Error('Unrelated emulator implementation loaded');
      }
      if (url.endsWith('/domain/executions/runExecution.js')) {
        globalThis.directLoads++;
        if (!['fallback', 'direct'].includes(mode)) throw Error('Direct runtime loaded on daemon path');
        return {format: 'module', shortCircuit: true, source:
          'export async function runExecution(execution) { globalThis.directCalls++; return globalThis.success(execution); }'};
      }
      return nextLoad(url, context);
    }});
    await import(${JSON.stringify(registry)});
    const {cmdActionClick} = await import(${JSON.stringify(action)});
    const {cmdObserveSnapshot, cmdObserveScreenshot} = await import(${JSON.stringify(observe)});
    const {cmdExecute} = await import(${JSON.stringify(execute)});
    assert.equal(globalThis.directLoads, 0);
    let proxyCalls = 0;
    const options = {format: 'json', deviceId: 'test-device', noDaemon: mode === 'direct',
      tryDaemonExecutionFn: async (execution, options) => {
        proxyCalls++;
        if (options.noDaemon || mode === 'fallback') return null;
        if (mode === 'lost') return {ok: false, error: {code: 'DAEMON_REQUEST_FAILED', message: 'dispatch uncertain'}};
        return globalThis.success(execution);
      }};
    const payload = {commandId: 'execute-test', taskId: 'execute-test', source: 'test',
      expectedFormat: 'android-ui-automator', timeoutMs: 30000,
      actions: [{id: 's', type: 'snapshot'}]};
    const commands = [
      () => cmdActionClick({...options, coordinate: {x: 1, y: 2}}),
      () => cmdObserveSnapshot(options),
      () => cmdObserveScreenshot({...options, path: '/tmp/test-capture.png'}),
      () => cmdExecute({...options, execution: JSON.stringify(payload)}),
    ];
    for (const command of commands) {
      const result = JSON.parse(await command());
      if (mode === 'lost') assert.equal(result.code, 'DAEMON_REQUEST_FAILED');
      else {
        assert.equal(result.envelope.status, 'success');
        assert.equal(result.envelope.commandId, result.envelope.taskId);
        assert.equal(result.terminalSource, 'androperator_result');
        assert.equal(result.isCanonicalTerminal, true);
      }
    }
    assert.equal(globalThis.directCalls, ['fallback', 'direct'].includes(mode) ? 4 : 0);
    assert.equal(globalThis.directLoads, ['fallback', 'direct'].includes(mode) ? 1 : 0);
    assert.equal(proxyCalls, mode === 'direct' ? 3 : 4);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

describe("daemon CLI import boundary", () => {
  it("keeps emulator and direct execution modules out of successful daemon clients", () => checkClient("daemon"));
  it("loads direct execution only for an eligible fallback", () => checkClient("fallback"));
  it("preserves explicit no-daemon execution", () => checkClient("direct"));
  it("does not load or call direct execution after an uncertain dispatch", () => checkClient("lost"));
});
