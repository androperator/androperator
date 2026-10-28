import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPathGestureParams, parseGesturePath } from "../../domain/actions/gesture.js";
import { buildDragExecution } from "../../domain/actions/drag.js";
import { validateExecution } from "../../domain/executions/validateExecution.js";

const cli = fileURLToPath(new URL("../../cli/index.js", import.meta.url));

it("parses a quoted point list and rejects malformed points", () => {
  assert.deepEqual(parseGesturePath("3,1500 400,1500"), [{ x: 3, y: 1500 }, { x: 400, y: 1500 }]);
  assert.deepEqual(parseGesturePath("  3,1500   400,1500 "), [{ x: 3, y: 1500 }, { x: 400, y: 1500 }]);
  for (const bad of ["", "3,1500", "3 1500", "3,1500 x,2", "3,1500 -4,2", "3,1500 4.5,2", "3,1500 4,2,5", ...[1, 2, 3, 8].map(n => Array.from({ length: n + 10 }, (_, i) => `${i},0`).join(" "))]) {
    assert.throws(() => parseGesturePath(bad), /./, bad);
  }
});

it("a straight path maps to a drag with a 1 ms initial hold and the whole duration on the move", () => {
  assert.deepEqual(buildPathGestureParams([{ x: 3, y: 1500 }, { x: 800, y: 1500 }], 400), {
    start: { x: 3, y: 1500 }, end: { x: 800, y: 1500 }, holdDurationMs: 1, moveDurationMs: 400,
  });
});

it("an out-and-back path keeps the pointer down through its turn and may end where it started", () => {
  const params = buildPathGestureParams([{ x: 3, y: 1500 }, { x: 400, y: 1500 }, { x: 3, y: 1500 }], 1000);
  assert.deepEqual(params, {
    start: { x: 3, y: 1500 }, end: { x: 3, y: 1500 }, holdDurationMs: 1, moveDurationMs: 500,
    waypoints: [{ x: 400, y: 1500, durationMs: 500 }],
  });
  assert.doesNotThrow(() => validateExecution(buildDragExecution(params)));
});

it("the duration is split across legs without losing milliseconds", () => {
  const params = buildPathGestureParams([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }], 1000);
  const legs = [...(params.waypoints ?? []).map(w => w.durationMs), params.moveDurationMs];
  assert.equal(legs.reduce((a, b) => a + b, 0), 1000);
  assert.ok(legs.every(leg => leg >= 333 && leg <= 334), JSON.stringify(legs));
});

it("a final hold keeps the pointer down at the last point before release", () => {
  const params = buildPathGestureParams([{ x: 3, y: 1500 }, { x: 400, y: 1500 }], 300, 700);
  assert.deepEqual(params, {
    start: { x: 3, y: 1500 }, end: { x: 400, y: 1500 }, holdDurationMs: 1, moveDurationMs: 700,
    waypoints: [{ x: 400, y: 1500, durationMs: 300 }],
  });
  assert.doesNotThrow(() => validateExecution(buildDragExecution(params)));
});

it("a long path keeps within the eight-waypoint limit, counting the last point when holding", () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
  assert.equal(buildPathGestureParams(ten, 900).waypoints?.length, 8);
  assert.throws(() => buildPathGestureParams(ten, 900, 100), /too long/);
  assert.equal(buildPathGestureParams(ten.slice(0, 9), 800, 100).waypoints?.length, 8);
});

it("rejects a path that never moves, too many points and durations that cannot be split", () => {
  assert.throws(() => buildPathGestureParams([{ x: 1, y: 1 }, { x: 1, y: 1 }], 300), /move/);
  assert.throws(() => buildPathGestureParams([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 1), /duration/);
  assert.throws(() => buildPathGestureParams([{ x: 0, y: 0 }, { x: 1, y: 0 }], 10001), /duration/);
  assert.throws(() => buildPathGestureParams([{ x: 0, y: 0 }, { x: 1, y: 0 }], 300, 10001), /hold/);
});

it("gesture CLI reports structured validation errors with exit 1", () => {
  const base = ["gesture", "--path", "3,1500 400,1500", "--duration-ms", "300"];
  for (const args of [
    ["gesture"], ["gesture", "--path", "3,1500 400,1500"], ["gesture", "--duration-ms", "300"],
    ["gesture", "--path", "3,1500", "--duration-ms", "300"], [...base, "--hold-ms", "-1"], [...base, "extra"],
    [...base, "--duration-ms", "400"], ["gesture", "--path", "3,1500 3,1500", "--duration-ms", "300"],
    ["gesture", "--path", "3,1500 400,1500", "--duration-ms", "0"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(JSON.parse(result.stdout).code, "EXECUTION_VALIDATION_FAILED", result.stdout);
  }
});

it("gesture CLI accepts a valid path with global flags before or after the command", () => {
  for (const args of [
    ["--device", "not-a-device", "gesture", "--path", "3,1500 400,1500 3,1500", "--duration-ms", "800", "--hold-ms", "200"],
    ["gesture", "--path", "3,1500 400,1500", "--duration-ms", "300", "--device", "not-a-device"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.notEqual(JSON.parse(result.stdout).code, "EXECUTION_VALIDATION_FAILED", result.stdout);
  }
});

it("a long path gets an execution timeout that covers its movement, holds and overhead", async () => {
  const { cmdActionDrag } = await import("../../cli/commands/action.js");
  const timeouts: number[] = [];
  const run = (params: Parameters<typeof buildPathGestureParams>, timeoutMs?: number) => cmdActionDrag({
    ...buildPathGestureParams(...params), format: "json", timeoutMs,
    tryDaemonExecutionFn: async () => null,
    runExecutionFn: async (execution: unknown) => { timeouts.push((execution as { timeoutMs: number }).timeoutMs); return { ok: false, error: "stop" } as never; },
  });
  await run([[{ x: 1, y: 1 }, { x: 900, y: 1 }, { x: 1, y: 1 }], 20000, 10000]);
  assert.ok(timeouts[0] >= 31001 + 5000, `timeout ${timeouts[0]} must exceed 31001 ms of gesture`);
  await run([[{ x: 1, y: 1 }, { x: 900, y: 1 }], 300]);
  assert.equal(timeouts[1], 30000, "short gestures keep the existing default");
  await run([[{ x: 1, y: 1 }, { x: 900, y: 1 }, { x: 1, y: 1 }], 20000, 10000], 90000);
  assert.equal(timeouts[2], 90000, "an explicit timeout is preserved");
});
