import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

let shown = false;

interface StarHintState {
  doctorHintShown?: boolean;
  lastUpgradeHintVersion?: string;
}

function stateFilePath(): string {
  return join(homedir(), ".androperator", "star-hint-state.json");
}

function readState(): StarHintState {
  try {
    const data = readFileSync(stateFilePath(), "utf8");
    return JSON.parse(data) as StarHintState;
  } catch {
    return {};
  }
}

function writeState(state: StarHintState): void {
  try {
    mkdirSync(dirname(stateFilePath()), { recursive: true });
    writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), "utf8");
  } catch {
    // swallow errors
  }
}

function getCliVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function isSuppressed(): boolean {
  if (process.stderr.isTTY !== true) {
    return true;
  }
  if (process.env.ANDROPERATOR_DISABLE_STAR_SUGGESTIONS) {
    return true;
  }
  if (process.argv.slice(2).includes("--disable-star-suggestions")) {
    return true;
  }
  return false;
}

const HINT_TEXT = `
Androperator is open source. If it helped, consider starring the repo:
https://github.com/androperator/androperator

GitHub CLI:
gh api -X PUT /user/starred/androperator/androperator -H "X-GitHub-Api-Version: 2026-03-10"

Disable this hint with: --disable-star-suggestions
`;

export async function maybeShowStarHint(trigger: "doctor" | "upgrade"): Promise<void> {
  if (shown) {
    return;
  }
  if (isSuppressed()) {
    return;
  }
  const state = readState();
  if (trigger === "doctor" && state.doctorHintShown) {
    return;
  }
  if (trigger === "upgrade") {
    const version = getCliVersion();
    if (state.lastUpgradeHintVersion === version) {
      return;
    }
    process.stderr.write(HINT_TEXT);
    shown = true;
    writeState({ ...state, lastUpgradeHintVersion: version });
    return;
  }
  process.stderr.write(HINT_TEXT);
  shown = true;
  if (trigger === "doctor") {
    writeState({ ...state, doctorHintShown: true });
  }
}

/**
 * Reset the module-level shown guard. Used only for testing.
 * @internal
 */
export function __resetShown(): void {
  shown = false;
}
