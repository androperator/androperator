import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ProcessRunner } from "../../adapters/android-bridge/processRunner.js";
import { setWallpaper } from "../../domain/actions/setWallpaper.js";

const cliPath = fileURLToPath(new URL("../../cli/index.js", import.meta.url));

it("validates wallpaper arguments and accepts common flags on either side of the command", () => {
  const common = ["--device", "test-emulator", "--operator-package", "test.operator", "--output", "json"];
  for (const [args, code] of [
    [[], "USAGE"],
    [["missing.png", "--target"], "USAGE"],
    [["missing.png", "--target", "all"], "USAGE"],
    [["missing.png", "--target", "both", "--target", "home"], "USAGE"],
    [["", "--target", "both"], "EXECUTION_VALIDATION_FAILED"],
  ] as const) {
    const result = spawnSync(process.execPath, [cliPath, "set-wallpaper", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).code, code);
  }
  const command = ["set-wallpaper", join(tmpdir(), "androperator-missing-wallpaper-test.png"), "--target", "both"];
  for (const args of [[...common, ...command], [...command, ...common]]) {
    const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).message, /ENOENT/);
  }
});

it("streams the original bytes to the resolved Android user and cleans up a rejected upload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "androperator-wallpaper-test-"));
  try {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x0a]);
    const imagePath = join(directory, "image.png");
    await writeFile(imagePath, image);
    let uploadUri: string | undefined;
    let cleaned = false;
    const success = { code: 0, stdout: "", stderr: "" };
    const runner: ProcessRunner = {
      async run(_command, args, options) {
        assert.deepEqual(args.slice(0, 2), ["-s", "test-emulator"]);
        const adbArgs = args.slice(2);
        if (adbArgs[0] === "devices") return { ...success, stdout: "List of devices attached\ntest-emulator\tdevice\n" };
        if (adbArgs[1] === "am") return { ...success, stdout: "10\n" };
        if (adbArgs[3] === "write") {
          assert.deepEqual(adbArgs.slice(0, -1), ["shell", "-T", "content", "write", "--user", "10", "--uri"]);
          assert.deepEqual(options?.input, image);
          uploadUri = adbArgs.at(-1);
          assert.match(uploadUri ?? "", /^content:\/\/test\.operator\.wallpaper-upload\/[a-f0-9]{32}$/);
          // The Android content command can print an error with a zero shell status.
          return { ...success, stderr: "upload rejected" };
        }
        assert.deepEqual(adbArgs, ["shell", "content", "delete", "--user", "10", "--uri", uploadUri]);
        cleaned = true;
        return success;
      },
      async runShell() { throw new Error("Unexpected shell command"); },
      spawn() { throw new Error("Unexpected dispatch"); },
    };
    const result = await setWallpaper(imagePath, "both", { runner, deviceId: "test-emulator", operatorPackage: "test.operator" });
    assert.deepEqual(result, { ok: false, deviceId: "test-emulator", error: { code: "WALLPAPER_UPLOAD_FAILED", message: "upload rejected" } });
    assert.equal(cleaned, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
