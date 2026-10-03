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
    assert.strictEqual(normalizeCompatibilityVersion("1.0.0-d"), "1.0.0");
  });

  it("maps receiver packages to their APK download paths", () => {
    assert.strictEqual(getOperatorPackageApkPath("com.androperator.operator.dev"), "~/.androperator/downloads/operator-debug.apk");
    assert.strictEqual(getOperatorPackageApkPath("com.androperator.operator"), "~/.androperator/downloads/operator.apk");
  });

  it("builds versioned APK download URLs", () => {
    assert.strictEqual(
      getOperatorApkDownloadUrl("1.0.0"),
      "https://downloads.androperator.com/operator/v1.0.0/operator-v1.0.0.apk"
    );
    assert.strictEqual(
      getOperatorApkSha256Url("1.0.0"),
      "https://downloads.androperator.com/operator/v1.0.0/operator-v1.0.0.apk.sha256"
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
    assert.throws(() => parseCompatibilityVersion("1.0.0.1"), /Unsupported Androperator version format/);
  });

  it("requires the same normalized version", () => {
    assert.strictEqual(isVersionCompatible("1.0.0", "1.0.0"), true);
    assert.strictEqual(isVersionCompatible("1.0.0", "1.0.0-d"), true);
    assert.strictEqual(isVersionCompatible("1.0.0-d", "1.0.0"), true);
    assert.strictEqual(isVersionCompatible("1.0.0", "1.0.1"), false);
    assert.strictEqual(isVersionCompatible("1.0.0", "1.1.0"), false);
    assert.strictEqual(isVersionCompatible("1.0.0", "2.0.0"), false);
  });

  it("rejects prerelease-style versions in compatibility checks", () => {
    assert.throws(() => parseCompatibilityVersion("1.0.0-alpha"), /Unsupported Androperator version format/);
    assert.throws(() => parseCompatibilityVersion("1.0.0-rc.1"), /Unsupported Androperator version format/);
    assert.throws(() => isVersionCompatible("1.0.0-alpha", "1.0.0"), /Unsupported Androperator version format/);
  });

  it("parses installed APK metadata from dumpsys output", () => {
    const parsed = parseInstalledApkVersion(`
      Package [com.androperator.operator] (abcd):
        versionCode=10000900 minSdk=21 targetSdk=35
        versionName=1.0.0-d
    `);

    assert.deepStrictEqual(parsed, { versionName: "1.0.0-d", versionCode: 10000900 });
  });

  it("throws when versionName is missing from dumpsys output", () => {
    assert.throws(() => parseInstalledApkVersion("Package [com.androperator.operator]"), /versionName/);
  });
});
