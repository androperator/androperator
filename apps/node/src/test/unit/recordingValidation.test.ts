import { describe, it } from "node:test";
import assert from "node:assert";
import { validateRecordingNdjson } from "../../domain/recording/recordingValidation.js";
import { ERROR_CODES } from "../../contracts/errors.js";

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


describe("recording evidence validation", () => {
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED
    );
  });

  it("rejects unsupported schema version", () => {
    const ndjson = buildHeader({ schemaVersion: 99 });

    assert.throws(
      () => validateRecordingNdjson(ndjson),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_SCHEMA_VERSION_UNSUPPORTED
    );
  });

  it("rejects empty recording file", () => {
    assert.throws(
      () => validateRecordingNdjson(""),
      (e: unknown) => (e as { code?: string }).code === ERROR_CODES.RECORDING_PARSE_FAILED
    );
  });

  it("rejects file with only whitespace", () => {
    assert.throws(
      () => validateRecordingNdjson("   \n\n   "),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
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
      () => validateRecordingNdjson(ndjson),
      (e: unknown) => {
        const err = e as { code?: string; message?: string };
        return err.code === ERROR_CODES.RECORDING_PARSE_FAILED &&
               err.message?.includes("Unknown event type");
      }
    );
  });

});
