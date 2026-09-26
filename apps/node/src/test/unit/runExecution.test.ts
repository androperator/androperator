import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  addSettleWarnings,
  attachSnapshotsToStepResults,
  buildTimeoutError,
  finalizeSuccessfulCloseAppSteps,
  finalizeSuccessfulScreenshotCapture,
  getReadinessInvalidationErrorCodes,
  injectServiceUnavailableHint,
  markExtractionFailedSnapshotSteps,
  reconcileEnvelopeStatusAfterPostProcessing,
  runCloseAppPreflight,
  runExecution,
} from "../../domain/executions/runExecution.js";
import { buildResultEnvelopeTimeoutHint } from "../../domain/executions/timeoutGuidance.js";
import type { Execution } from "../../contracts/execution.js";
import type { ResultEnvelope, StepResult } from "../../contracts/result.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { LIMITS } from "../../contracts/limits.js";
import { getDefaultRuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { waitForResultEnvelope } from "../../adapters/android-bridge/logcatResultReader.js";
import { extractSnapshotsForCommand, extractSnapshotsFromLogs } from "../../domain/executions/snapshotHelper.js";
import { createClawperatorLogger } from "../../adapters/logger.js";
import { clawperatorEvents, CLAWPERATOR_EVENT_TYPES } from "../../domain/observe/events.js";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { FakeProcessRunner } from "./fakes/FakeProcessRunner.js";

function formatLogcatTime(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

describe("attachSnapshotsToStepResults", () => {
  it("aligns fewer snapshots to the last snapshot steps", () => {
    const stepResults: StepResult[] = [
      { id: "s1", actionType: "snapshot", success: false, data: { error: "FAILED" } },
      { id: "click-1", actionType: "click", success: true, data: {} },
      { id: "s2", actionType: "snapshot", success: true, data: {} },
      { id: "s3", actionType: "snapshot", success: true, data: {} },
    ];

    attachSnapshotsToStepResults(stepResults, ["<tree-two/>", "<tree-three/>"]);

    assert.deepStrictEqual(stepResults[0].data, { error: "FAILED" });
    assert.deepStrictEqual(stepResults[2].data, { text: "<tree-two/>" });
    assert.deepStrictEqual(stepResults[3].data, { text: "<tree-three/>" });
  });

  it("keeps the most recent snapshots when logs contain more dumps than steps", () => {
    const stepResults: StepResult[] = [
      { id: "s1", actionType: "snapshot", success: true, data: {} },
      { id: "s2", actionType: "snapshot", success: true, data: {} },
    ];

    attachSnapshotsToStepResults(stepResults, ["<old/>", "<new-one/>", "<new-two/>"]);

    assert.deepStrictEqual(stepResults[0].data, { text: "<new-one/>" });
    assert.deepStrictEqual(stepResults[1].data, { text: "<new-two/>" });
  });

  it("does not set data.text when snapshot extraction returned no snapshots", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];

    attachSnapshotsToStepResults(stepResults, []);

    // data.text must remain absent - not set to undefined or empty string
    assert.ok(!("text" in stepResults[0].data), "data.text must not be set when no snapshots extracted");
    assert.deepStrictEqual(stepResults[0].data, {});
  });
});

describe("markExtractionFailedSnapshotSteps", () => {
  it("marks success:true snapshot steps with no data.text as SNAPSHOT_EXTRACTION_FAILED", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];

    markExtractionFailedSnapshotSteps(stepResults);

    assert.strictEqual(stepResults[0].success, false);
    assert.strictEqual(stepResults[0].data.error, "SNAPSHOT_EXTRACTION_FAILED");
    assert.ok(typeof stepResults[0].data.message === "string", "must include message");
    assert.ok(!("text" in stepResults[0].data), "data.text must not be set");
  });

  it("emits the warning through the provided callback", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];

    const warnings: string[] = [];

    markExtractionFailedSnapshotSteps(stepResults, message => {
      warnings.push(message);
    });

    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /snapshot step "snap-1"/);
  });

  it("does not emit the warning when no callback is provided", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];
    markExtractionFailedSnapshotSteps(stepResults);
    assert.strictEqual(stepResults[0].success, false);
  });

  it("does not modify snapshot steps that already have data.text", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: true, data: { text: "<hierarchy/>" } },
    ];

    markExtractionFailedSnapshotSteps(stepResults);

    assert.strictEqual(stepResults[0].success, true);
    assert.deepStrictEqual(stepResults[0].data, { text: "<hierarchy/>" });
  });

  it("rejects an empty-string payload as missing", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: true, data: { text: "" } },
    ];

    markExtractionFailedSnapshotSteps(stepResults);

    assert.strictEqual(stepResults[0].success, false);
    assert.strictEqual(stepResults[0].data.error, "SNAPSHOT_EXTRACTION_FAILED");
  });

  it("does not modify snapshot steps that are already failed", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: false, data: { error: "NODE_NOT_FOUND" } },
    ];

    markExtractionFailedSnapshotSteps(stepResults);

    assert.strictEqual(stepResults[0].success, false);
    assert.strictEqual(stepResults[0].data.error, "NODE_NOT_FOUND");
  });

  it("does not modify non-snapshot steps", () => {
    const stepResults: StepResult[] = [
      { id: "click-1", actionType: "click", success: true, data: {} },
    ];

    markExtractionFailedSnapshotSteps(stepResults);

    assert.strictEqual(stepResults[0].success, true);
    assert.deepStrictEqual(stepResults[0].data, {});
  });

  it("marks snapshot as SNAPSHOT_EXTRACTION_FAILED when only other commandIds are present", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];
    const logLines = [
      "04-25 20:14:52.453 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-other]:",
      "04-25 20:14:52.454 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
      "04-25 20:14:52.455 D/TaskScopeDefault(29817):   <node index=\"0\" text=\"Other\" />",
      "04-25 20:14:52.456 D/TaskScopeDefault(29817): </hierarchy>",
    ];

    attachSnapshotsToStepResults(stepResults, extractSnapshotsForCommand(logLines, "cmd-current"));
    markExtractionFailedSnapshotSteps(stepResults);

    assert.strictEqual(stepResults[0].success, false);
    assert.strictEqual(stepResults[0].data.error, "SNAPSHOT_EXTRACTION_FAILED");
  });

  it("marks missing snapshot text as VERSION_INCOMPATIBLE when legacy snapshot markers were observed", () => {
    const stepResults: StepResult[] = [
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];
    const warnings: string[] = [];

    markExtractionFailedSnapshotSteps(stepResults, message => warnings.push(message), {
      sawLegacyUntaggedSnapshotMarker: true,
    });

    assert.strictEqual(stepResults[0].success, false);
    assert.strictEqual(stepResults[0].data.error, "VERSION_INCOMPATIBLE");
    assert.match(String(stepResults[0].data.message), /legacy untagged marker/);
    assert.match(warnings[0] ?? "", /legacy untagged snapshot logs/);
  });
});

describe("addSettleWarnings", () => {
  it("warns when snapshot follows click without a sleep step", () => {
    const execution: Execution = {
      commandId: "cmd-settle",
      taskId: "task-settle",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "click-1", type: "click" },
        { id: "snap-1", type: "snapshot" },
      ],
    };
    const stepResults: StepResult[] = [
      { id: "click-1", actionType: "click", success: true, data: {} },
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];

    addSettleWarnings(stepResults, execution);

    assert.match(stepResults[1].data.warn ?? "", /snapshot captured without a preceding sleep step/);
  });

  it("does not warn when a sleep step appears between click and snapshot", () => {
    const execution: Execution = {
      commandId: "cmd-settle",
      taskId: "task-settle",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "click-1", type: "click" },
        { id: "sleep-1", type: "sleep" },
        { id: "snap-1", type: "snapshot" },
      ],
    };
    const stepResults: StepResult[] = [
      { id: "click-1", actionType: "click", success: true, data: {} },
      { id: "sleep-1", actionType: "sleep", success: true, data: {} },
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];

    addSettleWarnings(stepResults, execution);

    assert.ok(!("warn" in stepResults[2].data));
  });

  it("does not warn when no preceding click-like action exists", () => {
    const execution: Execution = {
      commandId: "cmd-settle",
      taskId: "task-settle",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "open-1", type: "open_app" },
        { id: "snap-1", type: "snapshot" },
      ],
    };
    const stepResults: StepResult[] = [
      { id: "open-1", actionType: "open_app", success: true, data: {} },
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];

    addSettleWarnings(stepResults, execution);

    assert.ok(!("warn" in stepResults[1].data));
  });

  it("warns when snapshot follows scroll_and_click without a sleep step", () => {
    const execution: Execution = {
      commandId: "cmd-settle",
      taskId: "task-settle",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "scroll-1", type: "scroll_and_click" },
        { id: "snap-1", type: "snapshot" },
      ],
    };
    const stepResults: StepResult[] = [
      { id: "scroll-1", actionType: "scroll_and_click", success: true, data: {} },
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];

    addSettleWarnings(stepResults, execution);

    assert.match(stepResults[1].data.warn ?? "", /snapshot captured without a preceding sleep step/);
  });

  it("does not warn when a non-sleep intermediate step separates click from snapshot", () => {
    // read_text, wait_for_node, etc. may themselves introduce settling time —
    // only warn when click is the immediately preceding action.
    const execution: Execution = {
      commandId: "cmd-settle",
      taskId: "task-settle",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "click-1", type: "click" },
        { id: "read-1", type: "read_text" },
        { id: "snap-1", type: "snapshot" },
      ],
    };
    const stepResults: StepResult[] = [
      { id: "click-1", actionType: "click", success: true, data: {} },
      { id: "read-1", actionType: "read_text", success: true, data: {} },
      { id: "snap-1", actionType: "snapshot", success: true, data: {} },
    ];

    addSettleWarnings(stepResults, execution);

    assert.ok(!("warn" in stepResults[2].data));
  });
});

describe("injectServiceUnavailableHint", () => {
  it("adds a recovery hint for SERVICE_UNAVAILABLE envelopes", () => {
    const envelope: ResultEnvelope = {
      commandId: "cmd-1",
      taskId: "task-1",
      status: "failed",
      stepResults: [],
      errorCode: "SERVICE_UNAVAILABLE",
    };

    injectServiceUnavailableHint(envelope, "device-123");

    assert.ok(envelope.hint?.includes("doctor --fix --device device-123"), `hint: ${envelope.hint}`);
    assert.ok(envelope.hint?.includes("operator setup"), `hint should mention operator setup: ${envelope.hint}`);
  });

  it("does not add a hint for other error codes", () => {
    const envelope: ResultEnvelope = {
      commandId: "cmd-1",
      taskId: "task-1",
      status: "failed",
      stepResults: [],
      errorCode: "OTHER_ERROR",
    };

    injectServiceUnavailableHint(envelope, "device-123");

    assert.strictEqual(envelope.hint, undefined);
  });

  it("does not add a hint for successful envelopes", () => {
    const envelope: ResultEnvelope = {
      commandId: "cmd-1",
      taskId: "task-1",
      status: "success",
      stepResults: [],
      errorCode: "SERVICE_UNAVAILABLE",
    };

    injectServiceUnavailableHint(envelope, "device-123");

    assert.strictEqual(envelope.hint, undefined);
  });
});

describe("reconcileEnvelopeStatusAfterPostProcessing", () => {
  it("marks envelope failed from first failed step and sets error", () => {
    const envelope: ResultEnvelope = {
      commandId: "c",
      taskId: "t",
      status: "success",
      stepResults: [
        { id: "a1", actionType: "scroll_until", success: false, data: { error: "TARGET_NOT_FOUND" } },
      ],
      error: null,
    };
    reconcileEnvelopeStatusAfterPostProcessing(envelope);
    assert.strictEqual(envelope.status, "failed");
    assert.strictEqual(envelope.error, "Step a1 (scroll_until) failed: TARGET_NOT_FOUND");
  });

  it("marks envelope success when all steps succeed after normalization", () => {
    const envelope: ResultEnvelope = {
      commandId: "c",
      taskId: "t",
      status: "failed",
      stepResults: [{ id: "close-1", actionType: "close_app", success: true, data: { application_id: "com.example" } }],
      error: "stale",
      hint: "stale",
    };
    reconcileEnvelopeStatusAfterPostProcessing(envelope);
    assert.strictEqual(envelope.status, "success");
    assert.strictEqual(envelope.error, null);
    assert.strictEqual(envelope.errorCode, undefined);
    assert.strictEqual(envelope.hint, undefined);
  });

  it("preserves runtime timeout verdict and original text even between steps", () => {
    for (const failedStep of [false, true]) {
      const envelope: ResultEnvelope = {
        commandId: "command", taskId: "task", status: "failed", errorCode: "COMMAND_TIMEOUT", error: "Original timeout",
        stepResults: [{ id: "before", actionType: "sleep", success: true, data: {} }],
      };
      if (failedStep) envelope.stepResults.push({ id: "wait", actionType: "wait_for_node", success: false,
        data: { errorCode: "COMMAND_TIMEOUT", error: "Interrupted wait" } });
      const expected = structuredClone(envelope);
      reconcileEnvelopeStatusAfterPostProcessing(envelope);
      assert.deepStrictEqual(envelope, expected);
    }
  });

  it("no-ops when stepResults is empty", () => {
    const envelope: ResultEnvelope = {
      commandId: "c",
      taskId: "t",
      status: "failed",
      stepResults: [],
      error: "Accessibility service is not available",
      errorCode: "SERVICE_UNAVAILABLE",
    };
    reconcileEnvelopeStatusAfterPostProcessing(envelope);
    assert.strictEqual(envelope.status, "failed");
    assert.strictEqual(envelope.error, "Accessibility service is not available");
  });
});

describe("getReadinessInvalidationErrorCodes", () => {
  it("includes top-level and failed step error codes", () => {
    const envelope: ResultEnvelope = {
      commandId: "cmd-step-failure",
      taskId: "task-step-failure",
      status: "failed",
      errorCode: "SERVICE_UNAVAILABLE",
      stepResults: [
        { id: "a1", actionType: "click", success: false, data: { error: ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING } },
        { id: "a2", actionType: "snapshot", success: true, data: {} },
        { id: "a3", actionType: "read_text", success: false, data: { error: "TARGET_NOT_FOUND" } },
      ],
      error: "failed",
    };

    assert.deepStrictEqual(getReadinessInvalidationErrorCodes(envelope), [
      "SERVICE_UNAVAILABLE",
      ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING,
      "TARGET_NOT_FOUND",
    ]);
  });
});

describe("finalizeSuccessfulScreenshotCapture", () => {
  it("only marks unsupported runtime screenshots successful after adb capture succeeds", () => {
    const screenStep: StepResult = {
      id: "shot-1",
      actionType: "take_screenshot",
      success: false,
      data: {
        error: "UNSUPPORTED_RUNTIME_SCREENSHOT",
        errorCode: "UNSUPPORTED_RUNTIME_SCREENSHOT",
        message: "Runtime screenshot not supported",
      },
    };

    finalizeSuccessfulScreenshotCapture(screenStep, "/tmp/capture.png", { width: 100, height: 200, coordinateSpace: "screenshot_pixels", origin: "top_left" });

    assert.strictEqual(screenStep.success, true);
    assert.deepStrictEqual(screenStep.data, { path: "/tmp/capture.png", captureSource: "host", capturedAt: screenStep.data.capturedAt, width: "100", height: "200", coordinateSpace: "screenshot_pixels", origin: "top_left" });
    assert.ok(!Number.isNaN(Date.parse(screenStep.data.capturedAt!)));
  });

  it("preserves existing success state and metadata for already-supported screenshots", () => {
    const screenStep: StepResult = {
      id: "shot-2",
      actionType: "take_screenshot",
      success: true,
      data: { source: "adb-fallback" },
    };

    finalizeSuccessfulScreenshotCapture(screenStep, "/tmp/capture.png", { width: 100, height: 200, coordinateSpace: "screenshot_pixels", origin: "top_left" });

    assert.strictEqual(screenStep.success, true);
    assert.deepStrictEqual(screenStep.data, {
      source: "adb-fallback",
      captureSource: "host",
      capturedAt: screenStep.data.capturedAt,
      width: "100", height: "200", coordinateSpace: "screenshot_pixels", origin: "top_left",
      path: "/tmp/capture.png",
    });
  });
});

describe("finalizeSuccessfulCloseAppSteps", () => {
  it("normalizes unsupported runtime close steps into success when the Node pre-flight close ran", () => {
    const execution: Execution = {
      commandId: "cmd-close",
      taskId: "task-close",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "close-1", type: "close_app", params: { applicationId: "com.example.app" } },
      ],
    };
    const stepResults: StepResult[] = [
      {
        id: "close-1",
        actionType: "close_app",
        success: false,
        data: {
          error: "UNSUPPORTED_RUNTIME_CLOSE",
          message: "Android runtime cannot reliably close apps.",
        },
      },
    ];

    finalizeSuccessfulCloseAppSteps(stepResults, execution, new Set(["close-1"]));

    assert.strictEqual(stepResults[0].success, true);
    assert.deepStrictEqual(stepResults[0].data, { application_id: "com.example.app" });
  });

  it("does not modify unrelated or already-successful close_app steps", () => {
    const execution: Execution = {
      commandId: "cmd-close",
      taskId: "task-close",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "close-1", type: "close_app", params: { applicationId: "com.example.app" } },
      ],
    };
    const stepResults: StepResult[] = [
      { id: "close-1", actionType: "close_app", success: true, data: { application_id: "com.example.app" } },
      { id: "click-1", actionType: "click", success: true, data: {} },
    ];

    finalizeSuccessfulCloseAppSteps(stepResults, execution, new Set(["close-1"]));

    assert.strictEqual(stepResults[0].success, true);
    assert.deepStrictEqual(stepResults[0].data, { application_id: "com.example.app" });
    assert.deepStrictEqual(stepResults[1].data, {});
  });

  it("does not normalize unsupported runtime close when the pre-flight close did not succeed", () => {
    const execution: Execution = {
      commandId: "cmd-close",
      taskId: "task-close",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "close-1", type: "close_app", params: { applicationId: "com.example.app" } },
      ],
    };
    const stepResults: StepResult[] = [
      {
        id: "close-1",
        actionType: "close_app",
        success: false,
        data: {
          error: "UNSUPPORTED_RUNTIME_CLOSE",
          message: "Android runtime cannot reliably close apps.",
        },
      },
    ];

    finalizeSuccessfulCloseAppSteps(stepResults, execution, new Set());

    assert.strictEqual(stepResults[0].success, false);
    assert.deepStrictEqual(stepResults[0].data, {
      error: "UNSUPPORTED_RUNTIME_CLOSE",
      message: "Android runtime cannot reliably close apps.",
    });
  });
});

describe("runCloseAppPreflight", () => {
  it("tracks successful close_app pre-flight steps", async () => {
    const execution: Execution = {
      commandId: "cmd-close",
      taskId: "task-close",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "close-1", type: "close_app", params: { applicationId: "com.example.app" } },
      ],
    };
    const config = getDefaultRuntimeConfig({
      runner: {
        run: async () => ({ stdout: "", stderr: "", code: 0 }),
        runShell: async () => ({ stdout: "", stderr: "", code: 0 }),
        spawn: () => { throw new Error("not used"); },
      },
    });

    const result = await runCloseAppPreflight(execution, config);

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.deepStrictEqual([...result.successfulCloseActionIds], ["close-1"]);
    }
  });

  it("returns a structured failure when adb force-stop exits non-zero", async () => {
    const execution: Execution = {
      commandId: "cmd-close",
      taskId: "task-close",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "close-1", type: "close_app", params: { applicationId: "com.example.app" } },
      ],
    };
    const config = getDefaultRuntimeConfig({
      runner: {
        run: async () => ({ stdout: "", stderr: "shell failed", code: 1 }),
        runShell: async () => ({ stdout: "", stderr: "", code: 0 }),
        spawn: () => { throw new Error("not used"); },
      },
    });

    const result = await runCloseAppPreflight(execution, config);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.DEVICE_SHELL_UNAVAILABLE);
      assert.match(result.error.message, /close_app pre-flight force-stop failed/);
      assert.deepStrictEqual(result.error.details, {
        earlierEffects: [],
        applicationId: "com.example.app",
        adbExitCode: 1,
        stdout: "",
        stderr: "shell failed",
      });
    }
  });
});

describe("runExecution", () => {
  it("fails fast when the Operator APK is missing and never broadcasts", async () => {
    const runner = new FakeProcessRunner();
    const warnings: string[] = [];
    let logcatKilled = false;
    const execution: Execution = {
      commandId: "cmd-preflight",
      taskId: "task-preflight",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });
    runner.spawn = ((command, args, options) => {
      runner.calls.push({ command, args, options });
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {
        logcatKilled = true;
      };
      return proc;
    }) as FakeProcessRunner["spawn"];

    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
      warn: message => warnings.push(message),
      logcatBroadcastDelayMs: 10_000,
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.OPERATOR_NOT_INSTALLED);
      assert.strictEqual(result.deviceId, "test-device-1");
      assert.match(result.error.message, /Operator APK \(com\.test\.operator\.dev\) is not installed on test-device-1/);
      assert.match(result.error.message, /clawperator operator setup --apk/);
      assert.match(result.error.message, /operator-debug\.apk/);
    }
    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(logcatKilled, true);
    assert.deepStrictEqual(
      runner.calls.map(call => call.args.join(" ")),
      [
        "-s test-device-1 logcat -v time -T 1",
        "-s test-device-1 devices",
        "-s test-device-1 shell pm list packages com.test.operator.dev",
        "-s test-device-1 shell pm list packages com.test.operator",
      ]
    );
  });

  it("does not take the explicit-device early logcat path for blank deviceId", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-blank-device",
      taskId: "task-blank-device",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\nemulator-5554\tdevice\n", stderr: "" });

    const result = await runExecution(execution, {
      deviceId: "",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.MULTIPLE_DEVICES_DEVICE_ID_REQUIRED);
    }
    assert.ok(!runner.calls.some(call => call.args.join(" ") === "logcat -v time -T 1"));
    assert.ok(!runner.calls.some(call => call.args.join(" ") === "shell pm list packages com.test.operator.dev"));
  });

  it("fails before dispatch when the resolved device is not interactive", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-interactive-preflight",
      taskId: "task-interactive-preflight",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });

    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
      logcatBroadcastDelayMs: 0,
      ensureInteractiveAutomationReadyFn: async () => ({
        ok: false,
        error: {
          code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
          message: "Device is not interactive. Interactive automation requires an awake, usable device state. screenOn=false deviceLocked=true userUnlocked=true",
          details: {
            screenOn: false,
            deviceLocked: true,
            userUnlocked: true,
          },
        },
      }),
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.DEVICE_NOT_INTERACTIVE);
      assert.strictEqual(result.deviceId, "test-device-1");
      assert.strictEqual((result.error.details as Record<string, unknown>).dispatchState, "not_dispatched");
      assert.strictEqual(result.error.message, "Device is not interactive. Interactive automation requires an awake, usable device state.");
    }
    assert.ok(!runner.calls.some(call => call.args.some(arg => arg.includes("am broadcast"))));
    assert.deepStrictEqual(
      runner.calls.map(call => call.args.join(" ")),
      [
        "-s test-device-1 logcat -v time -T 1",
        "-s test-device-1 devices",
        "-s test-device-1 shell pm list packages com.test.operator.dev",
      ]
    );
  });

  it("fails before dispatch when the screen is on but the device is still locked", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-awake-but-locked",
      taskId: "task-awake-but-locked",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });

    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
      logcatBroadcastDelayMs: 0,
      ensureInteractiveAutomationReadyFn: async () => ({
        ok: false,
        error: {
          code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
          message: "Device is not interactive. Interactive automation requires an awake, usable device state. screenOn=true deviceLocked=true userUnlocked=true",
          details: {
            screenOn: true,
            deviceLocked: true,
            userUnlocked: true,
          },
        },
      }),
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.DEVICE_NOT_INTERACTIVE);
      assert.strictEqual((result.error.details as Record<string, unknown>).dispatchState, "not_dispatched");
      assert.strictEqual(result.error.message, "Device is not interactive. Interactive automation requires an awake, usable device state.");
    }
    assert.ok(!runner.calls.some(call => call.args.some(arg => arg.includes("am broadcast"))));
  });

  it("preserves non-interactive-preflight diagnostics for transport or probe failures", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-interactive-transport-failure",
      taskId: "task-interactive-transport-failure",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });

    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
      ensureInteractiveAutomationReadyFn: async () => ({
        ok: false,
        error: {
          code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE,
          message: "adb shell broke",
          details: {
            screenOn: false,
            deviceLocked: false,
            userUnlocked: true,
          },
        },
      }),
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.DEVICE_SHELL_UNAVAILABLE);
      assert.strictEqual(result.error.message, "adb shell broke");
      const details = result.error.details as Record<string, unknown>;
      assert.equal(details.screenOn, false);
      assert.equal(details.deviceLocked, false);
      assert.equal(details.userUnlocked, true);
      assert.equal(details.phase, "readiness");
      assert.equal(details.dispatchState, "not_dispatched");
      assert.equal(details.commandId, execution.commandId);
      assert.strictEqual(result.deviceId, "test-device-1");
    }
    assert.ok(!runner.calls.some(call => call.args.some(arg => arg.includes("am broadcast"))));
  });

  it("cancels the early logcat waiter when readiness preflight throws", async () => {
    const runner = new FakeProcessRunner();
    let logcatKilled = false;
    const execution: Execution = {
      commandId: "cmd-throwing-preflight",
      taskId: "task-throwing-preflight",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.spawn = ((command, args, options) => {
      runner.calls.push({ command, args, options });
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {
        logcatKilled = true;
      };
      return proc;
    }) as FakeProcessRunner["spawn"];

    const thrownResult = await runExecution(execution, {
        deviceId: "test-device-1",
        operatorPackage: "com.test.operator.dev",
        runner,
        logcatBroadcastDelayMs: 10_000,
        ensureInteractiveAutomationReadyFn: async () => {
          throw new Error("readiness exploded");
        },
      });
    assert.equal(thrownResult.ok, false);
    if (!thrownResult.ok) assert.match(thrownResult.error.message, /readiness exploded/);

    assert.strictEqual(logcatKilled, true);
    assert.ok(!runner.calls.some(call => call.args.some(arg => arg.includes("am broadcast"))));
  });

  it("continues after the shared readiness helper wakes a sleeping device", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-central-wake",
      taskId: "task-central-wake",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" });
    runner.spawn = ((command, args, options) => {
      runner.calls.push({ command, args, options });
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      setTimeout(() => {
        proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-central-wake",
          taskId: "task-central-wake",
          status: "success",
          stepResults: [{ id: "sleep-1", actionType: "sleep", success: true, data: {} }],
          error: null,
        })}\n`));
        proc.emit("close", 0, null);
      }, 5);
      return proc;
    }) as FakeProcessRunner["spawn"];

    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
      logcatBroadcastDelayMs: 0,
      ensureInteractiveAutomationReadyFn: async () => ({
        ok: true,
        state: {
          screenOn: true,
          interactive: true,
          deviceLocked: false,
          userUnlocked: true,
        },
      }),
    });

    assert.strictEqual(result.ok, true);
    assert.ok(!runner.calls.some(call => call.args.join(" ") === "-s test-device-1 logcat -c"));
  });

  it("attaches clean snapshot text from noisy live logcat lines", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-noisy-snapshot",
      taskId: "task-noisy-snapshot",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "snap-1", type: "snapshot" },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" });
    runner.spawn = ((command, args, options) => {
      runner.calls.push({ command, args, options });
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      setTimeout(() => {
        const prefix = formatLogcatTime(new Date());
        proc.stdout?.emit("data", Buffer.from([
          `${prefix} D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-noisy-snapshot]:`,
          `${prefix} D/TaskScopeDefault(29817): <?xml version='1.0' encoding='UTF-8' standalone='yes' ?>`,
          `${prefix} D/TaskScopeDefault(29817): <hierarchy rotation="0">`,
          `${prefix} V/Configuration(29817): Updating configuration, locales updated from [] to [en_US]`,
          `${prefix} D/TaskScopeDefault(29817):   <node index="0" text="Settings" />`,
          `${prefix} D/TaskScopeDefault(29817): </hierarchy>`,
          `[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-noisy-snapshot",
          taskId: "task-noisy-snapshot",
          status: "success",
          stepResults: [{
            id: "snap-1",
            actionType: "snapshot_ui",
            success: true,
            data: {
              actual_format: "hierarchy_xml",
              foreground_package: "com.android.settings",
              has_overlay: "false",
              window_count: "2",
            },
          }],
          error: null,
        })}`,
        ].join("\n") + "\n"));
        proc.emit("close", 0, null);
      }, 5);
      return proc;
    }) as FakeProcessRunner["spawn"];

    const resultEvent = once(clawperatorEvents, CLAWPERATOR_EVENT_TYPES.RESULT);
    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
      logcatBroadcastDelayMs: 0,
      ensureInteractiveAutomationReadyFn: async () => ({
        ok: true,
        state: {
          screenOn: true,
          interactive: true,
          deviceLocked: false,
          userUnlocked: true,
        },
      }),
    });

    const [event] = await resultEvent as [{ deviceId: string; envelope: ResultEnvelope }];
    assert.strictEqual(result.ok, true);
    assert.ok(
      runner.calls.some(call => call.args.join(" ").includes('"type":"snapshot_ui"')),
      "broadcast payload should use the Android-compatible snapshot_ui action"
    );
    if (result.ok) {
      assert.strictEqual(result.envelope.status, "success");
      assert.strictEqual(result.envelope.stepResults[0].actionType, "snapshot");
      assert.deepStrictEqual(result.envelope.stepResults[0].data, {
        actual_format: "hierarchy_xml",
        foreground_package: "com.android.settings",
        has_overlay: "false",
        window_count: "2",
        text: [
          "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
          "<hierarchy rotation=\"0\">",
          "  <node index=\"0\" text=\"Settings\" />",
          "</hierarchy>",
        ].join("\n"),
      });
      assert.ok(!result.envelope.stepResults[0].data.text.includes("Updating configuration"));
    }
    assert.strictEqual(event.deviceId, "test-device-1");
    assert.strictEqual(event.envelope.stepResults[0].actionType, "snapshot");
    assert.strictEqual(event.envelope.stepResults[0].data.text, result.ok ? result.envelope.stepResults[0].data.text : undefined);
    assert.ok(!runner.calls.some(call => call.args.join(" ") === "-s test-device-1 logcat -d -v tag"));
    assert.ok(!runner.calls.some(call => call.args.join(" ") === "-s test-device-1 logcat -c"));
  });

  it("validates payload size after rewriting snapshot to the Android wire action", async () => {
    const runner = new FakeProcessRunner();
    const actions = Array.from({ length: LIMITS.MAX_EXECUTION_ACTIONS }, (_, index) => ({
      id: `s${index}`,
      type: "snapshot",
      ...(index === 0 ? { params: { retry: { padding: "" } } } : {}),
    }));
    const execution: Execution = {
      commandId: "cmd-payload-boundary",
      taskId: "task-payload-boundary",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions,
    };
    const emptyPaddingBytes = new TextEncoder().encode(JSON.stringify(execution)).length;
    const paddingBytes = LIMITS.MAX_PAYLOAD_BYTES - emptyPaddingBytes - 1;
    assert.ok(paddingBytes > 0, "test fixture should start below the payload limit");
    (execution.actions[0].params!.retry as Record<string, unknown>).padding = "x".repeat(paddingBytes);

    const canonicalBytes = new TextEncoder().encode(JSON.stringify(execution)).length;
    const androidBytes = new TextEncoder().encode(JSON.stringify({
      ...execution,
      actions: execution.actions.map(action => ({ ...action, type: "snapshot_ui" })),
    })).length;
    assert.strictEqual(canonicalBytes, LIMITS.MAX_PAYLOAD_BYTES - 1);
    assert.ok(androidBytes > LIMITS.MAX_PAYLOAD_BYTES);

    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, ERROR_CODES.PAYLOAD_TOO_LARGE);
    assert.match(result.error.message, new RegExp(`Payload exceeds ${LIMITS.MAX_PAYLOAD_BYTES} bytes`));
    assert.deepStrictEqual(runner.calls, []);
  });

  it("classifies legacy untagged snapshot markers as VERSION_INCOMPATIBLE through runExecution", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-legacy-marker-snapshot",
      taskId: "task-legacy-marker-snapshot",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "snap-1", type: "snapshot" },
      ],
    };
    const warnings: string[] = [];

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" });
    runner.spawn = ((command, args, options) => {
      runner.calls.push({ command, args, options });
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      setTimeout(() => {
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.453 D/kw2(29817): [TaskScope] UI Hierarchy:",
          "04-25 20:14:52.454 D/kw2(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.455 D/kw2(29817):   <node text=\"legacy\" />",
          "04-25 20:14:52.456 D/kw2(29817): </hierarchy>",
          `[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-legacy-marker-snapshot",
            taskId: "task-legacy-marker-snapshot",
            status: "success",
            stepResults: [{
              id: "snap-1",
              actionType: "snapshot",
              success: true,
              data: {
                actual_format: "hierarchy_xml",
              },
            }],
            error: null,
          })}`,
        ].join("\n") + "\n"));
        proc.emit("close", 0, null);
      }, 5);
      return proc;
    }) as FakeProcessRunner["spawn"];

    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator",
      runner,
      logcatBroadcastDelayMs: 0,
      warn: warning => warnings.push(warning),
      ensureInteractiveAutomationReadyFn: async () => ({
        ok: true,
        state: {
          screenOn: true,
          interactive: true,
          deviceLocked: false,
          userUnlocked: true,
        },
      }),
    });

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.status, "failed");
      assert.strictEqual(result.envelope.error, "Step snap-1 (snapshot) failed: VERSION_INCOMPATIBLE");
      assert.deepStrictEqual(result.envelope.stepResults[0].data, {
        actual_format: "hierarchy_xml",
        error: "VERSION_INCOMPATIBLE",
        extractionReason: "missing_payload",
        extractionDiagnostics: { receivedBytes: 0, sourceValidationCategory: "missing_payload" },
        message: "Snapshot hierarchy logs used the legacy untagged marker. Install a matching Operator APK that emits commandId-tagged snapshot logs, or use a compatible CLI.",
      });
    }
    assert.match(warnings[0] ?? "", /legacy untagged snapshot logs/);
  });

  it("allows close_app-only executions to succeed without the interactive gate", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-close-only",
      taskId: "task-close-only",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "close-1", type: "close_app", params: { applicationId: "com.example.app" } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    let readinessCalls = 0;
    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
      ensureInteractiveAutomationReadyFn: async () => {
        readinessCalls += 1;
        return {
          ok: false,
          error: {
            code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
            message: "Device is not interactive.",
          },
        };
      },
    });

    assert.strictEqual(readinessCalls, 0);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.status, "success");
      assert.deepStrictEqual(result.envelope.stepResults, [
        {
          id: "close-1",
          actionType: "close_app",
          success: true,
          data: { application_id: "com.example.app" },
        },
      ]);
    }
    assert.ok(!runner.calls.some(call => call.args.some(arg => arg.includes("am broadcast"))));
  });

  it("emits a terminal result event for close_app-only fast-path executions", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-close-only-event",
      taskId: "task-close-only-event",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "close-1", type: "close_app", params: { applicationId: "com.example.app" } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const resultEvent = once(clawperatorEvents, CLAWPERATOR_EVENT_TYPES.RESULT);
    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const [event] = await resultEvent as [{ deviceId: string; envelope: ResultEnvelope }];
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.status, "success");
      assert.deepStrictEqual(result.envelope.stepResults, [
        {
          id: "close-1",
          actionType: "close_app",
          success: true,
          data: { application_id: "com.example.app" },
        },
      ]);
    }
    assert.strictEqual(event.deviceId, "test-device-1");
    assert.strictEqual(event.envelope.status, "success");
    assert.deepStrictEqual(event.envelope.stepResults, [
      {
        id: "close-1",
        actionType: "close_app",
        success: true,
        data: { application_id: "com.example.app" },
      },
    ]);
  });

  it("starts logcat before explicit-device preflight and checks apk while resolving the device", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-explicit-fast-path",
      taskId: "task-explicit-fast-path",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" });
    runner.spawn = ((command, args, options) => {
      runner.calls.push({ command, args, options });
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      setTimeout(() => {
        proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-explicit-fast-path",
          taskId: "task-explicit-fast-path",
          status: "success",
          stepResults: [{ id: "sleep-1", actionType: "sleep", success: true, data: {} }],
          error: null,
        })}\n`));
        proc.emit("close", 0, null);
      }, 5);
      return proc;
    }) as FakeProcessRunner["spawn"];

    const result = await runExecution(execution, {
      deviceId: "test-device-1",
      operatorPackage: "com.test.operator.dev",
      runner,
      logcatBroadcastDelayMs: 0,
      ensureInteractiveAutomationReadyFn: async () => ({
        ok: true,
        state: {
          screenOn: true,
          interactive: true,
          deviceLocked: false,
          userUnlocked: true,
        },
      }),
    });

    assert.strictEqual(result.ok, true);
    const calls = runner.calls.map(call => call.args.join(" "));
    assert.strictEqual(calls[0], "-s test-device-1 logcat -v time -T 1");
    assert.strictEqual(calls[1], "-s test-device-1 devices");
    assert.strictEqual(calls[2], "-s test-device-1 shell pm list packages com.test.operator.dev");
    assert.match(calls[3], /shell am broadcast/);
  });

  it("keeps auto-resolve preflight sequential before starting logcat", async () => {
    const runner = new FakeProcessRunner();
    const execution: Execution = {
      commandId: "cmd-auto-sequential",
      taskId: "task-auto-sequential",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "sleep-1", type: "sleep", params: { durationMs: 0 } },
      ],
    };

    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device-1\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "Broadcast completed: result=0", stderr: "" });
    runner.spawn = ((command, args, options) => {
      runner.calls.push({ command, args, options });
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      setTimeout(() => {
        proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-auto-sequential",
          taskId: "task-auto-sequential",
          status: "success",
          stepResults: [{ id: "sleep-1", actionType: "sleep", success: true, data: {} }],
          error: null,
        })}\n`));
        proc.emit("close", 0, null);
      }, 5);
      return proc;
    }) as FakeProcessRunner["spawn"];

    const result = await runExecution(execution, {
      operatorPackage: "com.test.operator.dev",
      runner,
      logcatBroadcastDelayMs: 0,
      ensureInteractiveAutomationReadyFn: async () => ({
        ok: true,
        state: {
          screenOn: true,
          interactive: true,
          deviceLocked: false,
          userUnlocked: true,
        },
      }),
    });

    assert.strictEqual(result.ok, true);
    const calls = runner.calls.map(call => call.args.join(" "));
    assert.strictEqual(calls[0], "devices");
    assert.strictEqual(calls[1], "-s test-device-1 shell pm list packages com.test.operator.dev");
    assert.strictEqual(calls[2], "-s test-device-1 logcat -v time -T 1");
    assert.match(calls[3], /shell am broadcast/);
  });
});

describe("waitForResultEnvelope", () => {
  it("dispatches when the live logcat stream emits stdout before the fallback delay", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from("04-25 20:14:52.453 D/TaskScopeDefault(29817): ready\n"));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });
    const startedAt = Date.now();
    let broadcastStartedAt = 0;

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-signal-dispatch",
        timeoutMs: 1000,
        broadcastDelayMs: 10_000,
      },
      async (beginDispatchCapture) => {
        broadcastStartedAt = Date.now();
        beginDispatchCapture();
        setTimeout(() => {
          proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-signal-dispatch",
            taskId: "task-signal-dispatch",
            status: "success",
            stepResults: [],
            error: null,
          })}\n`));
        });
        return { success: true, stdout: "", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    assert.ok(broadcastStartedAt - startedAt < 1000, "broadcast should not wait for the fallback timer");
  });

  it("starts the result timeout from broadcast dispatch rather than logcat spawn", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-timeout-after-dispatch",
        timeoutMs: 5,
        broadcastDelayMs: 25,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        setTimeout(() => {
          proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-timeout-after-dispatch",
            taskId: "task-timeout-after-dispatch",
            status: "success",
            stepResults: [],
            error: null,
          })}\n`));
        });
        return { success: true, stdout: "", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
  });

  it("does not capture replayed snapshot lines from the first logcat attachment chunk", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.453 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-stale]:",
          "04-25 20:14:52.454 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.455 D/TaskScopeDefault(29817):   <node text=\"stale\" />",
          "04-25 20:14:52.456 D/TaskScopeDefault(29817): </hierarchy>",
        ].join("\n") + "\n"));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-capture-boundary",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        setTimeout(() => {
          const freshPrefix = formatLogcatTime(new Date());
          proc.stdout?.emit("data", Buffer.from([
            `${freshPrefix} D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-capture-boundary]:`,
            `${freshPrefix} D/TaskScopeDefault(29817): <hierarchy rotation="0">`,
            `${freshPrefix} D/TaskScopeDefault(29817):   <node text="fresh" />`,
            `${freshPrefix} D/TaskScopeDefault(29817): </hierarchy>`,
            `[Clawperator-Result] ${JSON.stringify({
              commandId: "cmd-capture-boundary",
              taskId: "task-capture-boundary",
              status: "success",
              stepResults: [],
              error: null,
            })}`,
          ].join("\n") + "\n"));
        });
        return { success: true, stdout: "", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.snapshotLogLines?.some(line => line.includes("fresh")));
      assert.ok(!result.snapshotLogLines?.some(line => line.includes("stale")));
    }
  });

  it("ignores replayed matching envelopes before dispatch", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-replayed-envelope",
          taskId: "old-task",
          status: "success",
          stepResults: [{ id: "old", actionType: "sleep", success: true, data: {} }],
          error: null,
        })}\n`));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-replayed-envelope",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        setTimeout(() => {
          proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-replayed-envelope",
            taskId: "new-task",
            status: "success",
            stepResults: [{ id: "new", actionType: "sleep", success: true, data: {} }],
            error: null,
          })}\n`));
        });
        return { success: true, stdout: "", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.taskId, "new-task");
    }
  });

  it("accepts matching envelopes emitted before broadcast command completion", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-sync-envelope",
          taskId: "old-task",
          status: "success",
          stepResults: [{ id: "old", actionType: "sleep", success: true, data: {} }],
          error: null,
        })}\n`));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-sync-envelope",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-sync-envelope",
          taskId: "new-task",
          status: "failed",
          stepResults: [],
          error: "service unavailable",
          errorCode: "SERVICE_UNAVAILABLE",
        })}\n`));
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.taskId, "new-task");
      assert.strictEqual(result.envelope.status, "failed");
      assert.strictEqual(result.envelope.errorCode, "SERVICE_UNAVAILABLE");
    }
  });

  it("captures fresh snapshot lines emitted before broadcast command completion", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.453 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-stale]:",
          "04-25 20:14:52.454 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.455 D/TaskScopeDefault(29817):   <node text=\"stale\" />",
          "04-25 20:14:52.456 D/TaskScopeDefault(29817): </hierarchy>",
        ].join("\n") + "\n"));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-sync-snapshot",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        const freshPrefix = formatLogcatTime(new Date());
        proc.stdout?.emit("data", Buffer.from([
          `${freshPrefix} D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-sync-snapshot]:`,
          `${freshPrefix} D/TaskScopeDefault(29817): <hierarchy rotation="0">`,
          `${freshPrefix} D/TaskScopeDefault(29817):   <node text="fresh" />`,
          `${freshPrefix} D/TaskScopeDefault(29817): </hierarchy>`,
          `[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-sync-snapshot",
            taskId: "task-sync-snapshot",
            status: "success",
            stepResults: [],
            error: null,
          })}`,
        ].join("\n") + "\n"));
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.snapshotLogLines?.some(line => line.includes("fresh")));
      assert.ok(!result.snapshotLogLines?.some(line => line.includes("stale")));
    }
  });

  it("captures commandId-tagged snapshot blocks that arrive before dispatch capture opens", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.453 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-pre-dispatch]:",
          "04-25 20:14:52.454 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.455 D/TaskScopeDefault(29817):   <node text=\"fresh-before-dispatch\" />",
          "04-25 20:14:52.456 D/TaskScopeDefault(29817): </hierarchy>",
        ].join("\n") + "\n"));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-pre-dispatch",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-pre-dispatch",
          taskId: "task-pre-dispatch",
          status: "success",
          stepResults: [],
          error: null,
        })}\n`));
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.snapshotLogLines?.some(line => line.includes("fresh-before-dispatch")));
      assert.deepStrictEqual(extractSnapshotsForCommand(result.snapshotLogLines ?? [], "cmd-pre-dispatch"), [
        '<hierarchy rotation="0">\n  <node text="fresh-before-dispatch" />\n</hierarchy>',
      ]);
    }
  });

  it("parses envelopes from other tags while a snapshot block is still open", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from("04-25 20:14:52.453 D/TaskScopeDefault(29817): ready\n"));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-open-snapshot",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.453 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-open-snapshot]:",
          "04-25 20:14:52.454 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
          `[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-open-snapshot",
            taskId: "task-open-snapshot",
            status: "success",
            stepResults: [],
            error: null,
          })}`,
        ].join("\n") + "\n"));
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.taskId, "task-open-snapshot");
    }
  });

  it("captures legacy untagged snapshot blocks after dispatch for compatibility diagnostics", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-legacy-snapshot",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.453 D/kw2(29817): [TaskScope] UI Hierarchy:",
          "04-25 20:14:52.454 D/kw2(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.455 D/kw2(29817):   <node text=\"legacy\" />",
          "04-25 20:14:52.456 D/kw2(29817): </hierarchy>",
          `[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-legacy-snapshot",
            taskId: "task-legacy-snapshot",
            status: "success",
            stepResults: [],
            error: null,
          })}`,
        ].join("\n") + "\n"));
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.snapshotLogLines?.some(line => line.includes("[TaskScope] UI Hierarchy:")));
      assert.deepStrictEqual(extractSnapshotsForCommand(result.snapshotLogLines ?? [], "cmd-legacy-snapshot"), []);
    }
  });

  it("drains replayed snapshot lines that arrive in later chunks before dispatch starts", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from("04-25 20:14:52.453 D/TaskScopeDefault(29817): ready\n"));
      });
      setTimeout(() => {
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.454 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-stale]:",
          "04-25 20:14:52.455 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.456 D/TaskScopeDefault(29817):   <node text=\"stale\" />",
          "04-25 20:14:52.457 D/TaskScopeDefault(29817): </hierarchy>",
          `[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-late-replay",
            taskId: "old-task",
            status: "success",
            stepResults: [{ id: "old", actionType: "sleep", success: true, data: {} }],
            error: null,
          })}`,
        ].join("\n") + "\n"));
      }, 5);
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-late-replay",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        setTimeout(() => {
          const freshPrefix = formatLogcatTime(new Date());
          proc.stdout?.emit("data", Buffer.from([
            `${freshPrefix} D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-late-replay]:`,
            `${freshPrefix} D/TaskScopeDefault(29817): <hierarchy rotation="0">`,
            `${freshPrefix} D/TaskScopeDefault(29817):   <node text="fresh" />`,
            `${freshPrefix} D/TaskScopeDefault(29817): </hierarchy>`,
            `[Clawperator-Result] ${JSON.stringify({
              commandId: "cmd-late-replay",
              taskId: "task-late-replay",
              status: "success",
              stepResults: [],
              error: null,
            })}`,
          ].join("\n") + "\n"));
        });
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.taskId, "task-late-replay");
      assert.ok(result.snapshotLogLines?.some(line => line.includes("fresh")));
      assert.ok(!result.snapshotLogLines?.some(line => line.includes("stale")));
    }
  });

  it("does not let the no-output fallback interrupt replay draining after stdout", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    let broadcastStarted = false;
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from("04-25 20:14:52.453 D/TaskScopeDefault(29817): ready\n"));
      });
      setTimeout(() => {
        assert.strictEqual(broadcastStarted, false, "fallback must not dispatch while replay chunks are still draining");
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.454 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-stale]:",
          "04-25 20:14:52.455 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.456 D/TaskScopeDefault(29817):   <node text=\"stale-after-fallback\" />",
          "04-25 20:14:52.457 D/TaskScopeDefault(29817): </hierarchy>",
        ].join("\n") + "\n"));
      }, 15);
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-fallback-replay-drain",
        timeoutMs: 1000,
        broadcastDelayMs: 10,
      },
      async (beginDispatchCapture) => {
        broadcastStarted = true;
        beginDispatchCapture();
        setTimeout(() => {
          const freshPrefix = formatLogcatTime(new Date());
          proc.stdout?.emit("data", Buffer.from([
            `${freshPrefix} D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-fallback-replay-drain]:`,
            `${freshPrefix} D/TaskScopeDefault(29817): <hierarchy rotation="0">`,
            `${freshPrefix} D/TaskScopeDefault(29817):   <node text="fresh" />`,
            `${freshPrefix} D/TaskScopeDefault(29817): </hierarchy>`,
            `[Clawperator-Result] ${JSON.stringify({
              commandId: "cmd-fallback-replay-drain",
              taskId: "task-fallback-replay-drain",
              status: "success",
              stepResults: [],
              error: null,
            })}`,
          ].join("\n") + "\n"));
        });
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.snapshotLogLines?.some(line => line.includes("fresh")));
      assert.ok(!result.snapshotLogLines?.some(line => line.includes("stale-after-fallback")));
    }
  });

  it("dispatches even when continuous logcat output keeps resetting the drain timer", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    const logTimers: NodeJS.Timeout[] = [];
    let broadcastStartedAt = 0;
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {
        for (const timer of logTimers) {
          clearTimeout(timer);
        }
      };
      for (let i = 0; i < 12; i += 1) {
        logTimers.push(setTimeout(() => {
          proc.stdout?.emit("data", Buffer.from(`04-25 20:14:52.${String(500 + i).padStart(3, "0")} D/TaskScopeDefault(29817): noisy replay ${i}\n`));
        }, i * 15));
      }
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const startedAt = Date.now();
    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-noisy-drain",
        timeoutMs: 1000,
        broadcastDelayMs: 10_000,
      },
      async (beginDispatchCapture) => {
        broadcastStartedAt = Date.now();
        beginDispatchCapture();
        setTimeout(() => {
          proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-noisy-drain",
            taskId: "task-noisy-drain",
            status: "success",
            stepResults: [],
            error: null,
          })}\n`));
        });
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    assert.ok(broadcastStartedAt > 0, "broadcast must start despite continuous stdout");
    assert.ok(broadcastStartedAt - startedAt < 500, "broadcast should be bounded by the max drain timer");
  });

  it("does not capture stale snapshot lines after forced replay-drain dispatch", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    const logTimers: NodeJS.Timeout[] = [];
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => {
        for (const timer of logTimers) {
          clearTimeout(timer);
        }
      };
      for (let i = 0; i < 12; i += 1) {
        logTimers.push(setTimeout(() => {
          proc.stdout?.emit("data", Buffer.from(`04-25 20:14:52.${String(500 + i).padStart(3, "0")} D/TaskScopeDefault(29817): noisy replay ${i}\n`));
        }, i * 15));
      }
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-forced-replay-snapshot",
        timeoutMs: 1000,
        broadcastDelayMs: 10_000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.700 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-stale]:",
          "04-25 20:14:52.701 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.702 D/TaskScopeDefault(29817):   <node text=\"stale-forced\" />",
          "04-25 20:14:52.703 D/TaskScopeDefault(29817): </hierarchy>",
        ].join("\n") + "\n"));
        setTimeout(() => {
          const freshPrefix = formatLogcatTime(new Date());
          proc.stdout?.emit("data", Buffer.from([
            `${freshPrefix} D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-forced-replay-snapshot]:`,
            `${freshPrefix} D/TaskScopeDefault(29817): <hierarchy rotation="0">`,
            `${freshPrefix} D/TaskScopeDefault(29817):   <node text="fresh-forced" />`,
            `${freshPrefix} D/TaskScopeDefault(29817): </hierarchy>`,
            `[Clawperator-Result] ${JSON.stringify({
              commandId: "cmd-forced-replay-snapshot",
              taskId: "task-forced-replay-snapshot",
              status: "success",
              stepResults: [],
              error: null,
            })}`,
          ].join("\n") + "\n"));
        }, 35);
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      const snapshots = extractSnapshotsFromLogs(result.snapshotLogLines ?? []);
      assert.ok(snapshots.some(snapshot => snapshot.includes("fresh-forced")));
      assert.ok(!snapshots.some(snapshot => snapshot.includes("stale-forced")));
    }
  });

  it("ignores stale malformed replayed envelopes for other commands after dispatch starts", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from("04-25 20:14:52.453 D/TaskScopeDefault(29817): ready\n"));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-current-malformed-filter",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        proc.stdout?.emit("data", Buffer.from("[Clawperator-Result] {\"commandId\":\"old-command\",\n"));
        setTimeout(() => {
          proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
            commandId: "cmd-current-malformed-filter",
            taskId: "task-current-malformed-filter",
            status: "success",
            stepResults: [],
            error: null,
          })}\n`));
        });
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.taskId, "task-current-malformed-filter");
    }
  });

  it("does not capture split replayed snapshot lines before dispatch completes", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.453 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-stale]:",
          "04-25 20:14:52.454 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
        ].join("\n") + "\n"));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-split-replay",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        proc.stdout?.emit("data", Buffer.from([
          "04-25 20:14:52.455 D/TaskScopeDefault(29817):   <node text=\"stale\" />",
          "04-25 20:14:52.456 D/TaskScopeDefault(29817): </hierarchy>",
        ].join("\n") + "\n"));
        beginDispatchCapture();
        setTimeout(() => {
          const freshPrefix = formatLogcatTime(new Date());
          proc.stdout?.emit("data", Buffer.from([
            `${freshPrefix} D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-split-replay]:`,
            `${freshPrefix} D/TaskScopeDefault(29817): <hierarchy rotation="0">`,
            `${freshPrefix} D/TaskScopeDefault(29817):   <node text="fresh" />`,
            `${freshPrefix} D/TaskScopeDefault(29817): </hierarchy>`,
            `[Clawperator-Result] ${JSON.stringify({
              commandId: "cmd-split-replay",
              taskId: "task-split-replay",
              status: "success",
              stepResults: [],
              error: null,
            })}`,
          ].join("\n") + "\n"));
        });
        return { success: true, stdout: "", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.snapshotLogLines?.some(line => line.includes("fresh")));
      assert.ok(!result.snapshotLogLines?.some(line => line.includes("stale")));
    }
  });

  it("drops partial replayed log lines that complete after dispatch starts", async () => {
    const runner = new FakeProcessRunner();
    let proc: EventEmitter & {
      stdout?: EventEmitter;
      stderr?: EventEmitter;
      kill: () => void;
    };
    runner.spawn = (() => {
      proc = new EventEmitter() as typeof proc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      process.nextTick(() => {
        proc.stdout?.emit("data", Buffer.from(`[Clawperator-Result] ${JSON.stringify({
          commandId: "cmd-partial-replay",
          taskId: "old-task",
          status: "success",
          stepResults: [{ id: "old", actionType: "sleep", success: true, data: {} }],
          error: null,
        }).slice(0, 48)}`));
      });
      return proc;
    }) as FakeProcessRunner["spawn"];
    const config = getDefaultRuntimeConfig({
      deviceId: "device-123",
      operatorPackage: "com.test.operator.dev",
      runner,
    });

    const result = await waitForResultEnvelope(
      config,
      {
        commandId: "cmd-partial-replay",
        timeoutMs: 1000,
        broadcastDelayMs: 1000,
      },
      async (beginDispatchCapture) => {
        beginDispatchCapture();
        proc.stdout?.emit("data", Buffer.from([
          `${JSON.stringify({
            commandId: "cmd-partial-replay",
            taskId: "old-task",
            status: "success",
          stepResults: [{ id: "old", actionType: "sleep", success: true, data: {} }],
          error: null,
        }).slice(48)}`,
          "04-25 20:14:52.454 D/TaskScopeDefault(29817): <hierarchy rotation=\"0\">",
          "04-25 20:14:52.455 D/TaskScopeDefault(29817):   <node text=\"stale-partial\" />",
          "04-25 20:14:52.456 D/TaskScopeDefault(29817): </hierarchy>",
        ].join("\n") + "\n"));
        setTimeout(() => {
          const freshPrefix = formatLogcatTime(new Date());
          proc.stdout?.emit("data", Buffer.from([
            `${freshPrefix} D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-partial-replay]:`,
            `${freshPrefix} D/TaskScopeDefault(29817): <hierarchy rotation="0">`,
            `${freshPrefix} D/TaskScopeDefault(29817):   <node text="fresh" />`,
            `${freshPrefix} D/TaskScopeDefault(29817): </hierarchy>`,
            `[Clawperator-Result] ${JSON.stringify({
              commandId: "cmd-partial-replay",
              taskId: "task-partial-replay",
              status: "success",
              stepResults: [],
              error: null,
            })}`,
          ].join("\n") + "\n"));
        });
        return { success: true, stdout: "Broadcast completed: result=0", stderr: "" };
      }
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.envelope.taskId, "task-partial-replay");
      assert.ok(result.snapshotLogLines?.some(line => line.includes("fresh")));
      assert.ok(!extractSnapshotsFromLogs(result.snapshotLogLines ?? []).some(snapshot => snapshot.includes("stale-partial")));
    }
  });
});

describe("buildTimeoutError", () => {
  it("includes correlation context and elapsed timing", () => {
    const error = buildTimeoutError(
      {
        commandId: "cmd-timeout-1",
        taskId: "task-timeout-1",
        actions: [
          { id: "click-1", type: "click" },
          { id: "snap-1", type: "snapshot" },
        ],
        timeoutMs: 30000,
      },
      {
        code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
        message: "Timed out waiting for result envelope",
      },
      321
    );

    assert.strictEqual(error.code, ERROR_CODES.RESULT_ENVELOPE_TIMEOUT);
    assert.strictEqual(error.message, "Timed out waiting for result envelope");
    assert.deepStrictEqual(error.details, {
      commandId: "cmd-timeout-1",
      taskId: "task-timeout-1",
      lastActionId: "snap-1",
      lastActionType: "snapshot",
      lastActionCaveat: "payload-last only; Android execution position is unknown",
      elapsedMs: 321,
      timeoutMs: 30000,
    });
  });

  it("omits commandId and taskId keys when they are absent from the payload", () => {
    const error = buildTimeoutError(
      {
        actions: [{ id: "snap-1", type: "snapshot" }],
        timeoutMs: 1000,
      },
      {
        code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
        message: "Timed out waiting for result envelope",
      },
      42
    );

    assert.strictEqual("commandId" in error.details, false);
    assert.strictEqual("taskId" in error.details, false);
    assert.strictEqual(error.details.lastActionId, "snap-1");
  });

  it("preserves timeout diagnostics fields on the returned error", () => {
    const error = buildTimeoutError(
      {
        commandId: "cmd-timeout-2",
        taskId: "task-timeout-2",
        actions: [{ id: "snap-1", type: "snapshot" }],
        timeoutMs: 2000,
      },
      {
        code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
        message: "Timed out waiting for result envelope",
        lastCorrelatedEvents: ["TaskScopeDefault: example"],
        broadcastDispatchStatus: "sent",
        deviceId: "emulator-5554",
        operatorPackage: "com.clawperator.operator.dev",
      },
      55
    );

    assert.deepStrictEqual(error.lastCorrelatedEvents, ["TaskScopeDefault: example"]);
    assert.strictEqual(error.broadcastDispatchStatus, "sent");
    assert.strictEqual(error.deviceId, "emulator-5554");
    assert.strictEqual(error.operatorPackage, "com.clawperator.operator.dev");
    assert.strictEqual(error.hint, undefined);
  });

  it("adds a version-compatibility hint when no correlated events were captured", () => {
    const error = buildTimeoutError(
      {
        commandId: "cmd-timeout-3",
        taskId: "task-timeout-3",
        actions: [{ id: "snap-1", type: "snapshot" }],
        timeoutMs: 2000,
      },
      {
        code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
        message: "Timed out waiting for result envelope",
        lastCorrelatedEvents: [],
        broadcastDispatchStatus: "sent",
        deviceId: "emulator-5554",
        operatorPackage: "com.clawperator.operator.dev",
      },
      55
    );

    assert.match(error.hint ?? "", /No correlated Android log lines were captured/);
    assert.match(error.hint ?? "", /APK\/CLI version mismatch/);
    assert.match(error.hint ?? "", /clawperator doctor --device emulator-5554 --operator-package com\.clawperator\.operator\.dev/);
  });

  it("does not add a version hint when broadcast dispatch failed", () => {
    const error = buildTimeoutError(
      {
        commandId: "cmd-timeout-4",
        taskId: "task-timeout-4",
        actions: [{ id: "snap-1", type: "snapshot" }],
        timeoutMs: 2000,
      },
      {
        code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
        message: "Timed out waiting for result envelope",
        lastCorrelatedEvents: [],
        broadcastDispatchStatus: "failed: Target package not found",
        deviceId: "emulator-5554",
        operatorPackage: "com.clawperator.operator.dev",
      },
      55
    );

    assert.strictEqual(error.hint, undefined);
  });

  it("builds a stable timeout hint when context fields are missing", () => {
    const hint = buildResultEnvelopeTimeoutHint(
      {
        broadcastDispatchStatus: "sent: broadcast_sent",
        lastCorrelatedEvents: [],
      },
      {}
    );

    assert.strictEqual(
      hint,
      "No correlated Android log lines were captured. This often indicates an APK/CLI version mismatch or an accessibility service issue. Run 'clawperator doctor' to diagnose."
    );
  });

  it("emits the timeout hint on the execution outcome without fabricating an envelope", async () => {
    const runner = new FakeProcessRunner();
    runner.spawn = (() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      return proc;
    }) as FakeProcessRunner["spawn"];

    runner.queueResult({ code: 0, stdout: "List of devices attached\ndevice-123\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const resultEvent = once(clawperatorEvents, CLAWPERATOR_EVENT_TYPES.EXECUTION);
    const result = await runExecution(
      {
        commandId: "cmd-timeout-5",
        taskId: "task-timeout-5",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [{ id: "snap-1", type: "snapshot" }],
      },
      {
        deviceId: "device-123",
        operatorPackage: "com.test.operator.dev",
        runner,
        resultEnvelopeTimeoutMs: 10,
        logcatBroadcastDelayMs: 0,
        ensureInteractiveAutomationReadyFn: async () => ({
          ok: true,
          state: {
            screenOn: true,
            interactive: true,
            deviceLocked: false,
            userUnlocked: true,
          },
        }),
      }
    );

    const [event] = await resultEvent;
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.RESULT_ENVELOPE_TIMEOUT);
      assert.match(String(result.error.hint ?? ""), /No correlated Android log lines were captured/);
    }
    assert.strictEqual(event.deviceId, "device-123");
    assert.match(event.result.error.hint ?? "", /No correlated Android log lines were captured/);
    assert.match(event.result.error.hint ?? "", /clawperator doctor --device device-123 --operator-package com\.test\.operator\.dev/);
  });

  it("does not emit the timeout hint when correlated log lines were captured", async () => {
    const runner = new FakeProcessRunner();
    runner.spawn = (() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: (signal?: string) => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;

      setTimeout(() => {
        proc.stdout?.emit("data", Buffer.from("04-25 20:14:52.453 D/TaskScopeDefault(29817): [TaskScope] UI Hierarchy [commandId=cmd-timeout-6]:\n"));
      }, 5);

      return proc;
    }) as FakeProcessRunner["spawn"];

    runner.queueResult({ code: 0, stdout: "List of devices attached\ndevice-123\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" }); // broadcast

    const resultEvent = once(clawperatorEvents, CLAWPERATOR_EVENT_TYPES.EXECUTION);
    const result = await runExecution(
      {
        commandId: "cmd-timeout-6",
        taskId: "task-timeout-6",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [{ id: "snap-1", type: "snapshot" }],
      },
      {
        deviceId: "device-123",
        operatorPackage: "com.test.operator.dev",
        runner,
        resultEnvelopeTimeoutMs: 100,
        logcatBroadcastDelayMs: 0,
        ensureInteractiveAutomationReadyFn: async () => ({
          ok: true,
          state: {
            screenOn: true,
            interactive: true,
            deviceLocked: false,
            userUnlocked: true,
          },
        }),
      }
    );

    const [event] = await resultEvent;
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.hint, undefined);
    }
    assert.strictEqual(event.deviceId, "device-123");
    assert.strictEqual(event.result.error.hint, undefined);
  });

  it("rejects invalid resultEnvelopeTimeoutMs overrides before dispatch", async () => {
    const runner = new FakeProcessRunner();
    const result = await runExecution(
      {
        commandId: "cmd-timeout-invalid-1",
        taskId: "task-timeout-invalid-1",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 0 } }],
      },
      {
        deviceId: "device-123",
        operatorPackage: "com.test.operator.dev",
        runner,
        resultEnvelopeTimeoutMs: Number.NaN,
      }
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
      assert.strictEqual(result.error.message, "resultEnvelopeTimeoutMs must be a finite number");
    }
    assert.deepStrictEqual(runner.calls, []);
  });

  it("rejects oversized resultEnvelopeTimeoutMs overrides before dispatch", async () => {
    const runner = new FakeProcessRunner();
    const result = await runExecution(
      {
        commandId: "cmd-timeout-invalid-1b",
        taskId: "task-timeout-invalid-1b",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 0 } }],
      },
      {
        deviceId: "device-123",
        operatorPackage: "com.test.operator.dev",
        runner,
        resultEnvelopeTimeoutMs: 2_147_483_648,
      }
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
      assert.strictEqual(result.error.message, "resultEnvelopeTimeoutMs must not exceed 2147483647");
    }
    assert.deepStrictEqual(runner.calls, []);
  });

  it("rejects invalid logcatBroadcastDelayMs overrides before dispatch", async () => {
    const runner = new FakeProcessRunner();
    const result = await runExecution(
      {
        commandId: "cmd-timeout-invalid-2",
        taskId: "task-timeout-invalid-2",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 0 } }],
      },
      {
        deviceId: "device-123",
        operatorPackage: "com.test.operator.dev",
        runner,
        logcatBroadcastDelayMs: -1,
      }
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
      assert.strictEqual(result.error.message, "logcatBroadcastDelayMs must be a non-negative number");
    }
    assert.deepStrictEqual(runner.calls, []);
  });

  it("rejects oversized logcatBroadcastDelayMs overrides before dispatch", async () => {
    const runner = new FakeProcessRunner();
    const result = await runExecution(
      {
        commandId: "cmd-timeout-invalid-2b",
        taskId: "task-timeout-invalid-2b",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [{ id: "sleep-1", type: "sleep", params: { durationMs: 0 } }],
      },
      {
        deviceId: "device-123",
        operatorPackage: "com.test.operator.dev",
        runner,
        logcatBroadcastDelayMs: 2_147_483_648,
      }
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
      assert.strictEqual(result.error.message, "logcatBroadcastDelayMs must not exceed 2147483647");
    }
    assert.deepStrictEqual(runner.calls, []);
  });
});

describe("runExecution logging", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "clawperator-run-log-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function writeFakeAdbScript(scriptName: string): Promise<string> {
    const scriptPath = join(tempRoot, scriptName);
    await writeFile(
      scriptPath,
      "#!/bin/sh\nexit 0\n",
      "utf8"
    );
    await chmod(scriptPath, 0o755);
    return scriptPath;
  }

  function createLogcatRunner(envelopeLine: string, delayMs = 5): FakeProcessRunner {
    const runner = new FakeProcessRunner();
    runner.spawn = (() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;
      setTimeout(() => {
        proc.stdout?.emit("data", Buffer.from(`${envelopeLine}\n`));
        proc.emit("close", 0, null);
      }, delayMs);
      return proc;
    }) as FakeProcessRunner["spawn"];
    return runner;
  }

  it("writes broadcast and envelope events with the execution commandId", async () => {
    const logger = createClawperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "info" });
    const adbPath = await writeFakeAdbScript("adb");
    const runner = createLogcatRunner(
      `[Clawperator-Result] ${JSON.stringify({
        commandId: "cmd-log-1",
        taskId: "task-log-1",
        status: "success",
        stepResults: [{ id: "a1", actionType: "enter_text", success: true, data: {} }],
        error: null,
      })}`,
      5
    );

    runner.queueResult({ code: 0, stdout: "List of devices attached\ndevice-123\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await runExecution(
      {
        commandId: "cmd-log-1",
        taskId: "task-log-1",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [
          {
            id: "a1",
            type: "enter_text",
            params: {
              matcher: { textEquals: "input" },
              text: "hello",
            },
          },
        ],
      },
      {
        deviceId: "device-123",
        operatorPackage: "com.test.operator.dev",
        adbPath,
        runner,
        logger,
        resultEnvelopeTimeoutMs: 100,
        logcatBroadcastDelayMs: 0,
        ensureInteractiveAutomationReadyFn: async () => ({
          ok: true,
          state: {
            screenOn: true,
            interactive: true,
            deviceLocked: false,
            userUnlocked: true,
          },
        }),
      }
    );

    assert.strictEqual(result.ok, true);
    const contents = await readFile(logger.logPath()!, "utf8");
    const lines = contents.trimEnd().split("\n").map(line => JSON.parse(line) as { event: string; commandId?: string });
    const broadcastLine = lines.find(line => line.event === "broadcast.dispatched");
    const envelopeLine = lines.find(line => line.event === "envelope.received");
    assert.strictEqual(broadcastLine?.commandId, "cmd-log-1");
    assert.strictEqual(envelopeLine?.commandId, "cmd-log-1");
  });

  it("keeps sentinel payload text out of every log line", async () => {
    const logger = createClawperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "debug" });
    const adbPath = await writeFakeAdbScript("adb");
    const sentinel = "CLAWPERATOR_TEST_SENTINEL_X9Z";
    const runner = createLogcatRunner(
      `[Clawperator-Result] ${JSON.stringify({
        commandId: "cmd-log-2",
        taskId: "task-log-2",
        status: "success",
        stepResults: [{ id: "a1", actionType: "enter_text", success: true, data: {} }],
        error: null,
      })}`,
      5
    );

    runner.queueResult({ code: 0, stdout: "List of devices attached\ndevice-123\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator.dev\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "", stderr: "" });

    const result = await runExecution(
      {
        commandId: "cmd-log-2",
        taskId: "task-log-2",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 1000,
        actions: [
          {
            id: "a1",
            type: "enter_text",
            params: {
              matcher: { textEquals: "input" },
              text: sentinel,
            },
          },
        ],
      },
      {
        deviceId: "device-123",
        operatorPackage: "com.test.operator.dev",
        adbPath,
        runner,
        logger,
        resultEnvelopeTimeoutMs: 100,
        logcatBroadcastDelayMs: 0,
        ensureInteractiveAutomationReadyFn: async () => ({
          ok: true,
          state: {
            screenOn: true,
            interactive: true,
            deviceLocked: false,
            userUnlocked: true,
          },
        }),
      }
    );

    assert.strictEqual(result.ok, true);
    const contents = await readFile(logger.logPath()!, "utf8");
    for (const line of contents.trimEnd().split("\n")) {
      assert.strictEqual(line.includes(sentinel), false, `sentinel leaked into log line: ${line}`);
    }
  });

  it("adds the logger path to timeout errors as an absolute file path", async () => {
    const logger = createClawperatorLogger({ logDir: join(tempRoot, "logs"), logLevel: "info" });
    logger.emit({
      ts: "2026-03-22T00:00:00.000Z",
      level: "info",
      event: "preflight.apk.pass",
      commandId: "cmd-timeout",
      taskId: "task-timeout",
      deviceId: "device-123",
      message: "Operator APK is installed",
    });
    const logPath = logger.logPath();
    assert.ok(logPath);

    const error = buildTimeoutError(
      {
        commandId: "cmd-timeout",
        taskId: "task-timeout",
        actions: [{ id: "a1", type: "snapshot" }],
        timeoutMs: 1000,
      },
      {
        code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
        message: "Timed out waiting for result envelope",
      },
      123,
      logPath
    );

    assert.ok(error.details.logPath);
    assert.strictEqual(error.details.logPath, logPath);
    assert.strictEqual(isAbsolute(error.details.logPath), true);
    assert.strictEqual((await stat(error.details.logPath)).isFile(), true);
  });
});

describe("transport failure execution evidence", () => {
  for (const phase of ["before-dispatch-close", "before-dispatch-exit", "after-dispatch"]) {
    const afterDispatch = phase === "after-dispatch";
    it(`never fabricates a terminal envelope or repeats dispatch (${phase})`, async () => {
      const runner = new FakeProcessRunner();
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
      Object.assign(proc, { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => undefined });
      runner.spawn = () => proc;
      let broadcasts = 0;
      runner.run = async (_command, args) => {
        if (args.includes("devices")) return { code: 0, stdout: "List of devices attached\ntransport-device\tdevice\n", stderr: "" };
        if (args.includes("pm")) return { code: 0, stdout: "package:com.test.operator\n", stderr: "" };
        if (args.some(arg => arg.startsWith("am broadcast "))) {
          broadcasts++;
          proc.stderr.emit("data", Buffer.from("reader disconnected"));
          proc.emit("close", 255, null);
          return { code: 0, stdout: "Broadcast completed: result=0", stderr: "" };
        }
        throw new Error(`Unexpected command ${args.join(" ")}`);
      };
      const terminalEvents: unknown[] = [];
      const onTerminal = (event: unknown) => terminalEvents.push(event);
      clawperatorEvents.on(CLAWPERATOR_EVENT_TYPES.RESULT, onTerminal);
      const outcome = once(clawperatorEvents, CLAWPERATOR_EVENT_TYPES.EXECUTION);
      try {
        const result = await runExecution({ commandId: "transport-command", taskId: "transport-task", source: "test",
          expectedFormat: "android-ui-automator", timeoutMs: 1000,
          actions: [{ id: "back", type: "press_key", params: { key: "BACK" } }] }, {
          runner, deviceId: "transport-device", operatorPackage: "com.test.operator", logcatBroadcastDelayMs: 0,
          ensureInteractiveAutomationReadyFn: async () => {
            if (!afterDispatch) {
              // Allow the reader's broadcast callback to park at the preflight gate.
              await new Promise(resolve => setTimeout(resolve, 10));
              if (phase === "before-dispatch-exit") {
                proc.emit("exit", 255, null);
                setImmediate(() => proc.emit("close", 255, null));
              } else {
                proc.emit("close", 255, null);
              }
            }
            return { ok: true, state: { screenOn: true, interactive: true, deviceLocked: false, userUnlocked: true } };
          },
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(!result.ok);
        assert.equal(result.error.code, "RESULT_TRANSPORT_EXITED");
        const details = result.error.details as Record<string, unknown>;
        assert.equal(details.commandId, "transport-command");
        assert.equal(details.taskId, "transport-task");
        assert.equal(details.dispatchAttempted, afterDispatch);
        if (!afterDispatch) {
          assert.equal(details.dispatchState, "not_dispatched");
          assert.equal(details.dispatchStartedAt, undefined);
        }
        assert.equal(details.executionPosition, "unknown");
        assert.equal(broadcasts, afterDispatch ? 1 : 0);
        assert.equal(terminalEvents.length, 0);
        assert.deepStrictEqual((await outcome)[0].result, result);
      } finally {
        clawperatorEvents.off(CLAWPERATOR_EVENT_TYPES.RESULT, onTerminal);
      }
    });
  }
});


it("blocks both mixed observation/UI orders before any action dispatch", async () => {
  const read = { id: "read", type: "list_notifications" };
  const ui = { id: "ui", type: "snapshot" };
  const mutations = [
    { id: "mutation", type: "dismiss_notification", params: { notificationKey: "k" } },
    { id: "mutation", type: "invoke_notification_action", params: { notificationKey: "k", actionId: "a" } },
  ];
  const control = { id: "control", type: "media_play", params: { mediaSessionId: "s" } };
  for (const actions of [[read, ui], [ui, read], [ui], [control, ui], [ui, control], ...mutations.flatMap(mutation => [[read, mutation], [mutation, read], [control, mutation], [mutation, control], [mutation]])]) {
    const runner = new FakeProcessRunner();
    runner.queueResult({ code: 0, stdout: "List of devices attached\ntest-device\tdevice\n", stderr: "" });
    runner.queueResult({ code: 0, stdout: "package:com.test.operator\n", stderr: "" });
    runner.spawn = (() => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} })) as FakeProcessRunner["spawn"];
    let readinessCalls = 0;
    const blocked = await runExecution({ commandId: "mixed", taskId: "mixed", source: "test", expectedFormat: "android-ui-automator", timeoutMs: 1000, actions }, {
      deviceId: "test-device", operatorPackage: "com.test.operator", runner, logcatBroadcastDelayMs: 0,
      ensureInteractiveAutomationReadyFn: async () => { readinessCalls++; throw new Error("interactive prerequisite unavailable"); },
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error.message, /interactive prerequisite unavailable/);
    assert.equal(readinessCalls, 1);
    assert.equal(runner.calls.some(call => call.args.some(arg => arg.includes("am broadcast"))), false);
  }
});
