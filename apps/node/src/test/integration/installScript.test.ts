import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const repoRoot = join(packageRoot, "..", "..");
const installScript = join(repoRoot, "sites", "androperator-public", "install.sh");
const installedNodeVersion = "v24.14.1";

describe("landing install.sh Node upgrade path", () => {
  let tempRoot: string;
  let fakeBinDir: string;
  let nvmDir: string;
  let stateFile: string;
  let logFile: string;

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "androperator-install-script-"));
    fakeBinDir = join(tempRoot, "bin");
    nvmDir = join(tempRoot, ".nvm");
    stateFile = join(tempRoot, "node-version");
    logFile = join(tempRoot, "nvm.log");
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function prepareEnvironment(initialVersion: string) {
    await rm(fakeBinDir, { recursive: true, force: true });
    await rm(nvmDir, { recursive: true, force: true });
    await mkdir(fakeBinDir, { recursive: true });
    await mkdir(nvmDir, { recursive: true });
    await writeFile(stateFile, initialVersion, "utf8");
    await writeFile(logFile, "", "utf8");

    await writeFile(
      join(tempRoot, "bin", "node"),
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"-v\" ]; then",
        `  cat "${stateFile}"`,
        "  exit 0",
        "fi",
        "printf '%s\\n' \"unexpected node invocation: $*\" >&2",
        "exit 1",
      ].join("\n"),
      "utf8"
    );
    await chmod(join(tempRoot, "bin", "node"), 0o755);

    await writeFile(
      join(tempRoot, ".nvm", "nvm.sh"),
      [
        "#!/bin/sh",
        "nvm() {",
        "  printf '%s %s %s\\n' \"$1\" \"${2:-}\" \"${3:-}\" >> \"$NVM_LOG_FILE\"",
        "  case \"$1\" in",
        "    install)",
        `      printf '${installedNodeVersion}' > "${stateFile}"`,
        "      ;;",
        "    alias|use)",
        "      return 0",
        "      ;;",
        "    *)",
        "      return 0",
        "      ;;",
        "  esac",
        "}",
      ].join("\n"),
      "utf8"
    );
    await chmod(join(tempRoot, ".nvm", "nvm.sh"), 0o755);
  }

  function runCheckNode() {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const proc = spawn("bash", ["-c", `set -euo pipefail
source ${JSON.stringify(installScript)}
PATH=${JSON.stringify(`${fakeBinDir}:${process.env.PATH ?? ""}`)}
export PATH
export NVM_DIR=${JSON.stringify(nvmDir)}
export NVM_LOG_FILE=${JSON.stringify(logFile)}
check_node
`], {
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
          NVM_DIR: nvmDir,
          NVM_LOG_FILE: logFile,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("close", (code) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  }

  it("upgrades Node 23 to 24 via nvm", async () => {
    await prepareEnvironment("v23.11.0");

    const result = await runCheckNode();
    const log = await readFile(logFile, "utf8");

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Upgrading to Node\.js >= 24 via nvm/);
    assert.match(result.stdout, /Node\.js 24\.[0-9]+\.[0-9]+ installed via nvm/);
    assert.match(log, /install 24/);
    assert.match(log, /alias default 24/);
    assert.match(log, /use 24/);
  });

  it("leaves Node 24 alone", async () => {
    await prepareEnvironment("v24.0.0");

    const result = await runCheckNode();

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Node\.js 24\.0\.0 detected/);
    assert.ok(!result.stdout.includes("Upgrading to Node.js >= 24 via nvm"));
  });
});
