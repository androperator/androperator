import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import { FFMPEG_VIDEO_REQUIREMENT, supportsFfmpegVideo } from "./ffmpegCapabilities.js";
import { ERROR_CODES } from "../../contracts/errors.js";

export const VIDEO_DEPENDENCIES_DOCS = "https://docs.androperator.com/api/evidence/#video-dependencies";
export const VIDEO_DEPENDENCIES_HINT = "Install scrcpy 3.0 or newer and ffmpeg 6.1 or newer (including ffprobe and libx264, with -fps_mode passthrough and -enc_time_base demux support), and expose all three executables on the PATH used by Androperator. On macOS: brew install scrcpy ffmpeg. Then rerun androperator doctor --device <device_serial> and retry video start only after host.video.dependencies passes. Androperator does not bundle or install these tools. Still screenshots require only ADB.";
export const SCRCPY_REQUIRED_FLAGS = ["--capture-orientation", "--no-window", "--no-audio", "--no-control", "--video-codec", "--max-size", "--record-format", "--time-limit"];

export interface VideoDependencyIssue {
  dependency: "scrcpy" | "ffmpeg" | "ffprobe";
  reason: "missing" | "unavailable" | "unsupported";
  requirement: string;
}

/** Shared by recording preflight and the optional doctor advisory. */
export async function inspectVideoDependencies(runner: ProcessRunner): Promise<VideoDependencyIssue[]> {
  const probes = [
    { dependency: "scrcpy", args: ["--help"], requirement: "scrcpy 3.0+ with capture orientation locking", supports: (text: string) => SCRCPY_REQUIRED_FLAGS.every(flag => text.includes(flag)) },
    { dependency: "ffmpeg", args: ["-version"], requirement: FFMPEG_VIDEO_REQUIREMENT, supports: (text: string) => supportsFfmpegVideo(runner, text) },
    { dependency: "ffprobe", args: ["-version"], requirement: "ffprobe from ffmpeg", supports: (_text: string) => true },
  ] as const;
  const results = await Promise.all(probes.map(async probe => {
    let reason: VideoDependencyIssue["reason"] | undefined;
    try {
      const result = await runner.run(probe.dependency, [...probe.args], { timeoutMs: 5000 });
      if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" || result.code === 127) reason = "missing";
      else if (result.error || result.code !== 0) reason = "unavailable";
      else if (!await probe.supports(result.stdout + result.stderr)) reason = "unsupported";
    } catch (error) {
      reason = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unavailable";
    }
    return reason === undefined ? [] : [{ dependency: probe.dependency, reason, requirement: probe.requirement }];
  }));
  return results.flat();
}

export function videoDependencyError(issues: VideoDependencyIssue[]) {
  return {
    code: ERROR_CODES.HOST_DEPENDENCY_MISSING,
    message: `Video recording is unavailable: ${issues.map(issue => `${issue.dependency} (${issue.reason}; requires ${issue.requirement})`).join(", ")}. Repair the host dependencies before retrying.`,
    hint: VIDEO_DEPENDENCIES_HINT,
    details: { capability: "video-recording", dependencies: issues, docsUrl: VIDEO_DEPENDENCIES_DOCS },
  };
}
