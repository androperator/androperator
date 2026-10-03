import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_OPERATOR_PACKAGE,
  resolveOperatorPackageForRequest,
} from "../../domain/config/resolveOperatorPackage.js";

describe("resolveOperatorPackageForRequest", () => {
  const originalOperatorPackage = process.env.ANDROPERATOR_OPERATOR_PACKAGE;

  afterEach(() => {
    if (originalOperatorPackage === undefined) {
      delete process.env.ANDROPERATOR_OPERATOR_PACKAGE;
      return;
    }

    process.env.ANDROPERATOR_OPERATOR_PACKAGE = originalOperatorPackage;
  });

  it("uses the explicit caller value when provided", () => {
    process.env.ANDROPERATOR_OPERATOR_PACKAGE = "com.example.env";

    const resolved = resolveOperatorPackageForRequest("com.example.explicit");

    assert.strictEqual(resolved, "com.example.explicit");
  });

  it("falls back to ANDROPERATOR_OPERATOR_PACKAGE when omitted", () => {
    process.env.ANDROPERATOR_OPERATOR_PACKAGE = "com.example.env";

    const resolved = resolveOperatorPackageForRequest(undefined);

    assert.strictEqual(resolved, "com.example.env");
  });

  it("falls back to the default package when env is absent or blank", () => {
    delete process.env.ANDROPERATOR_OPERATOR_PACKAGE;
    assert.strictEqual(resolveOperatorPackageForRequest(undefined), DEFAULT_OPERATOR_PACKAGE);

    process.env.ANDROPERATOR_OPERATOR_PACKAGE = "   ";
    assert.strictEqual(resolveOperatorPackageForRequest(undefined), DEFAULT_OPERATOR_PACKAGE);
  });
});
