import { randomUUID, createHash } from "node:crypto";
import type { ResultEnvelope } from "../../contracts/result.js";
import { verifyScreenshot } from "./screenshotMetadata.js";

export interface RenderBudget {
  /** Remaining host budget. Callbacks must honor this and the cancellation signal. */
  timeoutMs: number;
  signal: AbortSignal;
}
export interface RenderCaptureRequest extends RenderBudget {
  captureId: string;
  deviceId: string;
  conditionId: string;
  scale: 0.25 | 1;
}
export interface RenderFrame<Evidence> {
  captureId: string;
  deviceId: string;
  png: Buffer;
  backend: string;
  /** Native coordinate geometry, independently observed by the acquisition adapter. */
  source: { width: number; height: number; rotation: number; displayId: string };
  /** Adapter-owned keys for relevant window/hierarchy state around acquisition. */
  beforeKey: string;
  afterKey: string;
  evidence: Evidence;
}
export interface RenderDecision {
  semantic: { matched: boolean; reason: string };
  visual: { matched: boolean; reason: string };
}
export type RenderAdapterFailureReason = "device_not_ready" | "capture_unavailable"
  | "verification_unavailable" | "unsafe_observation";
const adapterFailureReasons: readonly RenderAdapterFailureReason[] = ["device_not_ready", "capture_unavailable", "verification_unavailable", "unsafe_observation"];
export interface RenderFailure {
  stage: "acquire" | "verify" | "validate";
  reason: RenderAdapterFailureReason | "callback_threw" | "invalid_field" | "not_cloneable"
    | "correlation_mismatch" | "geometry_changed" | "png_decode_failed" | "resolution_mismatch"
    | "verifier_mutation" | "deadline_exceeded" | "cancelled"
    | "reduced_capture_unavailable" | "reduced_budget_exhausted";
  /** Contract field name only; no arbitrary exception messages or field values. */
  field?: string;
}
/** Safe adapter classification; arbitrary messages, stacks and causes are never returned. */
export class RenderAdapterError extends Error {
  constructor(readonly reason: RenderAdapterFailureReason) {
    super(reason);
    if (!adapterFailureReasons.includes(reason)) {
      throw new TypeError("RenderAdapterError.reason must be device_not_ready, capture_unavailable, verification_unavailable or unsafe_observation; e.g. new RenderAdapterError('device_not_ready')");
    }
  }
}
export interface RenderAttempt<Evidence> {
  captureId: string;
  requestedScale: 0.25 | 1;
  /** All times here are host receipt/processing times, never device frame timestamps. */
  startedAt: string;
  elapsedMs: number;
  outcome: "rejected" | "accepted" | "failed";
  reason: string;
  failure?: RenderFailure;
  frame?: RenderFrame<Evidence>;
  image?: { width: number; height: number; sha256: string };
  decision?: RenderDecision;
}
export interface RenderRequest {
  action: ResultEnvelope;
  deviceId: string;
  conditionId: string;
  timeoutMs: number;
  /** Zero selects full-resolution checks only. Default: three quarter-size attempts. */
  reducedAttempts?: number;
  /** Default: two independently verified full-resolution attempts. */
  fullAttempts?: number;
  /** Reduced mode default: min(3000, max(1, floor(timeoutMs / 2))). Unused in full-only mode. */
  fallbackReserveMs?: number;
  signal?: AbortSignal;
}
export interface RenderResult<Evidence> {
  action: ResultEnvelope;
  conditionId: string;
  status: "verified" | "not_verified";
  code: "RENDER_VERIFIED" | "RENDER_NOT_VERIFIED" | "RENDER_TIMEOUT" | "RENDER_CANCELLED"
    | "RENDER_CALLBACK_FAILED" | "RENDER_INVALID_EVIDENCE" | "RENDER_BUSY" | "ACTION_NOT_SUCCESSFUL";
  /** Only this exact retained frame passed both checks; no later frame is substituted. */
  acceptedCaptureId?: string;
  elapsedMs: number;
  attempts: RenderAttempt<Evidence>[];
  failure?: RenderFailure;
}

/** Only an adapter-classified reduced transport/capability failure may bypass small retries. */
export class ReducedCaptureUnavailable extends Error {}

const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const digest = (png: Buffer) => createHash("sha256").update(png).digest("hex");
class Stop extends Error {
  constructor(readonly code: RenderResult<unknown>["code"], readonly failure?: RenderFailure) { super(code); }
}

/**
 * A serialized, read-only verification session. The caller supplies acquisition and
 * app-specific semantic/pixel checks. Neither callback may navigate or replay actions.
 * Separate sessions are not a cross-process/device lock or an atomic tree/frame API.
 */
export function createRenderVerifier<Evidence>(callbacks: {
  acquire(request: RenderCaptureRequest): Promise<RenderFrame<Evidence>>;
  verify(frame: RenderFrame<Evidence>, conditionId: string, budget: RenderBudget): Promise<RenderDecision>;
}): (request: RenderRequest) => Promise<RenderResult<Evidence>> {
  if (typeof callbacks?.acquire !== "function") throw new TypeError("acquire: must be an asynchronous acquisition function. Example: createRenderVerifier({acquire: acquireFreshObservation, verify: verifyExpectedPixelsAndSnapshot})");
  if (typeof callbacks?.verify !== "function") throw new TypeError("verify: must be an asynchronous semantic/pixel verifier. Example: createRenderVerifier({acquire: acquireFreshObservation, verify: verifyExpectedPixelsAndSnapshot})");
  let active = false;
  return async request => {
    const argument = (field: string, valid: boolean, expected: string, example: string) => {
      if (!valid) throw new TypeError(`${field}: ${expected}. Example: ${example}`);
    };
    argument("request", request !== null && typeof request === "object", "provide a RenderRequest object", "verifyRendering({action, deviceId, conditionId, timeoutMs: 1000})");
    argument("deviceId", nonblank(request.deviceId), "must be a nonblank string", "deviceId: 'selected-device'");
    argument("conditionId", nonblank(request.conditionId), "must be a nonblank string", "conditionId: 'destination'");
    argument("timeoutMs", Number.isInteger(request.timeoutMs) && request.timeoutMs >= 1 && request.timeoutMs <= 120000, "must be an integer in 1..120000", "timeoutMs: 1000");
    argument("action.commandId", nonblank(request.action?.commandId), "must be a nonblank string from the completed receipt", "action: clickResult.envelope");
    argument("action.taskId", nonblank(request.action?.taskId), "must be a nonblank string from the completed receipt", "action: clickResult.envelope");
    argument("action.status", ["success", "failed"].includes(request.action?.status), "must be success or failed", "action: clickResult.envelope");
    argument("action.stepResults", Array.isArray(request.action?.stepResults) && request.action.stepResults.length > 0
      && request.action.stepResults.every(step => step && typeof step.success === "boolean"), "must contain steps with boolean success fields", "action: clickResult.envelope");
    argument("signal", request.signal === undefined || request.signal instanceof AbortSignal, "must be an AbortSignal when supplied", "signal: abortController.signal");
    const reduced = request.reducedAttempts === undefined ? 3 : request.reducedAttempts;
    const full = request.fullAttempts === undefined ? 2 : request.fullAttempts;
    argument("reducedAttempts", Number.isInteger(reduced) && reduced >= 0 && reduced <= 3, "must be an integer in 0..3; zero selects full-only", "reducedAttempts: 0");
    argument("fullAttempts", Number.isInteger(full) && full >= 1 && full <= 3, "must be an integer in 1..3", "fullAttempts: 2");
    // Explicit values remain strict even when unused; an omitted full-only reserve is zero.
    if (request.fallbackReserveMs !== undefined) argument("fallbackReserveMs",
      Number.isInteger(request.fallbackReserveMs) && request.fallbackReserveMs >= 1 && request.fallbackReserveMs <= request.timeoutMs,
      "must be an integer in 1..timeoutMs when supplied", "timeoutMs: 1000, fallbackReserveMs: 500");
    const reserve = reduced === 0 ? 0 : request.fallbackReserveMs ?? Math.min(3000, Math.max(1, Math.floor(request.timeoutMs / 2)));
    request = { ...request };
    const start = performance.now();
    const action = structuredClone(request.action);
    const attempts: RenderAttempt<Evidence>[] = [];
    const result = (code: RenderResult<Evidence>["code"], acceptedCaptureId?: string, failure?: RenderFailure): RenderResult<Evidence> => ({
      action, conditionId: request.conditionId, status: code === "RENDER_VERIFIED" ? "verified" : "not_verified",
      code, acceptedCaptureId, elapsedMs: performance.now() - start, attempts,
      ...(failure ? { failure } : {}),
    });
    if (action.status !== "success" || action.stepResults.some(step => step.success !== true)) return result("ACTION_NOT_SUCCESSFUL");
    if (active) return result("RENDER_BUSY");
    active = true;
    let pending = 0, finished = false;
    const release = () => { if (finished && pending === 0) active = false; };
    const remaining = () => request.timeoutMs - (performance.now() - start);
    const check = () => {
      if (request.signal?.aborted) throw new Stop("RENDER_CANCELLED");
      if (remaining() <= 0) throw new Stop("RENDER_TIMEOUT");
    };
    async function bounded<T>(budgetMs: number, call: (budget: RenderBudget) => Promise<T>): Promise<T> {
      check();
      if (budgetMs <= 0) throw new Stop("RENDER_TIMEOUT");
      const callbackStarted = performance.now();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      let abort: () => void = () => undefined;
      const stopped = new Promise<never>((_resolve, reject) => {
        abort = () => { controller.abort(); reject(new Stop("RENDER_CANCELLED")); };
        request.signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { controller.abort(); reject(new Stop("RENDER_TIMEOUT")); }, budgetMs);
      });
      pending++;
      const work = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Stop("RENDER_CANCELLED");
        return call({ timeoutMs: Math.max(1, Math.floor(budgetMs)), signal: controller.signal });
      }).finally(() => { pending--; release(); });
      try {
        const value = await Promise.race([work, stopped]);
        check();
        if (performance.now() - callbackStarted >= budgetMs) throw new Stop("RENDER_TIMEOUT");
        return value;
      } finally {
        clearTimeout(timer!);
        request.signal?.removeEventListener("abort", abort);
        controller.abort();
      }
    }
    try {
      let useFull = reduced === 0;
      let geometry: string | undefined;
      for (let index = 0; index < reduced + full; index++) {
        check();
        if (!useFull && (index >= reduced || remaining() <= reserve)) useFull = true;
        // Skip unused small attempts; full attempts always retain their own bound.
        if (useFull && index < reduced) index = reduced;
        const scale = useFull ? 1 : 0.25;
        const attemptStart = performance.now();
        const attempt: RenderAttempt<Evidence> = { captureId: randomUUID(), requestedScale: scale,
          startedAt: new Date().toISOString(), elapsedMs: 0, outcome: "failed", reason: "acquisition_failed" };
        attempts.push(attempt);
        const budget = () => remaining() - (useFull ? 0 : reserve);
        let acquiredFrame = false;
        let stage: RenderFailure["stage"] = "acquire";
        function invalid(field: string, reason: RenderFailure["reason"] = "invalid_field"): never {
          throw new Stop("RENDER_INVALID_EVIDENCE", { stage: "validate", reason, field });
        };
        try {
          const acquired = await bounded(budget(), b => callbacks.acquire({ ...b, captureId: attempt.captureId, deviceId: request.deviceId, conditionId: request.conditionId, scale }));
          // Own the retained bytes: verifier mutation cannot alter the returned image.
          acquiredFrame = true;
          stage = "validate";
          if (!acquired || !Buffer.isBuffer(acquired.png) || acquired.png.length > 64 * 1024 * 1024) invalid("png");
          let frame: RenderFrame<Evidence>;
          try { frame = { ...structuredClone({ ...acquired, png: undefined }), png: Buffer.from(acquired.png) }; }
          catch { invalid("frame", "not_cloneable"); }
          attempt.frame = frame;
          const source = frame.source;
          if (frame.captureId !== attempt.captureId) invalid("captureId", "correlation_mismatch");
          if (frame.deviceId !== request.deviceId) invalid("deviceId", "correlation_mismatch");
          if (!nonblank(frame.backend)) invalid("backend");
          if (!source) invalid("source");
          if (!Number.isSafeInteger(source.width) || source.width < 1) invalid("source.width");
          if (!Number.isSafeInteger(source.height) || source.height < 1) invalid("source.height");
          if (![0, 1, 2, 3].includes(source.rotation)) invalid("source.rotation");
          if (!nonblank(source.displayId)) invalid("source.displayId");
          if (!nonblank(frame.beforeKey)) invalid("beforeKey");
          if (!nonblank(frame.afterKey)) invalid("afterKey");
          const currentGeometry = JSON.stringify([source.width, source.height, source.rotation, source.displayId]);
          if (geometry !== undefined && currentGeometry !== geometry) invalid("source", "geometry_changed");
          geometry = currentGeometry;
          let metadata;
          try { metadata = verifyScreenshot(frame.png); } catch { invalid("png", "png_decode_failed"); }
          attempt.image = { width: metadata.captureWidthPx, height: metadata.captureHeightPx, sha256: digest(frame.png) };
          if (metadata.captureWidthPx !== Math.max(1, Math.floor(source.width * scale))
            || metadata.captureHeightPx !== Math.max(1, Math.floor(source.height * scale))) invalid("png.dimensions", "resolution_mismatch");
          if (frame.beforeKey !== frame.afterKey) {
            attempt.outcome = "rejected"; attempt.reason = "context_changed"; continue;
          }
          attempt.reason = "verification_failed";
          const verifierFrame = { ...structuredClone(frame), png: Buffer.from(frame.png) };
          stage = "verify";
          const decision = await bounded(budget(), b => callbacks.verify(verifierFrame, request.conditionId, b));
          stage = "validate";
          if (!Buffer.isBuffer(verifierFrame.png) || digest(verifierFrame.png) !== attempt.image.sha256) invalid("png", "verifier_mutation");
          if (JSON.stringify(verifierFrame.source) !== JSON.stringify(frame.source)) invalid("source", "verifier_mutation");
          if (typeof decision?.semantic?.matched !== "boolean") invalid("decision.semantic.matched");
          if (!nonblank(decision.semantic.reason)) invalid("decision.semantic.reason");
          if (typeof decision?.visual?.matched !== "boolean") invalid("decision.visual.matched");
          if (!nonblank(decision.visual.reason)) invalid("decision.visual.reason");
          attempt.decision = { semantic: { matched: decision.semantic.matched, reason: decision.semantic.reason },
            visual: { matched: decision.visual.matched, reason: decision.visual.reason } };
          check();
          if (decision.semantic.matched && decision.visual.matched) {
            attempt.outcome = "accepted"; attempt.reason = "condition_matched";
            attempt.elapsedMs = performance.now() - attemptStart;
            return result("RENDER_VERIFIED", attempt.captureId);
          }
          attempt.outcome = "rejected"; attempt.reason = "condition_not_matched";
        } catch (error) {
          if (error instanceof ReducedCaptureUnavailable && !useFull && !acquiredFrame) {
            attempt.reason = "reduced_capture_unavailable";
            attempt.failure = { stage, reason: "reduced_capture_unavailable" }; useFull = true;
          } else if (error instanceof Stop && error.code === "RENDER_TIMEOUT" && !useFull && pending === 0 && remaining() > 0) {
            attempt.reason = "reduced_budget_exhausted";
            attempt.failure = { stage, reason: "reduced_budget_exhausted" }; useFull = true;
          } else {
            const code = error instanceof Stop ? error.code : "RENDER_CALLBACK_FAILED";
            attempt.reason = code;
            attempt.failure = error instanceof Stop && error.failure ? error.failure : { stage,
              reason: code === "RENDER_TIMEOUT" ? "deadline_exceeded" : code === "RENDER_CANCELLED" ? "cancelled"
                : error instanceof RenderAdapterError && adapterFailureReasons.includes(error.reason) ? error.reason : "callback_threw" };
            return result(code, undefined, attempt.failure);
          }
        } finally { attempt.elapsedMs = performance.now() - attemptStart; }
      }
      return result("RENDER_NOT_VERIFIED");
    } catch (error) {
      return result(error instanceof Stop ? error.code : "RENDER_CALLBACK_FAILED");
    } finally { finished = true; release(); }
  };
}
