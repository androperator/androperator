import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";

export interface ActiveDisplay {
  physicalId: string;
  width: number;
  height: number;
  rotation: number;
}

/** Physical IDs exceed JavaScript's safe integer range. Keep them as decimal strings. */
export function parseActiveDisplay(dump: string): ActiveDisplay | null {
  const viewports = dump.match(/DisplayViewport\{[^}]+\}/g) ?? [];
  // Older Android dumps have no activity field; preserve default capture selection.
  if (!viewports.some(viewport => /\bisActive=/.test(viewport))) return null;
  const primary = viewports.filter(viewport => /\bvalid=true\b/.test(viewport)
    && /\bisActive=true\b/.test(viewport) && /\bdisplayId=0\b/.test(viewport));
  if (primary.length !== 1) throw { code: "EVIDENCE_CAPTURE_FAILED", message: "Active primary display is unavailable or ambiguous" };
  const viewport = primary[0];
  const physicalId = viewport.match(/\buniqueId='local:(\d+)'/)?.[1];
  const rotation = viewport.match(/\borientation=([0-3])\b/)?.[1];
  const frame = viewport.match(/\blogicalFrame=Rect\(0, 0 - (\d+), (\d+)\)/);
  const width = Number(frame?.[1]), height = Number(frame?.[2]);
  if (physicalId === undefined || rotation === undefined || !Number.isSafeInteger(width) || width < 2 || !Number.isSafeInteger(height) || height < 2) {
    throw { code: "EVIDENCE_CAPTURE_FAILED", message: "Active primary display has invalid capture geometry or physical ID" };
  }
  return { physicalId, width, height, rotation: Number(rotation) };
}

export async function readActiveDisplay(config: { runner: ProcessRunner; adbPath: string; deviceId?: string }, timeoutMs: number, signal?: AbortSignal): Promise<ActiveDisplay | null> {
  signal?.throwIfAborted();
  if (!config.deviceId) throw new Error("Display selection requires a resolved device");
  const result = await config.runner.run(config.adbPath, ["-s", config.deviceId, "shell", "dumpsys", "display"], { timeoutMs, signal });
  signal?.throwIfAborted();
  if (result.code !== 0 || result.error) throw { code: "EVIDENCE_CAPTURE_FAILED", message: "Could not query the active Android display" };
  return parseActiveDisplay(result.stdout);
}
