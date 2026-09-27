#!/usr/bin/env node
// Local-only smoke/benchmark. Run separate processes to model independent agents.
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { runExecution } from "../../apps/node/dist/domain/executions/runExecution.js";

const { values } = parseArgs({ options: {
  device: { type: "string" },
  transport: { type: "string", default: "direct" },
  "operator-package": { type: "string", default: "com.clawperator.operator.dev" },
  iterations: { type: "string", default: "3" },
  "sleep-ms": { type: "string", default: "0" },
} });
const iterations = Number(values.iterations);
const sleepMs = Number(values["sleep-ms"]);
if (!values.device?.trim() || !["direct", "logcat"].includes(values.transport) ||
    !Number.isInteger(iterations) || iterations < 1 || iterations > 20 ||
    !Number.isInteger(sleepMs) || sleepMs < 0 || sleepMs > 10_000) {
  throw new Error("Use --device <serial> --transport direct|logcat --iterations 1..20 --sleep-ms 0..10000");
}
for (let iteration = 1; iteration <= iterations; iteration++) {
  const events = [];
  const logger = {
    emit(event) { if (event.event === "transport.direct.timing") events.push(JSON.parse(event.message)); },
    status() { return { status: "disabled" }; },
    logPath() { return undefined; },
    child() { return this; },
  };
  const commandId = `direct-probe-${randomUUID()}`;
  const started = performance.now();
  const result = await runExecution({ commandId, taskId: "direct-result-probe", source: "debug", expectedFormat: "android-ui-automator", timeoutMs: 30_000,
    actions: [...(sleepMs > 0 ? [{ id: "sleep", type: "sleep", params: { durationMs: sleepMs } }] : []), { id: "snapshot", type: "snapshot" }],
  }, { deviceId: values.device, operatorPackage: values["operator-package"], resultTransport: values.transport, logger });
  const step = result.ok ? result.envelope.stepResults.find(step => step.id === "snapshot") : undefined;
  const text = step?.data.text;
  const passed = result.ok && result.envelope.status === "success" && step?.success && typeof text === "string" && text.trimEnd().endsWith("</hierarchy>");
  console.log(JSON.stringify({ iteration, deviceId: values.device, commandId, transport: values.transport,
    passed: Boolean(passed), totalExecutionMs: performance.now() - started, snapshotBytes: typeof text === "string" ? Buffer.byteLength(text) : 0,
    transportTimings: events, ...(passed ? {} : { error: result.ok ? { status: result.envelope.status, stepError: step?.data.error } : result.error }) }));
  if (!passed) { process.exitCode = 1; break; }
}
