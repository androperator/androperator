import type { RuntimeConfig } from "../../../adapters/android-bridge/runtimeConfig.js";
import type { DoctorCheckResult } from "../../../contracts/doctor.js";
import { probeCaptureHelper } from "../../observe/captureHelper.js";

export async function checkCaptureHelper(config: RuntimeConfig): Promise<DoctorCheckResult> {
  const result = await probeCaptureHelper(config);
  return { id: "capture.reduced", status: result.status === "supported" ? "pass" : "warn",
    summary: `Reduced screenshot capture: ${result.status}.`, detail: result.detail,
    evidence: { capability: result.status, imageVerified: false, defaultMethod: "adb_screencap" },
    ...(result.status !== "supported" ? { fix: { title: "Capture compatibility", platform: "any" as const,
      steps: [{ kind: "manual" as const, value: "Check ADB connectivity and free /data/local/tmp space, then retry doctor. Incompatible Android builds require a supported OS capture API; the existing screenshot command without --scale keeps full-resolution behavior." }] } } : {}) };
}
