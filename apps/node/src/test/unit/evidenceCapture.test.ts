import { runExecution } from "../../domain/executions/runExecution.js";
import { captureScreenshot } from "../../domain/observe/captureScreenshot.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PNG } from "pngjs";
import { captureEvidence, validateEvidenceCaptureOptions, type EvidenceCaptureDependencies } from "../../domain/evidence/capture.js";
import { collectEvidenceMetadata } from "../../domain/evidence/metadata.js";
import { EvidenceBudgetRunner } from "../../domain/evidence/budget.js";
import { evidenceManifestSchema } from "../../contracts/evidence.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import { cmdEvidenceCapture } from "../../cli/commands/evidence.js";
import { shouldCliStdoutForceExitCode1 } from "../../cli/stdoutExitCode.js";
import { getEvidenceMcpTools } from "../../mcp/tools/evidence.js";

const xml = '<hierarchy><node text="Settings" visible-to-user="true" accessibility-data-sensitive="false"/></hierarchy>\n';
const png = PNG.sync.write({ width: 2, height: 2, data: Buffer.alloc(16, 255) } as PNG);
class CaptureRunner implements ProcessRunner {
  calls: string[][] = [];
  properties = '[ro.build.version.release]: [16]\n[ro.build.version.sdk]: [36]\n[ro.product.manufacturer]: [Example]\n[ro.product.model]: [Example phone]\n';
  inventory = "List of devices attached\ntest-device\tdevice\n";
  async run(_command: string, args: string[]) {
    this.calls.push(args);
    let stdout = "";
    const command = args.slice(args[0] === "-s" ? 2 : 0).join(" ");
    if (command === "devices") stdout = this.inventory;
    if (command === "shell getprop") stdout = this.properties;
    if (command === "shell wm size") stdout = 'Physical size: 200x400\nOverride size: 100x200\n';
    if (command === "shell wm density") stdout = 'Physical density: 400\nOverride density: 200\n';
    if (command === "shell dumpsys input") stdout = 'SurfaceOrientation: 1\n';
    if (command.startsWith("shell dumpsys package")) stdout = 'versionName=0.10.0-d\n';
    return { stdout, stderr: "", code: 0 };
  }
  async runShell(): Promise<never> { throw new Error("No shell allowed"); }
  spawn(_command: string, args: string[]) {
    this.calls.push(args);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    queueMicrotask(() => { child.stdout.emit("data", png); child.emit("close", 0); });
    return child;
  }
}
async function fixture() {
  const directory = await fs.mkdtemp(join(tmpdir(), "evidence-test-"));
  const runner = new CaptureRunner();
  const config = getDefaultRuntimeConfig({ runner, deviceId: "test-device", operatorPackage: "com.example.operator" });
  const dependencies: EvidenceCaptureDependencies = { config, baseDir: join(directory, "managed"),
    snapshot: async execution => ({ ok: true, deviceId: "test-device", terminalSource: "clawperator_result", envelope: {
      commandId: execution.commandId, taskId: execution.taskId, status: "success", stepResults: [{ id: "snap", actionType: "snapshot", success: true, data: { text: xml, operator_overlay_visible: "true" } }],
    } }),
  };
  return { directory, runner, config, dependencies, outputDir: join(directory, "bundle"), cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}
async function manifestAt(path: string) { return evidenceManifestSchema.parse(JSON.parse(await fs.readFile(path, "utf8"))); }

describe("still evidence capture", () => {
  it("captures independently through the real shared screenshot helper and hashes every final artifact", async () => {
    const f = await fixture();
    try {
      const context = { commandId: "original-command", verdict: "failed", nested: { error: "unchanged" } };
      const result = await captureEvidence({ outputDir: f.outputDir, label: "", context }, f.dependencies);
      assert.equal(result.status, "complete"); assert.equal(result.ok, true);
      const manifest = await manifestAt(result.manifestPath);
      assert.equal(manifest.label, ""); assert.deepEqual(manifest.context, context);
      assert.equal(manifest.device.serial, "test-device");
      assert.deepEqual(manifest.device.display, { width: 100, height: 200, density: 200, rotation: 1 });
      assert.equal(manifest.device.deviceType, "physical");
      assert.equal(manifest.device.deviceTypeProperties["ro.kernel.qemu"], null);
      assert.deepEqual(manifest.artifacts.map(value => value.kind), ["screenshot", "hierarchy", "capture_envelopes"]);
      for (const artifact of manifest.artifacts) {
        assert.equal(artifact.status, "complete");
        const bytes = await fs.readFile(join(f.outputDir, artifact.path!));
        assert.equal(artifact.bytes, bytes.length);
        assert.equal(artifact.sha256, createHash("sha256").update(bytes).digest("hex"));
        assert.ok(artifact.durationMs >= 0);
      }
      assert.equal(await fs.readFile(join(f.outputDir, "hierarchy.xml"), "utf8"), xml);
      const captures = JSON.parse(await fs.readFile(join(f.outputDir, "captures.json"), "utf8"));
      assert.equal(captures[0].source, "adb_screencap");
      assert.equal(captures[1].result.envelope.stepResults[0].data.operator_overlay_visible, "true");
      for (let i = 0; i < 2; i++) {
        assert.equal(captures[i].commandId, manifest.artifacts[i].commandId);
        assert.equal(captures[i].startedAt, manifest.artifacts[i].startedAt);
        assert.equal(captures[i].finishedAt, manifest.artifacts[i].finishedAt);
      }
      assert.ok(manifest.artifacts[0].finishedAt <= manifest.artifacts[1].startedAt);
      assert.ok(f.runner.calls.some(args => args.join(" ") === "-s test-device exec-out screencap -p"));
      assert.ok(f.runner.calls.every(args => args[0] === "-s" && args[1] === "test-device"));
    } finally { await f.cleanup(); }
  });
  for (const state of [
    { screenOn: false, deviceLocked: false, userUnlocked: true },
    { screenOn: true, deviceLocked: true, userUnlocked: true },
    { screenOn: true, deviceLocked: false, userUnlocked: true },
  ]) {
    it(`probes hierarchy readiness without input for ${JSON.stringify(state)}`, async () => {
      const f = await fixture();
      const snapshot = f.dependencies.snapshot!;
      f.dependencies.snapshot = async (execution, options) => {
        assert.ok(options?.ensureInteractiveAutomationReadyFn);
        const before = f.runner.calls.length;
        const readiness = await options.ensureInteractiveAutomationReadyFn(f.config, {
          probeInteractiveStateFn: async () => ({ ok: true, state }),
        });
        assert.equal(f.runner.calls.length, before, "readiness must not send wake or Home input");
        if (!readiness.ok) return { ok: false, error: { ...readiness.error } };
        return snapshot(execution, options);
      };
      try {
        const result = await captureEvidence({ outputDir: f.outputDir }, f.dependencies);
        const manifest = await manifestAt(result.manifestPath);
        assert.equal(manifest.artifacts[0].status, "complete");
        if (state.screenOn && !state.deviceLocked) assert.equal(result.status, "complete");
        else {
          assert.equal(result.status, "partial");
          assert.equal(manifest.artifacts[1].error?.code, "DEVICE_NOT_INTERACTIVE");
        }
      } finally { await f.cleanup(); }
    });
  }
  it("retains partial screenshot bytes and timeout cause when the overall deadline expires", async () => {
    const f = await fixture();
    f.runner.spawn = () => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => {
        queueMicrotask(() => child.emit("close", null));
        return true;
      } });
      queueMicrotask(() => child.stdout.emit("data", Buffer.from("partial")));
      return child;
    };
    // Keep the helper's own timeout later so only the shared deadline can cancel it.
    f.dependencies.screenshot = (config, options) => captureScreenshot(config, { ...options, timeoutMs: 5000 });
    try {
      const result = await captureEvidence({ outputDir: f.outputDir, timeoutMs: 1000 }, f.dependencies);
      const manifest = await manifestAt(result.manifestPath);
      assert.equal(manifest.artifacts[0].error?.code, "COMMAND_TIMEOUT");
      assert.equal(manifest.artifacts[0].path, "screenshot.partial.png");
      assert.equal(await fs.readFile(join(f.outputDir, "screenshot.partial.png"), "utf8"), "partial");
      const captures = JSON.parse(await fs.readFile(join(f.outputDir, "captures.json"), "utf8"));
      assert.equal(captures[0].result.error.code, "COMMAND_TIMEOUT");
    } finally { await f.cleanup(); }
  });
  it("preserves the screenshot and canonical hierarchy failure when no application root exists", async () => {
    const f = await fixture();
    try {
      f.dependencies.snapshot = async execution => ({ ok: true, deviceId: "test-device", terminalSource: "clawperator_result", envelope: {
        commandId: execution.commandId, taskId: execution.taskId, status: "failed", errorCode: "UI_TREE_UNAVAILABLE", error: "No application root", stepResults: [],
      } });
      const output = await cmdEvidenceCapture({ outputDir: f.outputDir, format: "json" }, f.dependencies);
      assert.equal(shouldCliStdoutForceExitCode1(output, false), true);
      const result = JSON.parse(output), manifest = await manifestAt(result.manifestPath);
      assert.equal(result.status, "partial");
      assert.equal(manifest.artifacts[0].status, "complete");
      assert.equal(manifest.artifacts[1].path, null);
      assert.equal(manifest.errors[0].code, "UI_TREE_UNAVAILABLE");
      assert.ok(f.runner.calls.some(args => args.includes("screencap")));
    } finally { await f.cleanup(); }
  });
  for (const bytes of [Buffer.alloc(0), Buffer.from("not a PNG"), png.subarray(0, png.length - 8)]) {
    it(`rejects invalid PNG (${bytes.length} bytes) while preserving hierarchy`, async () => {
      const f = await fixture();
      try {
        f.dependencies.screenshot = async () => bytes;
        const result = await captureEvidence({ outputDir: f.outputDir }, f.dependencies);
        assert.equal(result.status, "partial");
        const manifest = await manifestAt(result.manifestPath);
        assert.notEqual(manifest.artifacts[0].status, "complete");
        assert.equal(manifest.artifacts[0].path, bytes.length > 0 ? "screenshot.partial.png" : null);
        assert.equal(manifest.artifacts[1].status, "complete");
      } finally { await f.cleanup(); }
    });
  }
  it("produces a failed manifest when neither requested component is usable", async () => {
    const f = await fixture();
    try {
      f.dependencies.screenshot = async () => { throw new Error("Image failure"); };
      f.dependencies.snapshot = async () => ({ ok: false, error: { code: "OPERATOR_NOT_INSTALLED", message: "Missing Operator" } });
      const result = await captureEvidence({ outputDir: f.outputDir }, f.dependencies);
      assert.equal(result.status, "failed");
      const manifest = await manifestAt(result.manifestPath);
      assert.equal(manifest.artifacts[2].status, "complete");
      assert.equal(manifest.errors.length, 2);
    } finally { await f.cleanup(); }
  });
  it("records timeout for each undispatched component and keeps a readable manifest", async () => {
    const f = await fixture();
    let time = 0;
    f.dependencies.now = () => time;
    const run = f.runner.run.bind(f.runner);
    f.runner.run = async (command, args) => { const result = await run(command, args); time = 1000; return result; };
    f.dependencies.screenshot = async () => { throw new Error("must not dispatch"); };
    f.dependencies.snapshot = async () => { throw new Error("must not dispatch"); };
    try {
      const result = await captureEvidence({ outputDir: f.outputDir, timeoutMs: 1000 }, f.dependencies);
      const manifest = await manifestAt(result.manifestPath);
      assert.equal(result.status, "failed");
      assert.equal(manifest.artifacts[0].error!.code, "COMMAND_TIMEOUT");
      assert.equal(manifest.artifacts[1].error!.code, "COMMAND_TIMEOUT");
    } finally { await f.cleanup(); }
  });
  it("passes the remaining budget to hierarchy after a slow screenshot", async () => {
    const f = await fixture(); let time = 0; let budget = 0;
    f.dependencies.now = () => time;
    f.dependencies.screenshot = async () => { time = 7000; return png; };
    const snapshot = f.dependencies.snapshot!;
    f.dependencies.snapshot = async (execution, options) => { budget = options!.timeoutMs!; return snapshot(execution, options); };
    try { await captureEvidence({ outputDir: f.outputDir, timeoutMs: 10000 }, f.dependencies); assert.equal(budget, 3000); }
    finally { await f.cleanup(); }
  });
  it("marks metadata failures partial even when both captures succeed", async () => {
    const f = await fixture();
    f.dependencies.metadata = async (config, remaining) => {
      const data = await collectEvidenceMetadata(config, remaining);
      data.device.model = null;
      data.errors.push({ code: "EVIDENCE_CAPTURE_FAILED", stage: "metadata", component: "model", message: "unavailable" });
      return data;
    };
    try { const result = await captureEvidence({ outputDir: f.outputDir }, f.dependencies); assert.equal(result.status, "partial"); }
    finally { await f.cleanup(); }
  });
  it("reads primary-display rotation from modern Android input viewports", async () => {
    const f = await fixture();
    const run = f.runner.run.bind(f.runner);
    f.runner.run = async (command, args) => args.includes("input")
      ? { code: 0, stderr: "", stdout: "Viewport INTERNAL: displayId=-1, orientation=2\nViewport INTERNAL: displayId=0, uniqueId=example, orientation=3, isActive=[1]" }
      : run(command, args);
    try { assert.equal((await collectEvidenceMetadata(f.config, () => 1000)).device.display.rotation, 3); }
    finally { await f.cleanup(); }
  });
  it("rejects collisions without changing the existing directory", async () => {
    const f = await fixture();
    try {
      await fs.mkdir(f.outputDir); await fs.writeFile(join(f.outputDir, "sentinel"), "keep");
      await assert.rejects(captureEvidence({ outputDir: f.outputDir }, f.dependencies), { code: "EVIDENCE_OUTPUT_EXISTS" });
      assert.deepEqual(await fs.readdir(f.outputDir), ["sentinel"]);
      assert.ok(!f.runner.calls.some(args => args.includes("screencap")));
    } finally { await f.cleanup(); }
  });
  it("retains successful artifacts when captures.json cannot be written", async () => {
    const f = await fixture();
    f.dependencies.files = { ...fs, writeFile: async (path, data, options) => {
      if (String(path).includes("captures.partial")) throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
      return fs.writeFile(path, data, options);
    } };
    try {
      const result = await captureEvidence({ outputDir: f.outputDir }, f.dependencies);
      const manifest = await manifestAt(result.manifestPath);
      assert.equal(result.status, "partial");
      assert.equal(manifest.artifacts[2].status, "failed");
      assert.equal(manifest.artifacts[0].status, "complete");
    } finally { await f.cleanup(); }
  });
  it("validates persisted PNG bytes rather than assuming the file matches transport output", async () => {
    const f = await fixture();
    f.dependencies.files = { ...fs, writeFile: async (path, data, options) =>
      fs.writeFile(path, String(path).endsWith("screenshot.partial.png") ? Buffer.from("corrupt file") : data, options) };
    try {
      const result = await captureEvidence({ outputDir: f.outputDir }, f.dependencies);
      const manifest = await manifestAt(result.manifestPath);
      assert.equal(result.status, "partial");
      assert.equal(manifest.artifacts[0].status, "partial");
      assert.equal(manifest.artifacts[0].path, "screenshot.partial.png");
    } finally { await f.cleanup(); }
  });
  it("bounds the shared screenshot subprocess and preserves partial bytes", async () => {
    const f = await fixture(); let killed = false;
    f.runner.spawn = () => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => {
        killed = true; queueMicrotask(() => child.emit("close", null)); return true;
      } });
      queueMicrotask(() => child.stdout.emit("data", Buffer.from("partial")));
      return child;
    };
    try {
      await assert.rejects(captureScreenshot(f.config, { timeoutMs: 10 }), (error: unknown) => {
        assert.equal((error as { code: string }).code, "COMMAND_TIMEOUT");
        assert.equal((error as { partialBuffer: Buffer }).partialBuffer.toString(), "partial");
        return true;
      });
      assert.equal(killed, true);
    } finally { await f.cleanup(); }
  });
  it("fails explicitly if the manifest cannot be persisted", async () => {
    const f = await fixture();
    f.dependencies.files = { ...fs, writeFile: async (path, data, options) => {
      if (String(path).includes("manifest.partial")) throw new Error("Disk full");
      return fs.writeFile(path, data, options);
    } };
    try {
      await assert.rejects(captureEvidence({ outputDir: f.outputDir }, f.dependencies), { code: "EVIDENCE_CAPTURE_FAILED" });
      assert.ok((await fs.stat(join(f.outputDir, "screenshot.png"))).size > 0);
    } finally { await f.cleanup(); }
  });
  it("rejects unspecified multiple devices before creating output", async () => {
    const f = await fixture(); f.config.deviceId = undefined;
    f.runner.inventory = "List of devices attached\none\tdevice\ntwo\tdevice\n";
    try {
      await assert.rejects(captureEvidence({ outputDir: f.outputDir }, f.dependencies), { code: "MULTIPLE_DEVICES_DEVICE_ID_REQUIRED" });
      await assert.rejects(fs.stat(f.outputDir), { code: "ENOENT" });
    } finally { await f.cleanup(); }
  });
  it("MCP allocates a managed bundle and rejects caller output paths", async () => {
    const f = await fixture();
    try {
      const tool = getEvidenceMcpTools(undefined, {}, f.dependencies)[0];
      for (const args of [{ outputDir: f.outputDir }, { context: [] }, { context: { text: "😀".repeat(5000) } }]) {
        await assert.rejects(async () => tool.handler(args), (error: unknown) => (error as { code: number }).code === -32602);
      }
      const response = await tool.handler({ label: "Observation", context: { originalVerdict: "failed" } });
      const payload = JSON.parse((response.content[0] as { text: string }).text);
      assert.equal(payload.ok, true);
      assert.ok(payload.manifestPath.startsWith(f.dependencies.baseDir));
      assert.deepEqual(payload, response.structuredContent);
      assert.equal((await manifestAt(String(payload!.manifestPath))).context.originalVerdict, "failed");
    } finally { await f.cleanup(); }
  });
  it("MCP partial failures retain the managed manifest path and error state", async () => {
    const f = await fixture();
    f.dependencies.snapshot = async () => ({ ok: false, error: { code: "UI_TREE_UNAVAILABLE", message: "no root" } });
    try {
      const response = await getEvidenceMcpTools(undefined, {}, f.dependencies)[0].handler({});
      const payload = JSON.parse((response.content[0] as { text: string }).text);
      assert.equal(response.isError, true);
      assert.equal(payload.ok, false);
      assert.equal(payload.status, "partial");
      assert.equal((await manifestAt(payload.manifestPath)).artifacts[0].status, "complete");
    } finally { await f.cleanup(); }
  });
  it("validates paths, label and JSON budgets before device access", () => {
    for (const options of [{ outputDir: "" }, { outputDir: "relative" }, { outputDir: "/" }, { outputDir: "/tmp/../other" },
      { context: [] }, { context: null }, { operatorPackage: "com.example; echo unsafe" }, { context: { value: Infinity } }, { label: "x".repeat(2049) }, { context: { x: "x".repeat(16384) } }]) {
      assert.throws(() => validateEvidenceCaptureOptions(options as Parameters<typeof validateEvidenceCaptureOptions>[0]), { code: "EXECUTION_VALIDATION_FAILED" });
    }
  });
  it("returns nonzero structured errors for invalid or missing CLI flags with global options in either position", () => {
    for (const args of [[], ["--output-dir"], ["--output-dir", "relative"], ["--output-dir", " "],
      ["--output-dir", "/tmp/example", "--context-json", "[]"], ["--output-dir", "/tmp/example", "--context-json"],
      ["--output-dir", "/tmp/example", "--label"], ["--output-dir", "/tmp/example", "--timeout", "0"]]) {
      for (const command of [["evidence", "capture", ...args, "--output", "json"], ["--output", "json", "evidence", "capture", ...args]]) {
        const result = spawnSync(process.execPath, ["dist/cli/index.js", ...command], { encoding: "utf8" });
        assert.equal(result.status, 1, JSON.stringify(command));
        assert.equal(JSON.parse(result.stdout).code, "USAGE", result.stderr);
      }
    }
  });
  it("caches device resolution for nested primitives and prohibits dispatch past deadline", async () => {
    const delegate = new CaptureRunner();
    const runner = new EvidenceBudgetRunner(delegate, performance.now() + 10000);
    try {
      await runner.run("adb", ["-s", "test-device", "devices"]);
      await runner.run("adb", ["-s", "test-device", "devices"]);
      assert.equal(delegate.calls.length, 1);
    } finally { runner.close(); }
    const expired = new EvidenceBudgetRunner(delegate, performance.now() - 1);
    try { await assert.rejects(expired.run("adb", ["shell", "something"]), { code: "COMMAND_TIMEOUT" }); }
    finally { expired.close(); }
  });
});


it("managed still capture uses the configured root and reports storage recovery through MCP", async () => {
  const f = await fixture();
  const previous = process.env.CLAWPERATOR_EVIDENCE_DIR;
  try {
    process.env.CLAWPERATOR_EVIDENCE_DIR = join(f.directory, "configured");
    const dependencies = { ...f.dependencies, baseDir: undefined };
    const result = await captureEvidence({}, dependencies);
    assert.ok(result.manifestPath.startsWith(join(process.env.CLAWPERATOR_EVIDENCE_DIR, "bundles")));
    assert.equal(result.status, "complete");
    const blocked = join(f.directory, "blocked");
    await fs.writeFile(blocked, "existing bytes");
    process.env.CLAWPERATOR_EVIDENCE_DIR = blocked;
    const response = await getEvidenceMcpTools(undefined, undefined, dependencies)[0].handler({});
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent?.code, "EVIDENCE_STORAGE_UNWRITABLE");
    assert.equal(response.structuredContent?.path, join(blocked, "bundles"));
    assert.equal(typeof response.structuredContent?.recovery, "string");
  } finally {
    if (previous === undefined) delete process.env.CLAWPERATOR_EVIDENCE_DIR;
    else process.env.CLAWPERATOR_EVIDENCE_DIR = previous;
    await f.cleanup();
  }
});

describe("evidence metadata classification", () => {
  for (const [flags, expected] of [
    ["", "physical"],
    ["[persist.sys.boot.reason.history]: [reboot,123\nreboot,456]", "physical"],
    ["[persist.sys.boot.reason.history]: [reboot,123\r\nreboot,456]\r\n[ro.boot.qemu]: [1]\r\n", "emulator"],
    ["[ro.kernel.qemu]: []", "physical"],
    ["[ro.kernel.qemu]: [0]", "physical"],
    ["[ro.boot.qemu]: [0]", "physical"],
    ["[ro.kernel.qemu]: [0]\n[ro.boot.qemu]: [0]", "physical"],
    ["[ro.kernel.qemu]: [1]", "emulator"],
    ["[ro.boot.qemu]: [1]", "emulator"],
    ["[ro.kernel.qemu]: [0]\n[ro.boot.qemu]: [1]", "emulator"],
    ["[ro.kernel.qemu]: [1]\n[ro.boot.qemu]: [0]", "emulator"],
    ["[ro.kernel.qemu]: [unexpected]\n[ro.boot.qemu]: [1]", "emulator"],
    ["[ro.kernel.qemu]: [unexpected]", "unknown"],
    ["[ro.kernel.qemu]: [0]\n[ro.boot.qemu]: [unexpected]", "unknown"],
    ["malformed", "unknown"],
    ["[bad key]: [value]", "unknown"],
    ["[ro.kernel.qemu]: 1]", "unknown"],
    ["[ro.kernel.qemu]:[1]", "unknown"],
    ["[ro.kernel.qemu] : [1]", "unknown"],
    ["[persist.example]: broken]\n[ro.kernel.qemu]: [0]", "unknown"],
    ["[persist.example.multiline]: [unclosed\n[ro.kernel.qemu]: [0]", "unknown"],
    ["[ro.kernel.qemu]: [1", "unknown"],
    ["[ro.kernel.qemu]: [0]\n[ro.kernel.qemu]: [1]", "unknown"],
  ] as const) {
    it(`classifies ${JSON.stringify(flags)} as ${expected} through still capture`, async () => {
      const f = await fixture();
      try {
        f.runner.properties += flags;
        const output = await cmdEvidenceCapture({ outputDir: f.outputDir, format: "json" }, f.dependencies);
        const result = JSON.parse(output), manifest = await manifestAt(result.manifestPath);
        assert.equal(manifest.device.deviceType, expected);
        assert.equal(result.status, expected === "unknown" ? "partial" : "complete");
        assert.equal(shouldCliStdoutForceExitCode1(output, false), expected === "unknown");
      } finally { await f.cleanup(); }
    });
  }
  for (const newline of ["\n", "\r\n"]) {
    for (const value of ["first\n[second]", "first]\nsecond"]) {
      for (const flag of ["0", "1"]) {
        it(`preserves bracketed multiline values with ${JSON.stringify(newline)} and flag ${flag}`, async () => {
          const f = await fixture();
          try {
            f.runner.properties += `[persist.example.multiline]: [${value}]\n[ro.kernel.qemu]: [${flag}]\n`;
            f.runner.properties = f.runner.properties.replaceAll("\n", newline);
            const result = await captureEvidence({ outputDir: f.outputDir }, f.dependencies);
            const manifest = await manifestAt(result.manifestPath);
            assert.equal(result.status, "complete");
            assert.equal(manifest.device.deviceType, flag === "1" ? "emulator" : "physical");
            assert.equal(manifest.device.deviceTypeProperties["ro.kernel.qemu"], flag);
            assert.deepEqual(manifest.errors, []);
          } finally { await f.cleanup(); }
        });
      }
    }
  }
  for (const mode of ["empty", "nonzero", "throw", "exhausted"] as const) {
    it(`keeps ${mode} property reads unknown`, async () => {
      const f = await fixture();
      try {
        const run = f.runner.run.bind(f.runner);
        f.runner.run = async (command, args) => {
          if (args.includes("getprop")) {
            if (mode === "throw") throw new Error("read timed out");
            return { stdout: mode === "empty" ? "" : f.runner.properties, stderr: "", code: mode === "nonzero" ? 1 : 0 };
          }
          return run(command, args);
        };
        const data = await collectEvidenceMetadata(f.config, () => mode === "exhausted" ? 0 : 5000);
        assert.equal(data.device.deviceType, "unknown");
        assert.ok(data.errors.some(error => error.component === "deviceType"));
        if (mode === "exhausted") assert.equal(f.runner.calls.length, 0);
      } finally { await f.cleanup(); }
    });
  }
});


it("keeps the screenshot and owned timeout when the evidence budget cancels a dispatched hierarchy", async () => {
  const f = await fixture();
  let broadcasts = 0;
  const run = f.runner.run.bind(f.runner);
  f.runner.run = async (command, args) => {
    if (args.includes("packages")) return { code: 0, stdout: "package:com.example.operator\n", stderr: "" };
    if (args.some(arg => arg.startsWith("am broadcast "))) { broadcasts++; return { code: 0, stdout: "Broadcast completed: result=0", stderr: "" }; }
    return run(command, args);
  };
  f.runner.spawn = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => {
      queueMicrotask(() => { child.emit("exit", null, "SIGKILL"); child.emit("close", null, "SIGKILL"); });
      return true;
    } });
    return child;
  };
  f.dependencies.screenshot = async () => png;
  f.dependencies.snapshot = (execution, options) => runExecution(execution, { ...options,
    ensureInteractiveAutomationReadyFn: async () => ({ ok: true, state: { screenOn: true, deviceLocked: false, userUnlocked: true } }) });
  try {
    const result = await captureEvidence({ outputDir: f.outputDir, timeoutMs: 1500 }, f.dependencies);
    const manifest = await manifestAt(result.manifestPath);
    assert.equal(result.status, "partial");
    assert.equal(manifest.artifacts[0].status, "complete");
    assert.equal(manifest.artifacts[1].error?.code, "COMMAND_TIMEOUT");
    assert.equal(broadcasts, 1);
    const captures = JSON.parse(await fs.readFile(join(f.outputDir, "captures.json"), "utf8"));
    const error = captures[1].result.error;
    assert.equal(error.code, "COMMAND_TIMEOUT");
    assert.equal(error.details.deadlineOwner, "evidence_capture");
    assert.equal(error.details.dispatchState, "dispatched");
    assert.equal(error.details.phase, "result_wait");
    assert.deepEqual(error.details.earlierEffects, []);
    assert.equal(error.details.transport.receivedChunks, 0);
  } finally { await f.cleanup(); }
});
