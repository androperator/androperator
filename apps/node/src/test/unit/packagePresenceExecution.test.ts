import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { NodeProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import { startServer } from "../../cli/commands/serve.js";
import { runExecution, type RunExecutionResult } from "../../domain/executions/runExecution.js";
import { createAndroperatorLogger } from "../../adapters/logger.js";

const primary = "com.androperator.operator.dev";
const alternate = "com.androperator.operator";
const cases = [
  { name: "primary query failure", mode: "primary", code: "DEVICE_SHELL_UNAVAILABLE", queried: primary },
  { name: "alternate query failure", mode: "alternate", code: "DEVICE_SHELL_UNAVAILABLE", queried: alternate },
  { name: "confirmed absence", mode: "missing", code: "OPERATOR_NOT_INSTALLED" },
  { name: "variant mismatch", mode: "variant", code: "OPERATOR_VARIANT_MISMATCH" },
];

for (const scenario of cases) {
  it(`preserves ${scenario.name} through execution and daemon HTTP snapshot`, async (t) => {
    const readerClosures: Promise<void>[] = [];
    const spawn = NodeProcessRunner.prototype.spawn;
    t.mock.method(NodeProcessRunner.prototype, "spawn", function (this: NodeProcessRunner, ...args: Parameters<typeof spawn>) {
      const child = spawn.apply(this, args) as ChildProcess;
      readerClosures.push(new Promise<void>(resolve => child.once("close", () => resolve())));
      return child;
    });
    const dir = await mkdtemp(join(tmpdir(), "package-presence-"));
    const previousPath = process.env.PATH;
    const callsPath = join(dir, "calls");
    // Synthetic adb: exercise the real check, execution and HTTP serialization.
    await writeFile(join(dir, "adb"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n");
if (args.includes("logcat")) { setInterval(() => {}, 1000); }
else if (args.includes("devices")) { console.log("List of devices attached\\ntest-device\\tdevice"); }
else if (args.includes("packages")) {
  const pkg = args.at(-1);
  if ((${JSON.stringify(scenario.mode)} === "primary" && pkg === ${JSON.stringify(primary)}) ||
      (${JSON.stringify(scenario.mode)} === "alternate" && pkg === ${JSON.stringify(alternate)})) {
    console.error("synthetic package query failure"); process.exit(7);
  }
  if (${JSON.stringify(scenario.mode)} === "variant" && pkg === ${JSON.stringify(alternate)}) console.log("package:" + pkg);
} else { console.error("unexpected adb call"); process.exit(99); }
`, { mode: 0o755 });
    process.env.PATH = `${dir}:${previousPath}`;
    const logger = createAndroperatorLogger({ logDir: dir, outputFormat: "json" });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      const execution = {
        commandId: "package-query-command", taskId: "package-query-task",
        source: "test", expectedFormat: "android-ui-automator", timeoutMs: 5000,
        actions: [{ id: "snap", type: "snapshot" }],
      };
      const direct = await runExecution(execution, { deviceId: "test-device", operatorPackage: primary, logger });
      server = await startServer({ port: 0, host: "127.0.0.1", verbose: false, logger });
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const response = await fetch(`http://127.0.0.1:${address.port}/snapshot`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "test-device", operatorPackage: primary }),
      });
      assert.equal(response.status, scenario.queried ? 503 : 500);
      const daemon = await response.json() as RunExecutionResult;
      for (const result of [direct, daemon]) {
        assert.equal(result.ok, false);
        if (result.ok) throw new Error("expected failure");
        assert.equal(result.error.code, scenario.code);
        assert.equal(result.deviceId, "test-device");
        const details = result.error.details as Record<string, any>;
        assert.equal(details.phase, "readiness");
        assert.equal(details.dispatchState, "not_dispatched");
        assert.equal(details.checkId, "readiness.apk.presence");
        assert.ok(details.commandId);
        assert.ok(details.taskId);
        assert.equal((result.error.diagnostics as any).logging.status, "available");
        if (result === direct) {
          assert.equal(details.commandId, execution.commandId);
          assert.equal(details.taskId, execution.taskId);
        } else {
          assert.match(details.commandId, /^serve-snap-/);
          assert.equal(details.commandId, details.taskId);
        }
        if (scenario.queried) {
          assert.deepEqual(details.evidence, { operatorPackage: scenario.queried, exitCode: 7 });
          assert.match(details.detail, /synthetic package query failure/);
          assert.match(result.error.message, /Could not query installed packages/);
          assert.equal(details.fix, undefined);
        }
        if (scenario.mode === "missing") {
          assert.match(details.installCommand, /operator setup --apk/);
          assert.match(result.error.message, /Install it with:/);
        } else {
          assert.equal("installCommand" in details, false);
          assert.doesNotMatch(result.error.message, /is not installed|operator setup/);
        }
        if (scenario.mode === "variant") {
          assert.match(JSON.stringify(details.fix), /--operator-package com.androperator.operator/);
        }
        const events = (await readFile(logger.logPath()!, "utf8")).trim().split("\n").map(line => JSON.parse(line));
        const event = events.find(event => event.commandId === details.commandId && event.event.startsWith("preflight.apk."));
        assert.ok(event);
        assert.equal(event.taskId, details.taskId);
        assert.equal(event.deviceId, "test-device");
        assert.equal(event.event, scenario.mode === "missing" ? "preflight.apk.missing" : "preflight.apk.failed");
        assert.match(event.message, new RegExp(scenario.code));
        if (scenario.mode !== "missing") assert.doesNotMatch(event.message, /is not installed|operator setup/);
      }
      const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map(line => JSON.parse(line) as string[]);
      assert.equal(calls.some(args => args.includes("broadcast")), false);
      assert.equal(calls.filter(args => args.includes("packages")).length, scenario.mode === "primary" ? 2 : 4);
    } finally {
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      // Cancellation returns before reader exit/close diagnostics finish writing.
      // Keep the log directory alive until those child callbacks have drained.
      await Promise.all(readerClosures);
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await rm(dir, { recursive: true, force: true });
    }
  });
}
