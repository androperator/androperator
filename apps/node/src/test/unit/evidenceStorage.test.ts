import { it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { evidenceRoot, preflightDirectory, videoLockRoot } from "../../domain/evidence/storage.js";
import { releaseLock } from "../../domain/evidence/videoSupport.js";
import type { VideoState } from "../../domain/evidence/videoSupport.js";

it("resolves configured roots absolutely, rejects blanks, and preserves the default", () => {
  const previous = process.env.ANDROPERATOR_EVIDENCE_DIR;
  try {
    delete process.env.ANDROPERATOR_EVIDENCE_DIR;
    assert.equal(evidenceRoot(), join(homedir(), ".androperator", "evidence"));
    process.env.ANDROPERATOR_EVIDENCE_DIR = "relative evidence";
    assert.equal(evidenceRoot(), resolve("relative evidence"));
    assert.equal(evidenceRoot({ baseDir: "injected" }), resolve("injected"));
    assert.throws(() => evidenceRoot({ baseDir: "bad\0path" }));
    for (const blank of ["", "  ", "\t"]) {
      process.env.ANDROPERATOR_EVIDENCE_DIR = blank;
      assert.throws(() => evidenceRoot(), (e: any) => e.code === "EXECUTION_VALIDATION_FAILED");
    }
  } finally {
    if (previous === undefined) delete process.env.ANDROPERATOR_EVIDENCE_DIR;
    else process.env.ANDROPERATOR_EVIDENCE_DIR = previous;
  }
});

it("ownership location is unchanged across process home, temp, and evidence environments", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", "import {videoLockRoot} from './dist/domain/evidence/storage.js'; console.log(videoLockRoot())"], {
    encoding: "utf8", env: { ...process.env, HOME: "/unavailable-home", TMPDIR: "/different-temp", TEMP: "/another-temp", ANDROPERATOR_EVIDENCE_DIR: "/different-evidence" },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), videoLockRoot());
});

it("preflights writes and rejects unwritable or unsafe lock directories without changing permissions", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "evidence-storage-test-"));
  try {
    await preflightDirectory(join(root, "writable"));
    assert.deepEqual(await fs.readdir(join(root, "writable")), []);
    const file = join(root, "file");
    await fs.writeFile(file, "preserve");
    await assert.rejects(preflightDirectory(file), (e: any) => e.code === "EVIDENCE_STORAGE_UNWRITABLE" && e.path === file && typeof e.recovery === "string");
    assert.equal(await fs.readFile(file, "utf8"), "preserve");
    if (process.platform !== "win32") {
      await fs.symlink(join(root, "writable"), join(root, "link"));
      await assert.rejects(preflightDirectory(join(root, "link"), true), (e: any) => e.code === "EVIDENCE_STORAGE_UNWRITABLE");
      await fs.chmod(join(root, "writable"), 0o755);
      await assert.rejects(preflightDirectory(join(root, "writable"), true));
      assert.equal((await fs.stat(join(root, "writable"))).mode & 0o777, 0o755);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("a stale owner cannot release a different nonce or session", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "evidence-owner-test-"));
  const lockPath = join(root, "lock.json");
  try {
    const owner = JSON.stringify({ nonce: "new", sessionId: "new-session" });
    await fs.writeFile(lockPath, owner);
    for (const state of [{ nonce: "old", sessionId: "new-session" }, { nonce: "new", sessionId: "old-session" }]) {
      await assert.rejects(releaseLock({ ...state, lockPath } as VideoState));
      assert.equal(await fs.readFile(lockPath, "utf8"), owner);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


it("POSIX ownership works without an OS account database entry", { skip: process.platform === "win32" }, () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import os from "node:os";
    import fs from "node:fs/promises";
    import { join } from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    os.userInfo = () => { throw Object.assign(new Error("uv_os_get_passwd ENOENT"), { code: "ERR_SYSTEM_ERROR" }); };
    syncBuiltinESMExports();
    const { videoLockRoot, preflightDirectory } = await import("./dist/domain/evidence/storage.js");
    assert.equal(videoLockRoot(), "/tmp/androperator-evidence-locks-" + process.geteuid());
    const root = await fs.mkdtemp(join(os.tmpdir(), "evidence-numeric-user-test-"));
    try {
      await preflightDirectory(root, true);
      assert.deepEqual(await fs.readdir(root), []);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  `], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
});
