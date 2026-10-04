import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { resolveEmulatorPackage } from "../../adapters/android-emulator/packageSource.js";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "emulator-source-")));
  const consumer = join(root, "consumer/apps/node");
  const published = join(consumer, "node_modules/@androperator/emulator");
  const makePackage = (path: string, built = true) => {
    mkdirSync(join(path, "dist"), { recursive: true });
    writeFileSync(join(path, "package.json"), JSON.stringify({ name: "@androperator/emulator", version: "0.1.1" }));
    if (built) writeFileSync(join(path, "dist/index.js"), "export const fixture = true;");
  };
  makePackage(published);
  const entry = pathToFileURL(join(published, "dist/index.js")).href;
  const select = (source: string, path = consumer) => resolveEmulatorPackage(source, path, entry);
  const development = () => {
    mkdirSync(join(root, "consumer/.git"));
    mkdirSync(join(consumer, "src/cli"), { recursive: true });
    writeFileSync(join(consumer, "src/cli/index.ts"), "");
  };
  return { root, consumer, published, select, development, makePackage, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("automatic source selects a built sibling only for a development checkout", () => {
  const f = fixture();
  try {
    f.makePackage(join(f.root, "emulator"));
    assert.equal(f.select("auto").source, "published");
    f.development();
    assert.equal(f.select("auto").root, join(f.root, "emulator"));
    assert.equal(f.select("published").root, f.published);
    const custom = join(f.root, "elsewhere");
    f.makePackage(custom);
    assert.equal(f.select(custom).root, custom);
  } finally { f.cleanup(); }
});

test("absent sibling falls back to published, while explicit local and unbuilt sibling fail clearly", () => {
  const f = fixture();
  try {
    assert.throws(() => f.select("local"), /source checkout/);
    f.development();
    assert.equal(f.select("auto").source, "published");
    assert.throws(() => f.select("local"), /missing or unbuilt/);
    f.makePackage(join(f.root, "emulator"), false);
    assert.throws(() => f.select("auto"), /npm ci && npm run build/);
    assert.equal(f.select("published").source, "published");
    for (const value of ["", " ", "relative/path", "bundled"]) {
      assert.throws(() => f.select(value), /must be auto/);
    }
    writeFileSync(join(f.root, "emulator/package.json"), '{"name":"other","version":"1"}');
    writeFileSync(join(f.root, "emulator/dist/index.js"), "");
    assert.throws(() => f.select("local"), /Expected @androperator\/emulator/);
  } finally { f.cleanup(); }
});

test("worktree discovery follows the primary checkout's sibling without git on PATH", () => {
  const f = fixture();
  try {
    const repository = join(f.root, "consumer");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "pipe" });
    git("init", "--quiet");
    mkdirSync(join(f.consumer, "src/cli"), { recursive: true });
    writeFileSync(join(f.consumer, "src/cli/index.ts"), "// source marker\n");
    git("add", "apps/node/src");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
    const worktree = join(f.root, "worktree");
    git("worktree", "add", "--quiet", "--detach", worktree);
    f.makePackage(join(f.root, "emulator"));
    const previousPath = process.env.PATH;
    process.env.PATH = "";
    try {
      assert.equal(f.select("auto", join(worktree, "apps/node")).root, join(f.root, "emulator"));
    } finally {
      if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    }
  } finally { f.cleanup(); }
});
