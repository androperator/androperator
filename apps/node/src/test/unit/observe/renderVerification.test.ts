import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";
import { createRenderVerifier, ReducedCaptureUnavailable, type RenderFrame, type RenderRequest, type RenderCaptureRequest } from "../../../domain/observe/renderVerification.js";

const action = { commandId: "click-1", taskId: "task-1", status: "success" as const,
  stepResults: [{ id: "click", actionType: "click", success: true, data: {} }] };
const request = (overrides: Partial<RenderRequest> = {}): RenderRequest => ({ action, deviceId: "test-device", conditionId: "destination-and-content",
  timeoutMs: 500, fallbackReserveMs: 100, ...overrides });
const decision = (semantic = true, visual = true) => ({ semantic: { matched: semantic, reason: "snapshot condition" }, visual: { matched: visual, reason: "pixel condition" } });
function frame(r: RenderCaptureRequest, label = "new"): RenderFrame<string> {
  const png = new PNG({ width: 8 * r.scale, height: 8 * r.scale });
  return { captureId: r.captureId, deviceId: "test-device", png: PNG.sync.write(png), backend: "test",
    source: { width: 8, height: 8, rotation: 0, displayId: "display-1" }, beforeKey: label, afterKey: label, evidence: label };
}

test("rejects old pixels despite matching tree, then returns exactly the freshly verified reduced frame", async () => {
  let count = 0;
  const run = createRenderVerifier({ acquire: async r => frame(r, ++count === 1 ? "old" : "new"),
    verify: async f => decision(true, f.evidence === "new") });
  const result = await run(request());
  assert.equal(result.status, "verified"); assert.equal(count, 2);
  assert.deepEqual(result.action, action);
  assert.deepEqual(result.attempts.map(a => a.outcome), ["rejected", "accepted"]);
  assert.equal(result.acceptedCaptureId, result.attempts[1].captureId);
  assert.equal(result.attempts[1].image!.sha256, createHash("sha256").update(result.attempts[1].frame!.png).digest("hex"));
});

test("small attempts are bounded and full fallback must independently pass BOTH conditions", async () => {
  const scales: number[] = [];
  const run = createRenderVerifier({ acquire: async r => { scales.push(r.scale); return frame(r); }, verify: async f => decision(true, f.png.readUInt32BE(16) === 8) });
  const result = await run(request());
  assert.deepEqual(scales, [0.25, 0.25, 0.25, 1]); assert.equal(result.status, "verified");
  for (const [semantic, visual] of [[true, false], [false, true]]) {
    const fail = createRenderVerifier({ acquire: async r => frame(r), verify: async () => decision(semantic, visual) });
    const result = await fail(request());
    assert.equal(result.code, "RENDER_NOT_VERIFIED"); assert.equal(result.attempts.length, 5);
    assert.equal(result.acceptedCaptureId, undefined); assert.deepEqual(result.action, action);
  }
});

test("rejects acquisition context changes and delayed content even when title would match", async () => {
  let count = 0;
  const run = createRenderVerifier({ acquire: async r => { const f = frame(r, String(++count)); if (count === 1) f.afterKey = "changed"; return f; },
    verify: async f => decision(true, f.evidence === "3") });
  const result = await run(request());
  assert.equal(result.status, "verified"); assert.equal(result.attempts[0].reason, "context_changed");
  assert.equal(result.attempts[1].decision!.visual.matched, false); assert.equal(result.attempts.length, 3);
});

test("fails closed on wrong device, capture correlation, invalid PNG, resolution and rotation change", async () => {
  for (const change of [
    (f: RenderFrame<string>) => { f.deviceId = "other"; },
    (f: RenderFrame<string>) => { f.captureId = "old-capture"; },
    (f: RenderFrame<string>) => { f.png = Buffer.from("not png"); },
    (f: RenderFrame<string>) => { f.source.width = 20; },
  ]) {
    const run = createRenderVerifier({ acquire: async r => { const f = frame(r); change(f); return f; }, verify: async () => decision() });
    const result = await run(request()); assert.equal(result.code, "RENDER_INVALID_EVIDENCE"); assert.equal(result.attempts.length, 1);
  }
  let count = 0;
  const run = createRenderVerifier({ acquire: async r => { const f = frame(r); f.source.rotation = count++; return f; }, verify: async () => decision(false) });
  assert.equal((await run(request())).code, "RENDER_INVALID_EVIDENCE");
});

test("only classified reduced acquisition failure permits fallback; policy and verifier errors stop", async () => {
  const scales: number[] = [];
  const run = createRenderVerifier({ acquire: async r => { scales.push(r.scale); if (r.scale < 1) throw new ReducedCaptureUnavailable(); return frame(r); }, verify: async () => decision() });
  assert.equal((await run(request())).status, "verified"); assert.deepEqual(scales, [0.25, 1]);
  for (const acquireFails of [true, false]) {
    let count = 0;
    const stop = createRenderVerifier({ acquire: async r => { count++; if (acquireFails) throw Error("locked or protected"); return frame(r); },
      verify: async () => { throw new ReducedCaptureUnavailable("verifier failure is not capture fallback"); } });
    assert.equal((await stop(request())).code, "RENDER_CALLBACK_FAILED"); assert.equal(count, 1);
  }
});

test("reserves fallback time instead of starting small work, and supports full-only policy", async () => {
  for (const options of [{ timeoutMs: 50, fallbackReserveMs: 50 }, { reducedAttempts: 0 }]) {
    const scales: number[] = [];
    const run = createRenderVerifier({ acquire: async r => { scales.push(r.scale); return frame(r); }, verify: async () => decision() });
    assert.equal((await run(request(options))).status, "verified"); assert.deepEqual(scales, [1]);
  }
});

test("deadline covers verifier and late callbacks cannot publish or overlap another operation", async () => {
  let finish!: () => void;
  const run = createRenderVerifier({ acquire: async r => frame(r), verify: async () => { await new Promise<void>(resolve => { finish = resolve; }); return decision(); } });
  const result = await run(request({ timeoutMs: 30, fallbackReserveMs: 1, reducedAttempts: 0 }));
  assert.equal(result.code, "RENDER_TIMEOUT"); assert.equal(result.acceptedCaptureId, undefined);
  assert.equal((await run(request())).code, "RENDER_BUSY");
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.status, "not_verified");
});

test("cancellation stops checks, preserves action success and never retries navigation", async () => {
  const controller = new AbortController(); let captures = 0;
  const run = createRenderVerifier({ acquire: async r => { captures++; return frame(r); }, verify: async () => { controller.abort(); return decision(); } });
  const result = await run(request({ signal: controller.signal }));
  assert.equal(result.code, "RENDER_CANCELLED"); assert.deepEqual(result.action, action); assert.equal(captures, 1);
  const cancelled = await run(request({ signal: AbortSignal.abort() })); assert.equal(cancelled.code, "RENDER_CANCELLED"); assert.equal(captures, 1);
});

test("a failed action never starts observation; request/verifier contracts stay strict", async () => {
  let captures = 0;
  const run = createRenderVerifier({ acquire: async r => { captures++; return frame(r); }, verify: async () => ({} as ReturnType<typeof decision>) });
  assert.equal((await run(request({ action: { ...action, status: "failed" } }))).code, "ACTION_NOT_SUCCESSFUL"); assert.equal(captures, 0);
  for (const options of [{ conditionId: "" }, { deviceId: " " }, { reducedAttempts: 4 }, { fullAttempts: 0 }, { timeoutMs: 0 }, { fallbackReserveMs: 501 }]) {
    await assert.rejects(run(request(options)), TypeError);
  }
  assert.equal((await run(request())).code, "RENDER_INVALID_EVIDENCE");
});

test("verifier mutation is rejected without corrupting retained evidence", async () => {
  const run = createRenderVerifier({ acquire: async r => frame(r), verify: async f => { assert.ok(Buffer.isBuffer(f.png)); f.png.fill(0); f.source.rotation = 3; return decision(); } });
  const result = await run(request());
  assert.equal(result.code, "RENDER_INVALID_EVIDENCE"); assert.equal(result.attempts[0].frame!.source.rotation, 0);
  assert.equal(result.attempts[0].frame!.png.subarray(1, 4).toString(), "PNG");
});

test("a settled callback that overruns its small budget cannot consume fallback reserve silently", async () => {
  const scales: number[] = [];
  const run = createRenderVerifier({ acquire: async r => { scales.push(r.scale); return frame(r); },
    verify: async f => {
      if (f.png.readUInt32BE(16) === 2) {
        const start = performance.now();
        // Simulate an incorrectly blocking verifier whose timer cannot fire on time.
        while (performance.now() - start < 30) { /* bounded fixture */ }
      }
      return decision();
    } });
  const result = await run(request({ timeoutMs: 500, fallbackReserveMs: 490 }));
  assert.equal(result.status, "verified"); assert.deepEqual(scales, [0.25, 1]);
  assert.equal(result.attempts[0].reason, "reduced_budget_exhausted");
});

test("short timeouts need no reserve override in full-only or reduced mode", async () => {
  for (const reducedAttempts of [0, 3]) {
    const seen: RenderCaptureRequest[] = [];
    const run = createRenderVerifier({ acquire: async r => { seen.push(r); return frame(r); }, verify: async () => decision() });
    const result = await run({ action, deviceId: "test-device", conditionId: "destination", timeoutMs: 1000, reducedAttempts });
    assert.equal(result.code, "RENDER_VERIFIED");
    assert.equal(seen[0].scale, reducedAttempts ? 0.25 : 1);
    assert.ok(seen[0].timeoutMs <= (reducedAttempts ? 500 : 1000));
    assert.ok(seen[0].timeoutMs > 0);
  }
});

test("argument errors name the invalid field, valid range and example without echoing values", async () => {
  const run = createRenderVerifier({ acquire: async r => frame(r), verify: async () => decision() });
  for (const [options, field] of [
    [{ deviceId: "" }, "deviceId"], [{ conditionId: " " }, "conditionId"], [{ timeoutMs: undefined }, "timeoutMs"],
    [{ timeoutMs: 0 }, "timeoutMs"], [{ reducedAttempts: null }, "reducedAttempts"],
    [{ fullAttempts: 4 }, "fullAttempts"], [{ fallbackReserveMs: 0 }, "fallbackReserveMs"],
    [{ reducedAttempts: 0, fallbackReserveMs: 501 }, "fallbackReserveMs"],
  ] as const) {
    await assert.rejects(run(request(options as Partial<RenderRequest>)), error => {
      assert.ok(error instanceof TypeError); assert.ok(error.message.startsWith(field + ":"));
      assert.match(error.message, /Example:/); return true;
    });
  }
});

test("acquisition receives each call's device and condition without shared mutable context", async () => {
  const seen: string[] = [];
  const run = createRenderVerifier({ acquire: async r => {
    seen.push(`${r.deviceId}/${r.conditionId}`); return { ...frame(r), deviceId: r.deviceId };
  }, verify: async (_f, condition) => decision(condition.startsWith("destination-")) });
  for (const id of ["one", "two"]) assert.equal((await run(request({ deviceId: id, conditionId: `destination-${id}` }))).status, "verified");
  assert.deepEqual(seen, ["one/destination-one", "two/destination-two"]);
});

test("failures identify acquisition, verification or the invalid evidence field without leaking exceptions", async () => {
  const { RenderAdapterError } = await import("../../../renderVerification.js");
  for (const stage of ["acquire", "verify"] as const) {
    const run = createRenderVerifier({
      acquire: async r => { if (stage === "acquire") throw Error("private-token"); return frame(r); },
      verify: async () => { throw new RenderAdapterError("verification_unavailable"); },
    });
    const result = await run(request());
    assert.deepEqual(result.failure, { stage, reason: stage === "acquire" ? "callback_threw" : "verification_unavailable" });
    assert.deepEqual(result.failure, result.attempts[0].failure);
    assert.ok(!JSON.stringify(result).includes("private-token"));
  }
  const badDevice = createRenderVerifier({ acquire: async r => ({ ...frame(r), deviceId: "other" }), verify: async () => decision() });
  assert.deepEqual((await badDevice(request())).failure, { stage: "validate", reason: "correlation_mismatch", field: "deviceId" });
  const badPng = createRenderVerifier({ acquire: async r => ({ ...frame(r), png: Buffer.from("private-token") }), verify: async () => decision() });
  assert.deepEqual((await badPng(request())).failure, { stage: "validate", reason: "png_decode_failed", field: "png" });
  const classified = new RenderAdapterError("device_not_ready");
  Object.assign(classified, { reason: "private-token" });
  const tampered = createRenderVerifier({ acquire: async () => { throw classified; }, verify: async () => decision() });
  assert.equal((await tampered(request())).failure?.reason, "callback_threw");
});
