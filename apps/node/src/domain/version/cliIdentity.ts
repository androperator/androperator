import { createRequire } from "node:module";
import { realpathSync, statSync } from "node:fs";

export interface CliBuildIdentity {
  entryPath: string;
  mtimeMs: number | null;
  size: number | null;
}

const CLI_BUILD_IDENTITY = readCliBuildIdentity();

function readCliBuildIdentity(): CliBuildIdentity {
  const entryPath = process.argv[1] ?? "unknown";
  try {
    const resolvedEntryPath = realpathSync(entryPath);
    const stats = statSync(resolvedEntryPath);
    return {
      entryPath: resolvedEntryPath,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  } catch {
    return {
      entryPath,
      mtimeMs: null,
      size: null,
    };
  }
}

export function getCliBuildIdentity(): CliBuildIdentity {
  return CLI_BUILD_IDENTITY;
}


export function getCliVersion(): string {
  const pkg = createRequire(import.meta.url)("../../../package.json") as { version?: string };
  if (!pkg.version || pkg.version.trim().length === 0) throw new Error("package.json version is missing");
  return pkg.version;
}
