from __future__ import annotations

import json
import subprocess
from pathlib import Path

from evals.harness.replay import _build_replay_env, _extract_skill_output, _materialize_skill_package, run_replay


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _write_basic_run(tmp_path: Path, transcript: str) -> Path:
    run_dir = tmp_path / "runs" / "android-version-20260405-000000-aaaaaa-claude-claude-sonnet"
    run_dir.mkdir(parents=True)
    _write_json(
        run_dir / "config.json",
        {
            "eval_id": "android-version",
            "environment": {
                "device_serial": "device-123",
                "ground_truth_android_version": "15",
                "operator_package": "com.androperator.operator.dev",
            },
        },
    )
    _write_json(
        run_dir / "result.json",
        {
            "run_id": run_dir.name,
            "environment": {
                "device_serial": "device-123",
                "ground_truth_android_version": "15",
            },
        },
    )
    (run_dir / "transcript.txt").write_text(transcript, encoding="utf-8")
    return run_dir


def test_run_replay_skips_when_no_skill_emitted(tmp_path):
    run_dir = _write_basic_run(tmp_path, "ANDROPERATOR_EVAL_ANSWER: 15\n")

    skill_score = run_replay(
        run_dir=run_dir,
        androperator_cmd=["androperator"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
        timeout_s=1,
    )

    assert skill_score["skill_emitted"] is False
    assert skill_score["replay_status"] == "skipped"
    assert skill_score["replay_attempted"] is False


def test_run_replay_passes_with_materialized_skill(monkeypatch, tmp_path):
    transcript = (
        "before\n"
        "ANDROPERATOR_SKILL_START\n"
        "{"
        "\"id\":\"com.example.android-version\","
        "\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\","
        "\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"artifacts\":[],"
        "\"skillMarkdown\":\"# Generated skill\\n\","
        "\"scriptContents\":{"
        "\"skills/com.example.android-version/scripts/run.js\":\"console.log('ANDROPERATOR_EVAL_ANSWER: 15')\\n\""
        "}"
        "}"
        "\nANDROPERATOR_SKILL_END\n"
        "after\n"
    )
    run_dir = _write_basic_run(tmp_path, transcript)

    def fake_run(cmd, check, capture_output, text, env, timeout, cwd):
        assert cmd[:3] == ["androperator", "skills", "run"]
        assert "--output" not in cmd
        assert "--json" not in cmd
        assert "SECRET_TOKEN" not in env
        assert env["ANDROPERATOR_SKILLS_DIR"].endswith("skills")
        payload = {
            "skillId": "com.example.android-version",
            "output": "ANDROPERATOR_EVAL_ANSWER: 15\n",
            "exitCode": 0,
            "durationMs": 12,
        }
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("evals.harness.replay.subprocess.run", fake_run)

    skill_score = run_replay(
        run_dir=run_dir,
        androperator_cmd=["androperator"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
        timeout_s=1,
    )

    assert skill_score["skill_emitted"] is True
    assert skill_score["skill_valid"] is True
    assert skill_score["replay_attempted"] is True
    assert skill_score["replay_status"] == "pass"
    assert skill_score["replay_answer_normalized"] == "15"
    assert skill_score["replay_answer_correct"] is True


def test_run_replay_prefers_post_run_artifact_answer(monkeypatch, tmp_path):
    transcript = (
        "before\n"
        "ANDROPERATOR_SKILL_START\n"
        "{"
        "\"id\":\"com.example.android-version\","
        "\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\","
        "\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"artifacts\":[\"skills/com.example.android-version/android-version.txt\"],"
        "\"skillMarkdown\":\"# Generated skill\\n\","
        "\"scriptContents\":{"
        "\"skills/com.example.android-version/scripts/run.js\":\"console.log('ANDROPERATOR_EVAL_ANSWER: 15')\\n\""
        "},"
        "\"artifactContents\":{"
        "\"skills/com.example.android-version/android-version.txt\":\"15\""
        "}"
        "}"
        "\nANDROPERATOR_SKILL_END\n"
        "after\n"
    )
    run_dir = _write_basic_run(tmp_path, transcript)

    def fake_run(cmd, check, capture_output, text, env, timeout, cwd):
        artifact_path = Path(cwd) / "skills/com.example.android-version/android-version.txt"
        artifact_path.write_text("15", encoding="utf-8")
        payload = {
            "skillId": "com.example.android-version",
            "output": "ANDROPERATOR_EVAL_ANSWER: 5\n",
            "exitCode": 0,
            "durationMs": 12,
        }
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("evals.harness.replay.subprocess.run", fake_run)

    skill_score = run_replay(
        run_dir=run_dir,
        androperator_cmd=["androperator"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
        timeout_s=1,
    )

    assert skill_score["replay_status"] == "pass"
    assert skill_score["replay_answer_normalized"] == "15"
    assert skill_score["replay_answer_correct"] is True


def test_run_replay_does_not_pass_from_seeded_artifact_when_skill_fails(monkeypatch, tmp_path):
    transcript = (
        "before\n"
        "ANDROPERATOR_SKILL_START\n"
        "{"
        "\"id\":\"com.example.android-version\","
        "\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\","
        "\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"artifacts\":[\"skills/com.example.android-version/android-version.txt\"],"
        "\"skillMarkdown\":\"# Generated skill\\n\","
        "\"scriptContents\":{"
        "\"skills/com.example.android-version/scripts/run.js\":\"process.exit(1)\\n\""
        "},"
        "\"artifactContents\":{"
        "\"skills/com.example.android-version/android-version.txt\":\"15\""
        "}"
        "}"
        "\nANDROPERATOR_SKILL_END\n"
        "after\n"
    )
    run_dir = _write_basic_run(tmp_path, transcript)

    def fake_run(cmd, check, capture_output, text, env, timeout, cwd):
        payload = {
            "skillId": "com.example.android-version",
            "output": "",
            "exitCode": 1,
            "durationMs": 12,
        }
        return subprocess.CompletedProcess(cmd, 1, stdout=json.dumps(payload), stderr="skill failed")

    monkeypatch.setattr("evals.harness.replay.subprocess.run", fake_run)

    skill_score = run_replay(
        run_dir=run_dir,
        androperator_cmd=["androperator"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
        timeout_s=1,
    )

    assert skill_score["replay_status"] == "error"
    assert skill_score["replay_answer_normalized"] is None
    assert skill_score["replay_answer_correct"] is False


def test_run_replay_clears_answer_fields_when_process_exits_non_zero(monkeypatch, tmp_path):
    transcript = (
        "before\n"
        "ANDROPERATOR_SKILL_START\n"
        "{"
        "\"id\":\"com.example.android-version\","
        "\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\","
        "\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"artifacts\":[],"
        "\"skillMarkdown\":\"# Generated skill\\n\","
        "\"scriptContents\":{"
        "\"skills/com.example.android-version/scripts/run.js\":\"console.log('ANDROPERATOR_EVAL_ANSWER: 15'); process.exit(1)\\n\""
        "}"
        "}"
        "\nANDROPERATOR_SKILL_END\n"
        "after\n"
    )
    run_dir = _write_basic_run(tmp_path, transcript)

    def fake_run(cmd, check, capture_output, text, env, timeout, cwd):
        payload = {
            "skillId": "com.example.android-version",
            "output": "ANDROPERATOR_EVAL_ANSWER: 15\n",
            "exitCode": 1,
            "durationMs": 12,
        }
        return subprocess.CompletedProcess(cmd, 1, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("evals.harness.replay.subprocess.run", fake_run)

    skill_score = run_replay(
        run_dir=run_dir,
        androperator_cmd=["androperator"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
        timeout_s=1,
    )

    assert skill_score["replay_status"] == "error"
    assert skill_score["replay_answer_normalized"] is None
    assert skill_score["replay_answer_correct"] is False


def test_run_replay_skips_binary_artifact_and_falls_back_to_stdout(monkeypatch, tmp_path):
    transcript = (
        "before\n"
        "ANDROPERATOR_SKILL_START\n"
        "{"
        "\"id\":\"com.example.android-version\","
        "\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\","
        "\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"artifacts\":[\"skills/com.example.android-version/output.bin\"],"
        "\"skillMarkdown\":\"# Generated skill\\n\","
        "\"scriptContents\":{"
        "\"skills/com.example.android-version/scripts/run.js\":\"console.log('ANDROPERATOR_EVAL_ANSWER: 15')\\n\""
        "},"
        "\"artifactContents\":{"
        "\"skills/com.example.android-version/output.bin\":\"seed\""
        "}"
        "}"
        "\nANDROPERATOR_SKILL_END\n"
        "after\n"
    )
    run_dir = _write_basic_run(tmp_path, transcript)

    def fake_run(cmd, check, capture_output, text, env, timeout, cwd):
        artifact_path = Path(cwd) / "skills/com.example.android-version/output.bin"
        artifact_path.write_bytes(b"\x89PNG\r\n\x1a\n")
        payload = {
            "skillId": "com.example.android-version",
            "output": "ANDROPERATOR_EVAL_ANSWER: 15\n",
            "exitCode": 0,
            "durationMs": 12,
        }
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("evals.harness.replay.subprocess.run", fake_run)

    skill_score = run_replay(
        run_dir=run_dir,
        androperator_cmd=["androperator"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
        timeout_s=1,
    )

    assert skill_score["replay_status"] == "pass"
    assert skill_score["replay_answer_normalized"] == "15"


def test_extract_skill_output_parses_single_line_json_before_fallback():
    output = json.dumps(
        {
            "durationMs": 999,
            "exitCode": 7,
            "output": "ANDROPERATOR_EVAL_ANSWER: 15\n",
        }
    )

    assert _extract_skill_output(output) == "15"


def test_extract_skill_output_rejects_arbitrary_single_line_text():
    output = json.dumps(
        {
            "message": "completed successfully",
            "durationMs": 999,
        }
    )

    assert _extract_skill_output(output) is None


def test_build_replay_env_sets_androperator_bin_for_absolute_binary(tmp_path):
    registry_path = tmp_path / "skills" / "skills-registry.json"
    env = _build_replay_env(registry_path, ["/opt/homebrew/bin/androperator"])

    assert env["ANDROPERATOR_BIN"] == "/opt/homebrew/bin/androperator"


def test_build_replay_env_sets_androperator_bin_for_multipart_command(tmp_path):
    registry_path = tmp_path / "skills" / "skills-registry.json"
    env = _build_replay_env(
        registry_path,
        ["node", "/repo/apps/node/dist/cli/index.js"],
    )

    wrapper_path = Path(env["ANDROPERATOR_BIN"])
    assert wrapper_path == registry_path.parent / ".androperator-bin-replay-wrapper.sh"
    assert wrapper_path.read_text(encoding="utf-8") == (
        "#!/bin/sh\n"
        "exec node /repo/apps/node/dist/cli/index.js \"$@\"\n"
    )
    assert wrapper_path.stat().st_mode & 0o111


def test_materialize_skill_package_writes_skill_json_with_registry_shape_only(tmp_path):
    skill = {
        "id": "com.example.android-version",
        "applicationId": "com.example",
        "intent": "android-version",
        "summary": "Determine Android version",
        "path": "skills/com.example.android-version",
        "skillFile": "skills/com.example.android-version/SKILL.md",
        "scripts": ["skills/com.example.android-version/scripts/run.js"],
        "artifacts": [],
        "skillMarkdown": "# Generated skill\n",
        "scriptContents": {
            "skills/com.example.android-version/scripts/run.js": "console.log('hi')\n"
        },
    }

    _materialize_skill_package(skill, tmp_path)

    skill_json = json.loads((tmp_path / "skills/com.example.android-version/skill.json").read_text(encoding="utf-8"))
    assert "scriptContents" not in skill_json
    assert "skillMarkdown" not in skill_json
    assert skill_json["id"] == "com.example.android-version"


def test_run_replay_rejects_path_traversal_in_skill_materialization(tmp_path):
    transcript = (
        "before\n"
        "ANDROPERATOR_SKILL_START\n"
        "{"
        "\"id\":\"com.example.android-version\","
        "\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\","
        "\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"../escape/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"artifacts\":[],"
        "\"skillMarkdown\":\"# Generated skill\\n\","
        "\"scriptContents\":{"
        "\"skills/com.example.android-version/scripts/run.js\":\"console.log('ANDROPERATOR_EVAL_ANSWER: 15')\\n\""
        "}"
        "}"
        "\nANDROPERATOR_SKILL_END\n"
        "after\n"
    )
    run_dir = _write_basic_run(tmp_path, transcript)

    skill_score = run_replay(
        run_dir=run_dir,
        androperator_cmd=["androperator"],
        operator_package="com.androperator.operator.dev",
        device_serial="device-123",
        timeout_s=1,
    )

    assert skill_score["skill_emitted"] is True
    assert skill_score["skill_valid"] is False
    assert "unsafe path field: skillFile" in skill_score["skill_validation_errors"]
    assert skill_score["replay_attempted"] is False
    assert skill_score["replay_status"] == "skipped"
