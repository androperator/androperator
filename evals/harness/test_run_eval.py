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


def test_build_config_omits_redundant_skill_prompt_file(tmp_path):
    config = runner._build_config(
        run_id="run-1",
        eval_id="android-version",
        agent=_StubAgent(),
        knowledge_mode="full-repo",
        runtime_target="local-dev",
        prompt_path=tmp_path / "prompt-skill.md",
        prompt_sha256="abc123",
        work_dir=tmp_path,
        runs_dir=tmp_path / "runs",
        env=_make_stub_environment(),
        command=["stub-agent", str(tmp_path)],
        env_overrides={},
        label=None,
        timeout_s=300,
        max_turns=40,
        agent_binary_version="1.0.0",
        display_androperator_cmd=["androperator"],
        display_work_dir=str(tmp_path),
        display_cwd=str(tmp_path),
        display_runs_dir=str(tmp_path / "runs"),
        skill_prompt_path=tmp_path / "prompt-skill.md",
    )

    assert "skill_prompt_file" not in config["spec"]


def test_build_config_records_distinct_skill_prompt_file(tmp_path):
    config = runner._build_config(
        run_id="run-1",
        eval_id="android-version",
        agent=_StubAgent(),
        knowledge_mode="full-repo",
        runtime_target="local-dev",
        prompt_path=tmp_path / "prompt-full-repo.md",
        prompt_sha256="abc123",
        work_dir=tmp_path,
        runs_dir=tmp_path / "runs",
        env=_make_stub_environment(),
        command=["stub-agent", str(tmp_path)],
        env_overrides={},
        label=None,
        timeout_s=300,
        max_turns=40,
        agent_binary_version="1.0.0",
        display_androperator_cmd=["androperator"],
        display_work_dir=str(tmp_path),
        display_cwd=str(tmp_path),
        display_runs_dir=str(tmp_path / "runs"),
        skill_prompt_path=tmp_path / "prompt-skill.md",
    )

    assert config["spec"]["skill_prompt_file"] == "prompt-skill.md"


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


def test_load_replay_runtime_prefers_recorded_context():
    config = {
        "runtime_target": "local-dev",
        "environment": {
            "androperator_cmd": ["androperator"],
            "runtime_androperator_cmd": ["node", "/repo/apps/node/dist/cli/index.js"],
            "operator_package": "com.androperator.operator.dev",
        },
    }

    androperator_cmd, operator_package, runtime_target = run_eval._load_replay_runtime(config)

    assert androperator_cmd == ["node", "/repo/apps/node/dist/cli/index.js"]
    assert operator_package == "com.androperator.operator.dev"
    assert runtime_target == "local-dev"


def test_load_replay_runtime_published_can_use_display_command():
    config = {
        "runtime_target": "published",
        "environment": {
            "androperator_cmd": ["/opt/homebrew/bin/androperator"],
            "operator_package": "com.androperator.operator",
        },
    }

    androperator_cmd, operator_package, runtime_target = run_eval._load_replay_runtime(config)

    assert androperator_cmd == ["/opt/homebrew/bin/androperator"]
    assert operator_package == "com.androperator.operator"
    assert runtime_target == "published"


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


def test_replay_cli_rejects_missing_recorded_device_serial(tmp_path):
    runs_dir = tmp_path / "runs"
    run_dir = runs_dir / "android-version-20260404-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)
    (run_dir / "config.json").write_text(
        json.dumps(
            {
                "runtime_target": "published",
                "environment": {
                    "androperator_cmd": ["/opt/homebrew/bin/androperator"],
                    "operator_package": "com.androperator.operator",
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(SystemExit, match="missing environment.device_serial"):
        run_eval.main(["android-version", "--replay", run_dir.name, "--runs-dir", str(runs_dir)])


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


def _skill_payload_json() -> str:
    return (
        "{"
        '"id":"com.example.android-version",'
        '"applicationId":"com.example",'
        '"intent":"android-version",'
        '"summary":"Determine Android version",'
        '"path":"skills/com.example.android-version",'
        '"skillFile":"skills/com.example.android-version/SKILL.md",'
        '"scripts":["skills/com.example.android-version/scripts/run.js"],'
        '"artifacts":[],'
        '"scriptContents":{"skills/com.example.android-version/scripts/run.js":"console.log(\\"15\\")\\n"}'
        "}"
    )


def _valid_discovery_artifact_json(
    *,
    package_id: str = "com.android.settings",
    recommended_next_step: str = "proceed_to_recording",
    handoff_target: str | None = None,
    include_classification: bool | None = None,
    existing_skill_status: str = "none",
    runtime_command: str = "androperator skills for-app com.android.settings",
    authoring_command: str = "androperator bundled-skills list",
    registry_field: str = "commands",
) -> str:
    if handoff_target is None:
        handoff_target = {
            "use_existing_skill": "none",
            "proceed_to_recording": "androperator-skill-author-by-recording",
            "iterate_discovery": "none",
            "one_shot_direct_automation": "raw-androperator",
            "escalate_to_human": "human",
            "decline": "none",
        }[recommended_next_step]
    if include_classification is None:
        include_classification = recommended_next_step == "proceed_to_recording"
    skill_classification_line = '  "skill_classification": "shared-general",\n' if include_classification else ""
    registry_entries = json.dumps([runtime_command, authoring_command])
    return (
        "```json\n"
        "{\n"
        f'  "recommended_next_step": "{recommended_next_step}",\n'
        f'  "existing_skill_verdict": {{"status": "{existing_skill_status}", "{registry_field}": {registry_entries}}},\n'
        f'  "target_app_package": {{"app_label": "Settings", "package_id": "{package_id}", "sub_route": "About phone"}},\n'
        '  "route_confidence": {"level": "high", "evidence": ["Observed About phone route"]},\n'
        '  "mutation_risk": {"level": "read_only", "notes": "Settings inspection only"},\n'
        '  "evidence_collected": {"snapshots": ["snapshot-1"], "screenshots": [], "failed_probes": []},\n'
        '  "discovery_budget_used": {"snapshots": 1, "screenshots": 0, "elapsed_wall_time_s": 12},\n'
        f"{skill_classification_line}"
        f'  "handoff_target": "{handoff_target}",\n'
        '  "handoff_reasoning": "The route is understood enough to choose the next truthful step."\n'
        "}\n"
        "```\n"
    )


def test_attach_skill_score_records_replay_error_without_raising(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        "ANDROPERATOR_SKILL_START\n"
        + _skill_payload_json()
        + "\n"
        "ANDROPERATOR_SKILL_END\n",
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )

    def fake_run_replay(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(runner, "run_replay", fake_run_replay)

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={"skill_generation": {"replay_timeout_s": 60}},
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    saved = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    assert updated["skill_score"]["skill_emitted"] is True
    assert updated["skill_score"]["skill_valid"] is True
    assert updated["skill_score"]["replay_status"] == "error"
    assert updated["skill_score"]["replay_error"] == "boom"
    assert saved["skill_score"]["replay_status"] == "error"
    assert saved["skill_score"]["skill_emitted"] is True
    assert saved["skill_score"]["skill_valid"] is True


def test_attach_skill_score_requires_pack_a_route_evidence(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        '{"type":"item.completed","item":{"type":"command_execution","command":"androperator bundled-skills list"}}\n'
        "Discovery route: androperator-skill-author-by-agent-discovery -> androperator-skill-author-by-recording\n"
        "ANDROPERATOR_SKILL_START\n"
        + _skill_payload_json()
        + "\n"
        "ANDROPERATOR_SKILL_END\n",
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )

    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["route_requirements_met"] is False
    assert updated["skill_score"]["runtime_skill_discovery_seen"] is False
    assert updated["skill_score"]["runtime_skill_discovery_before_authoring"] is False
    assert updated["skill_score"]["bundled_skills_list_seen"] is True
    assert updated["skill_score"]["discovery_artifact_seen"] is False
    assert updated["skill_score"]["required_authoring_front_door_seen"] is False
    assert updated["skill_score"]["required_proving_handoff_seen"] is False
    assert updated["skill_score"]["skill_generation_passed"] is False
    assert updated["outcome"]["status"] == "fail"
    assert updated["outcome"]["failure_reason"] == "skill_route_not_proven"
    assert (
        updated["skill_score"]["route_requirement_errors"]
        == [
            "missing structured command evidence for runtime-skill discovery (`androperator skills for-app/search/get`)",
            "missing structured discovery artifact for required_authoring_front_door `androperator-skill-author-by-agent-discovery`",
            "missing structured discovery handoff for required_proving_handoff `androperator-skill-author-by-recording`",
        ]
    )


def test_attach_skill_score_accepts_pack_a_route_evidence(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        (
            '{"type":"item.completed","item":{"type":"command_execution","command":"node apps/node/dist/cli/index.js skills for-app com.android.settings"}}\n'
            '{"type":"item.completed","item":{"type":"command_execution","command":"node apps/node/dist/cli/index.js bundled-skills list --format json"}}\n'
            "Using androperator-skill-author-by-agent-discovery for bounded discovery\n"
            + _valid_discovery_artifact_json(
                runtime_command="node apps/node/dist/cli/index.js skills for-app com.android.settings",
                authoring_command="node apps/node/dist/cli/index.js bundled-skills list --format json",
                registry_field="queried_registry_paths",
            )
            + "ANDROPERATOR_SKILL_START\n"
            + _skill_payload_json()
            + "\n"
            + "ANDROPERATOR_SKILL_END\n"
        ),
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )

    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["bundled_skills_list_seen"] is True
    assert updated["skill_score"]["runtime_skill_discovery_seen"] is True
    assert updated["skill_score"]["runtime_skill_discovery_before_authoring"] is True
    assert updated["skill_score"]["discovery_artifact_count"] == 1
    assert updated["skill_score"]["discovery_artifact_seen"] is True
    assert updated["skill_score"]["discovery_artifact_valid"] is True
    assert updated["skill_score"]["required_authoring_front_door_seen"] is True
    assert updated["skill_score"]["required_proving_handoff_seen"] is True
    assert updated["skill_score"]["route_requirements_met"] is True
    assert updated["skill_score"]["route_requirement_errors"] == []
    assert updated["skill_score"]["skill_generation_passed"] is True
    assert updated["outcome"]["status"] == "pass"
    assert updated["outcome"]["failure_reason"] is None


def test_attach_skill_score_accepts_equivalent_registry_launchers(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        (
            '{"type":"item.completed","item":{"type":"command_execution","command":"node apps/node/dist/cli/index.js skills for-app com.android.settings"}}\n'
            '{"type":"item.completed","item":{"type":"command_execution","command":"node apps/node/dist/cli/index.js bundled-skills list --format json"}}\n'
            "Using androperator-skill-author-by-agent-discovery for bounded discovery\n"
            + _valid_discovery_artifact_json(
                runtime_command="androperator skills for-app com.android.settings",
                authoring_command="androperator bundled-skills list",
            )
            + "ANDROPERATOR_SKILL_START\n"
            + _skill_payload_json()
            + "\n"
            + "ANDROPERATOR_SKILL_END\n"
        ),
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )

    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
                "target_app_package": "com.android.settings",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["discovery_artifact_valid"] is True
    assert updated["skill_score"]["route_requirements_met"] is True
    assert updated["skill_score"]["skill_generation_passed"] is True
    assert updated["outcome"]["status"] == "pass"


def test_attach_skill_score_requires_explicit_front_door_signal(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        (
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator skills for-app com.android.settings"}}\n'
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator bundled-skills list"}}\n'
            + _valid_discovery_artifact_json()
            + "ANDROPERATOR_SKILL_START\n"
            + _skill_payload_json()
            + "\nANDROPERATOR_SKILL_END\n"
        ),
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )
    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
                "target_app_package": "com.android.settings",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["required_authoring_front_door_explicitly_seen"] is False
    assert updated["skill_score"]["required_authoring_front_door_seen"] is False
    assert updated["skill_score"]["route_requirements_met"] is False
    assert (
        "missing explicit transcript signal for required_authoring_front_door `androperator-skill-author-by-agent-discovery`"
        in updated["skill_score"]["route_requirement_errors"]
    )
    assert updated["outcome"]["status"] == "fail"


def test_attach_skill_score_rejects_copied_registry_provenance(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        (
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator skills for-app com.android.settings"}}\n'
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator bundled-skills list"}}\n'
            + _valid_discovery_artifact_json(
                runtime_command='androperator skills search --keyword "Netflix"',
                authoring_command="androperator bundled-skills list",
            )
            + "ANDROPERATOR_SKILL_START\n"
            + _skill_payload_json()
            + "\nANDROPERATOR_SKILL_END\n"
        ),
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )
    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
                "target_app_package": "com.android.settings",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["discovery_artifact_valid"] is False
    assert updated["skill_score"]["route_requirements_met"] is False
    assert (
        "discovery artifact existing_skill_verdict commands must include a runtime-skill discovery command seen in the transcript"
        in updated["skill_score"]["route_requirement_errors"]
    )
    assert updated["outcome"]["status"] == "fail"


def test_attach_skill_score_rejects_wrong_package_metadata(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        (
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator skills for-app com.android.settings"}}\n'
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator bundled-skills list"}}\n'
            + _valid_discovery_artifact_json(package_id="com.example.settings")
            + "ANDROPERATOR_SKILL_START\n"
            + _skill_payload_json()
            + "\nANDROPERATOR_SKILL_END\n"
        ),
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )
    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
                "target_app_package": "com.android.settings",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["discovery_artifact_valid"] is False
    assert updated["skill_score"]["route_requirements_met"] is False
    assert "discovery artifact target_app_package.package_id must be `com.android.settings`" in updated["skill_score"]["route_requirement_errors"]
    assert updated["outcome"]["status"] == "fail"


def test_attach_skill_score_requires_skill_classification_for_recording_handoff(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        (
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator skills for-app com.android.settings"}}\n'
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator bundled-skills list"}}\n'
            + _valid_discovery_artifact_json(include_classification=False)
            + "ANDROPERATOR_SKILL_START\n"
            + _skill_payload_json()
            + "\nANDROPERATOR_SKILL_END\n"
        ),
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )
    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
                "target_app_package": "com.android.settings",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["discovery_artifact_valid"] is False
    assert updated["skill_score"]["route_requirements_met"] is False
    assert (
        "discovery artifact skill_classification must be `shared-general` or `personalized-local` when recommended_next_step is `proceed_to_recording`"
        in updated["skill_score"]["route_requirement_errors"]
    )
    assert updated["outcome"]["status"] == "fail"


@pytest.mark.parametrize(
    ("recommended_next_step", "handoff_target", "expected_error"),
    [
        (
            "one_shot_direct_automation",
            "none",
            "discovery artifact handoff_target must be `raw-androperator` when recommended_next_step is `one_shot_direct_automation`",
        ),
        (
            "escalate_to_human",
            "none",
            "discovery artifact handoff_target must be `human` when recommended_next_step is `escalate_to_human`",
        ),
        (
            "iterate_discovery",
            "raw-androperator",
            "discovery artifact handoff_target must be `none` when recommended_next_step is `iterate_discovery`",
        ),
    ],
)
def test_attach_skill_score_rejects_wrong_handoff_for_non_recording_routes(
    monkeypatch,
    tmp_path,
    recommended_next_step,
    handoff_target,
    expected_error,
):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        (
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator skills for-app com.android.settings"}}\n'
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator bundled-skills list"}}\n'
            "Using androperator-skill-author-by-agent-discovery for bounded discovery\n"
            + _valid_discovery_artifact_json(
                recommended_next_step=recommended_next_step,
                handoff_target=handoff_target,
                include_classification=False,
            )
            + "ANDROPERATOR_SKILL_START\n"
            + _skill_payload_json()
            + "\nANDROPERATOR_SKILL_END\n"
        ),
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )
    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
                "target_app_package": "com.android.settings",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["discovery_artifact_valid"] is False
    assert updated["skill_score"]["route_requirements_met"] is False
    assert expected_error in updated["skill_score"]["route_requirement_errors"]
    assert updated["outcome"]["status"] == "fail"


def test_attach_skill_score_requires_runtime_discovery_before_authoring(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.txt").write_text(
        (
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator bundled-skills list"}}\n'
            '{"type":"item.completed","item":{"type":"command_execution","command":"androperator skills for-app com.android.settings"}}\n'
            + _valid_discovery_artifact_json()
            + "ANDROPERATOR_SKILL_START\n"
            + _skill_payload_json()
            + "\nANDROPERATOR_SKILL_END\n"
        ),
        encoding="utf-8",
    )
    result = {"run_id": "run-1", "outcome": {"status": "pass"}}
    env = SimpleNamespace(
        androperator_cmd=["node", "/repo/apps/node/dist/cli/index.js"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
    )
    monkeypatch.setattr(
        runner,
        "run_replay",
        lambda **kwargs: {
            "skill_emitted": True,
            "skill_valid": True,
            "skill_validation_errors": [],
            "replay_attempted": True,
            "replay_status": "pass",
            "replay_answer_normalized": "15",
            "replay_answer_correct": True,
            "replay_wall_clock_s": 1.25,
        },
    )

    updated = runner._attach_skill_score(
        run_dir=run_dir,
        result=result,
        spec={
            "skill_generation": {
                "replay_timeout_s": 60,
                "required_authoring_front_door": "androperator-skill-author-by-agent-discovery",
                "required_proving_handoff": "androperator-skill-author-by-recording",
                "target_app_package": "com.android.settings",
            }
        },
        skill_prompt_name="prompt-skill.md",
        env=env,
    )

    assert updated["skill_score"]["runtime_skill_discovery_seen"] is True
    assert updated["skill_score"]["runtime_skill_discovery_before_authoring"] is False
    assert updated["skill_score"]["route_requirements_met"] is False
    assert "runtime-skill discovery must appear before `androperator bundled-skills list`" in updated["skill_score"]["route_requirement_errors"]
    assert updated["outcome"]["status"] == "fail"
