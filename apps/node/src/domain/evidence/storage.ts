import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";

/** Resolve once at request entry, before asynchronous work or worker dispatch. */
export function evidenceRoot(dependencies: { baseDir?: string } = {}): string {
  const configured = dependencies.baseDir ?? process.env.ANDROPERATOR_EVIDENCE_DIR;
  if (configured !== undefined && (configured.trim().length === 0 || configured.includes("\0"))) {
    throw { code: "EXECUTION_VALIDATION_FAILED", message: "ANDROPERATOR_EVIDENCE_DIR must be a nonblank filesystem path" };
  }
  return resolve(configured ?? join(homedir(), ".androperator", "evidence"));
}

/** Never derive ownership from HOME, TMPDIR, TEMP, or the selected evidence root. */
export function videoLockRoot(): string {
  return process.platform === "win32"
    ? join(userInfo().homedir, "AppData", "Local", "Temp", "androperator-evidence-locks")
    : `/tmp/androperator-evidence-locks-${process.geteuid!()}`;
}

export function storageError(error: unknown, path: string): never {
  const cause = error as NodeJS.ErrnoException;
  throw {
    code: "EVIDENCE_STORAGE_UNWRITABLE", path,
    message: `Cannot write evidence storage at ${path}: ${cause.message ?? String(error)}`,
    causeCode: cause.code ?? null,
    recovery: "Choose a writable ANDROPERATOR_EVIDENCE_DIR and a new writable output directory; ensure the fixed host video lock directory is accessible. No permissions were changed.",
  };
}

/** Exercise the same create/read/rename/delete operations used by session files. */
export async function preflightDirectory(path: string, privateLockDirectory = false): Promise<void> {
  const probe = join(path, `.write-probe-${randomUUID()}`);
  const renamed = `${probe}.renamed`;
  try {
    await fs.mkdir(path, { recursive: true, mode: 0o700 });
    if (privateLockDirectory) {
      const stat = await fs.lstat(path);
      if (!stat.isDirectory() || (process.platform !== "win32" && (stat.uid !== process.geteuid!() || (stat.mode & 0o077) !== 0))) {
        throw new Error("Video lock directory must be a real, private directory owned by the current user");
      }
    }
    await fs.writeFile(probe, "evidence preflight", { flag: "wx", mode: 0o600 });
    await fs.readFile(probe);
    await fs.rename(probe, renamed);
    await fs.unlink(renamed);
  } catch (error) { storageError(error, path); }
  finally {
    await fs.rm(probe, { force: true }).catch(() => undefined);
    await fs.rm(renamed, { force: true }).catch(() => undefined);
  }
}

/** Exclusive creation is the arbitration point for every root and process. */
export async function acquireVideoLock(path: string, owner: { sessionId: string; nonce: string; outputDir: string }): Promise<void> {
  let handle: fs.FileHandle;
  try { handle = await fs.open(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw { code: "EVIDENCE_RECORDING_ACTIVE", message: "A video session owns this device; use its status/stop or verify recovery before removing its lock" };
    }
    storageError(error, path);
  }
  try { await handle.writeFile(JSON.stringify(owner)); }
  catch (error) {
    // This process created the file and has not dispatched a worker. No recorder owns it.
    await fs.unlink(path);
    storageError(error, path);
  } finally { await handle.close(); }
}
