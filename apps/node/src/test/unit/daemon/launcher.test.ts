import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cliEnvironmentIdentity } from "../../../cli/persistentCliProtocol.cjs";

const entry = (extension: string) => fileURLToPath(new URL(`../../../cli/index.${extension}`, import.meta.url));

describe("installed CLI launcher", () => {
  it("preserves direct-entry help, errors, flag placement and exit status", () => {
    const cases = [
      ["--help"], ["--version"], ["snapshot", "--help"],
      ["snapshot", "--max-nodes", "invalid"], ["snapshot", "--max-nodes"],
      ["--output", "json", "snapshot", "--max-nodes", "invalid"],
      ["snapshot", "--max-nodes", "invalid", "--output", "json"],
      ["click", "--text", ""], ["screenshot", "--path"],
      ["press", "--key", "INVALID"], ["--device", "", "snapshot"],
    ];
    for (const args of cases) {
      const run = (extension: string) => {
        const result = spawnSync(process.execPath, [entry(extension), ...args], {
          encoding: "utf8", timeout: 10000,
          env: { ...process.env, ANDROPERATOR_NO_DAEMON: "1", ANDROPERATOR_DISABLE_STAR_SUGGESTIONS: "1" },
        });
        assert.equal(result.error, undefined, JSON.stringify(args));
        return { stdout: result.stdout, stderr: result.stderr, status: result.status, signal: result.signal };
      };
      assert.deepEqual(run("cjs"), run("js"), JSON.stringify(args));
    }
  });
});

describe("caller environment identity", () => {
  it("uses stable ordering without depending on locale or insertion order", () => {
    const first = { z: "last", A: "first", "é": "accent", LANG: "C", EMPTY: "" };
    const reordered = Object.fromEntries(Object.entries(first).reverse());
    assert.equal(cliEnvironmentIdentity(first), cliEnvironmentIdentity(reordered));
    assert.match(cliEnvironmentIdentity(first), /^[a-f0-9]{64}$/);
    assert.notEqual(cliEnvironmentIdentity(first), cliEnvironmentIdentity({ ...first, EMPTY: undefined }));
    assert.notEqual(cliEnvironmentIdentity(first), cliEnvironmentIdentity({ ...first, LANG: "different" }));
    assert.equal(cliEnvironmentIdentity(first), cliEnvironmentIdentity({ ...first, ANDROPERATOR_RUN_ID: "run", ANDROPERATOR_LOG_DIR: "logs" }));
  });
});
