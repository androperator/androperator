import type { RuntimeConfig } from "../../adapters/android-bridge/runtimeConfig.js";
import { runAdb } from "../../adapters/android-bridge/adbClient.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { parseActiveDisplay } from "../observe/activeDisplay.js";
import type { GesturePoint } from "./gesture.js";

export type BackEdge = "left" | "right";
/** A pixel count (an integer) or a fraction of the display (a decimal with a point, in (0, 1]). */
export type Measure = { unit: "px"; value: number } | { unit: "fraction"; value: number };

export interface BackGestureOptions {
  edge: BackEdge;
  y: Measure;
  distance: Measure;
  /** Time to travel the distance inward; a cancelled gesture spends the same time coming back. */
  durationMs: number;
  holdMs?: number;
  cancel: boolean;
}

export interface Display { width: number; height: number }

export const BACK_GESTURE_DEFAULTS = {
  edge: "left" as BackEdge,
  y: { unit: "fraction", value: 0.5 } as Measure,
  distance: { unit: "fraction", value: 0.4 } as Measure,
  durationMs: 400,
};

export function parseMeasure(text: string, flag: string): Measure {
  if (/^\d+$/.test(text)) return { unit: "px", value: Number(text) };
  if (/^(?:0?\.\d+|1\.0+|0\.0+)$/.test(text) && Number(text) > 0 && Number(text) <= 1) return { unit: "fraction", value: Number(text) };
  throw new Error(`${flag} must be a pixel count such as 1500 or a fraction with a decimal point in (0, 1] such as 0.5`);
}

const resolveMeasure = (measure: Measure, extent: number): number =>
  measure.unit === "px" ? measure.value : Math.round(measure.value * extent);

/**
 * Plan the pointer path for a system Back edge gesture. The finger lands one pixel inside the edge pixel, so it
 * starts within the system gesture inset whatever its width, then travels inward by `distance`. A cancelled gesture
 * returns to the edge before release.
 */
export function planBackGesture(options: BackGestureOptions, display: Display): { points: GesturePoint[]; durationMs: number; holdMs?: number } {
  const { width, height } = display;
  const y = resolveMeasure(options.y, height);
  if (y < 0 || y > height - 1) throw new Error(`--y resolves to ${y}, outside the display height of ${height} pixels`);
  const distance = resolveMeasure(options.distance, width);
  if (distance < 1 || distance > width - 3) throw new Error(`--distance resolves to ${distance}, which must be from 1 to ${width - 3} pixels on a ${width} pixel wide display`);
  const left = options.edge === "left";
  const start = { x: left ? 1 : width - 2, y };
  const end = { x: left ? start.x + distance : start.x - distance, y };
  const points = options.cancel ? [start, end, start] : [start, end];
  return { points, durationMs: options.durationMs * (options.cancel ? 2 : 1), ...(options.holdMs === undefined ? {} : { holdMs: options.holdMs }) };
}

/** The Back edge gesture exists only in gesture navigation (navigation_mode 2). */
export function assertGestureNavigation(mode: string | null): void {
  if (mode === "2") return;
  const described = mode === "0" ? "3-button navigation" : mode === "1" ? "2-button navigation" : `an unknown navigation mode (${mode ?? "unreadable"})`;
  throw {
    code: ERROR_CODES.EXECUTION_ACTION_UNSUPPORTED,
    message: `back-gesture needs gesture navigation, but the device is using ${described}. Use \`androperator press-key back\` for the Back key, or switch the device to gesture navigation.`,
    details: { navigationMode: mode },
  };
}

async function read(config: RuntimeConfig, args: string[]): Promise<string | null> {
  const result = await runAdb(config, args, { timeoutMs: 5000, logOutput: false });
  return result.code === 0 ? result.stdout : null;
}

/** Current display size in the current rotation, and the navigation mode. */
export async function readBackGestureDevice(config: RuntimeConfig): Promise<{ display: Display; navigationMode: string | null }> {
  const mode = (await read(config, ["shell", "settings", "get", "secure", "navigation_mode"]))?.trim() ?? null;
  let active = null;
  try { active = parseActiveDisplay(await read(config, ["shell", "dumpsys", "display"]) ?? ""); } catch { /* fall back below */ }
  let width = active ? (active.rotation % 2 ? active.height : active.width) : null;
  let height = active ? (active.rotation % 2 ? active.width : active.height) : null;
  if (width === null || height === null) {
    const size = await read(config, ["shell", "wm", "size"]) ?? "";
    const match = size.match(/Override size:\s*(\d+)x(\d+)/) ?? size.match(/Physical size:\s*(\d+)x(\d+)/);
    const input = await read(config, ["shell", "dumpsys", "input"]) ?? "";
    const rotation = Number((input.match(/Viewport [^\n]*displayId=0,[^\n]*orientation=([0-3])\b/) ?? input.match(/SurfaceOrientation:\s*([0-3])\b/))?.[1] ?? 0);
    if (match === null) throw { code: ERROR_CODES.EXECUTION_VALIDATION_FAILED, message: "back-gesture could not read the display size from the device" };
    [width, height] = rotation % 2 ? [Number(match[2]), Number(match[1])] : [Number(match[1]), Number(match[2])];
  }
  return { display: { width, height }, navigationMode: mode };
}
