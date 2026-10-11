import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cases = [
  { name: "packages", stdout: "package:android\r\npackage:com.example.app\r\n\n", packages: ["android", "com.example.app"] },
  { name: "empty", stdout: "", packages: [] },
  { name: "offline", stdout: "", stderr: "error: device offline", exit: 1 },
  { name: "partial output", stdout: "package:com.example.partial\n", stderr: "transport disconnected", exit: 1 },
  { name: "terminated", stdout: "package:com.example.partial\n", signal: true },
  { name: "stderr failure", stdout: "", stderr: "Error: package manager unavailable", exit: 0 },
  { name: "stdout failure", stdout: "Error: package manager unavailable\n", exit: 0 },
  { name: "malformed record", stdout: "package:\n", exit: 0 },
];

for (const scenario of cases) for (const thirdParty of [false, true]) {
  test(`packages CLI: ${scenario.name}, third-party=${thirdParty}`, { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "packages-cli-"));
    try {
      const adb = join(root, "adb"), calls = join(root, "calls.jsonl");
      await writeFile(adb, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (args.at(-1) === 'devices') {
  process.stdout.write('List of devices attached\\ntest-device\\tdevice\\n');
} else {
  const scenario = ${JSON.stringify(scenario)};
  process.stdout.write(scenario.stdout);
  if (scenario.stderr) process.stderr.write(scenario.stderr);
  if (scenario.signal) process.kill(process.pid, 'SIGTERM');
  else process.exitCode = scenario.exit || 0;
}
`, { mode: 0o700 });
      // Exercise both global-option positions and both output formats.
      const args = thirdParty
        ? ["--device", "test-device", "--output", "pretty", "packages", "list", "--third-party"]
        : ["packages", "list", "--device", "test-device", "--output", "json"];
      const result = spawnSync(process.execPath, ["dist/cli/index.js", ...args], {
        encoding: "utf8", timeout: 10000,
        env: { ...process.env, ADB_PATH: adb, ANDROPERATOR_LOG_DIR: join(root, "logs") },
      });
      assert.equal(result.error, undefined);
      const output = JSON.parse(result.stdout);
      if ("packages" in scenario) {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.deepEqual(output, { packages: scenario.packages });
      } else {
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.equal(output.code, "DEVICE_SHELL_UNAVAILABLE");
        assert.equal(output.packages, undefined);
        assert.match(output.message, /package/i);
      }
      const dispatched = (await readFile(calls, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      assert.deepEqual(dispatched, [
        ["-s", "test-device", "devices"],
        ["-s", "test-device", "shell", "pm", "list", "packages", ...(thirdParty ? ["-3"] : [])],
      ]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
