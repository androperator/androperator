import { describe, it } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMANDS,
  levenshtein,
  didYouMean,
  barePositionalTokens,
  isOpenCliUriTarget,
  getStringOptStrict,
  resolveSupportedFlagsFromRegistry,
} from "../../cli/registry.js";

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

describe("COMMANDS registry consistency", () => {
  it("every command has non-empty name, summary, help, and group", () => {
    for (const [key, def] of Object.entries(COMMANDS)) {
      assert.ok(def.name, `${key}: name must be non-empty`);
      assert.ok(def.summary, `${key}: summary must be non-empty`);
      assert.ok(def.help, `${key}: help must be non-empty`);
      assert.ok(def.group, `${key}: group must be non-empty`);
    }
  });

  it("every command has a handler that is a function", () => {
    for (const [key, def] of Object.entries(COMMANDS)) {
      assert.strictEqual(typeof def.handler, "function", `${key}: handler must be a function`);
    }
  });

  it("no synonym appears twice across all commands", () => {
    const seenSynonyms = new Map<string, string>();
    for (const def of Object.values(COMMANDS)) {
      for (const syn of def.synonyms ?? []) {
        const existing = seenSynonyms.get(syn);
        assert.ok(!existing, `Synonym '${syn}' appears in both '${existing}' and '${def.name}'`);
        seenSynonyms.set(syn, def.name);
      }
    }
  });

  it("no primary command name appears as another command's synonym", () => {
    const primaryNames = new Set(Object.values(COMMANDS).map((d) => d.name));
    for (const def of Object.values(COMMANDS)) {
      for (const syn of def.synonyms ?? []) {
        assert.ok(
          !primaryNames.has(syn),
          `Synonym '${syn}' of '${def.name}' is also a primary command name`
        );
      }
    }
  });
});

describe("isOpenCliUriTarget", () => {
  it("returns true for http(s) and custom schemes", () => {
    assert.strictEqual(isOpenCliUriTarget("https://example.com"), true);
    assert.strictEqual(isOpenCliUriTarget("http://example.com"), true);
    assert.strictEqual(isOpenCliUriTarget("myapp://path"), true);
  });

  it("returns false for Android package ids and bare hosts", () => {
    assert.strictEqual(isOpenCliUriTarget("com.android.settings"), false);
    assert.strictEqual(isOpenCliUriTarget("example.com"), false);
  });
});

describe("barePositionalTokens", () => {
  it("skips flag values and boolean flags", () => {
    assert.deepStrictEqual(
      barePositionalTokens(["hello", "--selector", "{}", "--text", "x"], ["--selector", "--text"], ["--submit"]),
      ["hello"],
    );
    assert.deepStrictEqual(
      barePositionalTokens(["--selector", "{}", "hello", "--submit"], ["--selector", "--text"], ["--submit"]),
      ["hello"],
    );
  });
});

describe("getStringOptStrict", () => {
  it("rejects double-dash tokens as missing values", () => {
    assert.throws(
      () => getStringOptStrict(["--input", "--bogus"], "--input"),
      /Use '--input -- <literal>'/
    );
  });

  it("allows dash-prefixed path values", () => {
    assert.strictEqual(getStringOptStrict(["--input", "-context.ndjson"], "--input"), "-context.ndjson");
  });

  it("accepts escaped double-dash literals", () => {
    assert.strictEqual(
      getStringOptStrict(["--summary", "--", "--literal"], "--summary", ["--summary"]),
      "--literal",
    );
  });
});

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    assert.strictEqual(levenshtein("observe", "observe"), 0);
  });

  it("returns correct distance for similar strings", () => {
    assert.strictEqual(levenshtein("observe", "observ"), 1);
    assert.strictEqual(levenshtein("recrd", "record"), 1);
  });
});

describe("flag aliases - --device works like --device-id", () => {
  it("--device alias passes device id (validated via timeout error output)", async () => {
    // Use --timeout nope which produces EXECUTION_VALIDATION_FAILED. The device alias is consumed
    // by getGlobalOpts, so the command should still run and fail on the timeout.
    const { stdout, code } = await runCli(["--device", "test-device-alias", "snapshot", "--timeout", "nope"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /EXECUTION_VALIDATION_FAILED/);
    assert.match(stdout, /timeoutMs must be a finite number/);
  });
});

describe("flag aliases - --json sets output to json", () => {
  it("--json flag is consumed without error and output remains json", async () => {
    // operator setup without --apk returns USAGE JSON regardless of format
    const { stdout } = await runCli(["--json", "operator", "setup"]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--apk/);
  });
});

describe("flag aliases - --output selects output format", () => {
  it("--output json is consumed without error and output remains json", async () => {
    const { stdout, code } = await runCli(["doctor", "--output", "json", "--check-only"]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(typeof obj.criticalOk, "boolean");
    assert.strictEqual(code, obj.criticalOk ? 0 : 1, stdout);
  });

  it("--output with an invalid value produces USAGE error with exit code 1", async () => {
    const { stdout, code } = await runCli(["doctor", "--output", "xml"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--output must be one of: json, pretty/);
  });

  it("--output without a value produces USAGE error with exit code 1", async () => {
    const { stdout, code } = await runCli(["doctor", "--output"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--output requires a value: json or pretty/);
  });

  it("--format with an invalid value produces the same USAGE error as --output", async () => {
    const { stdout, code } = await runCli(["doctor", "--format", "xml"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--output must be one of: json, pretty/);
  });
});

describe("operator download registry", () => {
  it("dispatches operator download and preserves structured errors", async () => {
    const { stdout, code } = await runCli([
      "operator",
      "download",
      "--operator-package",
      "com.androperator.operator.dev",
    ]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "OPERATOR_DOWNLOAD_UNSUPPORTED");
    assert.match(obj.message, /Automatic operator download is only available/);
  });
});

describe("missing command after global flags", () => {
  it("returns USAGE instead of crashing when only global flags are supplied", async () => {
    const { stdout, code } = await runCli(["--json"]);
    assert.strictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--help/);
  });
});

describe("flag aliases - --timeout works like --timeout-ms", () => {
  it("--timeout nope produces EXECUTION_VALIDATION_FAILED", async () => {
    const { stdout, code } = await runCli(["snapshot", "--timeout", "nope"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /EXECUTION_VALIDATION_FAILED/);
    assert.match(stdout, /timeoutMs must be a finite number/);
  });

  it("--timeout without value produces USAGE error with exit code 1", async () => {
    const { stdout, code } = await runCli(["--timeout"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /USAGE/);
    assert.match(stdout, /--timeout requires a value/);
  });
});

describe("flag aliases - --operator-package works as alias for --operator-package", () => {
  it("--operator-package is accepted by getGlobalOpts (passed through to operator setup failure)", async () => {
    const { stdout } = await runCli([
      "--operator-package", "com.androperator.operator.dev",
      "operator", "setup",
      "--apk", "/nonexistent/test.apk",
    ]);
    const obj = JSON.parse(stdout);
    // Should fail with OPERATOR_APK_NOT_FOUND and echo back the operatorPackage
    assert.strictEqual(obj.operatorPackage, "com.androperator.operator.dev");
  });

  it("--operator-package missing value produces USAGE error with exit code 1", async () => {
    const { stdout, code } = await runCli(["--operator-package"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--operator-package requires a value/);
  });

  it("--operator-package blank value produces USAGE error with exit code 1", async () => {
    const { stdout, code } = await runCli(["--operator-package", ""]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--operator-package requires a value/);
  });

  it("--receiver-package missing value produces USAGE error with exit code 1", async () => {
    const { stdout, code } = await runCli(["--receiver-package"]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--operator-package requires a value/);
  });

  it("--receiver-package blank value produces USAGE error with exit code 1", async () => {
    const { stdout, code } = await runCli(["--receiver-package", ""]);
    assert.strictEqual(code, 1, stdout);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "USAGE");
    assert.match(obj.message, /--operator-package requires a value/);
  });

  it("--receiver-package is accepted and passed through to operator setup failure", async () => {
    const { stdout } = await runCli([
      "--receiver-package", "com.androperator.operator.dev",
      "operator", "setup",
      "--apk", "/nonexistent/test.apk",
    ]);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.operatorPackage, "com.androperator.operator.dev");
  });
});

describe("unknown command produces UNKNOWN_COMMAND", () => {
  it("completely unknown command returns UNKNOWN_COMMAND with exit code 1", async () => {
    const { stdout, code } = await runCli(["totally-unknown-command"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "UNKNOWN_COMMAND");
    assert.match(obj.message, /Unknown command: totally-unknown-command/);
  });

  it("typo close to a real command includes did-you-mean suggestion", async () => {
    // levenshtein("recrod", "record") = 1; threshold = max(2, floor(6/2)) = 3.
    // The suggestion always fires for this input - assert it explicitly.
    const { stdout, code } = await runCli(["recrod"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout) as { code?: string; message?: string; suggestion?: string };
    assert.strictEqual(obj.code, "UNKNOWN_COMMAND");
    assert.match(obj.message ?? "", /Unknown command: recrod/);
    assert.strictEqual(obj.suggestion, "record");
  });
});

describe("record synonym dispatches to recording handler", () => {
  it("record with no subcommand returns USAGE (not UNKNOWN_COMMAND)", async () => {
    // Proves the synonym resolves to the recording handler rather than being
    // treated as an unknown command.
    const { stdout } = await runCli(["record"]);
    const obj = JSON.parse(stdout) as { code?: string };
    assert.strictEqual(obj.code, "USAGE");
    assert.notStrictEqual(obj.code, "UNKNOWN_COMMAND");
  });

  it("record --help resolves to recording help text", async () => {
    const { stdout, code } = await runCli(["record", "--help"]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /recording start/);
  });

  it("recording export exposes the expected supported flags", () => {
    assert.deepStrictEqual(
      resolveSupportedFlagsFromRegistry(COMMANDS.recording, ["export"]),
      ["--input", "--out", "--snapshots"],
    );
  });

  it("emulator create exposes storage-size aliases", () => {
    assert.deepStrictEqual(
      resolveSupportedFlagsFromRegistry(COMMANDS.emulator, ["create"]),
      ["--name", "--storage-size", "--size", "--disk-size", "--data-partition-size"],
    );
  });

  it("emulator provision exposes storage-size aliases", () => {
    assert.deepStrictEqual(
      resolveSupportedFlagsFromRegistry(COMMANDS.emulator, ["provision"]),
      ["--storage-size", "--size", "--disk-size", "--data-partition-size"],
    );
    assert.deepStrictEqual(
      resolveSupportedFlagsFromRegistry(COMMANDS.provision, ["emulator"]),
      ["--storage-size", "--size", "--disk-size", "--data-partition-size"],
    );
  });
});

describe("agent-oriented command aliases", () => {
  it("open_app resolves to the open handler", async () => {
    const { stdout, code } = await runCli(["open_app"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.match(obj.message, /open requires a target/);
  });

  it("close_app resolves to the close handler", async () => {
    const { stdout, code } = await runCli(["close_app"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.match(obj.message, /close requires a package name/);
  });

  it("wait_for_navigation resolves to the wait-for-nav handler", async () => {
    const { stdout, code } = await runCli(["wait_for_navigation", "--json"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.match(obj.message, /wait-for-nav requires --timeout <ms>/);
  });
});

describe("agent-oriented flag aliases", () => {
  it("open accepts --package as an alias for --app", async () => {
    const { stdout, code } = await runCli(["open", "--package", "com.example.app", "com.example.other"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /positional argument or via --app, not both/);
  });

  it("open exposes --skip-navigation-wait as a supported flag", () => {
    assert.deepStrictEqual(
      resolveSupportedFlagsFromRegistry(COMMANDS.open, []),
      ["--app", "--navigation-timeout-ms", "--skip-navigation-wait", "--no-daemon"],
    );
  });

  it("open rejects --skip-navigation-wait for URI targets", async () => {
    const { stdout, code } = await runCli(["open", "https://example.com", "--skip-navigation-wait"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message, /--skip-navigation-wait only applies to package targets/);
  });

  it("open rejects --navigation-timeout-ms for URI targets", async () => {
    const { stdout, code } = await runCli(["open", "https://example.com", "--navigation-timeout-ms", "22000"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message, /--navigation-timeout-ms only applies to package targets/);
  });

  it("click accepts --resource-id selector aliases", async () => {
    const { stdout, code } = await runCli(["click", "--resource-id", "com.example:id/login", "--selector", '{"textEquals":"Login"}', "--json"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /use --selector OR the simple flags, not both/);
  });

  it("scroll accepts --container-resource-id aliases", async () => {
    const { stdout, code } = await runCli(["scroll", "down", "--container-resource-id", "com.example:id/list", "--container-selector", '{"textEquals":"List"}', "--json"]);
    assert.notStrictEqual(code, 0);
    assert.match(stdout, /use --container-selector OR the --container-\* flags, not both/);
  });

  it("read-value accepts --text as an alias for --label", async () => {
    const { stdout, code } = await runCli(["read-value", "--text", "Battery", "--validate-only", "--json"]);
    assert.strictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.ok, true);
    assert.strictEqual(obj.execution.actions[0].params.labelMatcher.textEquals, "Battery");
  });
});

describe("sleep command validation", () => {
  it("sleep without duration returns MISSING_ARGUMENT", async () => {
    const { stdout, code } = await runCli(["sleep", "--json"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "MISSING_ARGUMENT");
    assert.match(obj.message, /sleep requires a duration/);
  });

  it("sleep with negative duration returns EXECUTION_VALIDATION_FAILED", async () => {
    const { stdout, code } = await runCli(["sleep", "-1", "--json"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message, /non-negative/);
  });

  it("sleep over MAX_EXECUTION_TIMEOUT_MS returns EXECUTION_VALIDATION_FAILED", async () => {
    const { stdout, code } = await runCli(["sleep", "120001", "--json"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message, /120000ms/);
    assert.match(obj.message, /120001ms/);
  });

  it("sleep with non-numeric duration returns EXECUTION_VALIDATION_FAILED", async () => {
    const { stdout, code } = await runCli(["sleep", "abc", "--json"]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message, /non-negative/);
  });
});

describe("wait command --timeout validation", () => {
  it("wait with --timeout 0 returns EXECUTION_VALIDATION_FAILED", async () => {
    const { stdout, code } = await runCli([
      "wait",
      "--text",
      "x",
      "--timeout",
      "0",
      "--json",
    ]);
    assert.notStrictEqual(code, 0);
    const obj = JSON.parse(stdout);
    assert.strictEqual(obj.code, "EXECUTION_VALIDATION_FAILED");
    assert.match(obj.message, /positive/);
  });
});

describe("didYouMean tie-breaking", () => {
  // Minimal fake command map used across both cases.
  const fakeBase = { summary: "s", help: "h", group: "g", handler: async () => "" } as const;

  it("prefers primary name over synonym at equal Levenshtein distance", () => {
    // "fob" is distance 1 from primary "foo" and distance 1 from synonym "foa".
    // Primary name must win.
    const cmds = {
      foo: { ...fakeBase, name: "foo", synonyms: ["foa"] },
    } as Parameters<typeof didYouMean>[2];
    const result = JSON.parse(didYouMean("fob", [], cmds)) as { suggestion?: string };
    assert.strictEqual(result.suggestion, "foo");
  });

  it("picks alphabetically first primary name when distance is equal", () => {
    // "xcd" is distance 1 from both "acd" and "bcd". "acd" should win.
    const cmds = {
      bcd: { ...fakeBase, name: "bcd" },
      acd: { ...fakeBase, name: "acd" },
    } as Parameters<typeof didYouMean>[2];
    const result = JSON.parse(didYouMean("xcd", [], cmds)) as { suggestion?: string };
    assert.strictEqual(result.suggestion, "acd");
  });
});


describe("direct execution product surface", () => {
  it("exposes host guidance and recording evidence without a runtime package namespace", async () => {
    assert.equal(COMMANDS.skills, undefined);
    assert.ok(COMMANDS["bundled-skills"]);
    assert.ok(COMMANDS.exec);
    for (const args of [["skills"], ["skills", "run", "example"], ["skills", "--help"]]) {
      const result = await runCli(args);
      assert.equal(result.code, 1);
      assert.match(result.stdout || result.stderr, /UNKNOWN_COMMAND/);
      assert.doesNotMatch(result.stdout || result.stderr, /deprecated|migration|legacy/i);
    }
  });
});
