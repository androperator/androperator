import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import { parseActiveDisplay } from "../../domain/observe/activeDisplay.js";
import { captureScreenshot } from "../../domain/observe/captureScreenshot.js";
import { runScrcpyVideoWorker, scrcpyArguments, videoSegments } from "../../domain/evidence/scrcpyVideo.js";
import { atomicJson, type VideoState } from "../../domain/evidence/videoSupport.js";
import { evidenceManifestSchema } from "../../contracts/evidence.js";

const display = (id: string, active: boolean, rotation = 0, width = 1080, height = 2364, logicalId = 0) =>
  `DisplayViewport{type=INTERNAL, valid=true, isActive=${active}, displayId=${logicalId}, uniqueId='local:${id}', orientation=${rotation}, logicalFrame=Rect(0, 0 - ${width}, ${height})}`;
const frame = (time: number, width: number, height: number) => ({ best_effort_timestamp_time: String(time), width, height });

describe("active foldable display selection", () => {
  it("selects the active primary physical display without rounding its 64-bit ID", () => {
    const dump = display("9007199254740993", false, 0, 2076, 2152, 1) + display("9007199254740995", true);
    assert.deepEqual(parseActiveDisplay(dump), { physicalId: "9007199254740995", width: 1080, height: 2364, rotation: 0 });
    assert.deepEqual(parseActiveDisplay(display("9007199254740995", true, 1, 2364, 1080)),
      { physicalId: "9007199254740995", width: 2364, height: 1080, rotation: 1 });
  });
  it("rejects ambiguous, inactive, or malformed viewports and supports older dumps without viewports", () => {
    assert.equal(parseActiveDisplay("older dump"), null);
    for (const dump of [display("1", false), display("1", false) + display("2", true).replace("isActive=true, ", ""), display("1", true) + display("2", true), display("1", true).replace("local:1", "virtual:1")]) {
      assert.throws(() => parseActiveDisplay(dump));
    }
  });
  it("passes the selected physical ID to screenshots without requiring scrcpy", async () => {
    let captured: string[] = [];
    const runner: ProcessRunner = {
      run: async () => ({ code: 0, stdout: display("9007199254740995", true), stderr: "" }),
      runShell: async () => { throw new Error("No shell"); },
      spawn: (_command, args) => {
        captured = args;
        const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
        queueMicrotask(() => { child.stdout.emit("data", Buffer.from("pixels")); child.emit("close", 0); });
        return child;
      },
    };
    const config = getDefaultRuntimeConfig({ deviceId: "test", runner });
    assert.equal((await captureScreenshot(config, { timeoutMs: 1000 })).toString(), "pixels");
    assert.deepEqual(captured, ["-s", "test", "exec-out", "screencap", "-p", "-d", "9007199254740995"]);
    // Android 10 viewport records predate activity metadata and retain default capture.
    runner.run = async () => ({ code: 0, stdout: display("1", true).replace("isActive=true, ", ""), stderr: "" });
    assert.equal((await captureScreenshot(config, { timeoutMs: 1000 })).toString(), "pixels");
    assert.deepEqual(captured, ["-s", "test", "exec-out", "screencap", "-p"]);
    const abort = new AbortController();
    runner.run = async () => { abort.abort(new Error("cancelled during selection")); return { code: 0, stdout: "", stderr: "" }; };
    captured = [];
    await assert.rejects(captureScreenshot(config, { timeoutMs: 1000, signal: abort.signal }), /cancelled/);
    assert.deepEqual(captured, []);
  });
});

describe("scrcpy geometry", () => {
  it("keeps rotated content in one canvas and splits each fold size transition", () => {
    assert.deepEqual(videoSegments({ frames: [frame(0, 720, 1280), frame(1, 720, 1280), frame(2, 1000, 1000), frame(3, 720, 1280)] }), [
      { start: 0, end: 2, width: 720, height: 1280, frames: 2 },
      { start: 2, end: 3, width: 1000, height: 1000, frames: 1 },
      { start: 3, width: 720, height: 1280, frames: 1 },
    ]);
    for (const frames of [[], [{ ...frame(0, 720, 1280), best_effort_timestamp_time: "" }], [frame(0, 0, 720)], [frame(0, 720, 1280), frame(0, 720, 1280)], [frame(NaN, 720, 1280)]]) assert.throws(() => videoSegments({ frames }));
  });
});

for (const failure of [undefined, "late-decode", "second-encode", "missing-encode", "scan", "disconnect", "hung", "artifact", "lost-frame", "signal-error"] as const) {
  it(`scrcpy worker preserves ownership and evidence: ${failure ?? "success with three clips"}`, async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "scrcpy-worker-"));
    const sessionId = randomUUID();
    const state: VideoState = { sessionId, nonce: randomUUID(), deviceId: "test-device", operatorPackage: "com.test.operator", adbPath: "/custom/adb",
      outputDir: root, lockPath: join(root, "lock.json"), managed: false, durationSeconds: 10, size: "720x1280", hostPid: null, hostStartedAt: null,
      remotePid: null, remoteStart: null, remotePath: `/data/local/tmp/androperator-video-${sessionId}.mp4`, deadline: 0, updatedAt: 0,
      recoveryRequired: false, backend: "scrcpy", maxEdge: 1280 };
    const device = { serial: "test-device", operatorPackage: state.operatorPackage, cliVersion: "test", operatorVersion: "test", apiLevel: 36,
      androidVersion: "16", manufacturer: "test", model: "test", deviceType: "emulator", deviceTypeProperties: { "ro.kernel.qemu": "1", "ro.boot.qemu": null },
      display: { width: 720, height: 1280, rotation: 0, density: 320 } };
    await atomicJson(join(root, "manifest.json"), { schemaVersion: 1, evidenceId: sessionId, label: null, context: { verdict: "failed" }, device,
      startedAt: new Date().toISOString(), finishedAt: null, status: "starting", artifacts: [], errors: [],
      video: { requestedDurationSeconds: 10, hostDurationMs: 0, mediaDurationMs: null, requestedSize: state.size, actualSize: null, codec: null, stopReason: null } });
    await atomicJson(state.lockPath, { sessionId, nonce: state.nonce });
    await atomicJson(join(root, "stop.json"), { nonce: state.nonce });
    await fs.writeFile(join(root, "capture.partial.mkv"), "source media");
    let now = 10000;
    const signals: string[] = [], sizes = new Map<string, string>();
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill(signal: string) {
      signals.push(signal);
      if (failure === "signal-error" && signal === "SIGINT") { child.emit("error", new Error("Signal permission denied")); return; }
      if (failure !== "hung") queueMicrotask(() => child.emit("close", failure === "disconnect" ? 1 : 0));
    } });
    const runner: ProcessRunner = {
      runShell: async () => { throw new Error("No shell or remote process signals"); },
      spawn: (command, args, options) => {
        assert.equal(command, "scrcpy");
        assert.deepEqual(args, scrcpyArguments(state));
        assert.equal(options?.env?.ADB, "/custom/adb");
        assert.ok(args.includes("--capture-orientation=@"));
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
      run: async (command, args) => {
        const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
        if (args.includes("-show_frames")) return failure === "scan" ? { code: 0, stdout: "{}", stderr: "corrupt tail" } : ok(JSON.stringify({ frames: [frame(0, 720, 1280), frame(1, 720, 1280), frame(2, 1000, 1000), frame(3, 720, 1280)] }));
        if (command === "ffprobe") {
          const [width, height] = sizes.get(args.at(-1)!)!.split(":").map(Number);
          return ok(JSON.stringify({ streams: [{ codec_name: "h264", width, height, duration: "1" }] }));
        }
        if (args.includes("-vf")) {
          assert.equal(args[args.indexOf("-enc_time_base") + 1], "demux", "Preserve close VFR timestamps instead of rounding to a nominal frame rate");
          const path = args.at(-1)!;
          if (failure === "missing-encode") return { code: 1, stdout: "", stderr: "Unrecognized option" };
          await fs.writeFile(path, "encoded media");
          sizes.set(path, args[args.indexOf("-vf") + 1].slice(6).split(",")[0]);
          if (failure === "second-encode" && path.includes("0002")) return { code: 1, stdout: "", stderr: "encoder failed" };
        }
        if (failure === "late-decode" && args.includes("-progress")) return { code: 1, stdout: "frame=1\nprogress=continue\n", stderr: "late corrupt frame" };
        const frames = failure === "lost-frame" ? 99 : args.some(value => value.includes("video-000")) ? 1 : 2;
        return ok(`frame=${frames}\nprogress=end\n`);
      },
    };
    try {
      const read = (async (path: Parameters<typeof fs.readFile>[0]) => {
        if (failure === "artifact" && String(path).endsWith("video.mp4")) throw new Error("unreadable artifact");
        return fs.readFile(path);
      }) as typeof fs.readFile;
      await runScrcpyVideoWorker(state, runner, { now: () => now, monotonic: () => now, sleep: async ms => { now += ms; } }, read);
      const manifest = evidenceManifestSchema.parse(JSON.parse(await fs.readFile(join(root, "manifest.json"), "utf8")));
      assert.equal(manifest.context.verdict, "failed");
      assert.equal(manifest.status, failure ? "partial" : "complete");
      assert.equal(manifest.video!.stopReason, ["hung", "disconnect", "scan", "signal-error"].includes(failure ?? "") ? "failure" : "requested");
      if (!failure) {
        assert.deepEqual(manifest.artifacts.filter(a => a.kind === "video").map(a => a.path), ["video.mp4", "video-0002.mp4", "video-0003.mp4"]);
        assert.equal(manifest.video!.actualSize, null);
        assert.equal(manifest.video!.mediaDurationMs, 3000);
        await assert.rejects(fs.stat(join(root, "capture.partial.mkv")));
      } else {
        assert.ok(manifest.errors.length);
        assert.equal(await fs.readFile(join(root, "capture.partial.mkv"), "utf8"), "source media");
      }
      if (failure === "missing-encode") {
        assert.ok(manifest.errors.every(error => !error.message.includes("ENOENT")));
        assert.equal(manifest.errors.filter(error => error.message.includes("Unrecognized option")).length, 3);
        assert.ok(manifest.artifacts.some(artifact => artifact.path === "capture.partial.mkv"));
      }
      if (failure === "late-decode") {
        const receipt = JSON.parse(await fs.readFile(join(root, "captures.json"), "utf8"));
        assert.equal(receipt[0].segments[0].actualSize, "720x1280");
        assert.equal(receipt[0].segments[0].mediaDurationMs, 1000);
      }
      if (failure === "second-encode") assert.equal(manifest.artifacts.filter(a => a.kind === "video" && a.status === "complete").length, 2);
      if (failure === "hung" || failure === "signal-error") { await fs.stat(state.lockPath); assert.deepEqual(signals, ["SIGINT", "SIGKILL"]); }
      else { await assert.rejects(fs.stat(state.lockPath)); assert.deepEqual(signals, ["SIGINT"]); }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}
