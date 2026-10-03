import * as fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import type { EvidenceError } from "../../contracts/evidence.js";

export const videoStateSchema = z.object({
  sessionId: z.string().uuid(), nonce: z.string().uuid(), deviceId: z.string().min(1),
  operatorPackage: z.string().regex(/^[A-Za-z0-9_.]+$/), adbPath: z.string().min(1),
  outputDir: z.string(), lockPath: z.string(), managed: z.boolean(),
  durationSeconds: z.number().int().min(1).max(180), size: z.string().regex(/^\d+x\d+$/),
  hostPid: z.number().int().positive().nullable(), hostStartedAt: z.string().nullable(),
  remotePid: z.number().int().positive().nullable(), remoteStart: z.string().regex(/^\d+$/).nullable(),
  remotePath: z.string(), deadline: z.number(), updatedAt: z.number(), recoveryRequired: z.boolean(),
  backend: z.literal("scrcpy").optional(),
  maxEdge: z.number().int().min(2).optional(),
}).strict();
export type VideoState = z.infer<typeof videoStateSchema>;
export const terminal = (status: string) => ["complete", "partial", "failed"].includes(status);
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function videoError(error: unknown, stage = "video"): EvidenceError {
  const value = error as { code?: string; message?: string };
  return { code: value?.code ?? "EVIDENCE_CAPTURE_FAILED", message: value?.message ?? String(error), stage, component: "video" };
}
export function fail(message: string, code = "EVIDENCE_CAPTURE_FAILED"): never { throw { code, message }; }
export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); await fs.rename(temporary, path); }
  finally { await fs.rm(temporary, { force: true }); }
}
export async function readState(outputDir: string): Promise<VideoState> {
  const state = videoStateSchema.parse(JSON.parse(await fs.readFile(join(outputDir, "session.json"), "utf8")));
  if (state.outputDir !== outputDir || state.remotePath !== `/data/local/tmp/androperator-video-${state.sessionId}.mp4`) fail("Invalid session ownership state");
  return state;
}
export const lockName = (device: string) => createHash("sha256").update(device).digest("hex") + ".json";
export async function releaseLock(state: VideoState): Promise<void> {
  const owner = JSON.parse(await fs.readFile(state.lockPath, "utf8"));
  if (owner.nonce !== state.nonce || owner.sessionId !== state.sessionId) fail("Evidence lock ownership changed");
  await fs.unlink(state.lockPath);
}
export async function checked(runner: ProcessRunner, command: string, args: string[], timeoutMs = 10000): Promise<string> {
  const result = await runner.run(command, args, { timeoutMs });
  if (result.code !== 0) fail(`${command} failed: ${result.stderr || result.error?.message || `exit ${result.code}`}`);
  return result.stdout;
}
export function chooseVideoSize(width: number, height: number, requested?: string): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) fail("Current display dimensions are unavailable");
  if (requested !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(requested);
    const w = Number(match?.[1]), h = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 2 || h < 2 || w % 2 || h % 2 || Math.abs((w / h) / (width / height) - 1) > 0.01) {
      fail("size must contain positive even dimensions within 1% of the current display aspect ratio", "EXECUTION_VALIDATION_FAILED");
    }
    return `${w}x${h}`;
  }
  const scale = Math.min(1, 1280 / Math.max(width, height));
  return `${Math.max(2, Math.floor(width * scale / 2) * 2)}x${Math.max(2, Math.floor(height * scale / 2) * 2)}`;
}
export function verifyScreenrecordHelp(help: string, seconds: number): void {
  if (!help.includes("--size") || !help.includes("--time-limit")) fail("screenrecord does not advertise required size and duration options");
  // Older devices publish a maximum; newer versions explicitly support disabling the cap.
  const maximum = help.match(/(?:maximum|max(?:imum)? (?:is|of))[^\d\n]*(\d+)/i);
  if (maximum ? seconds > Number(maximum[1]) : !/Default is 180|default 180|Maximum recording time.*180/is.test(help)) {
    fail("screenrecord duration support could not be verified for the requested duration");
  }
}
export async function verifyRemote(runner: ProcessRunner, state: VideoState): Promise<string> {
  if (state.remotePid === null) fail("Recorder PID is unavailable", "EVIDENCE_RECOVERY_REQUIRED");
  const prefix = ["-s", state.deviceId, "shell"];
  const commandLine = await checked(runner, state.adbPath, [...prefix, "cat", `/proc/${state.remotePid}/cmdline`], 2000);
  const args = commandLine.split("\0").filter(Boolean);
  if (!/^(?:\/system\/bin\/)?screenrecord$/.test(args[0] ?? "") || args.at(-1) !== state.remotePath || args.length !== 6 || args[1] !== "--size" || args[2] !== state.size || args[3] !== "--time-limit" || args[4] !== String(state.durationSeconds)) fail("Recorder identity mismatch; no signal sent", "EVIDENCE_RECOVERY_REQUIRED");
  const stat = await checked(runner, state.adbPath, [...prefix, "cat", `/proc/${state.remotePid}/stat`], 2000);
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[19];
  if (!/^\d+$/.test(start ?? "") || (state.remoteStart !== null && state.remoteStart !== start)) fail("Recorder start identity mismatch; no signal sent", "EVIDENCE_RECOVERY_REQUIRED");
  return start;
}
