import { describe, it } from "node:test";
import assert from "node:assert";
import { cmdOperatorSetup, didAllPermissionsAlreadyExist } from "../../cli/commands/operatorSetup.js";
import type { PermissionGrantResult } from "../../domain/device/setupOperator.js";

describe("operator setup command messaging", () => {
  it("does not report already-enabled when notification grant was skipped", () => {
    const permissions: PermissionGrantResult = {
      operatorPackage: "com.androperator.operator",
      accessibility: { ok: true, alreadyEnabled: true },
      notification: { ok: true, skipped: true, error: "Not a changeable permission type" },
      notificationListener: { ok: true, alreadyEnabled: true },
    };

    assert.strictEqual(didAllPermissionsAlreadyExist(permissions), false);
  });

  it("reports already-enabled only when all tracked permissions pre-existed", () => {
    const permissions: PermissionGrantResult = {
      operatorPackage: "com.androperator.operator",
      accessibility: { ok: true, alreadyEnabled: true },
      notification: { ok: true, skipped: false },
      notificationListener: { ok: true, alreadyEnabled: true },
    };

    assert.strictEqual(didAllPermissionsAlreadyExist(permissions), true);
  });
});


describe("operator setup repair failure output", () => {
  it("retains failed probe correlation when permission repair fails", async () => {
    const verification = { ok: false, packageInstalled: true, readiness: { ok: false, attempts: [{
      ok: false as const, code: "DEVICE_ACCESSIBILITY_NOT_RUNNING" as const, message: "Unavailable",
      details: { probeCommandId: "probe-1", probeTaskId: "doctor-handshake" },
    }] } };
    const output = await cmdOperatorSetup({ format: "json", apkPath: "/test.apk", operatorPackage: "com.androperator.operator" }, async () => ({
      operatorPackage: "com.androperator.operator", install: { ok: true }, verification,
      permissions: { operatorPackage: "com.androperator.operator",
        accessibility: { ok: false, alreadyEnabled: false, error: "Device disconnected" },
        notification: { ok: true, skipped: false }, notificationListener: { ok: true, alreadyEnabled: false } },
    }));
    const result = JSON.parse(output);
    assert.equal(result.code, "OPERATOR_GRANT_FAILED");
    assert.deepEqual(result.verification, verification);
  });
});
