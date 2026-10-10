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
export interface RenderAttempt<Evidence> {
  captureId: string;
  requestedScale: 0.25 | 1;
  /** All times here are host receipt/processing times, never device frame timestamps. */
  startedAt: string;
  elapsedMs: number;
  outcome: "rejected" | "accepted" | "failed";
  reason: string;
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
  /** Budget kept for full-resolution acquisition AND verification. Default: 3000 ms. */
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
}

/** Only an adapter-classified reduced transport/capability failure may bypass small retries. */
export class ReducedCaptureUnavailable extends Error {}

const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const digest = (png: Buffer) => createHash("sha256").update(png).digest("hex");
class Stop extends Error {
  constructor(readonly code: RenderResult<unknown>["code"]) { super(code); }
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
  if (typeof callbacks?.acquire !== "function" || typeof callbacks?.verify !== "function") {
    throw new TypeError("Acquisition and semantic/pixel verification callbacks are required");
  }
  let active = false;
  return async request => {
    if (!nonblank(request.deviceId) || !nonblank(request.conditionId)
      || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 120000
      || !nonblank(request.action?.commandId) || !nonblank(request.action?.taskId)
      || !["success", "failed"].includes(request.action?.status) || !Array.isArray(request.action?.stepResults)
      || request.action.stepResults.length === 0 || request.action.stepResults.some(step => !step || typeof step.success !== "boolean")) {
      throw new TypeError("Explicit device, condition, action receipt and timeoutMs (1..120000) are required");
    }
    const reduced = request.reducedAttempts ?? 3;
    const full = request.fullAttempts ?? 2;
    const reserve = request.fallbackReserveMs ?? 3000;
    if (!Number.isInteger(reduced) || reduced < 0 || reduced > 3
      || !Number.isInteger(full) || full < 1 || full > 3
      || !Number.isInteger(reserve) || reserve < 1 || reserve > request.timeoutMs) {
      throw new TypeError("Invalid bounded rendering retry or fallback budget");
    }
    request = { ...request };
    const start = performance.now();
    const action = structuredClone(request.action);
    const attempts: RenderAttempt<Evidence>[] = [];
    const result = (code: RenderResult<Evidence>["code"], acceptedCaptureId?: string): RenderResult<Evidence> => ({
      action, conditionId: request.conditionId, status: code === "RENDER_VERIFIED" ? "verified" : "not_verified",
      code, acceptedCaptureId, elapsedMs: performance.now() - start, attempts,
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
        try {
          const acquired = await bounded(budget(), b => callbacks.acquire({ ...b, captureId: attempt.captureId, scale }));
          // Own the retained bytes: verifier mutation cannot alter the returned image.
          acquiredFrame = true;
          if (!acquired || !Buffer.isBuffer(acquired.png) || acquired.png.length > 64 * 1024 * 1024) throw new Stop("RENDER_INVALID_EVIDENCE");
          const frame = { ...structuredClone({ ...acquired, png: undefined }), png: Buffer.from(acquired.png) };
          attempt.frame = frame;
          const source = frame.source;
          if (frame.captureId !== attempt.captureId || frame.deviceId !== request.deviceId || !nonblank(frame.backend)
            || !source || !Number.isSafeInteger(source.width) || source.width < 1 || !Number.isSafeInteger(source.height) || source.height < 1
            || ![0, 1, 2, 3].includes(source.rotation) || !nonblank(source.displayId)
            || !nonblank(frame.beforeKey) || !nonblank(frame.afterKey)) throw new Stop("RENDER_INVALID_EVIDENCE");
          const currentGeometry = JSON.stringify([source.width, source.height, source.rotation, source.displayId]);
          if (geometry !== undefined && currentGeometry !== geometry) throw new Stop("RENDER_INVALID_EVIDENCE");
          geometry = currentGeometry;
          let metadata;
          try { metadata = verifyScreenshot(frame.png); } catch { throw new Stop("RENDER_INVALID_EVIDENCE"); }
          attempt.image = { width: metadata.captureWidthPx, height: metadata.captureHeightPx, sha256: digest(frame.png) };
          if (metadata.captureWidthPx !== Math.max(1, Math.floor(source.width * scale))
            || metadata.captureHeightPx !== Math.max(1, Math.floor(source.height * scale))) throw new Stop("RENDER_INVALID_EVIDENCE");
          if (frame.beforeKey !== frame.afterKey) {
            attempt.outcome = "rejected"; attempt.reason = "context_changed"; continue;
          }
          attempt.reason = "verification_failed";
          const verifierFrame = { ...structuredClone(frame), png: Buffer.from(frame.png) };
          const decision = await bounded(budget(), b => callbacks.verify(verifierFrame, request.conditionId, b));
          if (digest(verifierFrame.png) !== attempt.image.sha256
            || JSON.stringify(verifierFrame.source) !== JSON.stringify(frame.source)) throw new Stop("RENDER_INVALID_EVIDENCE");
          if (typeof decision?.semantic?.matched !== "boolean" || !nonblank(decision.semantic.reason)
            || typeof decision?.visual?.matched !== "boolean" || !nonblank(decision.visual.reason)) throw new Stop("RENDER_INVALID_EVIDENCE");
          attempt.decision = structuredClone(decision);
          check();
          if (decision.semantic.matched && decision.visual.matched) {
            attempt.outcome = "accepted"; attempt.reason = "condition_matched";
            attempt.elapsedMs = performance.now() - attemptStart;
            return result("RENDER_VERIFIED", attempt.captureId);
          }
          attempt.outcome = "rejected"; attempt.reason = "condition_not_matched";
        } catch (error) {
          if (error instanceof ReducedCaptureUnavailable && !useFull && !acquiredFrame) {
            attempt.reason = "reduced_capture_unavailable"; useFull = true;
          } else if (error instanceof Stop && error.code === "RENDER_TIMEOUT" && !useFull && pending === 0 && remaining() > 0) {
            attempt.reason = "reduced_budget_exhausted"; useFull = true;
          } else {
            const code = error instanceof Stop ? error.code : "RENDER_CALLBACK_FAILED";
            attempt.reason = code;
            return result(code);
          }
        } finally { attempt.elapsedMs = performance.now() - attemptStart; }
      }
      return result("RENDER_NOT_VERIFIED");
    } catch (error) {
      return result(error instanceof Stop ? error.code : "RENDER_CALLBACK_FAILED");
    } finally { finished = true; release(); }
  };
}
