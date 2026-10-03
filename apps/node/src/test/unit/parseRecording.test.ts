import { describe, it } from "node:test";
import assert from "node:assert";
import { parseRecording } from "../../domain/recording/parseRecording.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import type { OpenAppStep, ClickStep } from "../../domain/recording/recordingEventTypes.js";

function buildHeader(overrides?: { schemaVersion?: number; sessionId?: string }): string {
  const schemaVersion = overrides?.schemaVersion ?? 1;
  const sessionId = overrides?.sessionId ?? "test-session-001";
  return JSON.stringify({
    type: "recording_header",
    schemaVersion,
    sessionId,
    startedAt: 1710000000000,
    operatorPackage: "com.androperator.operator.test",
  });
}

describe("parseRecording", () => {
  it("open_app step inferred from first window_change", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000100,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: "com.android.settings.Settings",
        title: "Settings",
        snapshot: "<hierarchy><node /></hierarchy>",
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].type, "open_app");
    assert.strictEqual((result.steps[0] as OpenAppStep).packageName, "com.android.settings");
    assert.strictEqual(result.steps[0].seq, 0);
    assert.strictEqual(result.steps[0].uiStateBefore, "<hierarchy><node /></hierarchy>");
  });

  it("click step extracted with all fields", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "click",
        packageName: "com.android.settings",
        resourceId: "com.android.settings:id/dashboard_tile",
        text: "Display",
        contentDesc: "Display settings",
        bounds: { left: 0, top: 400, right: 1080, bottom: 560 },
        snapshot: "<hierarchy><node text='Display' /></hierarchy>",
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps.length, 2);
    
    const clickStep = result.steps[1] as ClickStep;
    assert.strictEqual(clickStep.type, "click");
    assert.strictEqual(clickStep.seq, 1);
    assert.strictEqual(clickStep.packageName, "com.android.settings");
    assert.strictEqual(clickStep.resourceId, "com.android.settings:id/dashboard_tile");
    assert.strictEqual(clickStep.text, "Display");
    assert.strictEqual(clickStep.contentDesc, "Display settings");
    assert.deepStrictEqual(clickStep.bounds, { left: 0, top: 400, right: 1080, bottom: 560 });
    assert.strictEqual(clickStep.uiStateBefore, "<hierarchy><node text='Display' /></hierarchy>");
  });

  it("consecutive window_changes collapsed to final one", () => {
    const ndjson = [
      buildHeader(),
      // First window_change - becomes open_app
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      // Second window_change - consecutive, should be collapsed
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      // Third window_change - consecutive, should be collapsed
      JSON.stringify({
        ts: 1710000000200,
        seq: 2,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    // Only the first window_change becomes a step (open_app)
    // The rest are suppressed because there's no intervening click or press_key
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].type, "open_app");
  });

  it("window_change after a click is NOT collapsed (intervening click breaks the run)", () => {
    const ndjson = [
      buildHeader(),
      // First window_change - becomes open_app
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      // Click - breaks the window_change run
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "click",
        packageName: "com.android.settings",
        resourceId: "id",
        text: "Display",
        contentDesc: null,
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        snapshot: null,
      }),
      // Window change after click - NOT suppressed (click broke the run)
      JSON.stringify({
        ts: 1710000000200,
        seq: 2,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    // open_app, click - window_change after click doesn't create a step in v1
    // but it resets the suppression state
    assert.strictEqual(result.steps.length, 2);
    assert.strictEqual(result.steps[0].type, "open_app");
    assert.strictEqual(result.steps[1].type, "click");
  });

  it("scroll events dropped with warnings", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: "<hierarchy><node /></hierarchy>",
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "scroll",
        packageName: "com.android.settings",
        resourceId: null,
        scrollX: 0,
        scrollY: 420,
        maxScrollX: 0,
        maxScrollY: 2800,
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps.length, 1);
    assert.ok(result._warnings, "Warnings should be present");
    assert.strictEqual(result._warnings!.length, 1);
    assert.ok(result._warnings![0].includes("scroll event dropped"));
    assert.ok(result._warnings![0].includes("seq 1"));
  });

  it("text_change events dropped silently (no warning)", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: "<hierarchy><node /></hierarchy>",
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "text_change",
        packageName: "com.android.settings",
        resourceId: "id",
        text: "hello world",
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result._warnings, undefined);
  });

  it("_warnings absent when no warnings generated", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: "<hierarchy><node /></hierarchy>",
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual("_warnings" in result, false);
    assert.strictEqual(result._warnings, undefined);
  });

  it("_warnings present with correct message when scroll dropped", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 5,
        type: "scroll",
        packageName: "com.android.settings",
        resourceId: null,
        scrollX: 0,
        scrollY: 100,
        maxScrollX: 0,
        maxScrollY: 1000,
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.ok(result._warnings);
    assert.ok(result._warnings!.some(w => w.includes("seq 5") && w.includes("scroll event dropped")));
  });

  it("null snapshot on event produces step with uiStateBefore: null", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps[0].uiStateBefore, null);
    assert.ok(result._warnings);
    assert.strictEqual(result._warnings!.length, 1);
    assert.match(result._warnings![0], /seq 0/);
    assert.match(result._warnings![0], /snapshot missing/);
  });

  it("null snapshot on click produces step with uiStateBefore: null and warning", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: "<hierarchy><node /></hierarchy>",
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "click",
        packageName: "com.android.settings",
        resourceId: "id",
        text: "Display",
        contentDesc: null,
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps[1].uiStateBefore, null);
    assert.ok(result._warnings);
    assert.strictEqual(result._warnings!.length, 1);
    assert.match(result._warnings![0], /seq 1/);
    assert.match(result._warnings![0], /click/);
  });

  it("missing snapshot field on event produces step with uiStateBefore: null", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        // No snapshot field at all
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps[0].uiStateBefore, null);
    assert.ok(result._warnings);
    assert.strictEqual(result._warnings!.length, 1);
    assert.match(result._warnings![0], /seq 0/);
    assert.match(result._warnings![0], /snapshot missing/);
  });

  it("rejects missing header (first line is not recording_header)", () => {
    const ndjson = JSON.stringify({
      ts: 1710000000000,
      seq: 0,
      type: "window_change",
      packageName: "com.android.settings",
      className: null,
      title: null,
      snapshot: null,
    });

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED
    );
  });

  it("rejects malformed header missing required fields", () => {
    const ndjson = JSON.stringify({
      type: "recording_header",
      schemaVersion: 1,
      startedAt: 1710000000000,
      operatorPackage: "com.androperator.operator.test",
      // sessionId is missing
    });

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED
    );
  });

  it("rejects unsupported schema version", () => {
    const ndjson = buildHeader({ schemaVersion: 99 });

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_SCHEMA_VERSION_UNSUPPORTED
    );
  });

  it("accepts structurally valid empty recording (header only, zero events)", () => {
    const ndjson = buildHeader();

    const result = parseRecording(ndjson);
    assert.strictEqual(result.sessionId, "test-session-001");
    assert.strictEqual(result.schemaVersion, 1);
    assert.strictEqual(result.steps.length, 0);
  });

  it("seq ordering: steps appear in seq order", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000300,
        seq: 2,
        type: "click",
        packageName: "com.android.settings",
        resourceId: "id2",
        text: "Second",
        contentDesc: null,
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "click",
        packageName: "com.android.settings",
        resourceId: "id1",
        text: "First",
        contentDesc: null,
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps.length, 3);
    assert.strictEqual(result.steps[0].seq, 0); // window_change -> open_app
    assert.strictEqual(result.steps[1].seq, 1); // click
    assert.strictEqual(result.steps[2].seq, 2); // click
  });

  it("press_key events dropped silently (no warning)", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: "<hierarchy><node /></hierarchy>",
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "press_key",
        key: "back",
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result._warnings, undefined);
  });

  it("multiple scroll events produce multiple warnings", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: "<hierarchy><node /></hierarchy>",
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "scroll",
        packageName: "com.android.settings",
        resourceId: null,
        scrollX: 0,
        scrollY: 100,
        maxScrollX: 0,
        maxScrollY: 1000,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000200,
        seq: 2,
        type: "scroll",
        packageName: "com.android.settings",
        resourceId: null,
        scrollX: 0,
        scrollY: 200,
        maxScrollX: 0,
        maxScrollY: 1000,
        snapshot: null,
      }),
    ].join("\n");

    const result = parseRecording(ndjson);
    assert.ok(result._warnings);
    assert.strictEqual(result._warnings!.length, 2);
    assert.ok(result._warnings!.some(w => w.includes("seq 1")));
    assert.ok(result._warnings!.some(w => w.includes("seq 2")));
  });

  it("rejects empty recording file", () => {
    assert.throws(
      () => parseRecording(""),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED
    );
  });

  it("rejects file with only whitespace", () => {
    assert.throws(
      () => parseRecording("   \n\n   "),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED
    );
  });

  it("rejects malformed NDJSON lines", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      // This line is malformed JSON (truncated)
      '{"ts":1710000000100,"seq":1,"type":"click"',
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED
    );
  });

  it("rejects event missing required fields (ts)", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        // ts is missing
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("missing required fields");
      }
    );
  });

  it("rejects event missing required fields (seq)", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        // seq is missing
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("missing required fields");
      }
    );
  });

  it("rejects event missing required fields (type)", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        // type is missing
        packageName: "com.android.settings",
        className: null,
        title: null,
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("missing required fields");
      }
    );
  });

  it("rejects window_change event missing packageName", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        // packageName is missing
        className: null,
        title: null,
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("window_change") &&
               err.message?.includes("packageName");
      }
    );
  });

  it("rejects click event missing bounds", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "click",
        packageName: "com.android.settings",
        resourceId: "id",
        text: "Display",
        contentDesc: null,
        // bounds is missing
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("click") &&
               err.message?.includes("missing required fields");
      }
    );
  });

  it("rejects click event with non-numeric bounds", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "click",
        packageName: "com.android.settings",
        resourceId: "id",
        text: "Display",
        contentDesc: null,
        bounds: { left: 0, top: 0, right: "100", bottom: 100 },
        snapshot: null,
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("click") &&
               err.message?.includes("missing required fields");
      }
    );
  });

  it("rejects scroll event missing scroll coordinates", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "scroll",
        packageName: "com.android.settings",
        resourceId: null,
        // scrollX, scrollY, maxScrollX, maxScrollY are missing
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("scroll") &&
               err.message?.includes("missing required fields");
      }
    );
  });

  it("rejects press_key event with invalid key", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "press_key",
        key: "volume_up", // Invalid key - only "back" is supported
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("press_key") &&
               err.message?.includes("key");
      }
    );
  });

  it("rejects text_change event missing text", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: null,
        title: null,
        snapshot: null,
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "text_change",
        packageName: "com.android.settings",
        resourceId: "id",
        // text is missing
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("text_change") &&
               err.message?.includes("missing required fields");
      }
    );
  });

  it("rejects unknown event type", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "unknown_event_type",
        packageName: "com.android.settings",
      }),
    ].join("\n");

    assert.throws(
      () => parseRecording(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("Unknown event type");
      }
    );
  });

  it("still prints the human-readable step summary to stderr", () => {
    const ndjson = [
      buildHeader(),
      JSON.stringify({
        ts: 1710000000000,
        seq: 0,
        type: "window_change",
        packageName: "com.android.settings",
        className: "com.android.settings.Settings",
        title: "Settings",
        snapshot: "<hierarchy><node /></hierarchy>",
      }),
      JSON.stringify({
        ts: 1710000000100,
        seq: 1,
        type: "click",
        packageName: "com.android.settings",
        resourceId: "com.android.settings:id/dashboard_tile",
        text: "Display",
        contentDesc: "Display settings",
        bounds: { left: 0, top: 400, right: 1080, bottom: 560 },
        snapshot: "<hierarchy><node text='Display' /></hierarchy>",
      }),
    ].join("\n");

    const writes: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      parseRecording(ndjson);
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.deepStrictEqual(writes, [
      "[0] open_app   com.android.settings\n",
      "[1] click      text=\"Display\" resourceId=com.android.settings:id/dashboard_tile contentDesc=\"Display settings\"\n",
    ]);
  });
});
