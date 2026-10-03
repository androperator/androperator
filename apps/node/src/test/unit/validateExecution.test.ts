import { describe, it } from "node:test";
import assert from "node:assert";
import { validateExecution, validatePayloadSize } from "../../domain/executions/validateExecution.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { LIMITS } from "../../contracts/limits.js";

describe("validateExecution", () => {
  it("accepts omitted or direct mode and rejects unsupported modes", () => {
    const payload = {
      commandId: "cmd-mode",
      taskId: "task-mode",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 8000,
      actions: [{ id: "snapshot", type: "snapshot" }],
    };
    assert.strictEqual(validateExecution(payload).mode, undefined);
    assert.strictEqual(validateExecution({ ...payload, mode: "direct" }).mode, "direct");
    for (const mode of ["artifact_compiled", "unknown", "", null]) {
      assert.throws(
        () => validateExecution({ ...payload, mode }),
        (error: unknown) => {
          assert.strictEqual((error as { code: string }).code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
          return true;
        },
      );
    }
  });

  it("accepts valid minimal execution", () => {
    const ex = validateExecution({
      commandId: "cmd-1",
      taskId: "task-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 10000,
      actions: [{ id: "a1", type: "sleep", params: { durationMs: 1000 } }],
    });
    assert.strictEqual(ex.commandId, "cmd-1");
    assert.strictEqual(ex.actions[0].type, "sleep");
  });

  it("returns Execution for a valid payload without throwing", () => {
    const ex = validateExecution({
      commandId: "cmd-anchor-1",
      taskId: "task-anchor-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 8000,
      actions: [{ id: "snap-1", type: "snapshot" }],
    });

    assert.strictEqual(ex.commandId, "cmd-anchor-1");
    assert.strictEqual(ex.taskId, "task-anchor-1");
    assert.strictEqual(ex.actions[0].id, "snap-1");
  });

  it("normalizes legacy snapshot_ui action type to snapshot", () => {
    const ex = validateExecution({
      commandId: "cmd-snapshot-alias",
      taskId: "task-snapshot-alias",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 8000,
      actions: [{ id: "snap-1", type: "snapshot_ui" }],
    });

    assert.strictEqual(ex.actions[0].type, "snapshot");
  });

  it("accepts click actions with coordinates", () => {
    const ex = validateExecution({
      commandId: "cmd-click-1",
      taskId: "task-click-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 8000,
      actions: [
        {
          id: "click-1",
          type: "click",
          params: { coordinate: { x: 120, y: 240 } },
        },
      ],
    });

    assert.strictEqual(ex.actions[0].type, "click");
    assert.deepStrictEqual(ex.actions[0].params?.coordinate, { x: 120, y: 240 });
  });

  it("rejects click actions that mix matcher and coordinate", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "cmd-click-2",
          taskId: "task-click-2",
          source: "test",
          expectedFormat: "android-ui-automator",
          timeoutMs: 8000,
          actions: [
            {
              id: "click-2",
              type: "click",
              params: {
                matcher: { textEquals: "Login" },
                coordinate: { x: 120, y: 240 },
              },
            },
          ],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("normalizes action type alias (type_text -> enter_text)", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        { id: "x", type: "type_text", params: { matcher: { resourceId: "id" }, text: "hi" } },
      ],
    });
    assert.strictEqual(ex.actions[0].type, "enter_text");
  });

  it("normalizes longPress false by omitting clickType", () => {
    const ex = validateExecution({
      commandId: "cmd-longpress-false-1",
      taskId: "task-longpress-false-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        {
          id: "click-1",
          type: "click",
          params: {
            matcher: { textEquals: "Login" },
            longPress: false,
          },
        },
      ],
    });
    assert.strictEqual(ex.actions[0].params?.clickType, undefined);
  });

  it("normalizes snake_case execution keys and common param aliases", () => {
    const ex = validateExecution({
      command_id: "cmd-snake-1",
      task_id: "task-snake-1",
      source: "test",
      expected_format: "android-ui-automator",
      timeout_ms: 5000,
      actions: [
        {
          id: "open-1",
          type: "open_app",
          params: {
            package: "com.example.settings",
            skip_navigation_wait: true,
            navigation_timeout_ms: 22000,
          },
        },
      ],
    });

    assert.strictEqual(ex.commandId, "cmd-snake-1");
    assert.strictEqual(ex.taskId, "task-snake-1");
    assert.strictEqual(ex.expectedFormat, "android-ui-automator");
    assert.strictEqual(ex.timeoutMs, 5000);
    assert.strictEqual(ex.actions[0].params?.applicationId, "com.example.settings");
    assert.strictEqual(ex.actions[0].params?.skipNavigationWait, true);
    assert.strictEqual(ex.actions[0].params?.navigationTimeoutMs, 22000);
  });

  it("normalizes matcher aliases in params.matcher-like fields", () => {
    const ex = validateExecution({
      commandId: "cmd-match-1",
      taskId: "task-match-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        {
          id: "click-1",
          type: "click",
          params: {
            selector: {
              id: "com.example:id/login",
              accessibility_label: "Login",
            },
          },
        },
      ],
    });

    assert.deepStrictEqual(ex.actions[0].params?.matcher, {
      resourceId: "com.example:id/login",
      contentDescEquals: "Login",
    });
  });

  it("normalizes url to uri for open_uri", () => {
    const ex = validateExecution({
      commandId: "cmd-url-1",
      taskId: "task-url-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "open-1", type: "open_uri", params: { url: "https://example.com" } }],
    });

    assert.strictEqual(ex.actions[0].params?.uri, "https://example.com");
  });

  it("preserves canonical keys when both canonical and alias keys are present", () => {
    const ex = validateExecution({
      commandId: "cmd-canonical-1",
      taskId: "task-canonical-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{
        id: "open-1",
        type: "open_app",
        params: {
          applicationId: "com.example.canonical",
          package: "com.example.alias",
        },
      }],
    });

    assert.strictEqual(ex.actions[0].params?.applicationId, "com.example.canonical");
  });

  it("uses alias value when canonical key is explicitly undefined", () => {
    const ex = validateExecution({
      commandId: "cmd-canonical-undefined-1",
      taskId: "task-canonical-undefined-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{
        id: "open-1",
        type: "open_app",
        params: {
          applicationId: undefined,
          package: "com.example.alias",
        },
      }],
    });

    assert.strictEqual(ex.actions[0].params?.applicationId, "com.example.alias");
  });

  it("normalizes expected_package and expected_node aliases for wait_for_navigation", () => {
    const ex = validateExecution({
      commandId: "cmd-nav-1",
      taskId: "task-nav-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 10000,
      actions: [
        {
          id: "wait-1",
          type: "wait_for_navigation",
          params: {
            expected_package: "com.example.app",
            expected_node: { text: "Done" },
            timeout_ms: 5000,
          },
        },
      ],
    });

    assert.strictEqual(ex.actions[0].params?.expectedPackage, "com.example.app");
    assert.deepStrictEqual(ex.actions[0].params?.expectedNode, { textEquals: "Done" });
    assert.strictEqual(ex.actions[0].params?.timeoutMs, 5000);
  });

  it("accepts start_recording with sessionId", () => {
    const ex = validateExecution({
      commandId: "cmd-1",
      taskId: "task-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 10000,
      actions: [{ id: "a1", type: "start_recording", params: { sessionId: "session-1" } }],
    });
    assert.strictEqual(ex.actions[0].type, "start_recording");
    assert.strictEqual(ex.actions[0].params?.sessionId, "session-1");
  });

  it("accepts stop_recording without params", () => {
    const ex = validateExecution({
      commandId: "cmd-1",
      taskId: "task-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 10000,
      actions: [{ id: "a1", type: "stop_recording" }],
    });
    assert.strictEqual(ex.actions[0].type, "stop_recording");
  });

  it("rejects blank sessionId for recording actions", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "cmd-1",
          taskId: "task-1",
          source: "test",
          expectedFormat: "android-ui-automator",
          timeoutMs: 10000,
          actions: [{ id: "a1", type: "start_recording", params: { sessionId: "   " } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects missing expectedFormat", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "sleep", params: { durationMs: 0 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("keeps path and reason in ValidationFailure details", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "cmd-anchor-2",
          source: "test",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "snap-1", type: "snapshot" }],
        }),
      (e: unknown) => {
        const err = e as {
          code?: string;
          details?: { path?: string; reason?: string };
        };
        assert.strictEqual(err.code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
        assert.strictEqual(err.details?.path, "taskId");
        assert.ok(typeof err.details?.reason === "string" && err.details.reason.length > 0);
        return true;
      }
    );
  });

  it("rejects invalid expectedFormat", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "wrong-format",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "sleep", params: { durationMs: 0 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects empty actions", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects unsupported action type", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "unsupported_action" }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects timeout above max", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: LIMITS.MAX_EXECUTION_TIMEOUT_MS + 1,
          actions: [{ id: "x", type: "sleep", params: { durationMs: 0 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects open_app without applicationId", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "open_app", params: {} }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("accepts open_app skipNavigationWait and navigationTimeoutMs", () => {
    const ex = validateExecution({
      commandId: "cmd-open-nav-1",
      taskId: "task-open-nav-1",
      source: "test",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [
        {
          id: "x",
          type: "open_app",
          params: {
            applicationId: "com.example.app",
            skipNavigationWait: true,
            navigationTimeoutMs: 20_000,
          },
        },
      ],
    });

    assert.strictEqual(ex.actions[0].params?.skipNavigationWait, true);
    assert.strictEqual(ex.actions[0].params?.navigationTimeoutMs, 20_000);
  });

  it("rejects open_app with invalid navigationTimeoutMs", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "cmd-open-nav-2",
          taskId: "task-open-nav-2",
          source: "test",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [
            {
              id: "x",
              type: "open_app",
              params: {
                applicationId: "com.example.app",
                navigationTimeoutMs: LIMITS.MIN_EXECUTION_TIMEOUT_MS - 1,
              },
            },
          ],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects open_app with non boolean skipNavigationWait", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "cmd-open-nav-3",
          taskId: "task-open-nav-3",
          source: "test",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [
            {
              id: "x",
              type: "open_app",
              params: {
                applicationId: "com.example.app",
                skipNavigationWait: "true" as unknown as boolean,
              },
            },
          ],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects sleep with negative durationMs", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "sleep", params: { durationMs: -1 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects sleep with durationMs above max", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "sleep", params: { durationMs: LIMITS.MAX_EXECUTION_TIMEOUT_MS + 1 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("accepts sleep with durationMs at max", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: LIMITS.MAX_EXECUTION_TIMEOUT_MS,
      actions: [{ id: "x", type: "sleep", params: { durationMs: LIMITS.MAX_EXECUTION_TIMEOUT_MS } }],
    });
    assert.strictEqual(ex.actions[0].type, "sleep");
  });

  it("rejects enter_text without matcher", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "enter_text", params: { text: "hello" } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects unknown top-level fields (strict schema)", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "sleep", params: { durationMs: 1 } }],
          unexpectedField: "nope",
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("extracts action context from index 0 validation failures", () => {
    try {
      validateExecution({
        commandId: "cmd-anchor-3",
        taskId: "task-anchor-3",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 5000,
        actions: [
          {
            id: "snap",
            type: "snapshot",
            params: { format: "ascii" },
          },
        ],
      });
      assert.fail("expected validation to fail");
    } catch (e) {
      const err = e as {
        code?: string;
        details?: {
          actionId?: string;
          actionType?: string;
          invalidKeys?: string[];
          hint?: string;
          path?: string;
          reason?: string;
        };
      };
      assert.strictEqual(err.code, ERROR_CODES.EXECUTION_VALIDATION_FAILED);
      assert.strictEqual(err.details?.actionId, "snap");
      assert.strictEqual(err.details?.actionType, "snapshot");
      assert.deepStrictEqual(err.details?.invalidKeys, ["format"]);
      assert.strictEqual(err.details?.path, "actions.0.params");
    }
  });

  it("adds a known hint for removed parameters and omits unknown hints", () => {
    try {
      validateExecution({
        commandId: "cmd-anchor-4",
        taskId: "task-anchor-4",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 5000,
        actions: [
          {
            id: "snap",
            type: "snapshot",
            params: { format: "ascii" },
          },
        ],
      });
      assert.fail("expected validation to fail");
    } catch (e) {
      const err = e as {
        details?: {
          hint?: string;
        };
      };
      assert.strictEqual(
        err.details?.hint,
        "'format' was removed from snapshot. Remove this parameter."
      );
    }

    try {
      validateExecution({
        commandId: "cmd-anchor-5",
        taskId: "task-anchor-5",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 5000,
        actions: [
          {
            id: "snap",
            type: "snapshot",
            params: { other: "value" },
          },
        ],
      });
      assert.fail("expected validation to fail");
    } catch (e) {
      const err = e as {
        details?: {
          hint?: string;
        };
      };
      assert.ok(!("hint" in (err.details ?? {})));
    }
  });

  it("uses canonical action types for hint lookup while preserving the raw alias in details", () => {
    try {
      validateExecution({
        commandId: "cmd-anchor-6",
        taskId: "task-anchor-6",
        source: "test",
        expectedFormat: "android-ui-automator",
        timeoutMs: 5000,
        actions: [
          {
            id: "snap",
            type: "snapshot_ui",
            params: { format: "ascii" },
          },
        ],
      });
      assert.fail("expected validation to fail");
    } catch (e) {
      const err = e as {
        details?: {
          actionType?: string;
          hint?: string;
        };
      };
      assert.strictEqual(err.details?.actionType, "snapshot_ui");
      assert.strictEqual(
        err.details?.hint,
        "'format' was removed from snapshot. Remove this parameter."
      );
    }
  });
  it("accepts valid open_uri with uri", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "open_uri", params: { uri: "market://details?id=com.actionlauncher.playstore" } }],
    });
    assert.strictEqual(ex.actions[0].type, "open_uri");
    assert.strictEqual(ex.actions[0].params?.uri, "market://details?id=com.actionlauncher.playstore");
  });

  it("accepts open_uri with https uri", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "open_uri", params: { uri: "https://example.com" } }],
    });
    assert.strictEqual(ex.actions[0].type, "open_uri");
  });

  it("normalizes open_url alias to open_uri", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "open_url", params: { uri: "https://example.com" } }],
    });
    assert.strictEqual(ex.actions[0].type, "open_uri");
  });

  it("rejects open_uri without uri", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "open_uri", params: {} }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects open_uri with blank uri", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "open_uri", params: { uri: "   " } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("accepts press_key with key back", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "press_key", params: { key: "back" } }],
    });
    assert.strictEqual(ex.actions[0].type, "press_key");
    assert.strictEqual(ex.actions[0].params?.key, "back");
  });

  it("accepts press_key with key home", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "press_key", params: { key: "home" } }],
    });
    assert.strictEqual(ex.actions[0].params?.key, "home");
  });

  it("accepts press_key with key recents", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "press_key", params: { key: "recents" } }],
    });
    assert.strictEqual(ex.actions[0].params?.key, "recents");
  });

  it("normalizes key_press alias to press_key", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "key_press", params: { key: "back" } }],
    });
    assert.strictEqual(ex.actions[0].type, "press_key");
  });

  it("rejects press_key without params.key", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "press_key", params: {} }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects press_key with unsupported key", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "press_key", params: { key: "volume_up" } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects press_key with blank key", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "press_key", params: { key: "  " } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("accepts press_key with uppercase key (case-insensitive)", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "press_key", params: { key: "BACK" } }],
    });
    assert.strictEqual(ex.actions[0].type, "press_key");
    assert.strictEqual(ex.actions[0].params?.key, "BACK");
  });

  it("rejects take_screenshot with blank path", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "take_screenshot", params: { path: "   " } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("accepts scroll with no params", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "scroll" }],
    });
    assert.strictEqual(ex.actions[0].type, "scroll");
  });

  it("accepts scroll with all optional params", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{
        id: "x",
        type: "scroll",
        params: {
          container: { resourceId: "com.android.settings:id/list" },
          direction: "down",
          distanceRatio: 0.7,
          settleDelayMs: 250,
          findFirstScrollableChild: false,
        },
      }],
    });
    assert.strictEqual(ex.actions[0].type, "scroll");
    assert.strictEqual(ex.actions[0].params?.direction, "down");
    assert.strictEqual(ex.actions[0].params?.distanceRatio, 0.7);
  });

  it("accepts scroll with direction up", () => {
    const ex = validateExecution({
      commandId: "c",
      taskId: "t",
      source: "s",
      expectedFormat: "android-ui-automator",
      timeoutMs: 5000,
      actions: [{ id: "x", type: "scroll", params: { direction: "up" } }],
    });
    assert.strictEqual(ex.actions[0].params?.direction, "up");
  });

  it("accepts scroll with horizontal directions", () => {
    for (const dir of ["left", "right"]) {
      const ex = validateExecution({
        commandId: "c",
        taskId: "t",
        source: "s",
        expectedFormat: "android-ui-automator",
        timeoutMs: 5000,
        actions: [{ id: "x", type: "scroll", params: { direction: dir } }],
      });
      assert.strictEqual(ex.actions[0].params?.direction, dir);
    }
  });

  it("rejects scroll with unsupported direction", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll", params: { direction: "diagonal" } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects scroll with distanceRatio below 0", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll", params: { distanceRatio: -0.1 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects scroll with distanceRatio above 1", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll", params: { distanceRatio: 1.1 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects scroll with settleDelayMs below 0", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll", params: { settleDelayMs: -1 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects scroll with settleDelayMs above 10000", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c",
          taskId: "t",
          source: "s",
          expectedFormat: "android-ui-automator",
          timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll", params: { settleDelayMs: 10001 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("accepts scroll_until with no params", () => {
    const result = validateExecution({
      commandId: "c", taskId: "t", source: "s",
      expectedFormat: "android-ui-automator", timeoutMs: 5000,
      actions: [{ id: "x", type: "scroll_until" }],
    });
    assert.equal(result.actions[0].type, "scroll_until");
  });

  it("accepts scroll_until with all params", () => {
    const result = validateExecution({
      commandId: "c", taskId: "t", source: "s",
      expectedFormat: "android-ui-automator", timeoutMs: 5000,
      actions: [{
        id: "x", type: "scroll_until",
        params: { direction: "down", distanceRatio: 0.7, settleDelayMs: 250, maxScrolls: 25, maxDurationMs: 10000, noPositionChangeThreshold: 3, clickAfter: true, matcher: { textEquals: "About phone" } },
      }],
    });
    assert.equal(result.actions[0].type, "scroll_until");
  });

  it("rejects scroll_until clickAfter without matcher", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll_until", params: { clickAfter: true } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects scroll_until with invalid direction", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll_until", params: { direction: "diagonal" } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects scroll_until with maxScrolls out of range", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll_until", params: { maxScrolls: 0 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects scroll_until with maxDurationMs out of range", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll_until", params: { maxDurationMs: 120001 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects scroll_until with noPositionChangeThreshold out of range", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "scroll_until", params: { noPositionChangeThreshold: 21 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  // wait_for_navigation validation tests
  it("accepts wait_for_navigation with expectedPackage", () => {
    const ex = validateExecution({
      commandId: "c", taskId: "t", source: "s",
      expectedFormat: "android-ui-automator", timeoutMs: 5000,
      actions: [{ id: "x", type: "wait_for_navigation", params: { expectedPackage: "com.example.app", timeoutMs: 5000 } }],
    });
    assert.strictEqual(ex.actions[0].type, "wait_for_navigation");
  });

  it("accepts wait_for_navigation with expectedNode", () => {
    const ex = validateExecution({
      commandId: "c", taskId: "t", source: "s",
      expectedFormat: "android-ui-automator", timeoutMs: 5000,
      actions: [{ id: "x", type: "wait_for_navigation", params: { expectedNode: { textEquals: "Success" }, timeoutMs: 5000 } }],
    });
    assert.strictEqual(ex.actions[0].type, "wait_for_navigation");
  });

  it("rejects wait_for_navigation without expectedPackage or expectedNode", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "wait_for_navigation", params: { timeoutMs: 5000 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects wait_for_navigation with timeoutMs = 0", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "wait_for_navigation", params: { expectedPackage: "com.example", timeoutMs: 0 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects wait_for_navigation with timeoutMs > 30000", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "wait_for_navigation", params: { expectedPackage: "com.example", timeoutMs: 30001 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects wait_for_navigation with blank expectedPackage", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "wait_for_navigation", params: { expectedPackage: "   ", timeoutMs: 5000 } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  // read_key_value_pair validation tests
  it("accepts read_key_value_pair with labelMatcher", () => {
    const ex = validateExecution({
      commandId: "c", taskId: "t", source: "s",
      expectedFormat: "android-ui-automator", timeoutMs: 5000,
      actions: [{ id: "x", type: "read_key_value_pair", params: { labelMatcher: { textEquals: "Android version" } } }],
    });
    assert.strictEqual(ex.actions[0].type, "read_key_value_pair");
  });

  it("rejects read_key_value_pair without labelMatcher", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "read_key_value_pair", params: {} }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  // read_text with regex validator tests
  it("accepts read_text with version validator", () => {
    const ex = validateExecution({
      commandId: "c", taskId: "t", source: "s",
      expectedFormat: "android-ui-automator", timeoutMs: 5000,
      actions: [{ id: "x", type: "read_text", params: { matcher: { textContains: "Version" }, validator: "version" } }],
    });
    assert.strictEqual(ex.actions[0].type, "read_text");
  });

  it("accepts read_text with regex validator and validatorPattern", () => {
    const ex = validateExecution({
      commandId: "c", taskId: "t", source: "s",
      expectedFormat: "android-ui-automator", timeoutMs: 5000,
      actions: [{ id: "x", type: "read_text", params: { matcher: { textContains: "Order" }, validator: "regex", validatorPattern: "^ORD-[0-9]{6}$" } }],
    });
    assert.strictEqual(ex.actions[0].type, "read_text");
  });

  it("rejects read_text with regex validator but missing validatorPattern", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "read_text", params: { matcher: { textContains: "Order" }, validator: "regex" } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects read_text with regex validator and blank validatorPattern", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "read_text", params: { matcher: { textContains: "Order" }, validator: "regex", validatorPattern: "" } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  it("rejects read_text with regex validator and invalid regex pattern", () => {
    assert.throws(
      () =>
        validateExecution({
          commandId: "c", taskId: "t", source: "s",
          expectedFormat: "android-ui-automator", timeoutMs: 5000,
          actions: [{ id: "x", type: "read_text", params: { matcher: { textContains: "Order" }, validator: "regex", validatorPattern: "[invalid(" } }],
        }),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
    );
  });

  // matcher validation tests for scroll_and_click and scroll_until
  describe("matcher param validation", () => {
    it("accepts scroll_and_click with 'matcher' param", () => {
      const ex = validateExecution({
        commandId: "c", taskId: "t", source: "s",
        expectedFormat: "android-ui-automator", timeoutMs: 5000,
        actions: [{ id: "x", type: "scroll_and_click", params: { matcher: { textEquals: "About phone" } } }],
      });
      assert.strictEqual(ex.actions[0].type, "scroll_and_click");
    });

    it("rejects scroll_and_click without 'matcher' param", () => {
      assert.throws(
        () =>
          validateExecution({
            commandId: "c", taskId: "t", source: "s",
            expectedFormat: "android-ui-automator", timeoutMs: 5000,
            actions: [{ id: "x", type: "scroll_and_click", params: {} }],
          }),
        (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
      );
    });

    it("rejects scroll_and_click with legacy 'target' param", () => {
      assert.throws(
        () =>
          validateExecution({
            commandId: "c", taskId: "t", source: "s",
            expectedFormat: "android-ui-automator", timeoutMs: 5000,
            actions: [{ id: "x", type: "scroll_and_click", params: { target: { textEquals: "About phone" } } }],
          }),
        (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
      );
    });

    it("accepts scroll_until with 'matcher' param and clickAfter", () => {
      const ex = validateExecution({
        commandId: "c", taskId: "t", source: "s",
        expectedFormat: "android-ui-automator", timeoutMs: 5000,
        actions: [{ id: "x", type: "scroll_until", params: { matcher: { textEquals: "About phone" }, clickAfter: true } }],
      });
      assert.strictEqual(ex.actions[0].type, "scroll_until");
    });

    it("rejects scroll_until with legacy 'target' param", () => {
      assert.throws(
        () =>
          validateExecution({
            commandId: "c", taskId: "t", source: "s",
            expectedFormat: "android-ui-automator", timeoutMs: 5000,
            actions: [{ id: "x", type: "scroll_until", params: { target: { textEquals: "About phone" }, clickAfter: true } }],
          }),
        (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
      );
    });

    it("accepts scroll_until without matcher when clickAfter is not set", () => {
      const ex = validateExecution({
        commandId: "c", taskId: "t", source: "s",
        expectedFormat: "android-ui-automator", timeoutMs: 5000,
        actions: [{ id: "x", type: "scroll_until", params: { direction: "down" } }],
      });
      assert.strictEqual(ex.actions[0].type, "scroll_until");
    });

    it("rejects scroll_until with clickAfter=true but no matcher", () => {
      assert.throws(
        () =>
          validateExecution({
            commandId: "c", taskId: "t", source: "s",
            expectedFormat: "android-ui-automator", timeoutMs: 5000,
            actions: [{ id: "x", type: "scroll_until", params: { clickAfter: true } }],
          }),
        (e: unknown) => (e as { code?: string }).code === ERROR_CODES.EXECUTION_VALIDATION_FAILED
      );
    });
  });
});

describe("validatePayloadSize", () => {
  it("allows payload within limit", () => {
    validatePayloadSize("{}");
  });

  it("throws for payload over limit", () => {
    const big = "x".repeat(LIMITS.MAX_PAYLOAD_BYTES + 1);
    assert.throws(
      () => validatePayloadSize(big),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.PAYLOAD_TOO_LARGE
    );
  });
});
