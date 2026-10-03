import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  compareRecordingBaselineWithSkillResult,
  isMeaningfulCompareDivergence,
  loadRecordingExportBaselineFile,
  loadSkillResultFromSkillsRunFile,
  normalizeRecordingExportForCompare,
} from "../../domain/recording/compareRecording.js";
import type { SkillResult } from "../../contracts/skillResult.js";
import type { RecordingExportArtifact } from "../../domain/recording/recordingEventTypes.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesRoot = join(packageRoot, "src", "test", "fixtures", "recording-compare");
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function readJsonFixture<T>(name: string): Promise<T> {
  const filePath = join(fixturesRoot, name);
  return JSON.parse(await readFile(filePath, "utf-8")) as T;
}

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const cliPath = join(packageRoot, "dist", "cli", "index.js");
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: packageRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("recording compare normalization", () => {
  it("normalizes the canonical Solax baseline export into checkpoint compare input", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const expected = await readJsonFixture("solax-baseline-success.normalized.json");

    assert.deepStrictEqual(normalizeRecordingExportForCompare(baseline), expected);
  });

  it("normalizes the sanitized retained baseline identically to the canonical baseline", async () => {
    const canonical = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const sanitized = await readJsonFixture<RecordingExportArtifact>("solax-baseline-sanitized.export.json");
    const canonicalExpected = await readJsonFixture("solax-baseline-success.normalized.json");
    const sanitizedExpected = await readJsonFixture("solax-baseline-sanitized.normalized.json");

    assert.deepStrictEqual(normalizeRecordingExportForCompare(canonical), canonicalExpected);
    assert.deepStrictEqual(normalizeRecordingExportForCompare(sanitized), sanitizedExpected);
    assert.deepStrictEqual(sanitizedExpected, canonicalExpected);
  });

  it("produces zero checkpoints for a non-Solax recording with only scroll events", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("non-solax-scroll-only.export.json");
    const normalized = normalizeRecordingExportForCompare(baseline);
    assert.strictEqual(normalized.checkpoints.length, 0);
    assert.strictEqual(normalized.appPackage, "com.example.notes");
  });

  it("fails closed for a non-Solax recording with generic events under the Solax-only normalization guard", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("non-solax-generic-events.export.json");
    const normalized = normalizeRecordingExportForCompare(baseline);
    assert.strictEqual(normalized.checkpoints.length, 0);
    assert.strictEqual(normalized.appPackage, "com.example.notes");
  });

  it("fails closed for a non-Solax recording whose generic labels would otherwise synthesize a full checkpoint set", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("non-solax-false-positive.export.json");
    const normalized = normalizeRecordingExportForCompare(baseline);
    assert.strictEqual(normalized.checkpoints.length, 0);
    assert.strictEqual(normalized.appPackage, "com.example.energy");
  });

  it("fails closed when Solax checkpoint candidates are not monotonic in event order", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-non-monotonic.export.json");
    const normalized = normalizeRecordingExportForCompare(baseline);
    assert.strictEqual(normalized.checkpoints.length, 0);
    assert.strictEqual(normalized.appPackage, "com.solaxcloud.starter");
  });
});

describe("recording compare outcomes", () => {
  it("reports literal match for a replay SkillResult that matches the baseline", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-replay-success.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.compareMode, "literal");
    assert.strictEqual(report.outcome, "literal_match");
    assert.strictEqual(report.pathMatches, true);
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), false);
  });

  it("reports semantic match for an agent-driven run whose checkpoints and outcome match", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-success.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.compareMode, "semantic");
    assert.strictEqual(report.outcome, "semantic_match");
    assert.strictEqual(report.pathMatches, true);
  });

  it("reports outcome_matches_path_differs when an agent-driven run reaches the goal through a different path", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-success-path-differs.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.compareMode, "semantic");
    assert.strictEqual(report.outcome, "outcome_matches_path_differs");
    assert.strictEqual(report.pathMatches, false);
    assert.strictEqual(report.firstDivergence?.baselineCheckpoint, "discharge_to_row_focused");
    assert.strictEqual(report.firstDivergence?.actualCheckpoint, "device_discharging_card_opened");
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), false);
  });

  it("reports baseline_drift when a replay-style run diverges from the normalized checkpoint path", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-baseline-drift.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.compareMode, "literal");
    assert.strictEqual(report.outcome, "baseline_drift");
    assert.strictEqual(report.firstDivergence?.baselineCheckpoint, "discharge_to_row_focused");
    assert.strictEqual(report.firstDivergence?.actualCheckpoint, "device_discharging_card_opened");
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), true);
  });

  it("reports verification_failed when checkpoints match but terminal verification fails", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-verification-failed.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "verification_failed");
    assert.strictEqual(report.pathMatches, true);
    assert.strictEqual(report.terminalVerificationStatus, "failed");
  });

  it("reports verification_indeterminate when the run does not prove terminal verification", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-indeterminate.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "verification_indeterminate");
    assert.strictEqual(report.pathMatches, true);
    assert.strictEqual(report.terminalVerificationStatus, "missing");
  });

  it("reports upstream_failure when the skill fails without an explicit runtime-state classification", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-upstream-failure.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "upstream_failure");
    assert.strictEqual(report.firstDivergence?.baselineCheckpoint, "target_text_entered");
    assert.strictEqual(report.firstDivergence?.actualCheckpoint, "target_text_entered");
    assert.strictEqual(report.firstDivergence?.actualStatus, "failed");
  });

  it("reports runtime_poisoned when the SkillResult carries an explicit poisoned runtime state", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-runtime-poisoned.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "runtime_poisoned");
  });

  it("reports runtime_unavailable when the SkillResult carries an explicit unavailable runtime state", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-runtime-unavailable.skillresult.json");

    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "runtime_unavailable");
  });

  it("reports normalization_insufficient for a non-Solax baseline with zero extractable checkpoints", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("non-solax-scroll-only.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-success.skillresult.json");
    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "normalization_insufficient");
    assert.strictEqual(report.normalizationStrategy, "solax_heuristic");
    assert.strictEqual(report.baselineCoverage.declared, 0);
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), true);
  });

  it("reports normalization_insufficient for a non-Solax baseline blocked by the Solax-only normalization guard", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("non-solax-generic-events.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-success.skillresult.json");
    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "normalization_insufficient");
    assert.strictEqual(report.baselineCoverage.declared, 0);
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), true);
  });

  it("reports normalization_insufficient for a false-positive non-Solax baseline that matches generic discharge/save strings", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("non-solax-false-positive.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-success.skillresult.json");
    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "normalization_insufficient");
    assert.strictEqual(report.baselineCoverage.declared, 0);
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), true);
  });

  it("reports normalization_insufficient when Solax checkpoints can only be stitched together out of order", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-non-monotonic.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-success.skillresult.json");
    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "normalization_insufficient");
    assert.strictEqual(report.baselineCoverage.declared, 0);
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), true);
  });

  it("includes baselineCoverage and normalizationStrategy in a successful compare report", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-replay-success.skillresult.json");
    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.outcome, "literal_match");
    assert.strictEqual(report.normalizationStrategy, "solax_heuristic");
    assert.strictEqual(report.minimumSemanticCoverage, 2);
    assert.strictEqual(report.baselineCoverage.declared, 4);
    assert.strictEqual(report.baselineCoverage.covered, 4);
  });

  it("reports baseline_uncovered when an agent-driven run has verified terminal state but zero baseline checkpoint coverage", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-zero-coverage.skillresult.json");
    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.compareMode, "semantic");
    assert.strictEqual(report.outcome, "baseline_uncovered");
    assert.strictEqual(report.terminalVerificationStatus, "verified");
    assert.strictEqual(report.baselineCoverage.declared, 4);
    assert.strictEqual(report.baselineCoverage.covered, 0);
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), true);
  });

  it("reports baseline_weakly_covered when an agent-driven run covers only one baseline checkpoint", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-single-coverage.skillresult.json");
    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.compareMode, "semantic");
    assert.strictEqual(report.outcome, "baseline_weakly_covered");
    assert.strictEqual(report.baselineCoverage.declared, 4);
    assert.strictEqual(report.baselineCoverage.covered, 1);
    assert.strictEqual(report.minimumSemanticCoverage, 2);
    assert.strictEqual(isMeaningfulCompareDivergence(report.outcome), true);
  });

  it("still reports outcome_matches_path_differs when an agent-driven run has baseline coverage and verified terminal state", async () => {
    const baseline = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    const skillResult = await readJsonFixture<SkillResult>("solax-result-success-path-differs.skillresult.json");
    const report = compareRecordingBaselineWithSkillResult(baseline, skillResult);
    assert.strictEqual(report.compareMode, "semantic");
    assert.strictEqual(report.outcome, "outcome_matches_path_differs");
    assert.ok(report.baselineCoverage.covered >= 2, "should satisfy minimum semantic coverage");
  });
});

describe("recording compare cross-repo baseline sync", () => {
  it("skills-repo retained baseline matches the Androperator fixture structurally", async () => {
    const skillsRootInput = process.env.ANDROPERATOR_SKILLS_ROOT;
    if (!skillsRootInput) {
      return;
    }
    const repoRoot = resolve(packageRoot, "..", "..");
    const skillsRoot = isAbsolute(skillsRootInput)
      ? skillsRootInput
      : resolve(repoRoot, skillsRootInput);
    const canonicalPath = join(
      skillsRoot,
      "skills",
      "com.solaxcloud.starter.set-discharge-to-limit-orchestrated",
      "references",
      "compare-baseline.export.json"
    );
    const canonical = await loadRecordingExportBaselineFile(canonicalPath);
    const fixture = await readJsonFixture<RecordingExportArtifact>("solax-baseline-success.export.json");
    assert.deepStrictEqual(
      normalizeRecordingExportForCompare(canonical),
      normalizeRecordingExportForCompare(fixture)
    );

    const successFixture = await readJsonFixture<SkillResult>("solax-result-success.skillresult.json");
    const canonicalReport = compareRecordingBaselineWithSkillResult(canonical, successFixture);
    const fixtureReport = compareRecordingBaselineWithSkillResult(fixture, successFixture);
    assert.strictEqual(canonicalReport.outcome, fixtureReport.outcome);
    assert.deepStrictEqual(canonicalReport.baseline.checkpointIds, fixtureReport.baseline.checkpointIds);
  });
});

describe("recording compare file loading", () => {
  it("loads a baseline export file and a saved skills run wrapper", async () => {
    const baseline = await loadRecordingExportBaselineFile(join(fixturesRoot, "solax-baseline-success.export.json"));
    const skillResult = await loadSkillResultFromSkillsRunFile(join(fixturesRoot, "solax-skills-run-success.json"));

    assert.strictEqual(baseline.session.sessionId, "solax-set-discharge-to-limit-20260410-135211");
    assert.strictEqual(skillResult.source.kind, "agent");
  });

  it("accepts deduplicated framed JSON success without top-level status", async () => {
    const skillResult = await loadSkillResultFromSkillsRunFile(
      join(fixturesRoot, "deduplicated-skills-run-success.json")
    );
    assert.strictEqual(
      skillResult.skillId,
      "com.solaxcloud.starter.set-discharge-to-limit-orchestrated"
    );
    assert.strictEqual(skillResult.source.kind, "agent");
  });

  it("rejects a saved skills run wrapper whose SkillResult contract major version is unsupported", async () => {
    const dir = await makeTempDir("androperator-recording-compare-contract-version-");
    const resultPath = join(dir, "unsupported-contract-version.json");
    const wrapper = await readJsonFixture<{ skillResult: SkillResult }>("solax-skills-run-success.json");
    const unsupportedWrapper = {
      ...wrapper,
      skillResult: {
        ...wrapper.skillResult,
        contractVersion: "2.0.0",
      },
    };
    await writeFile(resultPath, `${JSON.stringify(unsupportedWrapper, null, 2)}\n`, "utf-8");

    await assert.rejects(
      loadSkillResultFromSkillsRunFile(resultPath),
      (error: unknown) => {
        assert.deepStrictEqual(error, {
          code: "RECORDING_COMPARE_FAILED",
          message: `Compare result file ${resultPath} contained an unsupported skillResult contractVersion: Unsupported SkillResult contract major version 2; expected 1`,
        });
        return true;
      }
    );
  });

  it("rejects a saved skills run wrapper whose top-level status is indeterminate even when nested skillResult is successful", async () => {
    const dir = await makeTempDir("androperator-recording-compare-wrapper-status-");
    const resultPath = join(dir, "wrapper-indeterminate.json");
    const wrapper = await readJsonFixture<Record<string, unknown> & { skillResult: SkillResult }>("solax-skills-run-success.json");
    const indeterminateWrapper = {
      ...wrapper,
      status: "indeterminate",
      code: "SKILL_VERIFICATION_INDETERMINATE",
      message: "Declared verification was not proved.",
    };
    await writeFile(resultPath, `${JSON.stringify(indeterminateWrapper, null, 2)}\n`, "utf-8");

    await assert.rejects(
      loadSkillResultFromSkillsRunFile(resultPath),
      (error: unknown) => {
        assert.deepStrictEqual(error, {
          code: "RECORDING_COMPARE_FAILED",
          message: `Compare result file ${resultPath} must come from a successful skills run wrapper; got status indeterminate (SKILL_VERIFICATION_INDETERMINATE: Declared verification was not proved.)`,
        });
        return true;
      }
    );
  });
});

describe("recording compare CLI", () => {
  it("returns exit code 0 for replay success", async () => {
    const { stdout, code, stderr } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
      "--result",
      join(fixturesRoot, "solax-skills-run-replay-success.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 0, stderr);
    const parsed = JSON.parse(stdout) as { outcome?: string; compareMode?: string };
    assert.strictEqual(parsed.outcome, "literal_match");
    assert.strictEqual(parsed.compareMode, "literal");
  });

  it("returns exit code 0 for semantic path-diff success when mode is auto-detected from the saved wrapper", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
      "--result",
      join(fixturesRoot, "solax-skills-run-path-diff.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 0, stdout);
    const parsed = JSON.parse(stdout) as { outcome?: string; compareMode?: string };
    assert.strictEqual(parsed.compareMode, "semantic");
    assert.strictEqual(parsed.outcome, "outcome_matches_path_differs");
  });

  it("returns a typed compare error for an indeterminate saved wrapper that was not trusted by skills run", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
      "--result",
      join(fixturesRoot, "solax-skills-run-verification-failed.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "RECORDING_COMPARE_FAILED");
    assert.match(parsed.message ?? "", /must come from a successful skills run wrapper; got status indeterminate/i);
  });

  it("returns exit code 1 for a live-backed baseline drift wrapper", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
      "--result",
      join(fixturesRoot, "solax-skills-run-baseline-drift.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { outcome?: string; firstDivergence?: { actualCheckpoint?: string } };
    assert.strictEqual(parsed.outcome, "baseline_drift");
    assert.strictEqual(parsed.firstDivergence?.actualCheckpoint, "device_discharging_card_opened");
  });

  it("returns USAGE when --baseline is omitted", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--result",
      join(fixturesRoot, "solax-skills-run-success.json"),
    ]);

    assert.strictEqual(code, 0);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "USAGE");
    assert.match(parsed.message ?? "", /--baseline/);
  });

  it("returns USAGE when --result is omitted", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
    ]);

    assert.strictEqual(code, 0);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "USAGE");
    assert.match(parsed.message ?? "", /--result/);
  });

  it("returns USAGE when --baseline is missing its value", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      "--result",
      join(fixturesRoot, "solax-skills-run-success.json"),
    ]);

    assert.notStrictEqual(code, 0);
    assert.match(stdout, /"code":"USAGE"/);
    assert.match(stdout, /--baseline requires a value/);
  });

  it("returns USAGE when --mode has an invalid value", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
      "--result",
      join(fixturesRoot, "solax-skills-run-success.json"),
      "--mode",
      "bogus",
    ]);

    assert.strictEqual(code, 0);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "USAGE");
    assert.match(parsed.message ?? "", /auto, literal, semantic/);
  });

  it("returns a typed compare error when the baseline file does not exist", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      "/tmp/does-not-exist.export.json",
      "--result",
      join(fixturesRoot, "solax-skills-run-success.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "RECORDING_COMPARE_FAILED");
    assert.match(parsed.message ?? "", /Failed to read compare baseline file/);
  });

  it("returns a typed compare error for malformed baseline JSON", async () => {
    const dir = await makeTempDir("androperator-recording-compare-");
    const baselinePath = join(dir, "bad-baseline.json");
    await writeFile(baselinePath, "{not json}\n", "utf-8");

    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      baselinePath,
      "--result",
      join(fixturesRoot, "solax-skills-run-success.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "RECORDING_COMPARE_FAILED");
    assert.match(parsed.message ?? "", /not a valid recording export artifact/);
  });

  it("returns a typed compare error for malformed result JSON", async () => {
    const dir = await makeTempDir("androperator-recording-compare-");
    const resultPath = join(dir, "bad-result.json");
    await writeFile(resultPath, "{not json}\n", "utf-8");

    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
      "--result",
      resultPath,
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "RECORDING_COMPARE_FAILED");
    assert.match(parsed.message ?? "", /must be valid JSON/);
  });

  it("returns a typed compare error when the saved wrapper does not include skillResult", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
      "--result",
      join(fixturesRoot, "solax-skills-run-malformed-wrapper.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { code?: string; message?: string };
    assert.strictEqual(parsed.code, "RECORDING_COMPARE_FAILED");
    assert.match(parsed.message ?? "", /missing the top-level skillResult field/);
  });

  it("returns exit code 1 with normalization_insufficient for a baseline that does not satisfy the Solax heuristic set", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "non-solax-generic-events.export.json"),
      "--result",
      join(fixturesRoot, "solax-skills-run-success.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { outcome?: string; normalizationStrategy?: string };
    assert.strictEqual(parsed.outcome, "normalization_insufficient");
    assert.strictEqual(parsed.normalizationStrategy, "solax_heuristic");
  });

  it("returns exit code 1 with baseline_weakly_covered for a semantic run below the minimum coverage threshold", async () => {
    const { stdout, code } = await runCli([
      "recording",
      "compare",
      "--baseline",
      join(fixturesRoot, "solax-baseline-success.export.json"),
      "--result",
      join(fixturesRoot, "solax-skills-run-single-coverage.json"),
      "--output",
      "json",
    ]);

    assert.strictEqual(code, 1, stdout);
    const parsed = JSON.parse(stdout) as { outcome?: string; minimumSemanticCoverage?: number };
    assert.strictEqual(parsed.outcome, "baseline_weakly_covered");
    assert.strictEqual(parsed.minimumSemanticCoverage, 2);
  });
});
