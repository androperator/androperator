from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .timeutil import format_timestamp

REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_CLI = REPO_ROOT / "apps/node/dist/cli/index.js"
RELEASE_OPERATOR_PACKAGE = "com.androperator.operator"
LOCAL_DEV_OPERATOR_PACKAGE = "com.androperator.operator.dev"


@dataclass
class Environment:
    device_serial: str
    device_timezone: str | None
    ground_truth_android_version: str
    ground_truth_collected_at: str
    androperator_cmd: list[str]
    androperator_version: str
    androperator_npm_version: str
    operator_package: str
    requested_operator_package: str | None


@dataclass
class RuntimeInputs:
    device_serial: str
    device_timezone: str | None
    androperator_cmd: list[str]
    operator_package: str
    requested_operator_package: str | None
    androperator_version: str
    androperator_npm_version: str


def _raise_environment_error(code: str, *, details: dict[str, Any] | None = None) -> None:
    error = EnvironmentError(code)
    if details is not None:
        setattr(error, "details", details)
    raise error


def _minimal_env(device_serial: str | None = None, operator_package: str | None = None) -> dict[str, str]:
    env = {
        "PATH": os.environ["PATH"],
        "HOME": os.environ["HOME"],
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
    }
    if device_serial is not None:
        env["ANDROID_SERIAL"] = device_serial
    if operator_package is not None:
        env["ANDROPERATOR_OPERATOR_PACKAGE"] = operator_package
    return env


def _parse_authorized_devices(adb_output: str) -> list[str]:
    devices: list[str] = []
    for line in adb_output.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("List of devices attached"):
            continue
        parts = stripped.split()
        if len(parts) >= 2 and parts[1] == "device":
            devices.append(parts[0])
    return devices


def _resolve_androperator_cmd(runtime: str) -> list[str]:
    if runtime == "published":
        global_bin = shutil.which("androperator")
        if global_bin is None:
            raise EnvironmentError("published_binary_not_found")
        return [global_bin]
    explicit = os.environ.get("ANDROPERATOR_BIN")
    if explicit is not None and explicit.strip():
        return [explicit]
    if LOCAL_CLI.exists():
        return ["node", str(LOCAL_CLI)]
    global_bin = shutil.which("androperator")
    if global_bin is not None:
        return ["androperator"]
    raise EnvironmentError(
        "androperator binary not found: checked ANDROPERATOR_BIN, "
        f"{LOCAL_CLI}, and shutil.which('androperator')"
    )


def _read_local_npm_version() -> str:
    package_json = REPO_ROOT / "apps/node/package.json"
    try:
        payload = json.loads(package_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EnvironmentError("androperator_npm_version_unreadable") from exc
    version = payload.get("version")
    if not isinstance(version, str) or not version.strip():
        raise EnvironmentError("androperator_npm_version_invalid")
    return version.strip()


def _probe_androperator_version(androperator_cmd: list[str], env: dict[str, str]) -> str:
    cli_version_result = _run([*androperator_cmd, "version"], env=env)
    if cli_version_result.returncode != 0:
        raise EnvironmentError("androperator_version_unreadable")
    raw_output = cli_version_result.stdout.strip()
    try:
        version_payload = json.loads(raw_output or "{}")
    except json.JSONDecodeError as exc:
        version_payload = None
    if isinstance(version_payload, dict):
        cli_version = version_payload.get("cliVersion")
        if isinstance(cli_version, str) and cli_version.strip():
            return cli_version.strip()
    text_match = re.search(r"\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b", raw_output)
    if text_match is not None:
        return text_match.group(0)
    raise EnvironmentError("androperator_version_invalid")


def _run(cmd: list[str], env: dict[str, str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=False, capture_output=True, text=True, env=env, cwd=str(cwd) if cwd else None)


def _failed_doctor_checks(report: dict[str, Any]) -> list[dict[str, Any]]:
    checks = report.get("checks")
    if not isinstance(checks, list):
        return []
    failed: list[dict[str, Any]] = []
    for check in checks:
        if not isinstance(check, dict):
            continue
        status = check.get("status")
        if status in {"fail", "warn"}:
            failed.append(check)
    return failed


def _primary_doctor_failure_check(failed_checks: list[dict[str, Any]]) -> dict[str, Any] | None:
    for check in failed_checks:
        if check.get("status") == "fail":
            return check
    return failed_checks[0] if failed_checks else None


def _summarize_doctor_failure(report: dict[str, Any]) -> dict[str, Any]:
    failed_checks = _failed_doctor_checks(report)
    primary_check = _primary_doctor_failure_check(failed_checks)
    summary: dict[str, Any] = {
        "device_id": report.get("deviceId"),
        "operator_package": report.get("operatorPackage"),
        "critical_ok": report.get("criticalOk"),
        "failed_checks": failed_checks,
        "next_actions": report.get("nextActions", []),
    }
    if isinstance(primary_check, dict):
        summary["code"] = primary_check.get("code")
        summary["summary"] = primary_check.get("summary")
        summary["detail"] = primary_check.get("detail")
        summary["evidence"] = primary_check.get("evidence", {})
        if "fix" in primary_check:
            summary["fix"] = primary_check.get("fix")
        if "deviceGuidance" in primary_check:
            summary["device_guidance"] = primary_check.get("deviceGuidance")
    return summary


def _doctor_failure_details(stdout: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    return {
        "doctor_report": payload,
        "doctor_failure": _summarize_doctor_failure(payload),
    }


def _resolve_device_timezone(adb: str, device_serial: str) -> str | None:
    result = _run([adb, "-s", device_serial, "shell", "getprop", "persist.sys.timezone"], env=_minimal_env(device_serial=device_serial))
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    return value or None


def resolve_inputs(
    device: str | None,
    runtime: str = "local-dev",
    operator_package: str | None = None,
) -> RuntimeInputs:
    adb = shutil.which("adb")
    if adb is None:
        raise EnvironmentError("adb_not_found")

    adb_env = _minimal_env()
    devices_result = _run([adb, "devices"], env=adb_env)
    if devices_result.returncode != 0:
        raise EnvironmentError("adb_devices_failed")
    authorized = _parse_authorized_devices(devices_result.stdout)
    if device is not None:
        if device not in authorized:
            if not authorized:
                raise EnvironmentError("no_device")
            raise EnvironmentError("device_not_found")
        device_serial = device
    else:
        if len(authorized) == 0:
            raise EnvironmentError("no_device")
        if len(authorized) > 1:
            raise EnvironmentError("multiple_devices")
        device_serial = authorized[0]

    device_timezone = _resolve_device_timezone(adb, device_serial)
    androperator_cmd = _resolve_androperator_cmd(runtime)
    androperator_bin = Path(androperator_cmd[0])
    if shutil.which(androperator_cmd[0]) is None and not (androperator_bin.is_file() and os.access(androperator_bin, os.X_OK)):
        raise EnvironmentError("androperator_binary_not_found")

    env_operator_package = os.environ.get("ANDROPERATOR_OPERATOR_PACKAGE")
    requested_operator_package = (
        operator_package.strip()
        if operator_package is not None and operator_package.strip()
        else (env_operator_package.strip() if env_operator_package is not None and env_operator_package.strip() else None)
    )
    if runtime == "published":
        operator_package = RELEASE_OPERATOR_PACKAGE
    elif requested_operator_package is None:
        operator_package = LOCAL_DEV_OPERATOR_PACKAGE
    else:
        operator_package = requested_operator_package

    doctor_env = _minimal_env(device_serial=device_serial, operator_package=operator_package)
    cli_version = _probe_androperator_version(androperator_cmd, doctor_env)
    npm_version = cli_version if runtime == "published" else _read_local_npm_version()

    return RuntimeInputs(
        device_serial=device_serial,
        device_timezone=device_timezone,
        androperator_cmd=androperator_cmd,
        operator_package=operator_package,
        requested_operator_package=requested_operator_package,
        androperator_version=cli_version,
        androperator_npm_version=npm_version,
    )


def preflight(
    device: str | None,
    runtime: str = "local-dev",
    resolved_inputs: RuntimeInputs | None = None,
    operator_package: str | None = None,
) -> Environment:
    inputs = resolved_inputs if resolved_inputs is not None else resolve_inputs(device, runtime, operator_package)
    adb = shutil.which("adb")
    if adb is None:
        raise EnvironmentError("adb_not_found")

    doctor_env = _minimal_env(device_serial=inputs.device_serial, operator_package=inputs.operator_package)
    doctor_result = _run(
        [*inputs.androperator_cmd, "doctor", "--device", inputs.device_serial],
        env=doctor_env,
    )
    if doctor_result.returncode != 0:
        _raise_environment_error(
            "doctor_preflight_failed",
            details=_doctor_failure_details(doctor_result.stdout),
        )

    adb_env = _minimal_env()
    version_result = _run([adb, "-s", inputs.device_serial, "shell", "getprop", "ro.build.version.release"], env=adb_env)
    if version_result.returncode != 0:
        raise EnvironmentError("ground_truth_unreadable")
    ground_truth = version_result.stdout.strip()
    if not ground_truth:
        raise EnvironmentError("ground_truth_unreadable")
    collected_at = format_timestamp(inputs.device_timezone)

    return Environment(
        device_serial=inputs.device_serial,
        device_timezone=inputs.device_timezone,
        ground_truth_android_version=ground_truth,
        ground_truth_collected_at=collected_at,
        androperator_cmd=inputs.androperator_cmd,
        androperator_version=inputs.androperator_version,
        androperator_npm_version=inputs.androperator_npm_version,
        operator_package=inputs.operator_package,
        requested_operator_package=inputs.requested_operator_package,
    )
