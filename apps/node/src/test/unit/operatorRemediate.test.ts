import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { cmdOperatorRemediate } from "../../cli/commands/operatorRemediate.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import type { DoctorReport } from "../../contracts/doctor.js";

function buildReport(overrides: Partial<DoctorReport>): DoctorReport {
  return {
    ok: true,
    criticalOk: true,
    checks: [],
    ...overrides,
  };
}

describe("operator remediate", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("returns success when no devices are connected", async () => {
    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [],
        deviceEnumerationCheckImpl: async () => ({
          code: 0,
          stdout: "List of devices attached\n\n",
          stderr: "",
        }),
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.summary.totalDevices, 0);
    assert.deepStrictEqual(parsed.devices, []);
  });

  it("returns an adb error instead of a no-device success when enumeration fails", async () => {
    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [],
        deviceEnumerationCheckImpl: async () => ({
          code: 127,
          stdout: "",
          stderr: "ADB command not found at path: adb",
        }),
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.code, ERROR_CODES.ADB_NOT_FOUND);
    assert.match(parsed.message, /adb is not available/);
    assert.strictEqual(process.exitCode, 1);
  });

  it("remediates a single stale device with one download and setup pass", async () => {
    const reports = [
      buildReport({
        ok: false,
        criticalOk: false,
        checks: [
          {
            id: "readiness.version.compatibility",
            status: "fail",
            code: ERROR_CODES.VERSION_INCOMPATIBLE,
            summary: "CLI and installed APK versions are not compatible.",
          },
        ],
      }),
      buildReport({
        checks: [{ id: "readiness.handshake", status: "pass", summary: "Handshake successful." }],
      }),
    ];
    let downloadCount = 0;
    let setupCount = 0;

    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [{ serial: "device-1", state: "device" }],
        doctorServiceFactory: () => ({
          run: async () => {
            const next = reports.shift();
            if (!next) {
              throw new Error("Unexpected doctor call");
            }
            return next;
          },
        }),
        downloadOperatorApkImpl: async () => {
          downloadCount += 1;
          return {
            localPath: "/tmp/operator.apk",
            operatorVersion: "0.7.4",
            sha256: "a".repeat(64),
            operatorPackage: "com.androperator.operator",
            checksumSource: "inline",
            metadataUrl: "https://downloads.example.com/latest.json",
            apkUrl: "https://downloads.example.com/operator.apk",
            sha256Url: "https://downloads.example.com/operator.apk.sha256",
          };
        },
        setupOperatorImpl: async () => {
          setupCount += 1;
          return {
            operatorPackage: "com.androperator.operator",
            install: { ok: true },
            permissions: {
              operatorPackage: "com.androperator.operator",
              accessibility: { ok: true, alreadyEnabled: false },
              notification: { ok: true, skipped: false },
              notificationListener: { ok: true, alreadyEnabled: false },
            },
            verification: { ok: true, packageInstalled: true },
          };
        },
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.summary.remediated, 1);
    assert.strictEqual(parsed.devices[0].status, "remediated");
    assert.strictEqual(downloadCount, 1);
    assert.strictEqual(setupCount, 1);
  });

  it("remediates a wrong installed operator variant instead of reporting warning-only success", async () => {
    const reports = [
      buildReport({
        checks: [
          {
            id: "readiness.apk.presence",
            status: "warn",
            code: ERROR_CODES.OPERATOR_VARIANT_MISMATCH,
            summary: "Wrong Operator variant installed.",
          },
        ],
      }),
      buildReport({
        checks: [{ id: "readiness.handshake", status: "pass", summary: "Handshake successful." }],
      }),
    ];
    let downloadCount = 0;
    let setupCount = 0;

    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [{ serial: "device-1", state: "device" }],
        doctorServiceFactory: () => ({
          run: async () => {
            const next = reports.shift();
            if (!next) {
              throw new Error("Unexpected doctor call");
            }
            return next;
          },
        }),
        downloadOperatorApkImpl: async () => {
          downloadCount += 1;
          return {
            localPath: "/tmp/operator.apk",
            operatorVersion: "0.7.4",
            sha256: "c".repeat(64),
            operatorPackage: "com.androperator.operator",
            checksumSource: "inline",
            metadataUrl: "https://downloads.example.com/latest.json",
            apkUrl: "https://downloads.example.com/operator.apk",
            sha256Url: "https://downloads.example.com/operator.apk.sha256",
          };
        },
        setupOperatorImpl: async () => {
          setupCount += 1;
          return {
            operatorPackage: "com.androperator.operator",
            install: { ok: true },
            permissions: {
              operatorPackage: "com.androperator.operator",
              accessibility: { ok: true, alreadyEnabled: false },
              notification: { ok: true, skipped: false },
              notificationListener: { ok: true, alreadyEnabled: false },
            },
            verification: { ok: true, packageInstalled: true },
          };
        },
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.summary.remediated, 1);
    assert.strictEqual(parsed.summary.warn, 0);
    assert.strictEqual(parsed.devices[0].status, "remediated");
    assert.strictEqual(downloadCount, 1);
    assert.strictEqual(setupCount, 1);
  });

  it("keeps remediated devices in warn state when warnings remain after setup", async () => {
    const reports = [
      buildReport({
        ok: false,
        criticalOk: false,
        checks: [
          {
            id: "readiness.version.compatibility",
            status: "fail",
            code: ERROR_CODES.VERSION_INCOMPATIBLE,
            summary: "CLI and installed APK versions are not compatible.",
          },
        ],
      }),
      buildReport({
        ok: true,
        criticalOk: true,
        checks: [
          {
            id: "readiness.settings.dev_options",
            status: "warn",
            summary: "Developer options are disabled.",
          },
        ],
      }),
    ];
    let setupCount = 0;

    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [{ serial: "device-1", state: "device" }],
        doctorServiceFactory: () => ({
          run: async () => {
            const next = reports.shift();
            if (!next) {
              throw new Error("Unexpected doctor call");
            }
            return next;
          },
        }),
        downloadOperatorApkImpl: async () => ({
          localPath: "/tmp/operator.apk",
          operatorVersion: "0.7.4",
          sha256: "e".repeat(64),
          operatorPackage: "com.androperator.operator",
          checksumSource: "inline",
          metadataUrl: "https://downloads.example.com/latest.json",
          apkUrl: "https://downloads.example.com/operator.apk",
          sha256Url: "https://downloads.example.com/operator.apk.sha256",
        }),
        setupOperatorImpl: async () => {
          setupCount += 1;
          return {
            operatorPackage: "com.androperator.operator",
            install: { ok: true },
            permissions: {
              operatorPackage: "com.androperator.operator",
              accessibility: { ok: true, alreadyEnabled: false },
              notification: { ok: true, skipped: false },
              notificationListener: { ok: true, alreadyEnabled: false },
            },
            verification: { ok: true, packageInstalled: true },
          };
        },
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.summary.remediated, 0);
    assert.strictEqual(parsed.summary.warn, 1);
    assert.strictEqual(parsed.devices[0].status, "warn");
    assert.strictEqual(parsed.devices[0].setupAttempted, true);
    assert.strictEqual(parsed.message, "All connected devices passed critical checks. 1 device still has warnings.");
    assert.strictEqual(setupCount, 1);
  });

  it("marks downloadAttempted only for the device that triggered the shared release download", async () => {
    const perDeviceReports = new Map<string, DoctorReport[]>([
      ["device-alpha", [
        buildReport({
          ok: false,
          criticalOk: false,
          checks: [{ id: "readiness.version.compatibility", status: "fail", code: ERROR_CODES.VERSION_INCOMPATIBLE, summary: "Version mismatch." }],
        }),
        buildReport({
          checks: [{ id: "readiness.handshake", status: "pass", summary: "Handshake successful." }],
        }),
      ]],
      ["device-beta", [
        buildReport({
          ok: false,
          criticalOk: false,
          checks: [{ id: "readiness.version.compatibility", status: "fail", code: ERROR_CODES.VERSION_INCOMPATIBLE, summary: "Version mismatch." }],
        }),
        buildReport({
          checks: [{ id: "readiness.handshake", status: "pass", summary: "Handshake successful." }],
        }),
      ]],
    ]);
    let downloadCount = 0;
    let setupCount = 0;

    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [
          { serial: "device-alpha", state: "device" },
          { serial: "device-beta", state: "device" },
        ],
        doctorServiceFactory: () => ({
          run: async ({ config }) => {
            const queue = perDeviceReports.get(config.deviceId ?? "");
            const next = queue?.shift();
            if (!next) {
              throw new Error(`Unexpected doctor call for ${config.deviceId}`);
            }
            return next;
          },
        }),
        downloadOperatorApkImpl: async () => {
          downloadCount += 1;
          return {
            localPath: "/tmp/operator.apk",
            operatorVersion: "0.7.4",
            sha256: "d".repeat(64),
            operatorPackage: "com.androperator.operator",
            checksumSource: "inline",
            metadataUrl: "https://downloads.example.com/latest.json",
            apkUrl: "https://downloads.example.com/operator.apk",
            sha256Url: "https://downloads.example.com/operator.apk.sha256",
          };
        },
        setupOperatorImpl: async () => {
          setupCount += 1;
          return {
            operatorPackage: "com.androperator.operator",
            install: { ok: true },
            permissions: {
              operatorPackage: "com.androperator.operator",
              accessibility: { ok: true, alreadyEnabled: false },
              notification: { ok: true, skipped: false },
              notificationListener: { ok: true, alreadyEnabled: false },
            },
            verification: { ok: true, packageInstalled: true },
          };
        },
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(downloadCount, 1);
    assert.strictEqual(setupCount, 2);
    assert.strictEqual(parsed.devices[0].downloadAttempted, true);
    assert.strictEqual(parsed.devices[1].downloadAttempted, false);
  });

  it("reports mixed multi-device states and retries doctor --fix for handshake recovery", async () => {
    const perDeviceReports = new Map<string, DoctorReport[]>([
      ["device-ready", [buildReport({ checks: [{ id: "readiness.handshake", status: "pass", summary: "Handshake successful." }] })]],
      ["device-warn", [buildReport({
        checks: [{ id: "readiness.settings.dev_options", status: "warn", summary: "Developer options are disabled." }],
      })]],
      ["device-stale", [
        buildReport({
          ok: false,
          criticalOk: false,
          checks: [{ id: "readiness.version.compatibility", status: "fail", code: ERROR_CODES.VERSION_INCOMPATIBLE, summary: "Version mismatch." }],
        }),
        buildReport({
          ok: false,
          criticalOk: false,
          checks: [{ id: "readiness.handshake", status: "fail", code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT, summary: "Handshake failed." }],
        }),
        buildReport({
          ok: false,
          criticalOk: false,
          checks: [{ id: "readiness.handshake", status: "fail", code: ERROR_CODES.RESULT_ENVELOPE_TIMEOUT, summary: "Handshake failed." }],
        }),
        buildReport({
          checks: [{ id: "readiness.handshake", status: "pass", summary: "Handshake successful." }],
        }),
      ]],
      ["device-shell", [buildReport({
        ok: false,
        criticalOk: false,
        checks: [{ id: "readiness.apk.presence", status: "fail", code: ERROR_CODES.DEVICE_SHELL_UNAVAILABLE, summary: "Could not query installed packages on the device." }],
      })]],
    ]);

    let downloadCount = 0;
    let setupCount = 0;
    let doctorFixCount = 0;

    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [
          { serial: "device-ready", state: "device" },
          { serial: "device-warn", state: "device" },
          { serial: "device-stale", state: "device" },
          { serial: "device-shell", state: "device" },
          { serial: "device-offline", state: "offline" },
        ],
        doctorServiceFactory: () => ({
          run: async ({ config, fix }) => {
            if (fix) {
              doctorFixCount += 1;
            }
            const queue = perDeviceReports.get(config.deviceId ?? "");
            const next = queue?.shift();
            if (!next) {
              throw new Error(`Unexpected doctor call for ${config.deviceId}`);
            }
            return next;
          },
        }),
        downloadOperatorApkImpl: async () => {
          downloadCount += 1;
          return {
            localPath: "/tmp/operator.apk",
            operatorVersion: "0.7.4",
            sha256: "b".repeat(64),
            operatorPackage: "com.androperator.operator",
            checksumSource: "inline",
            metadataUrl: "https://downloads.example.com/latest.json",
            apkUrl: "https://downloads.example.com/operator.apk",
            sha256Url: "https://downloads.example.com/operator.apk.sha256",
          };
        },
        setupOperatorImpl: async () => {
          setupCount += 1;
          return {
            operatorPackage: "com.androperator.operator",
            install: { ok: true },
            permissions: {
              operatorPackage: "com.androperator.operator",
              accessibility: { ok: true, alreadyEnabled: false },
              notification: { ok: true, skipped: false },
              notificationListener: { ok: true, alreadyEnabled: false },
            },
            verification: { ok: true, packageInstalled: true },
          };
        },
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.summary.ready, 1);
    assert.strictEqual(parsed.summary.warn, 1);
    assert.strictEqual(parsed.summary.remediated, 1);
    assert.strictEqual(parsed.summary.adbUnready, 1);
    assert.strictEqual(parsed.summary.failed, 1);
    assert.strictEqual(parsed.message, "Remediation still required for 1 device. 1 visible device still needs ADB recovery.");
    assert.strictEqual(downloadCount, 1);
    assert.strictEqual(setupCount, 1);
    assert.strictEqual(doctorFixCount, 1);
    assert.strictEqual(parsed.devices.find((device: { deviceId: string }) => device.deviceId === "device-shell").status, "failed");
  });

  it("keeps ok=true when only adb-unready devices remain and reports that in the summary message", async () => {
    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [
          { serial: "device-ready", state: "device" },
          { serial: "device-offline", state: "offline" },
        ],
        doctorServiceFactory: () => ({
          run: async () => buildReport({
            checks: [{ id: "readiness.handshake", status: "pass", summary: "Handshake successful." }],
          }),
        }),
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.summary.failed, 0);
    assert.strictEqual(parsed.summary.adbUnready, 1);
    assert.strictEqual(parsed.message, "All connected devices are ready. 1 visible device still needs ADB recovery.");
    assert.strictEqual(process.exitCode, undefined);
  });

  it("keeps user-facing debug APK remediation paths in canonical tilde form", async () => {
    const output = await cmdOperatorRemediate(
      { format: "json", operatorPackage: "com.androperator.operator.dev" },
      {
        listDevicesImpl: async () => [{ serial: "device-debug", state: "device" }],
        doctorServiceFactory: () => ({
          run: async () => buildReport({
            ok: false,
            criticalOk: false,
            checks: [{ id: "readiness.version.compatibility", status: "fail", code: ERROR_CODES.VERSION_INCOMPATIBLE, summary: "Version mismatch." }],
          }),
        }),
        apkExistsImpl: async () => false,
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.devices[0].message, "Automatic APK download is only available for com.androperator.operator. Provide a matching local APK at ~/.androperator/downloads/operator-debug.apk for com.androperator.operator.dev.");
  });

  it("uses grammatically correct warning summaries for a single warning device", async () => {
    const output = await cmdOperatorRemediate(
      { format: "json" },
      {
        listDevicesImpl: async () => [{ serial: "device-warn", state: "device" }],
        doctorServiceFactory: () => ({
          run: async () => buildReport({
            checks: [{ id: "readiness.settings.dev_options", status: "warn", summary: "Developer options are disabled." }],
          }),
        }),
      },
    );

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.message, "All connected devices passed critical checks. 1 device still has warnings.");
  });
});
