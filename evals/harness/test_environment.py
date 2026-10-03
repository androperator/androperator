from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from evals.harness import environment
from evals.harness.runner import build_prompt


def _fake_run_factory(version: str):
    def _fake_run(cmd: list[str], env: dict[str, str], cwd: Path | None = None):
        if cmd[-1] == "devices":
            return subprocess.CompletedProcess(cmd, 0, stdout="List of devices attached\ndevice-123\tdevice\n", stderr="")
        if cmd[-3:] == ["shell", "getprop", "persist.sys.timezone"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="Australia/Brisbane\n", stderr="")
        if cmd[-3:] == ["shell", "getprop", "ro.build.version.release"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="15\n", stderr="")
        if "doctor" in cmd:
            return subprocess.CompletedProcess(cmd, 0, stdout="{}\n", stderr="")
        if cmd[-1] == "version":
            return subprocess.CompletedProcess(cmd, 0, stdout=f'{{"cliVersion":"{version}"}}\n', stderr="")
        raise AssertionError(f"unexpected command: {cmd!r}")

    return _fake_run


def _fake_which_factory(mapping: dict[str, str | None]):
    def _fake_which(name: str):
        if name in mapping:
            return mapping[name]
        if Path(name).is_absolute():
            return name
        if "/" in name:
            return name
        return f"/usr/bin/{name}"

    return _fake_which


def test_preflight_published_binary_missing(monkeypatch):
    monkeypatch.setattr(environment.shutil, "which", _fake_which_factory({"adb": "/usr/bin/adb", "androperator": None}))
    monkeypatch.setattr(environment, "_run", _fake_run_factory("0.5.2"))

    with pytest.raises(EnvironmentError, match="published_binary_not_found"):
        environment.resolve_inputs(None, runtime="published")


def test_published_runtime_forces_release_operator_package(monkeypatch):
    def fake_run(cmd: list[str], env: dict[str, str], cwd: Path | None = None):
        if cmd[-1] == "devices":
            return subprocess.CompletedProcess(cmd, 0, stdout="List of devices attached\ndevice-123\tdevice\n", stderr="")
        if cmd[-3:] == ["shell", "getprop", "persist.sys.timezone"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="Australia/Brisbane\n", stderr="")
        if cmd[-3:] == ["shell", "getprop", "ro.build.version.release"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="15\n", stderr="")
        if "doctor" in cmd:
            return subprocess.CompletedProcess(cmd, 0, stdout="{}\n", stderr="")
        if cmd[-1] == "version":
            return subprocess.CompletedProcess(cmd, 0, stdout="androperator 0.5.1\n", stderr="")
        raise AssertionError(f"unexpected command: {cmd!r}")

    monkeypatch.setattr(
        environment.shutil,
        "which",
        _fake_which_factory({"adb": "/usr/bin/adb", "androperator": "/opt/homebrew/bin/androperator"}),
    )
    monkeypatch.setattr(environment, "_run", fake_run)
    monkeypatch.setenv("ANDROPERATOR_OPERATOR_PACKAGE", "com.androperator.operator.dev")

    inputs = environment.resolve_inputs(None, runtime="published")

    assert inputs.operator_package == environment.RELEASE_OPERATOR_PACKAGE
    assert inputs.requested_operator_package == "com.androperator.operator.dev"
    assert inputs.androperator_version == "0.5.1"
    assert inputs.androperator_npm_version == "0.5.1"


def test_published_preflight_preserves_requested_operator_package(monkeypatch):
    def fake_run(cmd: list[str], env: dict[str, str], cwd: Path | None = None):
        if cmd[-1] == "devices":
            return subprocess.CompletedProcess(cmd, 0, stdout="List of devices attached\ndevice-123\tdevice\n", stderr="")
        if cmd[-3:] == ["shell", "getprop", "persist.sys.timezone"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="Australia/Brisbane\n", stderr="")
        if cmd[-3:] == ["shell", "getprop", "ro.build.version.release"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="15\n", stderr="")
        if "doctor" in cmd:
            return subprocess.CompletedProcess(cmd, 0, stdout="{}\n", stderr="")
        if cmd[-1] == "version":
            return subprocess.CompletedProcess(cmd, 0, stdout='{"cliVersion":"0.5.2"}\n', stderr="")
        raise AssertionError(f"unexpected command: {cmd!r}")

    monkeypatch.setattr(
        environment.shutil,
        "which",
        _fake_which_factory({"adb": "/usr/bin/adb", "androperator": "/opt/homebrew/bin/androperator"}),
    )
    monkeypatch.setattr(environment, "_run", fake_run)
    monkeypatch.setenv("ANDROPERATOR_OPERATOR_PACKAGE", "com.androperator.operator.dev")

    inputs = environment.resolve_inputs(None, runtime="published")
    env = environment.preflight(None, runtime="published", resolved_inputs=inputs)

    assert env.operator_package == environment.RELEASE_OPERATOR_PACKAGE
    assert env.requested_operator_package == "com.androperator.operator.dev"


def test_local_dev_explicit_operator_package_overrides_env(monkeypatch):
    monkeypatch.setattr(
        environment.shutil,
        "which",
        _fake_which_factory({"adb": "/usr/bin/adb", "node": "/usr/bin/node"}),
    )
    monkeypatch.setattr(environment, "_run", _fake_run_factory("0.5.3"))
    monkeypatch.setenv("ANDROPERATOR_OPERATOR_PACKAGE", "com.example.from-env")

    inputs = environment.resolve_inputs(
        None,
        runtime="local-dev",
        operator_package="com.androperator.operator.dev",
    )

    assert inputs.operator_package == "com.androperator.operator.dev"
    assert inputs.requested_operator_package == "com.androperator.operator.dev"


@pytest.mark.parametrize(
    ("runtime", "expected_cmd_prefix"),
    [
        ("local-dev", "node"),
        ("published", "/opt/homebrew/bin/androperator"),
    ],
)
def test_preflight_populates_androperator_npm_version(monkeypatch, tmp_path, runtime, expected_cmd_prefix):
    local_cli = tmp_path / "apps" / "node" / "dist" / "cli" / "index.js"
    local_cli.parent.mkdir(parents=True, exist_ok=True)
    local_cli.write_text("#!/usr/bin/env node\n", encoding="utf-8")
    expected_npm_version = (
        json.loads((environment.REPO_ROOT / "apps/node/package.json").read_text(encoding="utf-8"))["version"]
        if runtime == "local-dev"
        else "0.5.2"
    )

    def fake_which(name: str):
        if name == "adb":
            return "/usr/bin/adb"
        if name == "node":
            return "/usr/bin/node"
        if name == "androperator":
            return "/opt/homebrew/bin/androperator" if runtime == "published" else None
        if Path(name).is_absolute():
            return name
        if "/" in name:
            return name
        return f"/usr/bin/{name}"

    monkeypatch.setattr(environment, "LOCAL_CLI", local_cli)
    monkeypatch.setattr(environment.shutil, "which", fake_which)
    monkeypatch.setattr(environment, "_run", _fake_run_factory(expected_npm_version))

    env = environment.preflight(None, runtime=runtime)

    assert env.androperator_npm_version == expected_npm_version
    assert env.androperator_version == expected_npm_version
    assert env.androperator_cmd[0] == expected_cmd_prefix


def test_full_repo_prompt_substitutes_repo_root():
    prompt_path = Path(environment.REPO_ROOT / "evals/specs/android-version/prompt-full-repo.md")
    prompt = build_prompt(
        str(prompt_path),
        {
            "ANDROPERATOR_CMD": "androperator",
            "ANDROPERATOR_OPERATOR_PACKAGE": "com.androperator.operator",
            "DEVICE_SERIAL": "device-123",
            "DOCS_URL": "https://docs.androperator.com",
            "REPO_ROOT": str(environment.REPO_ROOT),
        },
    )

    assert "$REPO_ROOT" not in prompt
    assert str(environment.REPO_ROOT) in prompt


def test_probe_androperator_version_plain_text_fallback(monkeypatch):
    def fake_run(cmd: list[str], env: dict[str, str], cwd: Path | None = None):
        if cmd[-1] == "version":
            return subprocess.CompletedProcess(cmd, 0, stdout="androperator 0.5.4-beta.1\n", stderr="")
        raise AssertionError(f"unexpected command: {cmd!r}")

    monkeypatch.setattr(environment, "_run", fake_run)

    version = environment._probe_androperator_version(["androperator"], {"PATH": "/usr/bin", "HOME": "/tmp"})

    assert version == "0.5.4-beta.1"


def test_preflight_attaches_doctor_failure_details(monkeypatch):
    doctor_report = {
        "ok": False,
        "criticalOk": False,
        "deviceId": "emulator-5554",
        "operatorPackage": "com.androperator.operator.dev",
        "checks": [
            {
                "id": "readiness.version.compatibility",
                "status": "fail",
                "code": "VERSION_INCOMPATIBLE",
                "summary": "CLI and APK versions are incompatible",
                "detail": "Rebuild or reinstall the debug APK from the same checkout.",
                "evidence": {
                    "cliVersion": "0.5.3",
                    "apkVersion": "0.4.1-d",
                    "operatorPackage": "com.androperator.operator.dev",
                },
                "fix": {
                    "title": "Align CLI and APK versions",
                    "platform": "any",
                    "steps": [{"kind": "manual", "value": "Reinstall the debug APK"}],
                },
            }
        ],
        "nextActions": ["Reinstall the matching debug APK and rerun doctor."],
    }

    def fake_run(cmd: list[str], env: dict[str, str], cwd: Path | None = None):
        if cmd[-1] == "devices":
            return subprocess.CompletedProcess(cmd, 0, stdout="List of devices attached\nemulator-5554\tdevice\n", stderr="")
        if cmd[-3:] == ["shell", "getprop", "persist.sys.timezone"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="Australia/Brisbane\n", stderr="")
        if "doctor" in cmd:
            return subprocess.CompletedProcess(cmd, 1, stdout=json.dumps(doctor_report) + "\n", stderr="")
        if cmd[-1] == "version":
            return subprocess.CompletedProcess(cmd, 0, stdout='{"cliVersion":"0.5.3"}\n', stderr="")
        raise AssertionError(f"unexpected command: {cmd!r}")

    monkeypatch.setattr(environment.shutil, "which", _fake_which_factory({"adb": "/usr/bin/adb", "node": "/usr/bin/node"}))
    monkeypatch.setattr(environment, "_run", fake_run)

    with pytest.raises(EnvironmentError, match="doctor_preflight_failed") as exc_info:
        environment.preflight(None, runtime="local-dev")

    details = getattr(exc_info.value, "details")
    assert details["doctor_failure"]["code"] == "VERSION_INCOMPATIBLE"
    assert details["doctor_failure"]["evidence"]["cliVersion"] == "0.5.3"
    assert details["doctor_failure"]["evidence"]["apkVersion"] == "0.4.1-d"
    assert details["doctor_report"]["deviceId"] == "emulator-5554"


def test_preflight_prefers_first_fail_over_earlier_warning(monkeypatch):
    doctor_report = {
        "ok": False,
        "criticalOk": False,
        "deviceId": "emulator-5554",
        "operatorPackage": "com.androperator.operator.dev",
        "checks": [
            {
                "id": "device.warning.example",
                "status": "warn",
                "code": "DEVICE_WARNING",
                "summary": "A warning happened first",
                "detail": "This should not become the primary failure.",
            },
            {
                "id": "readiness.version.compatibility",
                "status": "fail",
                "code": "VERSION_INCOMPATIBLE",
                "summary": "CLI and APK versions are incompatible",
                "detail": "CLI 0.5.3 is not compatible with installed APK 0.4.1-d.",
                "evidence": {
                    "cliVersion": "0.5.3",
                    "apkVersion": "0.4.1-d",
                },
            },
        ],
        "nextActions": ["Reinstall the matching debug APK and rerun doctor."],
    }

    def fake_run(cmd: list[str], env: dict[str, str], cwd: Path | None = None):
        if cmd[-1] == "devices":
            return subprocess.CompletedProcess(cmd, 0, stdout="List of devices attached\nemulator-5554\tdevice\n", stderr="")
        if cmd[-3:] == ["shell", "getprop", "persist.sys.timezone"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="Australia/Brisbane\n", stderr="")
        if "doctor" in cmd:
            return subprocess.CompletedProcess(cmd, 1, stdout=json.dumps(doctor_report) + "\n", stderr="")
        if cmd[-1] == "version":
            return subprocess.CompletedProcess(cmd, 0, stdout='{"cliVersion":"0.5.3"}\n', stderr="")
        raise AssertionError(f"unexpected command: {cmd!r}")

    monkeypatch.setattr(environment.shutil, "which", _fake_which_factory({"adb": "/usr/bin/adb", "node": "/usr/bin/node"}))
    monkeypatch.setattr(environment, "_run", fake_run)

    with pytest.raises(EnvironmentError, match="doctor_preflight_failed") as exc_info:
        environment.preflight(None, runtime="local-dev")

    details = getattr(exc_info.value, "details")
    assert details["doctor_failure"]["code"] == "VERSION_INCOMPATIBLE"
    assert details["doctor_failure"]["summary"] == "CLI and APK versions are incompatible"
