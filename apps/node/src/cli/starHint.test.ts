import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { maybeShowStarHint, __resetShown } from "./starHint.js";

describe("maybeShowStarHint", () => {
  let tempRoot: string;
  let originalHome: string | undefined;
  let originalEnvVar: string | undefined;
  let originalArgv: string[];
  let capturedStderr: string;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  function mockStderr(): void {
    capturedStderr = "";
    process.stderr.write = ((chunk: unknown) => {
      capturedStderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
  }

  function restoreStderr(): void {
    process.stderr.write = originalStderrWrite;
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "androperator-starhint-"));
    originalHome = process.env.HOME;
    originalEnvVar = process.env.ANDROPERATOR_DISABLE_STAR_SUGGESTIONS;
    originalArgv = [...process.argv];
    capturedStderr = "";

    // Set HOME to temp directory for isolated state
    process.env.HOME = tempRoot;
    delete process.env.ANDROPERATOR_DISABLE_STAR_SUGGESTIONS;

    // Default to TTY=true for tests (suppress tests will override this)
    Object.defineProperty(process.stderr, "isTTY", { value: true, writable: true, configurable: true });

    // Reset module-level guard before each test
    __resetShown();
  });

  afterEach(async () => {
    restoreStderr();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalEnvVar === undefined) {
      delete process.env.ANDROPERATOR_DISABLE_STAR_SUGGESTIONS;
    } else {
      process.env.ANDROPERATOR_DISABLE_STAR_SUGGESTIONS = originalEnvVar;
    }
    process.argv = originalArgv;
    // Always restore isTTY to undefined (default)
    Object.defineProperty(process.stderr, "isTTY", { value: undefined, writable: true, configurable: true });
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("suppresses when TTY is not available", async () => {
    Object.defineProperty(process.stderr, "isTTY", { value: false, writable: true, configurable: true });

    mockStderr();
    await maybeShowStarHint("doctor");
    restoreStderr();

    assert.strictEqual(capturedStderr, "");
  });

  it("suppresses when ANDROPERATOR_DISABLE_STAR_SUGGESTIONS env var is set", async () => {
    process.env.ANDROPERATOR_DISABLE_STAR_SUGGESTIONS = "1";

    mockStderr();
    await maybeShowStarHint("doctor");
    restoreStderr();

    assert.strictEqual(capturedStderr, "");
  });

  it("suppresses doctor trigger when doctorHintShown is true in state", async () => {
    const stateDir = join(tempRoot, ".androperator");
    const stateFile = join(stateDir, "star-hint-state.json");
    const fs = await import("node:fs/promises");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({ doctorHintShown: true }), "utf8");

    mockStderr();
    await maybeShowStarHint("doctor");
    restoreStderr();

    assert.strictEqual(capturedStderr, "");
  });


  it("suppresses upgrade trigger when lastUpgradeHintVersion matches current version", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version: string };
    const currentVersion = pkg.version;

    const stateDir = join(tempRoot, ".androperator");
    const stateFile = join(stateDir, "star-hint-state.json");
    const fs = await import("node:fs/promises");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({ lastUpgradeHintVersion: currentVersion }), "utf8");

    mockStderr();
    await maybeShowStarHint("upgrade");
    restoreStderr();

    assert.strictEqual(capturedStderr, "");
  });

  it("shows hint and updates state correctly for doctor trigger", async () => {
    mockStderr();
    await maybeShowStarHint("doctor");
    restoreStderr();

    assert.match(capturedStderr, /Androperator is open source/);
    assert.match(capturedStderr, /androperator\/androperator/);

    // Verify state was written
    const stateFile = join(tempRoot, ".androperator", "star-hint-state.json");
    const stateData = await readFile(stateFile, "utf8");
    const state = JSON.parse(stateData);
    assert.strictEqual(state.doctorHintShown, true);
  });


  it("shows hint and updates state correctly for upgrade trigger", async () => {
    mockStderr();
    await maybeShowStarHint("upgrade");
    restoreStderr();

    assert.match(capturedStderr, /Androperator is open source/);

    // Verify state was written
    const stateFile = join(tempRoot, ".androperator", "star-hint-state.json");
    const stateData = await readFile(stateFile, "utf8");
    const state = JSON.parse(stateData);

    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version: string };
    assert.strictEqual(state.lastUpgradeHintVersion, pkg.version);
  });

  it("shows upgrade hint again when version differs from last shown", async () => {
    // Pre-populate state with an old version
    const stateDir = join(tempRoot, ".androperator");
    const stateFile = join(stateDir, "star-hint-state.json");
    const fs = await import("node:fs/promises");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({ lastUpgradeHintVersion: "0.1.0" }), "utf8");

    mockStderr();
    await maybeShowStarHint("upgrade");
    restoreStderr();

    // Should show because current version differs from 0.1.0
    assert.match(capturedStderr, /Androperator is open source/);

    // Verify state was updated to new version
    const stateData = await readFile(stateFile, "utf8");
    const state = JSON.parse(stateData);
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version: string };
    assert.strictEqual(state.lastUpgradeHintVersion, pkg.version);
    assert.notStrictEqual(state.lastUpgradeHintVersion, "0.1.0");
  });

  it("module-level shown guard prevents second hint in same invocation", async () => {
    mockStderr();

    // First call should show
    await maybeShowStarHint("doctor");
    assert.match(capturedStderr, /Androperator is open source/);

    // Second call should be suppressed (same module instance)
    await maybeShowStarHint("upgrade");
    // Output should be unchanged
    const outputAfterSecond = capturedStderr;
    assert.match(outputAfterSecond, /Androperator is open source/);

    // Third call should also be suppressed
    await maybeShowStarHint("upgrade");
    assert.strictEqual(capturedStderr, outputAfterSecond);

    restoreStderr();
  });

  it("swallows state write errors without throwing", async () => {
    // Create a file where the directory should be, causing mkdir to fail
    const blockingPath = join(tempRoot, ".androperator");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(blockingPath, "not a directory", "utf8");

    mockStderr();

    // This should not throw despite mkdir failing
    await assert.doesNotReject(async () => {
      await maybeShowStarHint("doctor");
    });

    restoreStderr();

    // Hint should still be shown (stderr write happens before state write)
    assert.match(capturedStderr, /Androperator is open source/);
  });

  it("suppresses when --disable-star-suggestions flag is in argv", async () => {
    process.argv = [...process.argv, "--disable-star-suggestions"];

    mockStderr();
    await maybeShowStarHint("doctor");
    restoreStderr();

    assert.strictEqual(capturedStderr, "");
  });
});
