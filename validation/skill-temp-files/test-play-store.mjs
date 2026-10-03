import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sourcePath = path.resolve('.agents/skills/test-recording-validate/play-store-search-skill/scripts/search_play_store.js');
const source = fs.readFileSync(sourcePath, 'utf8').split('const MAX_QUERY_LENGTH')[0];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'play-store-test-'));
try {
  for (const fail of [false, true]) {
    let executionPath;
    const context = vm.createContext({
      __dirname: path.dirname(sourcePath),
      process: { argv: ['node', 'fixture', 'device', 'query'], env: {} },
      require(name) {
        if (name === 'os') return { tmpdir: () => temp };
        if (name === 'child_process') return { execFileSync(_command, args) {
          executionPath = args[args.indexOf('--execution') + 1];
          assert.equal(path.dirname(path.dirname(executionPath)), temp);
          assert.equal(fs.statSync(path.dirname(executionPath)).mode & 0o777, 0o700);
          assert.equal(fs.statSync(executionPath).mode & 0o777, 0o600);
          assert.equal(JSON.parse(fs.readFileSync(executionPath)).commandId, '../escape');
          if (fail) throw new Error('fixture execution failure');
          return '{}';
        }};
        // The regression fixture wraps require to mock built-in modules; names come from the checked-in skill source, not external input.
        // nosemgrep: detect-non-literal-require
        return require(name);
      },
    });
    vm.runInContext(source, context);
    const result = vm.runInContext("runAndroperatorLocal({commandId: '../escape'}, 'device', 'package')", context);
    assert.equal(result.ok, !fail);
    assert.equal(fs.existsSync(executionPath), false);
    assert.deepEqual(fs.readdirSync(temp), []);
  }
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
console.log('Private skill temp files: permissions, traversal, success/failure cleanup passed.');
