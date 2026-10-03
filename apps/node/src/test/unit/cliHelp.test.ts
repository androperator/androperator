import { describe, it } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function runCli(
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cliPath = join(packageRoot, "dist", "cli", "index.js");
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: packageRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

describe("CLI help", () => {
  it("shows operator setup help for operator setup --help", async () => {
    const { stdout, code } = await runCli(["operator", "setup", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator operator setup/);
    assert.match(stdout, /--apk <path>/);
    assert.doesNotMatch(stdout, /skills compile-artifact/);
  });

  it("shows operator setup help for operator --help", async () => {
    const { stdout, code } = await runCli(["operator", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator operator setup/);
    assert.match(stdout, /--apk <path>/);
    assert.match(stdout, /androperator operator remediate/);
  });

  it("shows operator remediate help for operator remediate --help", async () => {
    const { stdout, code } = await runCli(["operator", "remediate", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator operator remediate/);
    assert.match(stdout, /doctor single-device by contract/);
    assert.match(stdout, /adb-unready devices are still reported/);
  });

  it("shows operator setup guidance for setup --help", async () => {
    const { stdout, code } = await runCli(["setup", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator operator setup/);
    assert.match(stdout, /--apk <path>/);
  });

  it("shows installer help for install --help", async () => {
    const { stdout, code } = await runCli(["install", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator install/);
    assert.match(stdout, /canonical post-bootstrap install route/);
    assert.match(stdout, /operator remediate, bundled-skills install, and host setup/);
  });

  it("rejects --device for install because remediation enumerates devices itself", async () => {
    const { stdout, code } = await runCli(["install", "--device", "serial-123"]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(code, 1);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /install does not accept --device/i);
  });

  it("shows operator setup help for operator install --help alias", async () => {
    const { stdout, code } = await runCli(["operator", "install", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator operator setup/);
    assert.match(stdout, /operator install remains a compatibility alias/);
  });

  it("falls back to top-level help for operator unknown --help", async () => {
    const { stdout, code } = await runCli(["operator", "unknown", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /Androperator CLI/);
    assert.match(stdout, /Commands:/);
    assert.doesNotMatch(stdout, /^androperator operator setup$/m);
  });

  it("returns structured guidance for bare androperator setup", async () => {
    const { stdout } = await runCli(["setup"]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /androperator operator setup/);
    assert.ok(obj.canonical);
    assert.match(obj.canonical, /operator setup/);
  });

  it("returns USAGE when operator setup is missing --apk", async () => {
    // USAGE from switch cases exits 0 per CLI convention (not a runtime error).
    const { stdout } = await runCli(["operator", "setup"]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--apk/);
  });

  it("returns USAGE when operator install alias is missing --apk", async () => {
    const { stdout } = await runCli(["operator", "install"]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--apk/);
  });

  it("returns USAGE for unknown operator subcommand", async () => {
    // USAGE from switch cases exits 0 per CLI convention (not a runtime error).
    const { stdout } = await runCli(["operator", "unknown"]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /operator setup/);
  });

  it("legacy nested `observe snapshot --help` returns unknown-command guidance", async () => {
    // Unknown command help uses the same command error as ordinary dispatch.
    const { stdout, stderr, code } = await runCli(["observe", "snapshot", "--help"]);
    assert.strictEqual(code, 1);
    assert.match(stderr || stdout, /UNKNOWN_COMMAND/);
  });

  it("legacy nested `observe screenshot --help` returns unknown-command guidance", async () => {
    // Unknown command help uses the same command error as ordinary dispatch.
    const { stdout, stderr, code } = await runCli(["observe", "screenshot", "--help"]);
    assert.strictEqual(code, 1);
    assert.match(stderr || stdout, /UNKNOWN_COMMAND/);
  });

  it("shows top-level discovery notes in help output", async () => {
    const { stdout, code } = await runCli(["--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /exec <json-or-file> \[--validate-only\]/);
    assert.match(stdout, /https:\/\/docs\.androperator\.com\/llms\.txt/);
    assert.match(stdout, /https:\/\/docs\.androperator\.com\/llms-full\.txt/);
    assert.match(stdout, /https:\/\/docs\.androperator\.com\/host-agents\//);
    assert.match(stdout, /androperator-agent-orientation/);
    assert.match(stdout, /androperator-upgrade/);
    assert.match(stdout, /bundled-skills list/);
    assert.match(stdout, /androperator-skill-author-by-agent-discovery/);
    assert.match(stdout, /androperator-skill-author-by-recording/);
    assert.match(stdout, /mcp serve/);
  });

  it("exec --help includes the raw-route orientation reminder", async () => {
    const { stdout, code } = await runCli(["exec", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /bundled-skills list/);
    assert.match(stdout, /androperator-agent-orientation/);
  });

  it("shows top-level help for help mcp serve", async () => {
    const { stdout, code } = await runCli(["help", "mcp", "serve"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /Androperator CLI/);
    assert.match(stdout, /mcp serve/);
  });

  it("shows mcp help for --help mcp serve", async () => {
    const { stdout, code } = await runCli(["--help", "mcp", "serve"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /stdio MCP server/);
    assert.match(stdout, /https:\/\/docs\.androperator\.com\/host-agents\//);
  });

  it("prints the version for --version before mcp serve", async () => {
    const { stdout, code } = await runCli(["--version", "mcp", "serve"]);
    assert.strictEqual(code, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it("returns mcp serve usage for global flags before mcp serve", async () => {
    const { stdout, code } = await runCli(["--operator-package", "com.androperator.operator.dev", "mcp", "serve"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /mcp serve is a stdio transport/);
  });

  it("rejects forwarded extra args after mcp serve", async () => {
    const { stdout, stderr, code } = await runCli(["mcp", "serve", "--", "extra"]);
    assert.notStrictEqual(code, 0);
    assert.match(stderr || stdout, /mcp serve does not accept additional arguments/);
  });

  it("exec best-effort points at flat `snapshot`, not nested `observe snapshot` (exit 0)", async () => {
    const { stdout, code } = await runCli(["exec", "best-effort", "--goal", "test-goal"]);
    assert.strictEqual(code, 0, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string; goal?: string };
    assert.strictEqual(obj.code, "NOT_IMPLEMENTED");
    assert.strictEqual(obj.goal, "test-goal");
    assert.match(obj.message ?? "", /snapshot/);
    assert.doesNotMatch(obj.message ?? "", /observe snapshot/);
  });

  it("shows bundled-skills discovery guidance", async () => {
    const { stdout, code } = await runCli(["bundled-skills", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator bundled-skills/);
    assert.match(stdout, /bundled-skills list/);
    assert.match(stdout, /androperator-agent-orientation/);
    assert.match(stdout, /androperator-upgrade/);
    assert.match(stdout, /androperator-skill-author-by-agent-discovery/);
    assert.match(stdout, /androperator-skill-author-by-recording/);
    assert.match(stdout, /https:\/\/docs\.androperator\.com\/skills\/authoring\//);
  });

  it("rejects the removed agent-skills command surface", async () => {
    const { stdout, stderr, code } = await runCli(["agent-skills", "--help"]);
    assert.notStrictEqual(code, 0);
    assert.match(stderr || stdout, /Unknown command: agent-skills/);
  });

  it("rejects the removed agent-skills command surface outside the help path", async () => {
    const bare = await runCli(["agent-skills"]);
    assert.notStrictEqual(bare.code, 0);
    assert.match(bare.stderr || bare.stdout, /Unknown command: agent-skills/);

    const list = await runCli(["agent-skills", "list"]);
    assert.notStrictEqual(list.code, 0);
    assert.match(list.stderr || list.stdout, /Unknown command: agent-skills/);
  });

  it("shows host setup help", async () => {
    const { stdout, code } = await runCli(["host", "setup", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator host/);
    assert.match(stdout, /host setup/);
    assert.match(stdout, /install-state JSON/);
    assert.match(stdout, /shared-agent bridge/);
  });

  it("returns USAGE for the removed host materialize-artifacts alias", async () => {
    const { stdout } = await runCli(["host", "materialize-artifacts"]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /androperator host setup/);
  });

  it("returns USAGE when host setup --installed-at is missing its value", async () => {
    const { stdout, code } = await runCli(["host", "setup", "--installed-at"]);
    assert.strictEqual(code, 1);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--installed-at requires a value/);
  });

  it("returns USAGE when host setup --cli-version is followed by another host flag", async () => {
    const { stdout, code } = await runCli(["host", "setup", "--cli-version", "--apk-version", "1.2.3"]);
    assert.strictEqual(code, 1);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--cli-version requires a value/);
  });

  it("inspect ui --help returns unknown-command guidance", async () => {
    // inspect ui is removed; --help with an unknown command falls back to top-level help.
    const { stdout, stderr, code } = await runCli(["inspect", "ui", "--help"]);
    assert.strictEqual(code, 1);
    assert.match(stderr || stdout, /UNKNOWN_COMMAND/);
  });

  it("forwards invalid timeout to EXECUTION_VALIDATION_FAILED", async () => {
    const { stdout, code } = await runCli(["snapshot", "--timeout", "nope"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /EXECUTION_VALIDATION_FAILED/);
    assert.match(stdout, /timeoutMs must be a finite number/);
  });

  it("returns usage when timeout value is missing", async () => {
    const { stdout, code } = await runCli(["inspect", "ui", "--timeout-ms"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--timeout requires a value/);
  });

  it("accepts --format as an alias for --output", async () => {
    const jsonResult = await runCli(["snapshot", "--timeout", "nope", "--format", "json"]);
    assert.notStrictEqual(jsonResult.code, 0);
    const json = JSON.parse(jsonResult.stdout);
    assert.strictEqual(json.code, "EXECUTION_VALIDATION_FAILED");
    assert.strictEqual(json.message, "timeoutMs must be a finite number");

    const prettyResult = await runCli(["snapshot", "--timeout", "nope", "--format", "pretty"]);
    assert.notStrictEqual(prettyResult.code, 0);
    const pretty = JSON.parse(prettyResult.stdout);
    assert.strictEqual(pretty.code, "EXECUTION_VALIDATION_FAILED");
    assert.strictEqual(pretty.message, "timeoutMs must be a finite number");
  });

  it("lists --json as an alias under Global options in top-level help", async () => {
    const { stdout, code } = await runCli(["--help"]);
    assert.strictEqual(code, 0);
    const globalIdx = stdout.indexOf("Global options:\n");
    assert.notStrictEqual(globalIdx, -1, "expected Global options section");
    const notesIdx = stdout.indexOf("\n\nNotes:", globalIdx);
    const globalBlock =
      notesIdx === -1 ? stdout.slice(globalIdx) : stdout.slice(globalIdx, notesIdx);
    assert.match(
      globalBlock,
      /\n  --json\s+Alias for --output json/,
      "expected --json as an indented alias line",
    );
    assert.match(globalBlock, /--output <json\|pretty>\s+Output format \(default: json\)/);
    assert.ok(
      globalBlock.indexOf("--output <json|pretty>") < globalBlock.indexOf("--json"),
      "expected preferred --output form to appear before the alias",
    );
  });

  it("shows common device actions without requiring --json in top-level help", async () => {
    const { stdout, code } = await runCli(["--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /snapshot \[--device <id>\] \[--operator-package <pkg>\]/);
    assert.match(stdout, /read --text <text> \| --id <id> \| --role <role> \[--device <id>\] \[--operator-package <pkg>\]/);
    assert.doesNotMatch(stdout, /snapshot .*--json/);
    assert.doesNotMatch(stdout, /read --text .*--json/);
  });

  it("shows recording as canonical command in top-level help", async () => {
    const { stdout, code } = await runCli(["--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /recording start/);
    assert.match(stdout, /recording stop/);
    assert.match(stdout, /recording pull/);
    assert.match(stdout, /recording parse/);
    assert.match(stdout, /recording export/);
    assert.doesNotMatch(stdout, /recording compare/);
    assert.match(stdout, /'record' is an alias/);
  });

  it("returns USAGE for bare recording command", async () => {
    const { stdout, code } = await runCli(["recording"]);
    assert.strictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /recording start\|stop\|pull\|parse\|export/);
    assert.match(obj.message, /'record' is an alias/);
  });

  it("returns USAGE for bare record alias", async () => {
    const { stdout, code } = await runCli(["record"]);
    assert.strictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /recording start\|stop\|pull\|parse\|export/);
    assert.match(obj.message, /'record' is an alias/);
  });

  it("returns USAGE for recording parse without --input", async () => {
    const { stdout, code } = await runCli(["recording", "parse"]);
    assert.strictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--input/);
  });

  it("returns USAGE for recording export without --input", async () => {
    const { stdout, code } = await runCli(["recording", "export"]);
    assert.strictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /recording export --input <file\|directory>/);
  });

  it("returns USAGE when --input is followed by another flag for recording export", async () => {
    const { stdout, code } = await runCli(["recording", "export", "--input", "--out", "/tmp/demo.export.json"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--input requires a value/);
  });

  it("returns USAGE when --input is followed by an unknown flag for recording export", async () => {
    const { stdout, code } = await runCli(["recording", "export", "--input", "--bogus"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /Use '--input -- <literal>'/);
  });

  it("returns USAGE when --input is followed by another flag for recording parse", async () => {
    const { stdout, code } = await runCli(["recording", "parse", "--input", "--out", "/tmp/demo.steps.json"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--input requires a value/);
  });

  it("returns USAGE when --snapshots is missing a value for recording export", async () => {
    const { stdout, code } = await runCli(["recording", "export", "--input", "/tmp/demo.ndjson", "--snapshots"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--snapshots requires a value/);
  });

  it("returns USAGE when --snapshots has an invalid value for record export", async () => {
    const { stdout, code } = await runCli(["record", "export", "--input", "/tmp/demo.ndjson", "--snapshots", "foo"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /omit, include/);
  });

  it("returns USAGE for record parse without --input", async () => {
    const { stdout, code } = await runCli(["record", "parse"]);
    assert.strictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--input/);
  });

  it("returns USAGE when --out flag has no value for recording pull", async () => {
    const { stdout, code } = await runCli(["recording", "pull", "--out"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--out requires a value/);
  });

  it("returns USAGE when --out is followed by another flag for recording pull", async () => {
    const { stdout, code } = await runCli(["recording", "pull", "--out", "--session-id", "abc"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--out requires a value/);
  });

  it("recording export accepts a dash-prefixed input path", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-recording-dash-input-"));
    const inputFile = join(tempRoot, "-context.ndjson");
    await mkdir(tempRoot, { recursive: true });
    await writeFile(
      inputFile,
      [
        JSON.stringify({
          type: "recording_header",
          schemaVersion: 1,
          sessionId: "dash-input",
          startedAt: 1710000000000,
          operatorPackage: "com.androperator.operator.dev",
        }),
        JSON.stringify({
          ts: 1710000000100,
          seq: 0,
          type: "window_change",
          packageName: "com.example.a",
          className: "MainActivity",
          title: "Home",
          snapshot: "<window />",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const { stdout, code } = await runCli(["recording", "export", "--input", inputFile]);

      assert.strictEqual(code, 0, stdout);
      const output = join(tempRoot, "-context.export.json");
      await stat(output);
      const obj = JSON.parse(stdout) as { outputFile?: string };
      assert.strictEqual(obj.outputFile, output);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("recording export accepts an escaped double-dash input path", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-recording-double-dash-input-"));
    const inputFile = join(tempRoot, "--context.ndjson");
    await mkdir(tempRoot, { recursive: true });
    await writeFile(
      inputFile,
      [
        JSON.stringify({
          type: "recording_header",
          schemaVersion: 1,
          sessionId: "double-dash-input",
          startedAt: 1710000000000,
          operatorPackage: "com.androperator.operator.dev",
        }),
        JSON.stringify({
          ts: 1710000000100,
          seq: 0,
          type: "window_change",
          packageName: "com.example.a",
          className: "MainActivity",
          title: "Home",
          snapshot: "<window />",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const { stdout, code } = await runCli(["recording", "export", "--input", "--", inputFile]);

      assert.strictEqual(code, 0, stdout);
      const output = join(tempRoot, "--context.export.json");
      await stat(output);
      const obj = JSON.parse(stdout) as { outputFile?: string };
      assert.strictEqual(obj.outputFile, output);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("still rejects unknown flags after an escaped double-dash input path", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "androperator-recording-double-dash-input-unknown-"));
    const inputFile = join(tempRoot, "--context.ndjson");
    await mkdir(tempRoot, { recursive: true });
    await writeFile(
      inputFile,
      [
        JSON.stringify({
          type: "recording_header",
          schemaVersion: 1,
          sessionId: "double-dash-input",
          startedAt: 1710000000000,
          operatorPackage: "com.androperator.operator.dev",
        }),
        JSON.stringify({
          ts: 1710000000100,
          seq: 0,
          type: "window_change",
          packageName: "com.example.a",
          className: "MainActivity",
          title: "Home",
          snapshot: "<window />",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const { stdout, code } = await runCli(["recording", "export", "--input", "--", inputFile, "--bogus"]);

      assert.notStrictEqual(code, 0);
      assert.match(stdout, /"code":"USAGE"/);
      assert.match(stdout, /unrecognized flag '--bogus'/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns USAGE when --out flag has no value for record pull", async () => {
    const { stdout, code } = await runCli(["record", "pull", "--out"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--out requires a value/);
  });
});

describe("operator setup CLI output", () => {
  const NONEXISTENT_APK = "/nonexistent/androperator-test-operator.apk";

  it("returns OPERATOR_APK_NOT_FOUND with exit code 1 when APK path does not exist", async () => {
    const { stdout, code } = await runCli(["operator", "setup", "--apk", NONEXISTENT_APK]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "OPERATOR_APK_NOT_FOUND");
    assert.ok(obj.message, "error message should be present");
  });

  it("includes install.ok: false in output on APK not found", async () => {
    const { stdout } = await runCli(["operator", "setup", "--apk", NONEXISTENT_APK]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.install?.ok, false);
  });

  it("passes --operator-package through to output on failure", async () => {
    const { stdout } = await runCli([
      "operator", "setup",
      "--apk", NONEXISTENT_APK,
      "--operator-package", "com.androperator.operator.dev",
    ]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.operatorPackage, "com.androperator.operator.dev");
  });

  it("accepts --operator-package as alias for --operator-package", async () => {
    const { stdout } = await runCli([
      "operator", "setup",
      "--apk", NONEXISTENT_APK,
      "--operator-package", "com.androperator.operator.dev",
    ]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.operatorPackage, "com.androperator.operator.dev");
  });

  it("uses ANDROPERATOR_OPERATOR_PACKAGE env var when --operator-package is omitted", async () => {
    const { stdout } = await runCli(
      ["operator", "setup", "--apk", NONEXISTENT_APK],
      { ANDROPERATOR_OPERATOR_PACKAGE: "com.androperator.operator.dev" }
    );
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.operatorPackage, "com.androperator.operator.dev");
  });

  it("treats blank ANDROPERATOR_OPERATOR_PACKAGE as unset for operator setup", async () => {
    const { stdout } = await runCli(
      ["operator", "setup", "--apk", NONEXISTENT_APK],
      { ANDROPERATOR_OPERATOR_PACKAGE: "   " }
    );
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.operatorPackage, "com.androperator.operator");
  });

  it("operator install alias still returns OPERATOR_APK_NOT_FOUND", async () => {
    const { stdout, code } = await runCli(["operator", "install", "--apk", NONEXISTENT_APK]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "OPERATOR_APK_NOT_FOUND");
  });

  it("--output pretty still produces parseable JSON on failure", async () => {
    const { stdout, code } = await runCli([
      "operator", "setup",
      "--apk", NONEXISTENT_APK,
      "--output", "pretty",
    ]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "OPERATOR_APK_NOT_FOUND");
  });

  it("nested `observe screenshot` returns UNKNOWN_COMMAND redirect to `screenshot`", async () => {
    // Nested observe is removed; any invocation (including with flags) gets the migration message.
    const { stdout, code } = await runCli(["observe", "screenshot", "--path"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string; suggestion?: string };
    assert.strictEqual(obj.code, "UNKNOWN_COMMAND");
    assert.match(obj.message ?? "", /'observe screenshot' has been removed/);
    assert.strictEqual(obj.suggestion, "screenshot");
  });

  it("nested `action click` returns UNKNOWN_COMMAND redirect to `click`", async () => {
    const { stdout, code } = await runCli(["action", "click", "--selector"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string; suggestion?: string };
    assert.strictEqual(obj.code, "UNKNOWN_COMMAND");
    assert.match(obj.message ?? "", /'action click' has been removed/);
    assert.match(obj.message ?? "", /Use 'click' instead/);
    assert.strictEqual(obj.suggestion, "click");
  });
});

describe("promoted flat commands - help and missing-arg errors", () => {
  it("snapshot --help shows snapshot help", async () => {
    const { stdout, code } = await runCli(["snapshot", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator snapshot/);
    assert.match(stdout, /--output <json\|pretty>\s+Output format \(default: json\)/);
    assert.match(stdout, /--timeout <ms>/);
    assert.match(stdout, /bundled-skills list/);
    assert.match(stdout, /androperator-agent-orientation/);
    assert.doesNotMatch(stdout, /--json\s+JSON output/);
    assert.doesNotMatch(stdout, /--file/);
  });

  it("screenshot --help shows screenshot help", async () => {
    const { stdout, code } = await runCli(["screenshot", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator screenshot/);
    assert.match(stdout, /--path <file>/);
    assert.match(stdout, /Also accepted as: --device-id, --file/);
  });

  it("click --help shows click help", async () => {
    const { stdout, code } = await runCli(["click", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator click/);
    assert.match(stdout, /--selector/);
    assert.match(stdout, /--output <json\|pretty>\s+Output format \(default: json\)/);
    assert.doesNotMatch(stdout, /--json\s+JSON output/);
  });

  it("click with no selector returns MISSING_SELECTOR with exit code 1", async () => {
    const { stdout, code } = await runCli(["click"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_SELECTOR");
    assert.match(obj.message ?? "", /click requires a selector/);
  });

  it("click --coordinate with invalid values returns EXECUTION_VALIDATION_FAILED with exit 1", async () => {
    const { stdout, code } = await runCli(["click", "--coordinate", "100", "pagedown"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /--coordinate requires two non-negative integers/);
  });

  it("click rejects repeated --coordinate flags with exit 1", async () => {
    const { stdout, code } = await runCli(["click", "--coordinate", "10", "20", "--coordinate", "30", "40"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /--coordinate must not appear more than once/);
  });

  it("click --coordinate with negative coordinates returns EXECUTION_VALIDATION_FAILED with exit 1", async () => {
    const { stdout, code } = await runCli(["click", "--coordinate", "-10", "20"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /--coordinate requires two non-negative integers/);
  });

  it("click --coordinate with fractional coordinates returns EXECUTION_VALIDATION_FAILED with exit 1", async () => {
    const { stdout, code } = await runCli(["click", "--coordinate", "10.5", "20"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /--coordinate requires two non-negative integers/);
  });

  it("click --coordinate rejects mixing with text selector (exit 1)", async () => {
    const { stdout, code } = await runCli(["click", "--coordinate", "100", "200", "--text", "Login"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /use --coordinate OR a selector, not both/);
  });

  it("click rejects unsupported execution flags like --all (exit 1)", async () => {
    const { stdout, code } = await runCli(["click", "--text", "Wi-Fi", "--all"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message ?? "", /unrecognized flag '--all'/);
  });

  it("click rejects dry-run-style execution flags (exit 1)", async () => {
    const dryRunResult = await runCli(["click", "--text", "Wi-Fi", "--dry-run"]);
    assert.strictEqual(dryRunResult.code, 1, dryRunResult.stdout);
    const dryRunObj = JSON.parse(dryRunResult.stdout) as { code?: string; message?: string };
    assert.strictEqual(dryRunObj.code, "USAGE");
    assert.match(dryRunObj.message ?? "", /unrecognized flag '--dry-run'/);

    const validateOnlyResult = await runCli(["click", "--text", "Wi-Fi", "--validate-only"]);
    assert.strictEqual(validateOnlyResult.code, 1, validateOnlyResult.stdout);
    const validateOnlyObj = JSON.parse(validateOnlyResult.stdout) as { code?: string; message?: string };
    assert.strictEqual(validateOnlyObj.code, "USAGE");
    assert.match(validateOnlyObj.message ?? "", /unrecognized flag '--validate-only'/);
  });

  it("snapshot rejects dry-run flags instead of executing", async () => {
    const { stdout, code } = await runCli(["snapshot", "--dry-run"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message ?? "", /unrecognized flag '--dry-run'/);
  });

  it("scroll-until accepts --direction as an alias for the positional direction", async () => {
    const { stdout } = await runCli(["scroll-until", "--direction", "up", "--text", "Settings", "--device", "test-device"]);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.notStrictEqual(obj.code, "USAGE");
    assert.doesNotMatch(obj.message ?? "", /unrecognized flag '--direction'/);
  });

  it("open accepts --app without unknown-flag rejection", async () => {
    const { stdout, code } = await runCli(["open", "--app"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.doesNotMatch(obj.message ?? "", /unrecognized flag/);
  });

  it("close accepts --app without unknown-flag rejection", async () => {
    const { stdout, code } = await runCli(["close", "--app"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.doesNotMatch(obj.message ?? "", /unrecognized flag/);
  });

  it("close rejects dry-run flags instead of force-stopping the app", async () => {
    const { stdout, code } = await runCli(["close", "com.android.settings", "--dry-run"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message ?? "", /unrecognized flag '--dry-run'/);
  });

  it("close rejects typoed dash-prefixed arguments instead of swallowing them", async () => {
    const { stdout, code } = await runCli(["close", "--ap"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message ?? "", /unrecognized flag '--ap'/);
  });

  it("exec best-effort accepts --goal without unknown-flag rejection", async () => {
    const { stdout, code } = await runCli(["exec", "best-effort", "--goal", "wifi settings"]);
    assert.strictEqual(code, 0, stdout);
    const obj = JSON.parse(stdout) as { code?: string; goal?: string; message?: string };
    assert.strictEqual(obj.code, "NOT_IMPLEMENTED");
    assert.strictEqual(obj.goal, "wifi settings");
    assert.doesNotMatch(obj.message ?? "", /unrecognized flag/);
  });

  it("exec rejects --goal for normal payload execution", async () => {
    const { stdout, code } = await runCli(["exec", "--goal", "wifi"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message ?? "", /unrecognized flag '--goal'/);
  });

  it("execute synonym also rejects --goal for normal payload execution", async () => {
    const { stdout, code } = await runCli(["execute", "--goal", "wifi"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message ?? "", /unrecognized flag '--goal'/);
  });

  it("exec rejects typoed dash-prefixed flags before treating them as payloads", async () => {
    const { stdout, code } = await runCli(["exec", "--goa", "wifi"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message ?? "", /unrecognized flag '--goa'/);
  });

  it("exec validate-only accepts a dash-prefixed payload path", async () => {
    const payloadPath = join(packageRoot, "--plan-payload.json");
    await writeFile(
      payloadPath,
      JSON.stringify({
        commandId: "cmd-plan",
        taskId: "task-plan",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 5000,
        actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 0 } }],
      }),
    );

    try {
      const { stdout, code } = await runCli(["exec", "--validate-only", "--payload", "--plan-payload.json"]);
      assert.strictEqual(code, 0, stdout);
      const obj = JSON.parse(stdout) as { ok?: boolean; validated?: boolean; message?: string };
      assert.strictEqual(obj.ok, true);
      assert.strictEqual(obj.validated, true);
      assert.doesNotMatch(obj.message ?? "", /unrecognized flag/);
    } finally {
      await rm(payloadPath, { force: true });
    }
  });

  it("exec validate-only accepts a dash-prefixed positional payload path", async () => {
    const payloadPath = join(packageRoot, "--plan-positional.json");
    await writeFile(
      payloadPath,
      JSON.stringify({
        commandId: "cmd-plan-positional",
        taskId: "task-plan-positional",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 5000,
        actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 0 } }],
      }),
    );

    try {
      const { stdout, code } = await runCli(["exec", "--validate-only", "--plan-positional.json"]);
      assert.strictEqual(code, 0, stdout);
      const obj = JSON.parse(stdout) as { ok?: boolean; validated?: boolean; message?: string };
      assert.strictEqual(obj.ok, true);
      assert.strictEqual(obj.validated, true);
      assert.doesNotMatch(obj.message ?? "", /unrecognized flag/);
    } finally {
      await rm(payloadPath, { force: true });
    }
  });

  it("recording pull accepts --out without unknown-flag rejection", async () => {
    const { stdout, code } = await runCli(["recording", "pull", "--out"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message ?? "", /--out requires a value/);
    assert.doesNotMatch(obj.message ?? "", /unrecognized flag/);
  });

  it("open --help shows open help", async () => {
    const { stdout, code } = await runCli(["open", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator open/);
    assert.match(stdout, /package-id/);
    assert.match(stdout, /--navigation-timeout-ms/);
    assert.match(stdout, /--skip-navigation-wait/);
  });

  it("open with no target returns MISSING_ARGUMENT with exit code 1", async () => {
    const { stdout, code } = await runCli(["open"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.match(obj.message ?? "", /open requires a target/);
    assert.match(obj.message ?? "", /com.android.settings/);
    assert.match(obj.message ?? "", /https:\/\/example.com/);
  });

  it("press --help shows press help", async () => {
    const { stdout, code } = await runCli(["press", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator press/);
    assert.match(stdout, /back/);
  });

  it("press with no key returns MISSING_ARGUMENT with exit code 1", async () => {
    const { stdout, code } = await runCli(["press"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.match(obj.message ?? "", /press requires a key/);
    assert.match(obj.message ?? "", /back/);
  });

  it("scroll --help shows scroll help", async () => {
    const { stdout, code } = await runCli(["scroll", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /androperator scroll/);
    assert.match(stdout, /down/);
  });

  it("scroll with no direction returns MISSING_ARGUMENT with exit code 1", async () => {
    const { stdout, code } = await runCli(["scroll"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.match(obj.message ?? "", /scroll requires a direction/);
  });

  it("scroll with invalid direction returns MISSING_ARGUMENT with exit code 1", async () => {
    const { stdout, code } = await runCli(["scroll", "sideways"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.match(obj.message ?? "", /scroll requires a direction/);
  });

  it("type with no selector returns MISSING_SELECTOR with exit code 1", async () => {
    const { stdout, code } = await runCli(["type", "hello"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_SELECTOR");
    assert.match(obj.message ?? "", /type requires a selector/);
  });

  it("read with no selector returns MISSING_SELECTOR with exit code 1", async () => {
    const { stdout, code } = await runCli(["read"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_SELECTOR");
    assert.match(obj.message ?? "", /read requires a selector/);
  });

  it("wait with no selector returns MISSING_SELECTOR with exit code 1", async () => {
    const { stdout, code } = await runCli(["wait"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_SELECTOR");
    assert.match(obj.message ?? "", /wait requires a selector/);
  });

  it("screenshot --path with missing value returns USAGE with exit code 1", async () => {
    const { stdout, code } = await runCli(["screenshot", "--path"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.strictEqual(obj.message, "--path requires a value");
  });

  it("tap synonym dispatches to click handler (missing selector returns MISSING_SELECTOR)", async () => {
    const { stdout, code } = await runCli(["tap"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "MISSING_SELECTOR");
    assert.match(obj.message ?? "", /click requires a selector/);
  });

  it("type rejects positional text together with --text (exit 1)", async () => {
    const { stdout, code } = await runCli([
      "type",
      "hello",
      "--text",
      "world",
      "--selector",
      "{}",
    ]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /not both/);
  });

  it("press rejects positional key together with --key (exit 1)", async () => {
    const { stdout, code } = await runCli(["press", "back", "--key", "home"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /not both/);
  });

  it("scroll rejects positional direction together with --direction (exit 1)", async () => {
    const { stdout, code } = await runCli(["scroll", "down", "--direction", "up"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /not both/);
  });

  it("open rejects positional target together with --app (exit 1)", async () => {
    const { stdout, code } = await runCli(["open", "com.android.settings", "--app", "com.example.foo"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message ?? "", /not both/);
  });
});
