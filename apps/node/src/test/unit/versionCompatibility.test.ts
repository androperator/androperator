import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getAlternateOperatorVariant,
  getOperatorApkDownloadUrl,
  getOperatorApkSha256Url,
  getOperatorPackageApkPath,
  isVersionCompatible,
  normalizeCompatibilityVersion,
  parseCompatibilityVersion,
  parseInstalledApkVersion,
  readCliVersion,
} from "../../domain/version/compatibility.js";

describe("version compatibility", () => {
  it("normalizes the debug suffix before compatibility parsing", () => {
    assert.strictEqual(normalizeCompatibilityVersion("0.1.4-d"), "0.1.4");
  });

  it("maps receiver packages to their APK download paths", () => {
    assert.strictEqual(getOperatorPackageApkPath("com.androperator.operator.dev"), "~/.androperator/downloads/operator-debug.apk");
    assert.strictEqual(getOperatorPackageApkPath("com.androperator.operator"), "~/.androperator/downloads/operator.apk");
  });

  it("builds versioned APK download URLs", () => {
    assert.strictEqual(
      getOperatorApkDownloadUrl("0.1.4"),
      "https://downloads.androperator.com/operator/v0.1.4/operator-v0.1.4.apk"
    );
    assert.strictEqual(
      getOperatorApkSha256Url("0.1.4"),
      "https://downloads.androperator.com/operator/v0.1.4/operator-v0.1.4.apk.sha256"
    );
  });

  it("removes only a trailing debug suffix when deriving the alternate package", () => {
    assert.strictEqual(getAlternateOperatorVariant("com.androperator.operator.dev"), "com.androperator.operator");
    assert.strictEqual(
      getAlternateOperatorVariant("com.example.devtools.operator.dev"),
      "com.example.devtools.operator"
    );
    assert.strictEqual(
      getAlternateOperatorVariant("com.example.devtools.operator"),
      "com.example.devtools.operator.dev"
    );
  });

  it("throws when the CLI package metadata has no version", () => {
    assert.throws(() => readCliVersion({}), /package\.json version is missing/);
    assert.throws(() => readCliVersion({ version: "   " }), /package\.json version is missing/);
  });

  it("rejects non-simple versions", () => {
    assert.throws(() => parseCompatibilityVersion("0.1.4.1"), /Unsupported Androperator version format/);
  });

  it("requires the same normalized version", () => {
    assert.strictEqual(isVersionCompatible("0.1.4", "0.1.4"), true);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.1.4-d"), true);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.1.9"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.2.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.4.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.4.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.5.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.5.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.5.2"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.5.3"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.5.4"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.5.5"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.5.6"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.6.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.6.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.6.2"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.6.3"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.6.4"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.6.5"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.6.6"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.2"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.3"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.4"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.5"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.6"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.7"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.8"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.7.9"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.8.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.8.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.9.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.9.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.9.2"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.9.3"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.9.4"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.9.5"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.9.6"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.10.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.10.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.11.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.11.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.11.2"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.11.3"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.11.4"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.12.0"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.12.1"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.12.2"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.12.3"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.12.4"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.12.5"), false);
    assert.strictEqual(isVersionCompatible("0.1.4", "0.12.6"), false);
  });

  it("rejects prerelease-style versions in compatibility checks", () => {
    assert.throws(() => parseCompatibilityVersion("0.1.4-alpha"), /Unsupported Androperator version format/);
    assert.throws(() => parseCompatibilityVersion("0.1.4-rc.1"), /Unsupported Androperator version format/);
    assert.throws(() => isVersionCompatible("0.1.4-alpha", "0.1.4"), /Unsupported Androperator version format/);
  });

  it("parses installed APK metadata from dumpsys output", () => {
    const parsed = parseInstalledApkVersion(`
      Package [com.androperator.operator] (abcd):
        versionCode=104900 minSdk=21 targetSdk=35
        versionName=0.1.4-d
    `);

    assert.deepStrictEqual(parsed, { versionName: "0.1.4-d", versionCode: 104900 });
  });

  it("throws when versionName is missing from dumpsys output", () => {
    assert.throws(() => parseInstalledApkVersion("Package [com.androperator.operator]"), /versionName/);
  });
});
