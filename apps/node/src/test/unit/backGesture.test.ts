import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertGestureNavigation, parseMeasure, planBackGesture, readBackGestureDevice, BACK_GESTURE_DEFAULTS } from "../../domain/actions/backGesture.js";
import { buildPathGestureParams } from "../../domain/actions/gesture.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";

const cli = fileURLToPath(new URL("../../cli/index.js", import.meta.url));
const display = { width: 1344, height: 2992 };
const base = { edge: "left" as const, y: { unit: "fraction" as const, value: 0.5 }, distance: { unit: "fraction" as const, value: 0.4 }, durationMs: 400, cancel: false };

it("measures are pixels when integers and fractions when they have a decimal point", () => {
  assert.deepEqual(parseMeasure("1500", "--y"), { unit: "px", value: 1500 });
  assert.deepEqual(parseMeasure("0.5", "--y"), { unit: "fraction", value: 0.5 });
  assert.deepEqual(parseMeasure(".25", "--y"), { unit: "fraction", value: 0.25 });
  assert.deepEqual(parseMeasure("1.0", "--y"), { unit: "fraction", value: 1 });
  for (const bad of ["", "0.0", "1.5", "-1", "1e3", "abc", "0.5px", "50%"]) assert.throws(() => parseMeasure(bad, "--y"), /--y/, bad);
});

it("a left edge gesture lands one pixel inside the edge and travels inward", () => {
  const plan = planBackGesture(base, display);
  assert.deepEqual(plan.points, [{ x: 1, y: 1496 }, { x: 1 + 538, y: 1496 }]);
  assert.equal(plan.durationMs, 400);
  assert.equal(plan.holdMs, undefined);
});

it("a right edge gesture mirrors the left one", () => {
  const plan = planBackGesture({ ...base, edge: "right", y: { unit: "px", value: 900 }, distance: { unit: "px", value: 300 } }, display);
  assert.deepEqual(plan.points, [{ x: 1342, y: 900 }, { x: 1042, y: 900 }]);
});

it("cancel returns to the edge and spends the travel time again; hold is passed through", () => {
  const plan = planBackGesture({ ...base, cancel: true, holdMs: 500 }, display);
  assert.deepEqual(plan.points[2], plan.points[0]);
  assert.equal(plan.points.length, 3);
  assert.equal(plan.durationMs, 800);
  assert.equal(plan.holdMs, 500);
  const params = buildPathGestureParams(plan.points, plan.durationMs, plan.holdMs);
  assert.deepEqual(params.end, params.start);
});

it("rejects positions and distances outside the display", () => {
  assert.throws(() => planBackGesture({ ...base, y: { unit: "px", value: 2992 } }, display), /--y/);
  assert.throws(() => planBackGesture({ ...base, distance: { unit: "px", value: 0 } }, display), /--distance/);
  assert.throws(() => planBackGesture({ ...base, distance: { unit: "px", value: 1342 } }, display), /--distance/);
  assert.deepEqual(BACK_GESTURE_DEFAULTS.edge, "left");
});

it("only gesture navigation is accepted, with a teaching error otherwise", () => {
  assert.doesNotThrow(() => assertGestureNavigation("2"));
  for (const mode of ["0", "1", "null", null]) {
    assert.throws(() => assertGestureNavigation(mode), (error: any) => error.code === "EXECUTION_ACTION_UNSUPPORTED" && /press-key back/.test(error.message), String(mode));
  }
});

function runnerFor(outputs: Record<string, string>): ProcessRunner {
  return {
    run: async (_command, args) => {
      const key = args.filter(arg => arg !== "-s" && arg !== "dev").join(" ");
      const stdout = outputs[key];
      return stdout === undefined ? { stdout: "", stderr: "unexpected", code: 1 } : { stdout, stderr: "", code: 0 };
    },
    runShell: async () => ({ stdout: "", stderr: "", code: 0 }),
    spawn: () => { throw new Error("unused"); },
  };
}

// logicalFrame is already in the current rotation, as on a real device (orientation 1: 2992x1344).
const viewport = (orientation: number) => {
  const [w, h] = orientation % 2 ? [2992, 1344] : [1344, 2992];
  return `DisplayViewport{type=INTERNAL, valid=true, isActive=true, displayId=0, uniqueId='local:4619827259835644672', orientation=${orientation}, logicalFrame=Rect(0, 0 - ${w}, ${h}), physicalFrame=Rect(0, 0 - ${w}, ${h}), deviceWidth=${w}, deviceHeight=${h}}`;
};

it("reads the navigation mode and the display in its current rotation", async () => {
  const config = getDefaultRuntimeConfig({ deviceId: "dev", runner: runnerFor({
    "shell settings get secure navigation_mode": "2\n", "shell dumpsys display": viewport(0) }) });
  assert.deepEqual(await readBackGestureDevice(config), { display: { width: 1344, height: 2992 }, navigationMode: "2" });
  for (const orientation of [1, 3]) {
    const landscape = getDefaultRuntimeConfig({ deviceId: "dev", runner: runnerFor({
      "shell settings get secure navigation_mode": "0\n", "shell dumpsys display": viewport(orientation) }) });
    assert.deepEqual(await readBackGestureDevice(landscape), { display: { width: 2992, height: 1344 }, navigationMode: "0" }, `orientation ${orientation}`);
  }
});

it("falls back to wm size and the input viewport when the display dump has no activity field", async () => {
  const config = getDefaultRuntimeConfig({ deviceId: "dev", runner: runnerFor({
    "shell settings get secure navigation_mode": "2\n", "shell dumpsys display": "no viewports",
    "shell wm size": "Physical size: 1080x2400\n", "shell dumpsys input": "SurfaceOrientation: 1\n" }) });
  assert.deepEqual(await readBackGestureDevice(config), { display: { width: 2400, height: 1080 }, navigationMode: "2" });
});

it("back-gesture CLI reports structured validation errors with exit 1 before touching a device", () => {
  for (const args of [
    ["--edge", "top"], ["--edge"], ["--y", "50%"], ["--y", "1.5"], ["--distance", "0.0"], ["--duration-ms", "0"], ["--duration-ms", "10001"],
    ["--duration-ms", "fast"], ["--hold-ms", "0"], ["--hold-ms", "-1"], ["--cancel", "--cancel"], ["--edge", "left", "--edge", "right"], ["extra"],
  ]) {
    const result = spawnSync(process.execPath, [cli, "back-gesture", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(JSON.parse(result.stdout).code, "EXECUTION_VALIDATION_FAILED", result.stdout);
  }
});

it("refuses to guess the rotation when the fallback cannot read it", async () => {
  const outputs = { "shell settings get secure navigation_mode": "2\n", "shell dumpsys display": "no viewports", "shell wm size": "Physical size: 1080x2400\n" };
  for (const input of [undefined, "nothing useful"]) {
    const config = getDefaultRuntimeConfig({ deviceId: "dev", runner: runnerFor(input === undefined ? outputs : { ...outputs, "shell dumpsys input": input }) });
    await assert.rejects(readBackGestureDevice(config), (error: any) => error.code === "EXECUTION_VALIDATION_FAILED" && /rotation/.test(error.message), String(input));
  }
  const noSize = getDefaultRuntimeConfig({ deviceId: "dev", runner: runnerFor({ "shell settings get secure navigation_mode": "2\n", "shell dumpsys display": "none" }) });
  await assert.rejects(readBackGestureDevice(noSize), (error: any) => /display size/.test(error.message));
});
