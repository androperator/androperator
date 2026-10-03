import { describe, it } from "node:test";
import assert from "node:assert";
import { mapServeErrorCodeToStatus } from "../../cli/commands/serve.js";
import { ERROR_CODES } from "../../contracts/errors.js";

describe("mapServeErrorCodeToStatus", () => {
  it("maps DEVICE_NOT_INTERACTIVE to 409 Conflict for direct execution routes", () => {
    assert.strictEqual(mapServeErrorCodeToStatus(ERROR_CODES.DEVICE_NOT_INTERACTIVE), 409);
  });

  it("maps DEVICE_ACCESSIBILITY_NOT_RUNNING to 409 Conflict for direct execution routes", () => {
    assert.strictEqual(mapServeErrorCodeToStatus(ERROR_CODES.DEVICE_ACCESSIBILITY_NOT_RUNNING), 409);
  });

  it("maps DEVICE_SHELL_UNAVAILABLE to 503 Service Unavailable for transport failures", () => {
    assert.strictEqual(mapServeErrorCodeToStatus(ERROR_CODES.DEVICE_SHELL_UNAVAILABLE), 503);
  });
});
