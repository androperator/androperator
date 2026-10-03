import { describe, it } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const cliPath = join(packageRoot, "dist", "cli", "index.js");
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: packageRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

describe("emulator CLI help and usage", () => {
  it("shows emulator help topic", async () => {
    const { stdout, code } = await runCli(["emulator", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator emulator/);
    assert.match(stdout, /emulator inspect <name>/);
    assert.match(stdout, /--storage-size <sizeG>/);
    assert.match(stdout, /provision emulator/);
  });

  it("shows usage for missing inspect name", async () => {
    const { stdout, code } = await runCli(["emulator", "inspect"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /emulator inspect <name>/);
  });

  it("shows usage for missing provision target", async () => {
    const { stdout, code } = await runCli(["provision"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /provision emulator/);
  });

  it("rejects invalid emulator storage-size units before provisioning", async () => {
    const { stdout, code } = await runCli(["emulator", "create", "--storage-size", "12000M"]);
    assert.notStrictEqual(code, 0);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.code, "USAGE");
    assert.match(parsed.message, /positive integer followed by G or GB/);
  });

  it("rejects missing emulator storage-size values", async () => {
    const { stdout, code } = await runCli(["emulator", "create", "--storage-size"]);
    assert.notStrictEqual(code, 0);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.code, "USAGE");
    assert.match(parsed.message, /--storage-size requires a value/);
  });

  it("rejects multiple emulator storage-size aliases", async () => {
    const { stdout, code } = await runCli(["emulator", "provision", "--size", "12G", "--disk-size", "16G"]);
    assert.notStrictEqual(code, 0);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.code, "USAGE");
    assert.match(parsed.message, /Use only one emulator storage size flag/);
  });
});
