from __future__ import annotations

import json
from types import SimpleNamespace
from pathlib import Path

import pytest

from evals.harness import environment
from evals.harness import runner
from evals import run_eval


class _StubAgent:
    def __init__(self) -> None:
        self.config = SimpleNamespace(type_id="claude", model="claude-sonnet-4-6", extra_flags=[])

    def build_command(self, prompt: str, work_dir: str) -> list[str]:
        return ["stub-agent", work_dir]


def _make_stub_environment():
    return SimpleNamespace(
        device_serial="device-123",
        androperator_cmd=["androperator"],
        androperator_version="0.5.3",
        androperator_npm_version="0.5.3",
        ground_truth_android_version="15",
        operator_package="com.androperator.operator.dev",
    )


def test_write_preflight_failure_run_uses_full_repo_paths(monkeypatch, tmp_path):
    args = SimpleNamespace(
        eval_id="android-version",
        agent="claude",
        model="claude-sonnet-4-6",
        label=None,
        runs_dir=str(tmp_path / "runs"),
        mode="full-repo",
        runtime="published",
        timeout_s=300,
        max_turns=40,
    )
    spec = {"prompts": {"full-repo": "prompt-full-repo.md"}}
    monkeypatch.setenv("ANDROPERATOR_OPERATOR_PACKAGE", "   ")
    run_dir = run_eval._write_preflight_failure_run(
        args=args,
        spec=spec,
        agent=_StubAgent(),
        failure_reason="published_binary_not_found",
        runtime_inputs=None,
    )

    result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))

    assert result["environment"]["operator_package"] == environment.RELEASE_OPERATOR_PACKAGE
    assert result["environment"]["cwd"] == str(run_eval.ROOT)
    assert result["environment"]["runs_dir"] == str(tmp_path / "runs")
    assert result["environment"]["androperator_npm_version"] is None
    assert config["invocation"]["work_dir"] == str(run_eval.ROOT)
    assert config["environment"]["cwd"] == str(run_eval.ROOT)
    assert config["environment"]["runs_dir"] == str(tmp_path / "runs")
    assert config["environment"]["operator_package"] == environment.RELEASE_OPERATOR_PACKAGE
    assert "skill_prompt_file" not in config["spec"]






def test_write_preflight_failure_run_redacts_public_surface_runtime_command(monkeypatch, tmp_path):
    args = SimpleNamespace(
        eval_id="android-version",
        agent="claude",
        model="claude-sonnet-4-6",
        label=None,
        runs_dir=str(tmp_path / "runs"),
        mode="public-surface",
        runtime="local-dev",
        timeout_s=300,
        max_turns=40,
    )
    spec = {"prompts": {"public-surface": "prompt-public.md"}}
    monkeypatch.setenv("ANDROPERATOR_OPERATOR_PACKAGE", "   ")

    run_dir = run_eval._write_preflight_failure_run(
        args=args,
        spec=spec,
        agent=_StubAgent(),
        failure_reason="doctor_preflight_failed",
        runtime_inputs=None,
    )

    result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))

    assert result["environment"]["androperator_cmd"] == ["androperator"]
    assert result["environment"]["runtime_androperator_cmd"] == ["node", str(run_eval.REPO_ROOT / "apps/node/dist/cli/index.js")]
    assert result["environment"]["cwd"] == "<redacted>"
    assert result["environment"]["runs_dir"] == "<redacted>"
    assert config["environment"]["androperator_cmd"] == ["androperator"]
    assert config["environment"]["runtime_androperator_cmd"] == ["node", str(run_eval.REPO_ROOT / "apps/node/dist/cli/index.js")]
    assert config["environment"]["cwd"] == "<redacted>"
    assert config["environment"]["runs_dir"] == "<redacted>"


def test_write_preflight_failure_run_persists_doctor_details(monkeypatch, tmp_path):
    args = SimpleNamespace(
        eval_id="android-version",
        agent="claude",
        model="claude-sonnet-4-6",
        label=None,
        runs_dir=str(tmp_path / "runs"),
        mode="public-surface",
        runtime="local-dev",
        timeout_s=300,
        max_turns=40,
    )
    spec = {"prompts": {"public-surface": "prompt-public.md"}}
    preflight_details = {
        "doctor_report": {
            "deviceId": "emulator-5554",
            "operatorPackage": "com.androperator.operator.dev",
        },
        "doctor_failure": {
            "code": "VERSION_INCOMPATIBLE",
            "summary": "CLI and APK versions are incompatible",
            "evidence": {
                "cliVersion": "0.5.3",
                "apkVersion": "0.4.1-d",
            },
        },
    }

    run_dir = run_eval._write_preflight_failure_run(
        args=args,
        spec=spec,
        agent=_StubAgent(),
        failure_reason="doctor_preflight_failed",
        runtime_inputs=None,
        preflight_details=preflight_details,
    )

    result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))

    assert result["preflight"] == {
        "doctor_failure": {
            "code": "VERSION_INCOMPATIBLE",
            "summary": "CLI and APK versions are incompatible",
        }
    }
    assert config["preflight"] == result["preflight"]


def test_write_preflight_failure_run_persists_full_doctor_report_in_full_repo(monkeypatch, tmp_path):
    args = SimpleNamespace(
        eval_id="android-version",
        agent="claude",
        model="claude-sonnet-4-6",
        label=None,
        runs_dir=str(tmp_path / "runs"),
        mode="full-repo",
        runtime="local-dev",
        timeout_s=300,
        max_turns=40,
    )
    spec = {"prompts": {"full-repo": "prompt-full-repo.md"}}
    preflight_details = {
        "doctor_report": {
            "deviceId": "emulator-5554",
            "operatorPackage": "com.androperator.operator.dev",
            "nextActions": ["Run `androperator doctor`"],
        },
        "doctor_failure": {
            "code": "VERSION_INCOMPATIBLE",
            "summary": "CLI and APK versions are incompatible",
            "detail": "CLI 0.5.3 is not compatible with installed APK 0.4.1-d.",
            "evidence": {
                "cliVersion": "0.5.3",
                "apkVersion": "0.4.1-d",
            },
        },
    }

    run_dir = run_eval._write_preflight_failure_run(
        args=args,
        spec=spec,
        agent=_StubAgent(),
        failure_reason="doctor_preflight_failed",
        runtime_inputs=None,
        preflight_details=preflight_details,
    )

    result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))

    assert result["preflight"]["doctor_report"]["deviceId"] == "emulator-5554"
    assert result["preflight"]["doctor_report"]["nextActions"] == ["Run `androperator doctor`"]
    assert config["preflight"]["doctor_failure"]["evidence"]["cliVersion"] == "0.5.3"






def test_resolve_android_eval_budget_uses_spec_defaults():
    args = SimpleNamespace(timeout_s=None, max_turns=None)
    spec = {"budget": {"default_timeout_s": 600, "default_max_turns": 55}}

    timeout_s, max_turns = run_eval._resolve_android_eval_budget(args, spec)

    assert timeout_s == 600
    assert max_turns == 55


def test_resolve_android_eval_budget_prefers_cli_overrides():
    args = SimpleNamespace(timeout_s=420, max_turns=21)
    spec = {"budget": {"default_timeout_s": 600, "default_max_turns": 55}}

    timeout_s, max_turns = run_eval._resolve_android_eval_budget(args, spec)

    assert timeout_s == 420
    assert max_turns == 21


def test_resolve_android_eval_budget_ignores_non_positive_cli_overrides():
    args = SimpleNamespace(timeout_s=0, max_turns=-1)
    spec = {"budget": {"default_timeout_s": 600, "default_max_turns": 55}}

    timeout_s, max_turns = run_eval._resolve_android_eval_budget(args, spec)

    assert timeout_s == 600
    assert max_turns == 55


@pytest.mark.parametrize(
    "argv",
    [
        ["android-version", "--timeout-s", "0"],
        ["android-version", "--timeout-s", "-1"],
        ["android-version", "--max-turns", "0"],
        ["android-version", "--max-turns", "-1"],
    ],
)
def test_run_eval_rejects_non_positive_android_budgets(argv):
    with pytest.raises(SystemExit) as excinfo:
        run_eval.main(argv)

    assert excinfo.value.code == 2




def test_extract_answer_candidate_prefers_normalized_stream_output():
    raw_line = (
        '{"role":"assistant","content":[{"type":"text","text":"ANDROPERATOR_EVAL_ANSWER: 15"}]}\n'
    )
    normalized_line = "ANDROPERATOR_EVAL_ANSWER: 15\n"

    answer = runner._extract_answer_candidate(raw_line, normalized_line)

    assert answer == "15"


def test_extract_answer_candidate_handles_gemini_wrapped_marker():
    raw_line = (
        '{"type":"message","role":"assistant","content":"ANDROPERATOR_\\nEVAL_ANSWER: 15","delta":true}\n'
    )
    normalized_line = "ANDROPERATOR_\nEVAL_ANSWER: 15\n"

    answer = runner._extract_answer_candidate(raw_line, normalized_line)

    assert answer == "15"


def test_extract_answer_candidate_handles_kimi_stream_json():
    raw_line = (
        '{"role":"assistant","content":[{"type":"text","text":"ANDROPERATOR_EVAL_ANSWER: 15"}]}\n'
    )
    normalized_line = "ANDROPERATOR_EVAL_ANSWER: 15\n"

    answer = runner._extract_answer_candidate(raw_line, normalized_line)

    assert answer == "15"


def test_extract_answer_candidate_handles_codex_item_completed_json():
    raw_line = (
        '{"type":"item.completed","item":{"type":"agent_message","text":"ANDROPERATOR_EVAL_ANSWER: 15"}}\n'
    )
    normalized_line = "ANDROPERATOR_EVAL_ANSWER: 15\n"

    answer = runner._extract_answer_candidate(raw_line, normalized_line)

    assert answer == "15"
