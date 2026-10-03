import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { NodeProcessRunner, type ProcessResult } from "../../adapters/android-bridge/processRunner.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { inspectVideoDependencies, SCRCPY_REQUIRED_FLAGS } from "../../domain/evidence/videoDependencies.js";
import { supportsFfmpegVideo } from "../../domain/evidence/ffmpegCapabilities.js";
import { checkVideoDependencies } from "../../domain/doctor/checks/videoChecks.js";
import { getVideoMcpTools } from "../../mcp/tools/evidence.js";

class DependencyRunner extends NodeProcessRunner {
  failures: Record<string, ProcessResult | Error> = {};
  override async run(command: string, _args: string[], options?: { timeoutMs?: number }): Promise<ProcessResult> {
    const failure = this.failures[command];
    if (failure instanceof Error) throw failure;
    if (failure) return failure;
    if (command === "adb") return { code: 0, stdout: "List of devices attached\ntest-device\tdevice\n", stderr: "" };
    assert.equal(options?.timeoutMs, 5000);
    return { code: 0, stdout: command === "scrcpy" ? SCRCPY_REQUIRED_FLAGS.join(" ") : "ffmpeg version 6.1", stderr: "" };
  }
}

it("doctor reports optional host readiness and manual recovery without installing tools", async () => {
  const runner = new DependencyRunner();
  const config = getDefaultRuntimeConfig({ runner });
  assert.equal((await checkVideoDependencies(config)).status, "pass");
  runner.failures = {
    scrcpy: Object.assign(new Error("missing"), { code: "ENOENT" }),
    ffmpeg: { code: 0, stdout: "other encoders", stderr: "" },
    ffprobe: { code: null, stdout: "", stderr: "timeout" },
  };
  const check = await checkVideoDependencies(config);
  assert.equal(check.id, "host.video.dependencies");
  assert.equal(check.status, "warn");
  assert.equal(check.code, "HOST_DEPENDENCY_MISSING");
  assert.deepEqual((check.evidence?.dependencies as Array<{ reason: string }>).map(issue => issue.reason), ["missing", "unsupported", "unavailable"]);
  assert.ok(check.fix?.steps.every(step => step.kind === "manual"));
  assert.match(check.fix!.steps[0].value, /brew install scrcpy ffmpeg/);
});

it("rejects every missing scrcpy capture flag and handles returned spawn errors", async () => {
  const runner = new DependencyRunner();
  for (const flag of SCRCPY_REQUIRED_FLAGS) {
    runner.failures.scrcpy = { code: 0, stdout: SCRCPY_REQUIRED_FLAGS.filter(value => value !== flag).join(" "), stderr: "" };
    assert.equal((await inspectVideoDependencies(runner))[0].reason, "unsupported");
  }
  runner.failures.scrcpy = { code: 1, stdout: "", stderr: "", error: Object.assign(new Error("missing"), { code: "ENOENT" }) };
  assert.equal((await inspectVideoDependencies(runner))[0].reason, "missing");
});

it("MCP preserves actionable structured dependency errors and creates no bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-dependency-mcp-"));
  try {
    const runner = new DependencyRunner();
    for (const dependency of ["scrcpy", "ffmpeg", "ffprobe"]) runner.failures[dependency] = { code: 127, stdout: "", stderr: "missing" };
    const tool = getVideoMcpTools(undefined, { baseDir: root, config: getDefaultRuntimeConfig({ runner }) })[0];
    const result = await tool.handler({ deviceId: "test-device", durationSeconds: 5 });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].type, "text");
    if (result.content[0].type !== "text") throw new Error("Expected text error");
    const payload = JSON.parse(result.content[0].text);
    assert.deepEqual(result.structuredContent, payload);
    assert.equal(payload.code, "HOST_DEPENDENCY_MISSING");
    assert.equal(payload.details.capability, "video-recording");
    assert.deepEqual(payload.details.dependencies.map((issue: { dependency: string }) => issue.dependency), ["scrcpy", "ffmpeg", "ffprobe"]);
    assert.match(payload.hint, /host.video.dependencies passes/);
    assert.match(payload.details.docsUrl, /#video-dependencies$/);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("CLI returns exit 1 with all missing dependencies in JSON and pretty output", async () => {
  const root = await mkdtemp(join(tmpdir(), "video-dependency-cli-"));
  try {
    const adb = join(root, "adb");
    await writeFile(adb, "#!/bin/sh\nprintf 'List of devices attached\\ntest-device\\tdevice\\n'\n", { mode: 0o755 });
    for (const format of ["json", "pretty"]) {
      const destination = join(root, "bundle");
      const result = spawnSync(process.execPath, ["dist/cli/index.js", "evidence", "video", "start", "--device", "test-device", "--output-dir", destination, "--duration-seconds", "5", "--output", format], {
        encoding: "utf8", env: { ...process.env, PATH: root, ADB_PATH: adb, ANDROPERATOR_LOG_DIR: join(root, "logs") },
      });
      assert.equal(result.status, 1, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.code, "HOST_DEPENDENCY_MISSING");
      assert.equal(payload.details.dependencies.length, 3);
      assert.ok(payload.details.dependencies.every((issue: { reason: string }) => issue.reason === "missing"));
      assert.match(payload.hint, /brew install scrcpy ffmpeg/);
      assert.ok(!(await readdir(root)).includes("bundle"));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});


it("rejects old versions and modern builds lacking actual timing capabilities", async () => {
  const runner = new DependencyRunner();
  for (const version of ["4.4", "5.1", "6.0", "n5.1", "n6.0", "unknown"]) {
    assert.equal(await supportsFfmpegVideo(runner, `ffmpeg version ${version}`), false);
  }
  for (const version of ["6.1", "8.1.3", "9.0.2", "n6.1", "n7.1", "n9.0.2"]) {
    assert.equal(await supportsFfmpegVideo(runner, `ffmpeg version ${version}`), true);
  }
  const run = runner.run.bind(runner);
  runner.run = async (command, args, options) => args.includes("-f")
    ? { code: 1, stdout: "", stderr: "Unrecognized option fps_mode" }
    : run(command, args, options);
  const issues = await inspectVideoDependencies(runner);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].dependency, "ffmpeg");
  assert.equal(issues[0].reason, "unsupported");
  assert.match(issues[0].requirement, /6.1.*fps_mode.*enc_time_base/);
});
