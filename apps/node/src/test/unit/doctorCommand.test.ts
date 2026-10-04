import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cmdDoctor } from "../../cli/commands/doctor.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { DOCTOR_DOCS_URLS } from "../../domain/doctor/docsUrls.js";

afterEach(() => {
  process.exitCode = undefined;
});

describe("cmdDoctor", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");

  it("returns nonzero under --check-only even when the APK is missing", async () => {
    const output = await cmdDoctor(
      {
        format: "json",
        checkOnly: true,
        deviceId: "test-device-1",
        operatorPackage: "com.test.operator",
      },
      {
        doctorService: {
          run: async () => ({
            ok: false,
            criticalOk: false,
            deviceId: "test-device-1",
            operatorPackage: "com.test.operator",
            checks: [
              {
                id: "readiness.apk.presence",
                status: "fail",
                code: ERROR_CODES.OPERATOR_NOT_INSTALLED,
                summary: "Operator APK not installed.",
              },
            ],
            nextActions: ["androperator operator setup --apk ~/.androperator/downloads/operator.apk --device test-device-1"],
          }),
        },
      }
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.criticalOk, false);
    assert.strictEqual(parsed.checks[0].code, ERROR_CODES.OPERATOR_NOT_INSTALLED);
    assert.strictEqual(process.exitCode, 1);
  });

  it("returns a non-zero exit code without --check-only when the APK is missing", async () => {
    const output = await cmdDoctor(
      {
        format: "json",
        deviceId: "test-device-1",
        operatorPackage: "com.test.operator",
      },
      {
        doctorService: {
          run: async () => ({
            ok: false,
            criticalOk: false,
            deviceId: "test-device-1",
            operatorPackage: "com.test.operator",
            checks: [
              {
                id: "readiness.apk.presence",
                status: "fail",
                code: ERROR_CODES.OPERATOR_NOT_INSTALLED,
                summary: "Operator APK not installed.",
              },
            ],
          }),
        },
      }
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.criticalOk, false);
    assert.strictEqual(process.exitCode, 1);
  });

  it("includes docsUrl in JSON output when a fix provides one", async () => {
    const output = await cmdDoctor(
      {
        format: "json",
      },
      {
        doctorService: {
          run: async () => ({
            ok: false,
            criticalOk: false,
            checks: [
              {
                id: "host.node.version",
                status: "fail",
                code: ERROR_CODES.NODE_TOO_OLD,
                summary: "Node is too old.",
                fix: {
                  title: "Upgrade Node.js",
                  platform: "any",
                  steps: [{ kind: "shell", value: "nvm install 24" }],
                  docsUrl: DOCTOR_DOCS_URLS.setup,
                },
              },
            ],
          }),
        },
      }
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.checks[0].fix.docsUrl, DOCTOR_DOCS_URLS.setup);
  });

  it("preserves interactive-state evidence in JSON output", async () => {
    const output = await cmdDoctor(
      {
        format: "json",
      },
      {
        doctorService: {
          run: async () => ({
            ok: false,
            criticalOk: false,
            deviceId: "test-device-1",
            operatorPackage: "com.test.operator",
            checks: [
              {
                id: "readiness.device.interactive",
                status: "fail",
                code: ERROR_CODES.DEVICE_NOT_INTERACTIVE,
                summary: "Device is not interactive.",
                evidence: {
                  deviceLocked: true,
                  screenOn: false,
                  userUnlocked: false,
                },
              },
            ],
          }),
        },
      }
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.checks[0].code, ERROR_CODES.DEVICE_NOT_INTERACTIVE);
    assert.deepStrictEqual(parsed.checks[0].evidence, {
      deviceLocked: true,
      screenOn: false,
      userUnlocked: false,
    });
  });

  it("omits docsUrl in JSON output when a fix does not provide one", async () => {
    const output = await cmdDoctor(
      {
        format: "json",
      },
      {
        doctorService: {
          run: async () => ({
            ok: false,
            criticalOk: false,
            checks: [
              {
                id: "host.adb.presence",
                status: "fail",
                code: ERROR_CODES.ADB_NOT_FOUND,
                summary: "adb not found.",
                fix: {
                  title: "Install adb",
                  platform: "any",
                  steps: [{ kind: "manual", value: "Install platform tools" }],
                },
              },
            ],
          }),
        },
      }
    );

    const parsed = JSON.parse(output);
    assert.ok(!("docsUrl" in parsed.checks[0].fix));
  });

  it("renders docsUrl in pretty output", async () => {
    const output = await cmdDoctor(
      {
        format: "pretty",
      },
      {
        doctorService: {
          run: async () => ({
            ok: false,
            criticalOk: false,
            checks: [
              {
                id: "readiness.handshake",
                status: "fail",
                code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT,
                summary: "Handshake timed out.",
                fix: {
                  title: "Grant accessibility permissions via adb",
                  platform: "any",
                  steps: [{ kind: "shell", value: "androperator grant-device-permissions --device test-device" }],
                  docsUrl: DOCTOR_DOCS_URLS.operator,
                },
              },
            ],
          }),
        },
      }
    );

    assert.match(output, /Docs: https:\/\/docs\.androperator\.com\/troubleshooting\/operator\//);
  });

  it("formats shell commands in pretty checks and next actions without changing JSON values", async () => {
    const report = {
      ok: false,
      criticalOk: false,
      checks: [{
        id: "host.adb.presence",
        status: "fail" as const,
        summary: "adb not found in PATH.",
        fix: {
          title: "Install Android Platform Tools",
          platform: "any" as const,
          steps: [
            { kind: "shell" as const, value: "adb start-server" },
            { kind: "manual" as const, value: "macOS: brew install --cask android-platform-tools" },
          ],
        },
      }],
      nextActions: ["adb start-server", "macOS: brew install --cask android-platform-tools"],
    };
    const doctorService = { run: async () => report };

    const pretty = await cmdDoctor({ format: "pretty" }, { doctorService });
    assert.match(pretty, /- `adb start-server`/);
    assert.match(pretty, /- macOS: `brew install --cask android-platform-tools`/);
    assert.match(pretty, /`adb` not found in `PATH`/);
    assert.doesNotMatch(pretty, /``adb start-server``/);

    const json = JSON.parse(await cmdDoctor({ format: "json" }, { doctorService }));
    assert.strictEqual(json.checks[0].fix.steps[0].value, "adb start-server");
    assert.strictEqual(json.checks[0].fix.steps[1].value, "macOS: brew install --cask android-platform-tools");
    assert.strictEqual(json.nextActions[0], "adb start-server");
  });

  it("formats commands embedded in manual recovery text", async () => {
    const output = await cmdDoctor({ format: "pretty" }, {
      doctorService: { run: async () => ({
        ok: false,
        checks: [{
          id: "readiness.version.compatibility",
          status: "fail",
          summary: "Installed APK version mismatch.",
          fix: {
            title: "Align CLI and APK versions",
            platform: "any",
            steps: [
              { kind: "manual", value: "Reinstall the CLI: npm install -g @androperator/cli@latest" },
              { kind: "manual", value: "Use --operator-package com.androperator.operator.dev" },
            ],
          },
        }],
      }) },
    });

    assert.match(output, /Reinstall the CLI: `npm install -g @androperator\/cli@latest`/);
    assert.match(output, /Use `--operator-package com\.androperator\.operator\.dev`/);
  });

  it("uses the lowercase ffmpeg executable name in pretty video guidance", async () => {
    const output = await cmdDoctor({ format: "pretty" }, {
      doctorService: { run: async () => ({
        ok: true,
        checks: [{
          id: "host.video.dependencies",
          status: "warn",
          summary: "ffmpeg 6.1 is required.",
          fix: {
            title: "Install video tools",
            platform: "any",
            steps: [{ kind: "manual", value: "Install scrcpy 3.0 or newer and ffmpeg 6.1 or newer." }],
          },
        }],
      }) },
    });

    assert.match(output, /`ffmpeg` 6\.1 is required/);
    assert.match(output, /Install `scrcpy` 3\.0 or newer and `ffmpeg` 6\.1 or newer/);
    assert.doesNotMatch(output, /FFmpeg/);
  });

  it("uses docsUrl values that map to pages present in mkdocs nav", async () => {
    const mkdocsText = await readFile(join(repoRoot, "sites/docs/mkdocs.yml"), "utf8");
    const docsUrlToNavPath = new Map<string, string>([
      [DOCTOR_DOCS_URLS.setup, "setup.md"],
      [DOCTOR_DOCS_URLS.devices, "api/devices.md"],
      [DOCTOR_DOCS_URLS.operator, "troubleshooting/operator.md"],
      [DOCTOR_DOCS_URLS.compatibility, "troubleshooting/compatibility.md"],
    ]);

    for (const [docsUrl, navPath] of docsUrlToNavPath) {
      assert.match(mkdocsText, new RegExp(navPath.replace("/", "\\/")));
      assert.match(docsUrl, /^https:\/\/docs\.androperator\.com\/.+\/$/);
    }
  });
});
