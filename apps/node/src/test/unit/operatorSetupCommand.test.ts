import { describe, it } from "node:test";
import assert from "node:assert";
import { didAllPermissionsAlreadyExist } from "../../cli/commands/operatorSetup.js";
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
