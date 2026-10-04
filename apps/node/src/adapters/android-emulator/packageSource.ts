import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface EmulatorPackageSource {
  source: "local" | "published";
  version: string;
  root: string;
  entry: string;
}

/** Source markers are absent from npm artifacts, even when installed inside a Git repo. */
function siblingProject(consumerRoot: string): string | undefined {
  const repository = resolve(consumerRoot, "../..");
  const gitPath = join(repository, ".git");
  if (!existsSync(join(consumerRoot, "src/cli/index.ts")) || !existsSync(gitPath)) return undefined;
  if (statSync(gitPath).isDirectory()) return resolve(repository, "../emulator");
  // Read Git's worktree metadata directly: CLI startup must not require git on PATH.
  const pointer = /^gitdir: (.+)$/m.exec(readFileSync(gitPath, "utf8"));
  if (!pointer) throw new Error(`Invalid Git worktree pointer at ${gitPath}`);
  const gitDirectory = resolve(repository, pointer[1].trim());
  const commonFile = join(gitDirectory, "commondir");
  if (!existsSync(commonFile)) return resolve(repository, "../emulator");
  const common = resolve(gitDirectory, readFileSync(commonFile, "utf8").trim());
  return resolve(dirname(common), "../emulator");
}

export function resolveEmulatorPackage(
  source: string = process.env.ANDROPERATOR_EMULATOR_SOURCE ?? "auto",
  consumerRoot: string = resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  publishedEntry: string = import.meta.resolve("@androperator/emulator"),
): EmulatorPackageSource {
  if (!["auto", "local", "published"].includes(source) && !isAbsolute(source)) {
    throw new Error("ANDROPERATOR_EMULATOR_SOURCE must be auto, local, published, or an absolute package directory; blank values are invalid.");
  }
  let localRoot: string | undefined;
  if (isAbsolute(source)) {
    localRoot = source;
  } else if (source !== "published") {
    const sibling = siblingProject(consumerRoot);
    if (source === "local" && sibling === undefined) {
      throw new Error("Local emulator discovery requires a source checkout; set ANDROPERATOR_EMULATOR_SOURCE to an absolute package directory.");
    }
    if (sibling !== undefined && (source === "local" || existsSync(sibling))) localRoot = sibling;
  }
  const entry = localRoot === undefined ? publishedEntry : pathToFileURL(join(localRoot, "dist/index.js")).href;
  const root = localRoot ?? resolve(dirname(fileURLToPath(entry)), "..");
  if (!existsSync(join(root, "package.json")) || !existsSync(fileURLToPath(entry))) {
    throw new Error(`Emulator package is missing or unbuilt at ${root}. Run npm ci && npm run build there, or select ANDROPERATOR_EMULATOR_SOURCE=published.`);
  }
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: string; version?: string };
  if (metadata.name !== "@androperator/emulator" || typeof metadata.version !== "string") {
    throw new Error(`Expected @androperator/emulator package metadata at ${root}`);
  }
  return { source: localRoot === undefined ? "published" : "local", version: metadata.version, root, entry };
}
