from __future__ import annotations

import json
import subprocess
from pathlib import Path

from evals.harness import live_skill_eval


def test_choose_target_requires_observed_value():
    target, note = live_skill_eval._choose_target(None, (35, 40, 45))

    assert target is None
    assert "unavailable" in note


def test_choose_target_picks_first_distinct_candidate():
    target, note = live_skill_eval._choose_target(40, (35, 40, 45))

    assert target == 35
    assert "differed" in note


def test_classify_run_accepts_only_cold_start_verified_success():
    result_payload = {
        "skillResult": {
            "status": "success",
            "terminalVerification": {
                "status": "verified",
                "observed": {"text": "Discharge to 45% \ue660"},
            },
        }
    }

    classified = live_skill_eval._classify_run(
        normalization_before_probe={"app_restart_proven": True},
        normalization_before_skill={"outside_app_proven": True},
        observed_percent=40,
        target_percent=45,
        result_payload=result_payload,
        skill_capture=None,
    )

    assert classified["classification"] == "cold_start_verified"
    assert classified["proof_mode"] == "cold-start"
    assert classified["passed"] is True


def test_classify_run_requires_restart_proof_for_cold_start_pass():
    result_payload = {
        "skillResult": {
            "status": "success",
            "terminalVerification": {
                "status": "verified",
                "observed": {"text": "Discharge to 45% \ue660"},
            },
        }
    }

    classified = live_skill_eval._classify_run(
        normalization_before_probe={"app_restart_proven": False},
        normalization_before_skill={"outside_app_proven": True},
        observed_percent=40,
        target_percent=45,
        result_payload=result_payload,
        skill_capture=None,
    )

    assert classified["classification"] == "run_start_not_proven"
    assert classified["proof_mode"] == "unproven"
    assert classified["passed"] is False


def test_classify_run_marks_outside_app_proof_failure():
    result_payload = {
        "skillResult": {
            "status": "success",
            "terminalVerification": {
                "status": "verified",
                "observed": {"text": "Discharge to 35%"},
            },
        }
    }

    classified = live_skill_eval._classify_run(
        normalization_before_probe={"app_restart_proven": True},
        normalization_before_skill={"outside_app_proven": False},
        observed_percent=40,
        target_percent=35,
        result_payload=result_payload,
        skill_capture=None,
    )

    assert classified["classification"] == "outside_app_not_proven"
    assert classified["proof_mode"] == "unproven"
    assert classified["passed"] is False


def test_classify_run_marks_skill_timeout():
    classified = live_skill_eval._classify_run(
        normalization_before_probe={"app_restart_proven": True},
        normalization_before_skill={"outside_app_proven": True},
        observed_percent=40,
        target_percent=35,
        result_payload=None,
        skill_capture=live_skill_eval.CommandCapture(
            name="skill-run",
            command=["androperator", "skills", "run"],
            returncode=124,
            timed_out=True,
            stdout_path="run-01/commands/skill-run.stdout.txt",
            stderr_path="run-01/commands/skill-run.stderr.txt",
            parsed_json_path=None,
            started_at="2026-04-13T09:23:08+10:00",
            finished_at="2026-04-13T09:26:08+10:00",
        ),
    )

    assert classified["classification"] == "skill_timed_out"
    assert classified["proof_mode"] == "unproven"
    assert classified["run_start_restarted"] is True


def test_render_summary_markdown_lists_runs():
    summary = {
        "eval_id": live_skill_eval.SOLAX_COLD_START_EVAL_ID,
        "batch_id": "batch-1",
        "device_serial": "device-123",
        "operator_package": "com.androperator.operator.dev",
        "skills_registry": "/tmp/skills-registry.json",
        "runs_requested": 2,
        "aggregate_status": "failed",
        "counts": {
            "cold_start_verified": 1,
            "run_start_not_proven": 0,
            "outside_app_not_proven": 1,
            "observed_value_unavailable": 0,
            "target_selection_failed": 0,
            "skill_timed_out": 0,
            "verification_mismatch": 0,
            "skill_failed": 0,
            "skill_indeterminate": 0,
            "skill_result_missing": 0,
            "result_parse_failed": 1,
        },
        "runs": [
            {
                "run_name": "run-01",
                "observed_percent": 40,
                "target_percent": 45,
                "classification": "cold_start_verified",
                "proof_mode": "cold-start",
                "passed": True,
            },
            {
                "run_name": "run-02",
                "observed_percent": 45,
                "target_percent": 35,
                "classification": "outside_app_not_proven",
                "proof_mode": "unproven",
                "passed": False,
            },
        ],
    }

    rendered = live_skill_eval._render_summary_markdown(summary)

    assert "run-01" in rendered
    assert "outside_app_not_proven" in rendered
    assert "cold_start_verified" in rendered
    assert "Result-parse failures: `1`" in rendered


def test_sanitize_json_value_redacts_device_and_repo_paths(tmp_path):
    skills_registry = tmp_path / "local skill workspace" / "skills" / "skills-registry.json"
    skills_registry.parent.mkdir(parents=True)
    replacements = live_skill_eval._artifact_replacements("device-123", skills_registry)
    payload = {
        "device": "device-123",
        "registry": str(skills_registry),
        "repo": str(live_skill_eval.REPO_ROOT),
    }

    sanitized = live_skill_eval._sanitize_json_value(payload, replacements)

    assert sanitized["device"] == "<device_serial>"
    assert sanitized["registry"] == "/<local_user>/src/local skill workspace/skills/skills-registry.json"
    assert sanitized["repo"] == "/<local_user>/src/androperator"


def test_artifact_replacements_skip_root_like_skills_repo_prefix(tmp_path):
    skills_registry = tmp_path / "skills-registry.json"
    skills_registry.write_text("{}\n", encoding="utf-8")

    replacements = live_skill_eval._artifact_replacements("device-123", skills_registry)
    payload = {
        "registry": str(skills_registry),
        "other_path": "/tmp/example/path.json",
    }

    sanitized = live_skill_eval._sanitize_json_value(payload, replacements)

    assert sanitized["registry"] == "/<local_user>/src/local skill workspace/skills/skills-registry.json"
    assert sanitized["other_path"] == "/tmp/example/path.json"


def test_androperator_env_forwards_skill_debugging_overrides(monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin")
    monkeypatch.setenv("HOME", "/tmp/home")
    monkeypatch.setenv("ANDROPERATOR_SKILL_RETAIN_LOGS", "1")
    monkeypatch.setenv("ANDROPERATOR_SKILL_LOG_DIR", "/tmp/skill-logs")
    monkeypatch.setenv("ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS", "120000")

    env = live_skill_eval._androperator_env()

    assert env["ANDROPERATOR_SKILL_RETAIN_LOGS"] == "1"
    assert env["ANDROPERATOR_SKILL_LOG_DIR"] == "/tmp/skill-logs"
    assert env["ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS"] == "120000"


def test_run_and_capture_records_timeout(tmp_path, monkeypatch):
    def fake_run(*args, **kwargs):
        exc = subprocess.TimeoutExpired(
            cmd=["androperator", "skills", "run"],
            timeout=kwargs["timeout"],
            output='{"partial":true}\n',
            stderr="still waiting",
        )
        exc.stdout = exc.output
        raise exc

    monkeypatch.setattr(live_skill_eval.subprocess, "run", fake_run)

    capture, payload, stdout, stderr = live_skill_eval._run_and_capture(
        command=["androperator", "skills", "run"],
        run_dir=tmp_path,
        name="skill-run",
        env={"PATH": "/usr/bin", "HOME": "/tmp"},
        parse_json=True,
        replacements=[],
        cwd=Path("/tmp"),
        timeout_s=180,
    )

    assert capture.returncode == 124
    assert capture.timed_out is True
    assert payload == {"partial": True}
    assert stdout == '{"partial":true}\n'
    assert "timed out after 180s" in stderr


def test_normalization_sequence_uses_bounded_timeout(tmp_path, monkeypatch):
    calls: list[int | None] = []
    (tmp_path / "commands").mkdir()

    def fake_run_and_capture(**kwargs):
        calls.append(kwargs.get("timeout_s"))
        return (
            live_skill_eval.CommandCapture(
                name=kwargs["name"],
                command=kwargs["command"],
                returncode=0,
                timed_out=False,
                stdout_path="stdout.txt",
                stderr_path="stderr.txt",
                parsed_json_path="parsed.json",
                started_at="2026-04-13T09:23:08+10:00",
                finished_at="2026-04-13T09:23:09+10:00",
            ),
            {},
            "{}",
            "",
        )

    monkeypatch.setattr(live_skill_eval, "_run_and_capture", fake_run_and_capture)
    monkeypatch.setattr(live_skill_eval, "_foreground_package", lambda device_serial: ("com.android.launcher", "line", "raw"))

    result = live_skill_eval._normalization_sequence(
        run_dir=tmp_path,
        androperator_cmd=["androperator"],
        device_serial="device-123",
        operator_package="com.androperator.operator.dev",
        stage_prefix="before-probe",
        replacements=[],
    )

    assert result["app_restart_proven"] is True
    assert calls == [live_skill_eval.NORMALIZATION_TIMEOUT_S, live_skill_eval.NORMALIZATION_TIMEOUT_S]


def test_probe_observed_value_uses_bounded_timeout(tmp_path, monkeypatch):
    calls: list[int | None] = []

    def fake_run_and_capture(**kwargs):
        calls.append(kwargs.get("timeout_s"))
        payload = {
            "envelope": {
                "stepResults": [
                    {"data": {"text": "Discharge to 40% \ue660"}},
                ]
            }
        }
        return (
            live_skill_eval.CommandCapture(
                name=kwargs["name"],
                command=kwargs["command"],
                returncode=0,
                timed_out=False,
                stdout_path="stdout.txt",
                stderr_path="stderr.txt",
                parsed_json_path="parsed.json",
                started_at="2026-04-13T09:23:08+10:00",
                finished_at="2026-04-13T09:23:09+10:00",
            ),
            payload,
            "{}",
            "",
        )

    monkeypatch.setattr(live_skill_eval, "_run_and_capture", fake_run_and_capture)

    result = live_skill_eval._probe_observed_value(
        run_dir=tmp_path,
        androperator_cmd=["androperator"],
        device_serial="device-123",
        operator_package="com.androperator.operator.dev",
        stage_prefix="probe",
        replacements=[],
    )

    assert result["observed_percent"] == 40
    assert calls == [live_skill_eval.PROBE_STEP_TIMEOUT_S, live_skill_eval.PROBE_STEP_TIMEOUT_S, live_skill_eval.PROBE_STEP_TIMEOUT_S]


def test_run_eval_dispatches_solax_eval(monkeypatch, tmp_path):
    registry = tmp_path / "skills-registry.json"
    registry.write_text("{}\n", encoding="utf-8")
    batch_dir = tmp_path / "artifacts" / "batch-1"
    batch_dir.mkdir(parents=True)
    (batch_dir / "summary.json").write_text(
        json.dumps(
            {
                "aggregate_status": "passed",
                "counts": {"cold_start_verified": 2},
                "runs_requested": 2,
            }
        ),
        encoding="utf-8",
    )

    calls: dict[str, object] = {}

    def fake_run_solax(**kwargs):
        calls.update(kwargs)
        return batch_dir

    from evals import run_eval

    monkeypatch.setattr(run_eval, "run_solax_orchestrated_cold_start_eval", fake_run_solax)

    exit_code = run_eval.main(
        [
            live_skill_eval.SOLAX_COLD_START_EVAL_ID,
            "--device",
            "device-123",
            "--operator-package",
            "com.androperator.operator.dev",
            "--runs",
            "2",
            "--skills-registry",
            str(registry),
            "--artifacts-dir",
            str(tmp_path / "artifacts"),
        ]
    )

    assert exit_code == 0
    assert calls["device_serial"] == "device-123"
    assert calls["runs"] == 2
    assert calls["runtime"] == "local-dev"
    assert calls["operator_package"] == "com.androperator.operator.dev"


def test_run_eval_rejects_operator_package_for_android_version():
    from evals import run_eval

    try:
        run_eval.main(
            [
                "android-version",
                "--operator-package",
                "com.androperator.operator.dev",
            ]
        )
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("expected parser failure")


def test_run_eval_rejects_solax_only_flags_for_android_version():
    from evals import run_eval

    for flag, value in [
        ("--artifacts-dir", str(Path(run_eval.ROOT / "evals" / "artifacts"))),
        ("--skills-registry", str(run_eval.DEFAULT_SKILLS_REGISTRY)),
        ("--runs", "2"),
    ]:
        try:
            run_eval.main(["android-version", flag, value])
        except SystemExit as exc:
            assert exc.code == 2
        else:
            raise AssertionError(f"expected parser failure for {flag}")


def test_run_eval_rejects_android_version_flags_for_solax_eval():
    from evals import run_eval

    invalid_argvs = [
        [live_skill_eval.SOLAX_COLD_START_EVAL_ID, "--agent", "claude"],
        [live_skill_eval.SOLAX_COLD_START_EVAL_ID, "--model", "claude-haiku-4-5"],
        [live_skill_eval.SOLAX_COLD_START_EVAL_ID, "--skill-prompt", "prompt-skill.md"],
        [live_skill_eval.SOLAX_COLD_START_EVAL_ID, "--replay", "run-123"],
        [live_skill_eval.SOLAX_COLD_START_EVAL_ID, "--rescore", "run-123"],
        [live_skill_eval.SOLAX_COLD_START_EVAL_ID, "--timeout-s", "120"],
        [live_skill_eval.SOLAX_COLD_START_EVAL_ID, "--max-turns", "12"],
        [live_skill_eval.SOLAX_COLD_START_EVAL_ID, "--runs-dir", "/tmp/runs"],
    ]

    for argv in invalid_argvs:
        try:
            run_eval.main(argv)
        except SystemExit as exc:
            assert exc.code == 2
        else:
            raise AssertionError(f"expected parser failure for argv={argv!r}")
