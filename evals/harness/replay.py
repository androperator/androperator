from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .environment import REPO_ROOT
from .scorer import extract_answer_from_transcript, extract_skill, score, validate_skill


DEFAULT_REPLAY_TIMEOUT_S = 60
_SKILL_REQUIRED_FIELDS = (
    "id",
    "applicationId",
    "intent",
    "summary",
    "path",
    "skillFile",
    "scripts",
    "artifacts",
)


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _required_skill_entry(payload: dict[str, Any]) -> dict[str, Any]:
    return {field: payload[field] for field in _SKILL_REQUIRED_FIELDS}


def _coerce_string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, str] = {}
    for key, entry in value.items():
        if isinstance(key, str) and isinstance(entry, str):
            out[key] = entry
    return out


def _resolve_safe_relative_path(root: Path, relative_path: str) -> Path:
    candidate = Path(relative_path)
    if candidate.is_absolute() or candidate.anchor:
        raise ValueError(f"path must be relative: {relative_path}")
    resolved_root = root.resolve()
    resolved_path = (resolved_root / candidate).resolve()
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError(f"path escapes root: {relative_path}") from exc
    return resolved_path


def _write_text_file(root: Path, relative_path: str, content: str) -> None:
    file_path = _resolve_safe_relative_path(root, relative_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")


def _materialize_skill_package(skill: dict[str, Any], temp_root: Path) -> tuple[Path, str]:
    skill_id = skill["id"]
    skill_root = _resolve_safe_relative_path(temp_root, skill["path"])
    skill_root.mkdir(parents=True, exist_ok=True)

    skill_json_path = skill_root / "skill.json"
    skill_json_path.write_text(
        json.dumps(_required_skill_entry(skill), indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )

    _write_text_file(temp_root, skill["skillFile"], skill.get("skillMarkdown", "# Generated skill\n"))

    script_contents = _coerce_string_map(skill.get("scriptContents"))
    for script_path in skill["scripts"]:
        content = script_contents.get(script_path)
        if content is None:
            raise ValueError(f"missing inline script content for {script_path}")
        _write_text_file(temp_root, script_path, content)

    artifact_contents = _coerce_string_map(skill.get("artifactContents"))
    for artifact_path in skill["artifacts"]:
        content = artifact_contents.get(artifact_path)
        if content is None:
            raise ValueError(f"missing inline artifact content for {artifact_path}")
        _write_text_file(temp_root, artifact_path, content)

    registry_path = temp_root / "skills" / "skills-registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry = {
        "schemaVersion": "1.0",
        "generatedAt": _now_utc_iso(),
        "skills": [_required_skill_entry(skill)],
    }
    registry_path.write_text(json.dumps(registry, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return registry_path, skill_id


def _extract_skill_output(output: str) -> str | None:
    candidate = extract_answer_from_transcript(output)
    if candidate is not None:
        return candidate

    stripped = output.strip()
    looks_like_json = stripped.startswith("{") or stripped.startswith("[") or stripped.startswith('"')

    payload = None
    if looks_like_json:
        try:
            payload = json.loads(output)
        except json.JSONDecodeError:
            payload = None

    if isinstance(payload, dict):
        candidate_texts: list[str] = []
        for key in ("output", "stdout", "stderr", "message", "result"):
            value = payload.get(key)
            if isinstance(value, str):
                candidate_texts.append(value)

        for text in candidate_texts:
            candidate = extract_answer_from_transcript(text)
            if candidate is not None:
                return candidate

        for text in candidate_texts:
            normalized = text.strip()
            if _is_plausible_answer(normalized):
                return normalized
        return None

    if isinstance(payload, str):
        decoded = payload.strip()
        if _is_plausible_answer(decoded):
            return decoded
        return extract_answer_from_transcript(payload)

    if _is_plausible_answer(stripped):
        return stripped
    return None


def _is_plausible_answer(value: str) -> bool:
    if not value or "\n" in value:
        return False
    return value.lower() == "unknown" or bool(
        re.match(r"^(?:android\s+)?\d+(?:\.\d+)?$", value.strip(), re.IGNORECASE)
    )


def _capture_artifact_states(skill: dict[str, Any], temp_root: Path) -> dict[str, tuple[bool, int | None, int | None]]:
    states: dict[str, tuple[bool, int | None, int | None]] = {}
    for artifact_path in skill.get("artifacts", []):
        if not isinstance(artifact_path, str):
            continue
        try:
            candidate_path = _resolve_safe_relative_path(temp_root, artifact_path)
        except ValueError:
            continue
        if not candidate_path.exists():
            states[artifact_path] = (False, None, None)
            continue
        try:
            stat = candidate_path.stat()
        except OSError:
            states[artifact_path] = (False, None, None)
            continue
        states[artifact_path] = (True, stat.st_mtime_ns, stat.st_size)
    return states


def _artifact_changed(
    path: Path,
    before: tuple[bool, int | None, int | None] | None,
) -> bool:
    if not path.exists():
        return False
    try:
        stat = path.stat()
    except OSError:
        return False
    if before is None:
        return True
    existed_before, mtime_ns_before, size_before = before
    if not existed_before:
        return True
    return stat.st_mtime_ns != mtime_ns_before or stat.st_size != size_before


def _extract_answer_from_artifacts(
    skill: dict[str, Any],
    temp_root: Path,
    artifact_states_before: dict[str, tuple[bool, int | None, int | None]],
) -> str | None:
    for artifact_path in skill.get("artifacts", []):
        if not isinstance(artifact_path, str):
            continue
        try:
            candidate_path = _resolve_safe_relative_path(temp_root, artifact_path)
        except ValueError:
            continue
        if not candidate_path.exists():
            continue
        if not _artifact_changed(candidate_path, artifact_states_before.get(artifact_path)):
            continue
        try:
            artifact_text = candidate_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        candidate = _extract_skill_output(artifact_text)
        if candidate is not None:
            return candidate
    return None


def _build_replay_env(registry_path: Path, androperator_cmd: list[str]) -> dict[str, str]:
    env = {
        "PATH": os.environ["PATH"],
        "HOME": os.environ["HOME"],
        "USER": os.environ.get("USER", ""),
        "LOGNAME": os.environ.get("LOGNAME", os.environ.get("USER", "")),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "ANDROPERATOR_SKILLS_REGISTRY": str(registry_path),
    }
    if androperator_cmd and all(isinstance(part, str) and part for part in androperator_cmd):
        if len(androperator_cmd) == 1:
            env["ANDROPERATOR_BIN"] = androperator_cmd[0]
        else:
            wrapper_path = registry_path.parent / ".androperator-bin-replay-wrapper.sh"
            wrapper_path.parent.mkdir(parents=True, exist_ok=True)
            wrapper_lines = [
                "#!/bin/sh",
                f"exec {shlex.join(androperator_cmd)} \"$@\"",
                "",
            ]
            wrapper_path.write_text("\n".join(wrapper_lines), encoding="utf-8")
            wrapper_path.chmod(0o755)
            env["ANDROPERATOR_BIN"] = str(wrapper_path)
    return env


def _load_ground_truth(config: dict[str, Any], result: dict[str, Any]) -> str:
    ground_truth = config.get("environment", {}).get("ground_truth_android_version")
    if isinstance(ground_truth, str) and ground_truth.strip():
        return ground_truth.strip()
    ground_truth = result.get("environment", {}).get("ground_truth_android_version")
    if isinstance(ground_truth, str) and ground_truth.strip():
        return ground_truth.strip()
    raise ValueError("ground truth android version missing")


def _load_skill_generation_spec(eval_id: str) -> dict[str, Any] | None:
    spec_path = REPO_ROOT / "evals" / "specs" / eval_id / "spec.json"
    if not spec_path.exists():
        return None
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    skill_generation = spec.get("skill_generation")
    return skill_generation if isinstance(skill_generation, dict) else None


def run_replay(
    run_dir: Path,
    androperator_cmd: list[str],
    operator_package: str,
    device_serial: str,
    timeout_s: int = DEFAULT_REPLAY_TIMEOUT_S,
) -> dict[str, Any]:
    config_path = run_dir / "config.json"
    result_path = run_dir / "result.json"
    transcript_path = run_dir / "transcript.txt"
    if not config_path.exists() or not result_path.exists() or not transcript_path.exists():
        raise FileNotFoundError(f"missing replay artifacts in {run_dir}")

    config = _read_json(config_path)
    result = _read_json(result_path)
    transcript = transcript_path.read_text(encoding="utf-8")
    ground_truth = _load_ground_truth(config, result)
    eval_id = config.get("eval_id") or result.get("eval_id")

    skill_generation = _load_skill_generation_spec(eval_id) if isinstance(eval_id, str) else None
    start_marker = skill_generation.get("skill_start_marker") if skill_generation else "ANDROPERATOR_SKILL_START"
    end_marker = skill_generation.get("skill_end_marker") if skill_generation else "ANDROPERATOR_SKILL_END"

    skill_score = {
        "skill_emitted": False,
        "skill_valid": False,
        "skill_validation_errors": [],
        "replay_attempted": False,
        "replay_status": "skipped",
        "replay_answer_normalized": None,
        "replay_answer_correct": False,
        "replay_wall_clock_s": 0.0,
    }

    skill_json = extract_skill(transcript, start_marker, end_marker)
    if skill_json is None:
        return skill_score

    recorded_device_serial = config.get("environment", {}).get("device_serial")
    if not isinstance(recorded_device_serial, str) or not recorded_device_serial.strip():
        raise ValueError("replay device serial missing from run config")
    if device_serial != recorded_device_serial:
        raise ValueError("replay device serial does not match the original run config")

    skill_score["skill_emitted"] = True
    is_valid, errors = validate_skill(skill_json, androperator_cmd, operator_package)
    skill_score["skill_valid"] = is_valid
    skill_score["skill_validation_errors"] = errors
    if not is_valid:
        return skill_score

    skill_payload = json.loads(skill_json)

    with tempfile.TemporaryDirectory(prefix="androperator-eval-skill-") as temp_dir_name:
        temp_root = Path(temp_dir_name)
        try:
            registry_path, skill_id = _materialize_skill_package(skill_payload, temp_root)
        except Exception:
            skill_score["replay_attempted"] = True
            skill_score["replay_status"] = "error"
            return skill_score

        env = _build_replay_env(registry_path, androperator_cmd)
        artifact_states_before = _capture_artifact_states(skill_payload, temp_root)

        command = [
            *androperator_cmd,
            "skills",
            "run",
            skill_id,
            "--device",
            device_serial,
            "--operator-package",
            operator_package,
            "--skip-validate",
        ]

        skill_score["replay_attempted"] = True
        started = time.monotonic()
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                env=env,
                timeout=timeout_s,
                cwd=str(temp_root),
            )
        except subprocess.TimeoutExpired:
            skill_score["replay_status"] = "error"
            skill_score["replay_wall_clock_s"] = time.monotonic() - started
            return skill_score

        skill_score["replay_wall_clock_s"] = time.monotonic() - started

        combined_output = "\n".join(
            part for part in [completed.stdout, completed.stderr] if isinstance(part, str) and part
        )
        replay_answer = _extract_skill_output(combined_output)
        if completed.returncode == 0:
            artifact_answer = _extract_answer_from_artifacts(skill_payload, temp_root, artifact_states_before)
            if artifact_answer is not None:
                replay_answer = artifact_answer

        if replay_answer is not None:
            replay_result = score(
                combined_output,
                ground_truth,
                answer_extracted_raw=replay_answer,
                allow_transcript_fallback=False,
            )
            skill_score["replay_answer_normalized"] = replay_result.answer_normalized
            skill_score["replay_answer_correct"] = replay_result.answer_correct

        if completed.returncode != 0:
            skill_score["replay_answer_normalized"] = None
            skill_score["replay_answer_correct"] = False
            skill_score["replay_status"] = "error"
            return skill_score
        if replay_answer is None:
            skill_score["replay_status"] = "no_answer"
            return skill_score

        skill_score["replay_status"] = "pass" if skill_score["replay_answer_correct"] else "fail"
        return skill_score
