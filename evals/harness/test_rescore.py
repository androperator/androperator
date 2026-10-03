from __future__ import annotations

import json
from pathlib import Path

import pytest

from evals.run_eval import _rescore_run, main


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def test_rescore_run_writes_result_rescored_without_overwriting_result(tmp_path):
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "android-version-20260404-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)

    config = {
        "environment": {
            "ground_truth_android_version": "15",
        },
    }
    result = {
        "run_id": run_dir.name,
        "outcome": {
            "status": "fail",
            "answer_extracted_raw": "14",
            "answer_normalized": "14",
            "ground_truth_normalized": "15",
            "answer_correct": False,
            "failure_reason": None,
        },
        "metrics": {
            "used_disallowed_tool": False,
        },
        "environment": {
            "ground_truth_android_version": "15",
        },
    }
    transcript = "ANDROPERATOR_EVAL_ANSWER: 15\n"

    _write_json(run_dir / "config.json", config)
    _write_json(run_dir / "result.json", result)
    (run_dir / "transcript.txt").write_text(transcript, encoding="utf-8")

    rescored = _rescore_run(runs_dir, run_dir.name)

    assert (run_dir / "result.json").read_text(encoding="utf-8") == json.dumps(result, indent=2) + "\n"
    rescored_path = run_dir / "result-rescored.json"
    assert rescored_path.exists()
    rescored_payload = json.loads(rescored_path.read_text(encoding="utf-8"))
    assert rescored_payload["outcome"]["status"] == "pass"
    assert rescored["outcome"]["status"] == "pass"


def test_rescore_cli_accepts_only_run_id(tmp_path, capsys):
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "android-version-20260404-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)
    _write_json(run_dir / "config.json", {"environment": {"ground_truth_android_version": "15"}})
    _write_json(
        run_dir / "result.json",
        {
            "run_id": run_dir.name,
            "outcome": {
                "status": "pass",
                "answer_extracted_raw": "15",
                "answer_normalized": "15",
                "ground_truth_normalized": "15",
                "answer_correct": True,
                "failure_reason": None,
            },
            "metrics": {"used_disallowed_tool": False, "wall_clock_s": 0.0},
            "environment": {"ground_truth_android_version": "15"},
        },
    )
    (run_dir / "transcript.txt").write_text("ANDROPERATOR_EVAL_ANSWER: 15\n", encoding="utf-8")

    exit_code = main(["android-version", "--rescore", run_dir.name, "--runs-dir", str(runs_dir)])

    captured = capsys.readouterr()
    assert exit_code == 0
    assert "RESCORED" in captured.out.upper()


def test_rescore_rejects_escape_run_id(tmp_path):
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    with pytest.raises(SystemExit, match="escapes runs_dir"):
        _rescore_run(runs_dir, "../escape")


def test_rescore_rebuilds_derived_fields(tmp_path):
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "android-version-20260404-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)

    _write_json(
        run_dir / "config.json",
        {"environment": {"ground_truth_android_version": "15"}},
    )
    _write_json(
        run_dir / "result.json",
        {
            "run_id": run_dir.name,
            "outcome": {
                "status": "pass",
                "answer_extracted_raw": "15",
                "answer_normalized": "15",
                "ground_truth_normalized": "15",
                "answer_correct": True,
                "failure_reason": None,
            },
            "metrics": {
                "used_disallowed_tool": False,
                "answer_emitted": True,
                "violations": {"used_adb": False},
                "wall_clock_s": 1.0,
            },
            "environment": {"ground_truth_android_version": "15"},
        },
    )
    (run_dir / "transcript.txt").write_text("> adb shell getprop ro.build.version.release\n", encoding="utf-8")

    rescored = _rescore_run(runs_dir, run_dir.name)

    assert rescored["outcome"]["status"] == "no_answer"
    assert rescored["outcome"]["answer_extracted_raw"] is None
    assert rescored["outcome"]["answer_correct"] is False
    assert rescored["metrics"]["answer_emitted"] is False
    assert rescored["metrics"]["used_disallowed_tool"] is True
    assert rescored["metrics"]["violations"]["used_adb"] is True


def test_rescore_preserves_skill_generation_gate(tmp_path):
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "android-version-20260404-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)

    _write_json(
        run_dir / "config.json",
        {
            "eval_id": "android-version",
            "spec": {"prompt_file": "prompt-skill.md"},
            "environment": {
                "ground_truth_android_version": "15",
                "androperator_cmd": ["node", "/repo/apps/node/dist/cli/index.js"],
                "runtime_androperator_cmd": ["node", "/repo/apps/node/dist/cli/index.js"],
                "operator_package": "com.androperator.operator.dev",
            },
        },
    )
    _write_json(
        run_dir / "result.json",
        {
            "run_id": run_dir.name,
            "eval_id": "android-version",
            "outcome": {
                "status": "fail",
                "answer_extracted_raw": "15",
                "answer_normalized": "15",
                "ground_truth_normalized": "15",
                "answer_correct": True,
                "failure_reason": "skill_route_not_proven",
            },
            "skill_score": {
                "skill_emitted": True,
                "skill_valid": True,
                "skill_validation_errors": [],
                "replay_attempted": True,
                "replay_status": "pass",
                "replay_answer_normalized": "15",
                "replay_answer_correct": True,
                "route_requirements_met": False,
                "skill_generation_passed": False,
            },
            "metrics": {
                "used_disallowed_tool": False,
                "answer_emitted": True,
                "violations": {"used_adb": False},
                "wall_clock_s": 1.0,
            },
            "environment": {"ground_truth_android_version": "15"},
        },
    )
    (run_dir / "transcript.txt").write_text(
        '{"type":"item.completed","item":{"type":"command_execution","command":"androperator bundled-skills list"}}\n'
        "ANDROPERATOR_EVAL_ANSWER: 15\n",
        encoding="utf-8",
    )

    rescored = _rescore_run(runs_dir, run_dir.name)

    assert rescored["outcome"]["status"] == "fail"
    assert rescored["outcome"]["failure_reason"] == "skill_route_not_proven"
    assert rescored["skill_score"]["skill_generation_passed"] is False


def test_rescore_rebuilds_skill_generation_gate_when_skill_score_is_missing(tmp_path):
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "android-version-20260404-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)

    _write_json(
        run_dir / "config.json",
        {
            "eval_id": "android-version",
            "spec": {"prompt_file": "prompt-skill.md"},
            "environment": {
                "ground_truth_android_version": "15",
                "androperator_cmd": ["node", "/repo/apps/node/dist/cli/index.js"],
                "runtime_androperator_cmd": ["node", "/repo/apps/node/dist/cli/index.js"],
                "operator_package": "com.androperator.operator.dev",
            },
        },
    )
    _write_json(
        run_dir / "result.json",
        {
            "run_id": run_dir.name,
            "eval_id": "android-version",
            "outcome": {
                "status": "pass",
                "answer_extracted_raw": "15",
                "answer_normalized": "15",
                "ground_truth_normalized": "15",
                "answer_correct": True,
                "failure_reason": None,
            },
            "metrics": {
                "used_disallowed_tool": False,
                "answer_emitted": True,
                "violations": {"used_adb": False},
                "wall_clock_s": 1.0,
            },
            "environment": {"ground_truth_android_version": "15"},
        },
    )
    (run_dir / "transcript.txt").write_text(
        "ANDROPERATOR_EVAL_ANSWER: 15\n",
        encoding="utf-8",
    )

    rescored = _rescore_run(runs_dir, run_dir.name)

    assert rescored["outcome"]["status"] == "fail"
    assert rescored["outcome"]["failure_reason"] == "skill_route_not_proven"
    assert rescored["skill_score"]["skill_emitted"] is False
    assert rescored["skill_score"]["skill_generation_passed"] is False


def test_rescore_rejects_missing_outcome_or_metrics(tmp_path):
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "android-version-20260404-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)

    _write_json(run_dir / "config.json", {"environment": {"ground_truth_android_version": "15"}})
    _write_json(run_dir / "result.json", {"run_id": run_dir.name, "environment": {"ground_truth_android_version": "15"}})
    (run_dir / "transcript.txt").write_text("ANDROPERATOR_EVAL_ANSWER: 15\n", encoding="utf-8")

    with pytest.raises(SystemExit, match="missing or non-object outcome"):
        _rescore_run(runs_dir, run_dir.name)


def test_rescore_rejects_missing_metrics(tmp_path):
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "android-version-20260404-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)

    _write_json(run_dir / "config.json", {"environment": {"ground_truth_android_version": "15"}})
    _write_json(
        run_dir / "result.json",
        {
            "run_id": run_dir.name,
            "outcome": {
                "status": "pass",
                "answer_extracted_raw": "15",
                "answer_normalized": "15",
                "ground_truth_normalized": "15",
                "answer_correct": True,
                "failure_reason": None,
            },
            "environment": {"ground_truth_android_version": "15"},
        },
    )
    (run_dir / "transcript.txt").write_text("ANDROPERATOR_EVAL_ANSWER: 15\n", encoding="utf-8")

    with pytest.raises(SystemExit, match="missing or non-object metrics"):
        _rescore_run(runs_dir, run_dir.name)
