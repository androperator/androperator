from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .artifacts import make_run_id
from .environment import (
    LOCAL_DEV_OPERATOR_PACKAGE,
    REPO_ROOT,
    RuntimeInputs,
    _minimal_env,
    _run,
    preflight,
    resolve_inputs,
)
from .timeutil import format_timestamp


SOLAX_COLD_START_EVAL_ID = "solax-orchestrated-cold-start"
SOLAX_APP_ID = "com.solaxcloud.starter"
SOLAX_SKILL_ID = "com.solaxcloud.starter.set-discharge-to-limit-orchestrated"
DEFAULT_TARGET_VALUES = (35, 40, 45)
DEFAULT_SKILLS_REGISTRY = Path.home() / ".androperator" / "skills" / "skills" / "skills-registry.json"
SKILL_RUN_TIMEOUT_S = 180
NORMALIZATION_TIMEOUT_S = 45
PROBE_STEP_TIMEOUT_S = 60


@dataclass
class CommandCapture:
    name: str
    command: list[str]
    returncode: int
    timed_out: bool
    stdout_path: str
    stderr_path: str
    parsed_json_path: str | None
    started_at: str
    finished_at: str


def _sanitize_text(text: str, replacements: list[tuple[str, str]]) -> str:
    sanitized = text
    for original, replacement in replacements:
        if original:
            sanitized = sanitized.replace(original, replacement)
    return sanitized


def _sanitize_json_value(value: Any, replacements: list[tuple[str, str]]) -> Any:
    if isinstance(value, str):
        return _sanitize_text(value, replacements)
    if isinstance(value, list):
        return [_sanitize_json_value(entry, replacements) for entry in value]
    if isinstance(value, dict):
        return {key: _sanitize_json_value(entry, replacements) for key, entry in value.items()}
    return value


def _write_json(path: Path, payload: dict[str, Any], replacements: list[tuple[str, str]]) -> None:
    sanitized = _sanitize_json_value(payload, replacements)
    path.write_text(json.dumps(sanitized, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def _write_text(path: Path, text: str, replacements: list[tuple[str, str]]) -> None:
    path.write_text(_sanitize_text(text, replacements), encoding="utf-8")


def _parse_json(stdout: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _run_and_capture(
    *,
    command: list[str],
    run_dir: Path,
    name: str,
    env: dict[str, str],
    parse_json: bool,
    replacements: list[tuple[str, str]],
    cwd: Path | None = None,
    timeout_s: int | None = None,
) -> tuple[CommandCapture, dict[str, Any] | None, str, str]:
    commands_dir = run_dir / "commands"
    commands_dir.mkdir(parents=True, exist_ok=True)
    started_at = format_timestamp()
    timed_out = False
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            env=env,
            cwd=str(cwd) if cwd is not None else None,
            timeout=timeout_s,
        )
        stdout = result.stdout
        stderr = result.stderr
        returncode = result.returncode
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        stdout = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout.decode("utf-8", errors="replace") if exc.stdout else "")
        stderr = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr.decode("utf-8", errors="replace") if exc.stderr else "")
        timeout_note = f"\n[live-skill-eval] command timed out after {timeout_s}s\n"
        stderr = f"{stderr}{timeout_note}" if stderr else timeout_note.lstrip("\n")
        returncode = 124
    finished_at = format_timestamp()
    stdout_path = commands_dir / f"{name}.stdout.txt"
    stderr_path = commands_dir / f"{name}.stderr.txt"
    _write_text(stdout_path, stdout, replacements)
    _write_text(stderr_path, stderr, replacements)
    parsed_payload = _parse_json(stdout) if parse_json else None
    parsed_json_path: Path | None = None
    if parsed_payload is not None:
        parsed_json_path = commands_dir / f"{name}.json"
        _write_json(parsed_json_path, parsed_payload, replacements)
    capture = CommandCapture(
        name=name,
        command=command,
        returncode=returncode,
        timed_out=timed_out,
        stdout_path=str(stdout_path.relative_to(run_dir)),
        stderr_path=str(stderr_path.relative_to(run_dir)),
        parsed_json_path=str(parsed_json_path.relative_to(run_dir)) if parsed_json_path is not None else None,
        started_at=started_at,
        finished_at=finished_at,
    )
    return capture, parsed_payload, stdout, stderr


def _androperator_env() -> dict[str, str]:
    env = {
        "PATH": os.environ["PATH"],
        "HOME": os.environ["HOME"],
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
    }
    for key in [
        "ANDROPERATOR_SKILL_RETAIN_LOGS",
        "ANDROPERATOR_SKILL_LOG_DIR",
        "ANDROPERATOR_SKILL_DEBUG",
        "ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS",
    ]:
        if key in os.environ:
            env[key] = os.environ[key]
    return env


def _foreground_package(device_serial: str) -> tuple[str | None, str | None, str]:
    adb = shutil.which("adb")
    if adb is None:
        raise EnvironmentError("adb_not_found")
    env = _minimal_env(device_serial=device_serial)
    result = _run([adb, "-s", device_serial, "shell", "dumpsys", "activity", "activities"], env=env)
    raw_output = result.stdout + result.stderr
    if result.returncode != 0:
        return None, None, raw_output
    patterns = [
        r"mResumedActivity: .*? ([A-Za-z0-9._]+)/",
        r"topResumedActivity=.*? ([A-Za-z0-9._]+)/",
        r"mFocusedApp=.*? ([A-Za-z0-9._]+)/",
        r"ResumedActivity: .*? ([A-Za-z0-9._]+)/",
    ]
    for pattern in patterns:
        match = re.search(pattern, raw_output)
        if match is not None:
            evidence_line = next(
                (line.strip() for line in raw_output.splitlines() if match.group(1) in line),
                None,
            )
            return match.group(1), evidence_line, raw_output
    return None, None, raw_output


def _extract_percent(text: str | None) -> int | None:
    if not isinstance(text, str):
        return None
    match = re.search(r"Discharge to\s+(\d+)%", text)
    if match is None:
        return None
    return int(match.group(1))


def _extract_step_text(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    envelope = payload.get("envelope")
    if not isinstance(envelope, dict):
        return None
    step_results = envelope.get("stepResults")
    if not isinstance(step_results, list):
        return None
    for step in reversed(step_results):
        if not isinstance(step, dict):
            continue
        data = step.get("data")
        if not isinstance(data, dict):
            continue
        text = data.get("text")
        if isinstance(text, str) and text.strip():
            return text
    return None


def _choose_target(observed_percent: int | None, candidate_values: tuple[int, ...]) -> tuple[int | None, str]:
    if observed_percent is None:
        return None, "observed value unavailable"
    for candidate in candidate_values:
        if candidate != observed_percent:
            return candidate, "selected first configured value that differed from the observed persisted value"
    return None, "no configured target value differed from the observed persisted value"


def _build_solax_probe_execution(run_label: str) -> dict[str, Any]:
    return {
        "commandId": f"{run_label}-probe",
        "taskId": run_label,
        "source": SOLAX_COLD_START_EVAL_ID,
        "expectedFormat": "android-ui-automator",
        "timeoutMs": 45000,
        "actions": [
            {
                "id": "open_intelligence",
                "type": "click",
                "params": {"matcher": {"resourceId": "com.solaxcloud.starter:id/tab_intelligent"}},
            },
            {"id": "settle_after_tab", "type": "sleep", "params": {"durationMs": 1500}},
            {
                "id": "open_peak_export",
                "type": "click",
                "params": {"coordinate": {"x": 860, "y": 1399}},
            },
            {
                "id": "wait_device_discharging",
                "type": "wait_for_node",
                "params": {"matcher": {"textContains": "Device Discharging"}, "timeoutMs": 15000},
            },
            {
                "id": "open_device_discharging",
                "type": "click",
                "params": {"coordinate": {"x": 875, "y": 1548}},
            },
            {
                "id": "wait_discharge_row",
                "type": "wait_for_node",
                "params": {"matcher": {"textContains": "Discharge to"}, "timeoutMs": 15000},
            },
            {
                "id": "read_discharge_row",
                "type": "read_text",
                "params": {"matcher": {"textContains": "Discharge to"}},
            },
        ],
    }


def _normalization_sequence(
    *,
    run_dir: Path,
    androperator_cmd: list[str],
    device_serial: str,
    operator_package: str,
    stage_prefix: str,
    replacements: list[tuple[str, str]],
) -> dict[str, Any]:
    env = _androperator_env()
    records: list[dict[str, Any]] = []

    def run_json(name: str, args: list[str]) -> dict[str, Any]:
        capture, payload, _, _ = _run_and_capture(
            command=[*androperator_cmd, *args],
            run_dir=run_dir,
            name=f"{stage_prefix}-{name}",
            env=env,
            parse_json=True,
            replacements=replacements,
            cwd=REPO_ROOT,
            timeout_s=NORMALIZATION_TIMEOUT_S,
        )
        records.append({**asdict(capture), "ok": capture.returncode == 0})
        return payload or {}

    run_json(
        "close-solax",
        [
            "close",
            SOLAX_APP_ID,
            "--device",
            device_serial,
            "--operator-package",
            operator_package,
        ],
    )
    run_json(
        "press-home",
        [
            "press",
            "home",
            "--device",
            device_serial,
            "--operator-package",
            operator_package,
        ],
    )
    foreground_package, evidence_line, raw_foreground = _foreground_package(device_serial)
    foreground_path = run_dir / "commands" / f"{stage_prefix}-foreground.txt"
    foreground_summary = {
        "foreground_package": foreground_package,
        "evidence_line": evidence_line,
        "parse_ok": foreground_package is not None,
        "fallback_note": None if foreground_package is not None else "package parse failed; raw dumpsys excerpt retained",
        "raw_excerpt": raw_foreground[:1200],
    }
    _write_json(foreground_path.with_suffix(".json"), foreground_summary, replacements)
    outside_app_proven = foreground_package is not None and foreground_package != SOLAX_APP_ID
    app_restart_proven = bool(records) and all(record["ok"] for record in records)
    return {
        "records": records,
        "foreground_package": foreground_package,
        "foreground_path": str(foreground_path.with_suffix(".json").relative_to(run_dir)),
        "outside_app_proven": outside_app_proven,
        "app_restart_proven": app_restart_proven,
    }


def _probe_observed_value(
    *,
    run_dir: Path,
    androperator_cmd: list[str],
    device_serial: str,
    operator_package: str,
    stage_prefix: str,
    replacements: list[tuple[str, str]],
) -> dict[str, Any]:
    env = _androperator_env()
    records: list[dict[str, Any]] = []

    def run_json(name: str, args: list[str]) -> dict[str, Any] | None:
        capture, payload, _, _ = _run_and_capture(
            command=[*androperator_cmd, *args],
            run_dir=run_dir,
            name=f"{stage_prefix}-{name}",
            env=env,
            parse_json=True,
            replacements=replacements,
            cwd=REPO_ROOT,
            timeout_s=PROBE_STEP_TIMEOUT_S,
        )
        records.append({**asdict(capture), "ok": capture.returncode == 0})
        return payload

    run_json(
        "open-solax",
        [
            "open",
            SOLAX_APP_ID,
            "--device",
            device_serial,
            "--operator-package",
            operator_package,
        ],
    )
    run_json(
        "settle",
        [
            "sleep",
            "3000",
            "--device",
            device_serial,
            "--operator-package",
            operator_package,
        ],
    )
    probe_payload = run_json(
        "route-probe",
        [
            "exec",
            "--payload",
            json.dumps(_build_solax_probe_execution(stage_prefix), separators=(",", ":")),
            "--device",
            device_serial,
            "--operator-package",
            operator_package,
        ],
    )
    observed_text = _extract_step_text(probe_payload)
    observed_percent = _extract_percent(observed_text)
    return {
        "records": records,
        "observed_row_text": observed_text,
        "observed_percent": observed_percent,
    }


def _extract_skill_result(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    skill_result = payload.get("skillResult")
    return skill_result if isinstance(skill_result, dict) else None


def _classify_run(
    *,
    normalization_before_probe: dict[str, Any],
    normalization_before_skill: dict[str, Any],
    observed_percent: int | None,
    target_percent: int | None,
    result_payload: dict[str, Any] | None,
    skill_capture: CommandCapture | None,
) -> dict[str, Any]:
    skill_result = _extract_skill_result(result_payload)
    skill_status = skill_result.get("status") if isinstance(skill_result, dict) else None
    terminal_verification = skill_result.get("terminalVerification") if isinstance(skill_result, dict) else None
    observed_terminal_text = None
    if isinstance(terminal_verification, dict):
        observed = terminal_verification.get("observed")
        if isinstance(observed, dict):
            observed_terminal_text = observed.get("text")

    terminal_verified = (
        isinstance(terminal_verification, dict)
        and terminal_verification.get("status") == "verified"
        and _extract_percent(observed_terminal_text) == target_percent
    )
    run_start_restarted = bool(normalization_before_probe.get("app_restart_proven"))
    outside_app_proven = bool(normalization_before_skill.get("outside_app_proven"))
    target_difference_proven = observed_percent is not None and target_percent is not None and observed_percent != target_percent
    if not run_start_restarted:
        classification = "run_start_not_proven"
        proof_mode = "unproven"
    elif not outside_app_proven:
        classification = "outside_app_not_proven"
        proof_mode = "unproven"
    elif observed_percent is None:
        classification = "observed_value_unavailable"
        proof_mode = "unproven"
    elif target_percent is None:
        classification = "target_selection_failed"
        proof_mode = "unproven"
    elif skill_capture is not None and skill_capture.timed_out:
        classification = "skill_timed_out"
        proof_mode = "unproven"
    elif result_payload is None:
        classification = "result_parse_failed"
        proof_mode = "unproven"
    elif skill_result is None:
        classification = "skill_result_missing"
        proof_mode = "unproven"
    elif skill_status == "success" and terminal_verified and target_difference_proven:
        classification = "cold_start_verified"
        proof_mode = "cold-start"
    elif skill_status == "success":
        classification = "verification_mismatch"
        proof_mode = "unproven"
    elif skill_status == "indeterminate":
        classification = "skill_indeterminate"
        proof_mode = "unproven"
    else:
        classification = "skill_failed"
        proof_mode = "unproven"

    return {
        "classification": classification,
        "proof_mode": proof_mode,
        "passed": classification == "cold_start_verified",
        "run_start_restarted": run_start_restarted,
        "outside_app_proven": outside_app_proven,
        "target_difference_proven": target_difference_proven,
        "terminal_verification_proven": terminal_verified,
        "skill_status": skill_status,
        "observed_terminal_text": observed_terminal_text,
    }


def _render_summary_markdown(summary: dict[str, Any]) -> str:
    count_labels = {
        "cold_start_verified": "Cold-start verified runs",
        "run_start_not_proven": "Restart-proof failures",
        "outside_app_not_proven": "Outside-app proof failures",
        "observed_value_unavailable": "Observed-value unavailable failures",
        "target_selection_failed": "Target-selection failures",
        "skill_timed_out": "Skill timeouts",
        "verification_mismatch": "Verification mismatches",
        "skill_failed": "Skill failures",
        "skill_indeterminate": "Skill indeterminate runs",
        "skill_result_missing": "Skill-result missing failures",
        "result_parse_failed": "Result-parse failures",
    }
    lines = [
        f"# {summary['eval_id']}",
        "",
        "## Purpose",
        "",
        "Repeatable cold-start proving for the Solax orchestrated skill from a normalized outside-app state.",
        "",
        "## Batch",
        "",
        f"- Batch id: `{summary['batch_id']}`",
        f"- Device: `{summary['device_serial']}`",
        f"- Operator package: `{summary['operator_package']}`",
        f"- Skills registry: `{summary['skills_registry']}`",
        f"- Requested runs: `{summary['runs_requested']}`",
        f"- Aggregate status: `{summary['aggregate_status']}`",
        "",
        "## What Was Proven",
        "",
    ]
    for key, value in summary["counts"].items():
        label = count_labels.get(key, key.replace("_", "-"))
        lines.append(f"- {label}: `{value}`")
    lines.extend(
        [
            "",
        "## Runs",
        "",
        "| Run | Observed | Target | Classification | Proof mode | Result |",
        "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for run in summary["runs"]:
        observed = run["observed_percent"] if run["observed_percent"] is not None else "n/a"
        target = run["target_percent"] if run["target_percent"] is not None else "n/a"
        result = "pass" if run["passed"] else "fail"
        lines.append(
            f"| `{run['run_name']}` | `{observed}` | `{target}` | `{run['classification']}` | `{run['proof_mode']}` | `{result}` |"
        )
    lines.extend(
        [
            "",
            "## Artifacts",
            "",
            "- Each run directory preserves normalization commands, foreground checks, and raw `skills run` JSON.",
            "- `summary.json` is the machine-readable aggregate result.",
            "- `summary.md` is the human-readable batch digest.",
        ]
    )
    return "\n".join(lines) + "\n"


def _initial_summary(*, batch_id: str, device_serial: str, operator_package: str, skills_registry: Path, runs_requested: int) -> dict[str, Any]:
    return {
        "eval_id": SOLAX_COLD_START_EVAL_ID,
        "batch_id": batch_id,
        "started_at": format_timestamp(),
        "finished_at": None,
        "device_serial": device_serial,
        "operator_package": operator_package,
        "skills_registry": str(skills_registry),
        "runs_requested": runs_requested,
        "aggregate_status": "failed",
        "aggregate_rule": "every run must prove outside-app cold start, target-difference selection, and verified terminal persistence",
        "counts": {
            "cold_start_verified": 0,
            "run_start_not_proven": 0,
            "outside_app_not_proven": 0,
            "observed_value_unavailable": 0,
            "target_selection_failed": 0,
            "skill_timed_out": 0,
            "verification_mismatch": 0,
            "skill_failed": 0,
            "skill_indeterminate": 0,
            "skill_result_missing": 0,
            "result_parse_failed": 0,
        },
        "runs": [],
    }


def _artifact_replacements(device_serial: str, skills_registry: Path) -> list[tuple[str, str]]:
    replacements: list[tuple[str, str]] = [
        (device_serial, "<device_serial>"),
        (str(skills_registry), "/<local_user>/src/local skill workspace/skills/skills-registry.json"),
        (str(REPO_ROOT), "/<local_user>/src/androperator"),
    ]
    skills_repo_root = skills_registry.parent.parent
    skills_repo_root_str = str(skills_repo_root)
    non_anchor_parts = [part for part in skills_repo_root.parts if part not in (skills_repo_root.anchor, "")]
    if skills_repo_root.is_absolute() and skills_repo_root_str != skills_repo_root.anchor and len(non_anchor_parts) > 2:
        replacements.append((skills_repo_root_str, "/<local_user>/src/local skill workspace"))
    return replacements


def run_solax_orchestrated_cold_start_eval(
    *,
    device_serial: str | None,
    operator_package: str | None,
    runtime: str = "local-dev",
    runs: int,
    artifacts_dir: Path,
    skills_registry: Path,
    label: str | None = None,
    dry_run: bool = False,
) -> Path:
    if runs < 1:
        raise SystemExit("--runs must be at least 1")

    if not skills_registry.exists():
        raise SystemExit(f"skills registry not found: {skills_registry}")

    inputs: RuntimeInputs = resolve_inputs(
        device_serial,
        runtime=runtime,
        operator_package=operator_package,
    )
    preflight(device_serial, runtime=runtime, resolved_inputs=inputs, operator_package=operator_package)

    batch_id = make_run_id(SOLAX_COLD_START_EVAL_ID, "live-skill", "solax", label)
    batch_dir = artifacts_dir / batch_id
    batch_dir.mkdir(parents=True, exist_ok=False)
    replacements = _artifact_replacements(inputs.device_serial, skills_registry)

    config = {
        "eval_id": SOLAX_COLD_START_EVAL_ID,
        "batch_id": batch_id,
        "runtime_target": runtime,
        "device_serial": inputs.device_serial,
        "operator_package": inputs.operator_package,
        "requested_operator_package": inputs.requested_operator_package,
        "skills_registry": str(skills_registry),
        "androperator_cmd": inputs.androperator_cmd,
        "target_values": list(DEFAULT_TARGET_VALUES),
        "runs": runs,
    }
    _write_json(batch_dir / "config.json", config, replacements)

    if dry_run:
        return batch_dir

    summary = _initial_summary(
        batch_id=batch_id,
        device_serial=inputs.device_serial,
        operator_package=inputs.operator_package,
        skills_registry=skills_registry,
        runs_requested=runs,
    )

    skill_env = {
        **_androperator_env(),
        "ANDROPERATOR_SKILLS_REGISTRY": str(skills_registry),
    }

    for run_index in range(1, runs + 1):
        run_name = f"run-{run_index:02d}"
        run_dir = batch_dir / run_name
        run_dir.mkdir(parents=True, exist_ok=False)

        normalization_before_probe = _normalization_sequence(
            run_dir=run_dir,
            androperator_cmd=inputs.androperator_cmd,
            device_serial=inputs.device_serial,
            operator_package=inputs.operator_package,
            stage_prefix="before-probe",
            replacements=replacements,
        )
        probe = _probe_observed_value(
            run_dir=run_dir,
            androperator_cmd=inputs.androperator_cmd,
            device_serial=inputs.device_serial,
            operator_package=inputs.operator_package,
            stage_prefix="probe",
            replacements=replacements,
        )
        normalization_before_skill = _normalization_sequence(
            run_dir=run_dir,
            androperator_cmd=inputs.androperator_cmd,
            device_serial=inputs.device_serial,
            operator_package=inputs.operator_package,
            stage_prefix="before-skill",
            replacements=replacements,
        )
        target_percent, target_note = _choose_target(probe["observed_percent"], DEFAULT_TARGET_VALUES)

        result_payload = None
        skill_capture = None
        if target_percent is not None and normalization_before_skill["outside_app_proven"]:
            skill_capture, result_payload, _, _ = _run_and_capture(
                command=[
                    *inputs.androperator_cmd,
                    "skills",
                    "run",
                    SOLAX_SKILL_ID,
                    "--device",
                    inputs.device_serial,
                    "--operator-package",
                    inputs.operator_package,
                    "--",
                    str(target_percent),
                ],
                run_dir=run_dir,
                name="skill-run",
                env=skill_env,
                parse_json=True,
                replacements=replacements,
                cwd=REPO_ROOT,
                timeout_s=SKILL_RUN_TIMEOUT_S,
            )

        classification = _classify_run(
            normalization_before_probe=normalization_before_probe,
            normalization_before_skill=normalization_before_skill,
            observed_percent=probe["observed_percent"],
            target_percent=target_percent,
            result_payload=result_payload,
            skill_capture=skill_capture,
        )

        run_metadata = {
            "run_name": run_name,
            "skill_id": SOLAX_SKILL_ID,
            "application_id": SOLAX_APP_ID,
            "runtime_target": runtime,
            "device_serial": inputs.device_serial,
            "operator_package": inputs.operator_package,
            "requested_operator_package": inputs.requested_operator_package,
            "target_values": list(DEFAULT_TARGET_VALUES),
            "normalization_before_probe": normalization_before_probe,
            "probe": probe,
            "normalization_before_skill": normalization_before_skill,
            "target_selection": {
                "observed_percent": probe["observed_percent"],
                "selected_percent": target_percent,
                "note": target_note,
            },
            "skill_run": asdict(skill_capture) if skill_capture is not None else None,
            "classification": classification,
        }
        _write_json(run_dir / "metadata.json", run_metadata, replacements)
        if result_payload is not None:
            _write_json(run_dir / "result.json", result_payload, replacements)

        summary["runs"].append(
            {
                "run_name": run_name,
                "run_dir": str(run_dir.relative_to(batch_dir)),
                "observed_percent": probe["observed_percent"],
                "target_percent": target_percent,
                **classification,
            }
        )
        summary["counts"][classification["classification"]] += 1

    summary["finished_at"] = format_timestamp()
    summary["counts"]["cold_start_verified"] = sum(1 for run in summary["runs"] if run["classification"] == "cold_start_verified")
    summary["aggregate_status"] = "passed" if summary["counts"]["cold_start_verified"] == runs else "failed"
    _write_json(batch_dir / "summary.json", summary, replacements)
    _write_text(batch_dir / "summary.md", _render_summary_markdown(summary), replacements)
    return batch_dir
