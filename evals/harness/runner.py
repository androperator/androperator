from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import platform
from pathlib import Path
from string import Template
from typing import Any

from .agents.base import BaseAgent
from .artifacts import make_run_id, write_run
from .environment import Environment, RELEASE_OPERATOR_PACKAGE, REPO_ROOT
from .logger import get_logger
from .replay import run_replay
from .scorer import extract_answer_from_transcript, extract_skill, score, validate_skill
from .timeutil import format_timestamp


DOCS_URL = "https://docs.androperator.com"
TRANSCRIPT_CAP_BYTES = 10 * 1024 * 1024
_SENSITIVE_KEY_RE = ("KEY", "SECRET", "TOKEN", "PASSWORD")
_DISCOVERY_ARTIFACT_REQUIRED_KEYS = {
    "recommended_next_step",
    "existing_skill_verdict",
    "target_app_package",
    "route_confidence",
    "mutation_risk",
    "evidence_collected",
    "discovery_budget_used",
    "handoff_target",
    "handoff_reasoning",
}
_DISCOVERY_ARTIFACT_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)


def build_prompt(template_path: str, variables: dict) -> str:
    template = Template(Path(template_path).read_text(encoding="utf-8"))
    return template.substitute(variables)


def _load_prompt_path(spec: dict, knowledge_mode: str, skill_prompt_name: str | None = None) -> Path:
    if skill_prompt_name is not None:
        prompt_path = Path(skill_prompt_name)
        spec_dir = spec.get("spec_dir")
        if spec_dir is not None and not prompt_path.is_absolute():
            return Path(spec_dir) / prompt_path
        return prompt_path
    direct = spec.get("prompt_path")
    if direct is not None:
        return Path(direct)
    prompt_file = spec.get("prompt_file")
    if prompt_file is not None:
        return Path(prompt_file)
    prompts = spec.get("prompts")
    if isinstance(prompts, dict):
        prompt_name = prompts.get(knowledge_mode)
        if prompt_name is not None:
            prompt_path = Path(prompt_name)
            spec_dir = spec.get("spec_dir")
            if spec_dir is not None and not prompt_path.is_absolute():
                return Path(spec_dir) / prompt_path
            return prompt_path
    raise KeyError(f"prompt path not found for mode {knowledge_mode}")


def _minimal_base_env(
    device_serial: str,
    operator_package: str,
    androperator_cmd: list[str],
    path_prefix: str | None = None,
) -> dict[str, str]:
    path = os.environ["PATH"]
    if path_prefix is not None and path_prefix:
        path = f"{path_prefix}{os.pathsep}{path}"
    return {
        "PATH": path,
        "HOME": os.environ["HOME"],
        "USER": os.environ.get("USER", ""),
        "LOGNAME": os.environ.get("LOGNAME", os.environ.get("USER", "")),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "ANDROID_SERIAL": device_serial,
        "ANDROPERATOR_CMD": shlex.join(androperator_cmd),
        "ANDROPERATOR_OPERATOR_PACKAGE": operator_package,
    }


def _prepare_androperator_launcher(
    work_dir: Path,
    androperator_cmd: list[str],
    knowledge_mode: str,
    runtime_target: str,
) -> tuple[list[str], str | None]:
    if runtime_target == "published" or knowledge_mode != "public-surface":
        return androperator_cmd, None
    if len(androperator_cmd) == 1 and androperator_cmd[0] == "androperator":
        return androperator_cmd, None
    wrapper_path = work_dir / "androperator"
    script = "#!/bin/sh\nexec " + shlex.join(androperator_cmd) + ' "$@"\n'
    wrapper_path.write_text(script, encoding="utf-8")
    wrapper_path.chmod(0o755)
    return ["androperator"], str(work_dir)


def _display_work_dir(work_dir: Path, knowledge_mode: str) -> str:
    if knowledge_mode == "public-surface":
        return "<tempdir>"
    return str(work_dir)


def _display_cwd(knowledge_mode: str) -> str:
    if knowledge_mode == "public-surface":
        return "<redacted>"
    return os.getcwd()


def _display_runs_dir(runs_dir: Path, knowledge_mode: str) -> str:
    if knowledge_mode == "public-surface":
        return "<redacted>"
    return str(runs_dir)


def _ensure_agent_binary_available(agent: BaseAgent) -> str:
    binary = agent.build_command("", "")[0]
    if shutil.which(binary) is None and not Path(binary).exists():
        raise EnvironmentError("agent_binary_not_found")
    return binary


def _ensure_context_file_if_needed(work_dir: Path, agent: BaseAgent, knowledge_mode: str) -> None:
    if knowledge_mode != "public-surface":
        return
    if agent.config.type_id != "claude":
        return
    context_path = work_dir / "CLAUDE.md"
    if context_path.exists():
        return
    context_path.write_text("https://docs.androperator.com\n", encoding="utf-8")


def _run_keyevent(device_serial: str, keyevent: str, logger) -> None:
    adb = shutil.which("adb")
    if adb is None:
        logger.warning("device_keyevent_failed", keyevent=keyevent, reason="adb_not_found")
        return
    command = [adb, "-s", device_serial, "shell", "input", "keyevent", keyevent]
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        env={
            "PATH": os.environ["PATH"],
            "HOME": os.environ["HOME"],
            "LANG": os.environ.get("LANG", "C.UTF-8"),
            "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        },
    )
    if result.returncode != 0:
        logger.warning("device_keyevent_failed", keyevent=keyevent, returncode=result.returncode, stderr=result.stderr.strip())


def _count_androperator_results(transcript: str) -> int:
    count = 0
    for line in transcript.splitlines():
        if line.startswith("[Androperator-Result]"):
            count += 1
    return count


def _extract_answer_candidate(raw_line: str, normalized_line: str) -> str | None:
    for candidate in (normalized_line, raw_line):
        answer = extract_answer_from_transcript(candidate)
        if answer is not None:
            return answer
    return None


def _write_json_file(path: Path, payload: dict[str, Any]) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    temp_path.replace(path)


def _strip_marked_blocks(transcript: str, start_marker: str, end_marker: str) -> str:
    pattern = re.compile(
        r"^[ \t]*"
        + re.escape(start_marker)
        + r"[ \t]*$\n?"
        + r".*?"
        + r"\n?^[ \t]*"
        + re.escape(end_marker)
        + r"[ \t]*$\n?",
        re.DOTALL | re.MULTILINE,
    )
    return pattern.sub("", transcript)


def _iter_transcript_json_objects(transcript: str):
    for line_number, raw_line in enumerate(transcript.splitlines()):
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            yield line_number, payload


def _iter_command_execution_records(transcript: str):
    for line_number, payload in _iter_transcript_json_objects(transcript):
        item = payload.get("item") if payload.get("type") == "item.completed" else payload
        if not isinstance(item, dict):
            continue
        if item.get("type") == "command_execution":
            yield line_number, item


def _normalize_command_tokens(tokens: Any) -> list[str]:
    if not isinstance(tokens, list):
        return []
    normalized: list[str] = []
    for token in tokens:
        if isinstance(token, str) and token.strip():
            normalized.append(token.strip())
    return normalized


def _extract_command_token_lists(record: dict[str, Any]) -> list[list[str]]:
    token_lists: list[list[str]] = []

    command = record.get("command")
    if isinstance(command, str) and command.strip():
        try:
            parsed = shlex.split(command)
        except ValueError:
            parsed = command.split()
        if parsed:
            token_lists.append(parsed)
    elif isinstance(command, list):
        parsed = _normalize_command_tokens(command)
        if parsed:
            token_lists.append(parsed)
    elif isinstance(command, dict):
        executable = command.get("executable")
        args = _normalize_command_tokens(command.get("args"))
        if isinstance(executable, str) and executable.strip():
            token_lists.append([executable.strip(), *args])
        argv = _normalize_command_tokens(command.get("argv"))
        if argv:
            token_lists.append(argv)

    for key in ("argv", "args", "command_argv", "commandArgs"):
        parsed = _normalize_command_tokens(record.get(key))
        if parsed:
            token_lists.append(parsed)

    return token_lists


def _tokens_use_default_json_output(tokens: list[str]) -> bool:
    lowered = [token.lower() for token in tokens]
    for index, token in enumerate(lowered[:-1]):
        if token in {"--output", "--format"} and lowered[index + 1] == "pretty":
            return False
    return True


def _is_bundled_skills_list_command(record: dict[str, Any]) -> bool:
    for tokens in _extract_command_token_lists(record):
        lowered = [token.lower() for token in tokens]
        for index in range(len(lowered) - 1):
            if lowered[index] == "bundled-skills" and lowered[index + 1] == "list":
                if _tokens_use_default_json_output(tokens):
                    return True
    return False


def _is_runtime_skill_discovery_command(record: dict[str, Any]) -> bool:
    for tokens in _extract_command_token_lists(record):
        lowered = [token.lower() for token in tokens]
        for index in range(len(lowered) - 1):
            if lowered[index] == "skills" and lowered[index + 1] in {"for-app", "search", "get"}:
                if _tokens_use_default_json_output(tokens):
                    return True
    return False


def _normalize_command_signature(command: str) -> str | None:
    if not isinstance(command, str) or not command.strip():
        return None
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()
    normalized_tokens = [token.strip().lower() for token in tokens if isinstance(token, str) and token.strip()]
    if not normalized_tokens:
        return None
    return " ".join(normalized_tokens)


def _canonicalize_registry_command_tokens(tokens: list[str]) -> str | None:
    normalized_tokens = [token.strip().lower() for token in tokens if isinstance(token, str) and token.strip()]
    if not normalized_tokens:
        return None

    for index in range(len(normalized_tokens) - 1):
        token = normalized_tokens[index]
        next_token = normalized_tokens[index + 1]
        if token == "skills" and next_token in {"for-app", "search", "get"}:
            relevant_tokens = normalized_tokens[index:]
            break
        if token == "bundled-skills" and next_token == "list":
            relevant_tokens = normalized_tokens[index:]
            break
    else:
        return None

    canonical_tokens: list[str] = []
    cursor = 0
    while cursor < len(relevant_tokens):
        token = relevant_tokens[cursor]
        if token == "--json":
            cursor += 1
            continue
        if token in {"--output", "--format"} and cursor + 1 < len(relevant_tokens):
            if relevant_tokens[cursor + 1] == "json":
                cursor += 2
                continue
            if relevant_tokens[cursor + 1] == "pretty":
                return None
        canonical_tokens.append(token)
        cursor += 1
    return " ".join(canonical_tokens)


def _canonicalize_registry_command_signature(command: str) -> str | None:
    normalized_signature = _normalize_command_signature(command)
    if normalized_signature is None:
        return None
    return _canonicalize_registry_command_tokens(normalized_signature.split())


def _extract_discovery_artifacts(transcript: str) -> list[tuple[int, dict[str, Any]]]:
    artifacts: list[tuple[int, dict[str, Any]]] = []
    for match in _DISCOVERY_ARTIFACT_FENCE_RE.finditer(transcript):
        candidate = match.group(1).strip()
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        if _DISCOVERY_ARTIFACT_REQUIRED_KEYS.issubset(payload.keys()):
            line_number = transcript.count("\n", 0, match.start()) + 1
            artifacts.append((line_number, payload))
    return artifacts


def _find_transcript_token_line(transcript: str, token: str) -> int | None:
    needle = token.strip().lower()
    if not needle:
        return None
    for line_number, raw_line in enumerate(transcript.splitlines()):
        if needle in raw_line.lower():
            return line_number
    return None


def _extract_non_empty_string_list(value: Any) -> list[str] | None:
    if not isinstance(value, list) or len(value) == 0:
        return None
    items: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            return None
        items.append(item.strip())
    return items


def _extract_artifact_registry_commands(existing_skill_verdict: dict[str, Any]) -> list[str] | None:
    commands = _extract_non_empty_string_list(existing_skill_verdict.get("commands"))
    if commands is not None:
        return commands
    return _extract_non_empty_string_list(existing_skill_verdict.get("queried_registry_paths"))


def _coerce_non_negative_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return float(value)
    return None


def _validate_discovery_artifact(
    artifact: dict[str, Any],
    *,
    skill_generation: Any,
    runtime_probe_signatures: set[str],
    authoring_probe_signatures: set[str],
) -> list[str]:
    errors: list[str] = []

    target_package_expected = (
        skill_generation.get("target_app_package").strip()
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("target_app_package"), str)
        else None
    )
    required_proving_handoff = (
        skill_generation.get("required_proving_handoff").strip()
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("required_proving_handoff"), str)
        else None
    )
    expected_recording_handoff = required_proving_handoff or "androperator-skill-author-by-recording"

    target_app_package = artifact.get("target_app_package")
    if not isinstance(target_app_package, dict):
        errors.append("discovery artifact is missing object field `target_app_package`")
    elif target_package_expected is not None:
        package_id = target_app_package.get("package_id")
        if not isinstance(package_id, str) or package_id.strip() != target_package_expected:
            errors.append(f"discovery artifact target_app_package.package_id must be `{target_package_expected}`")
        app_label = target_app_package.get("app_label")
        if not isinstance(app_label, str) or not app_label.strip():
            app_label = target_app_package.get("label")
        if not isinstance(app_label, str) or not app_label.strip():
            errors.append("discovery artifact target_app_package must include a non-empty app label")
        sub_route = target_app_package.get("sub_route")
        if not isinstance(sub_route, str) or not sub_route.strip():
            sub_route = target_app_package.get("sub_route_observed")
        if not isinstance(sub_route, str) or not sub_route.strip():
            errors.append("discovery artifact target_app_package must include a non-empty sub-route observation")

    existing_skill_verdict = artifact.get("existing_skill_verdict")
    if not isinstance(existing_skill_verdict, dict):
        errors.append("discovery artifact is missing object field `existing_skill_verdict`")
    else:
        status = existing_skill_verdict.get("status")
        if status not in {"match", "partial_match", "none"}:
            errors.append("discovery artifact existing_skill_verdict.status must be `match`, `partial_match`, or `none`")
        commands = _extract_artifact_registry_commands(existing_skill_verdict)
        if commands is None:
            errors.append(
                "discovery artifact existing_skill_verdict must include a non-empty `commands` or `queried_registry_paths` string array"
            )
        else:
            artifact_registry_signatures = {
                signature
                for signature in (_canonicalize_registry_command_signature(command) for command in commands)
                if signature is not None
            }
            artifact_runtime_probe_signatures = {
                signature for signature in artifact_registry_signatures if " skills " in f" {signature} "
            }
            if runtime_probe_signatures and artifact_runtime_probe_signatures.isdisjoint(runtime_probe_signatures):
                errors.append(
                    "discovery artifact existing_skill_verdict commands must include a runtime-skill discovery command seen in the transcript"
                )
            if authoring_probe_signatures and artifact_registry_signatures.isdisjoint(authoring_probe_signatures):
                errors.append(
                    "discovery artifact existing_skill_verdict commands must include `bundled-skills list` evidence seen in the transcript"
                )

    route_confidence = artifact.get("route_confidence")
    if not isinstance(route_confidence, dict):
        errors.append("discovery artifact is missing object field `route_confidence`")
    else:
        if route_confidence.get("level") not in {"high", "medium", "low"}:
            errors.append("discovery artifact route_confidence.level must be `high`, `medium`, or `low`")
        evidence = _extract_non_empty_string_list(route_confidence.get("evidence"))
        if evidence is None:
            errors.append("discovery artifact route_confidence.evidence must be a non-empty string array")

    mutation_risk = artifact.get("mutation_risk")
    if not isinstance(mutation_risk, dict):
        errors.append("discovery artifact is missing object field `mutation_risk`")
    else:
        if mutation_risk.get("level") not in {"read_only", "reversible_mutation", "irreversible_mutation"}:
            errors.append(
                "discovery artifact mutation_risk.level must be `read_only`, `reversible_mutation`, or `irreversible_mutation`"
            )
        notes = mutation_risk.get("notes")
        if isinstance(notes, str):
            if not notes.strip():
                errors.append("discovery artifact mutation_risk.notes must be a non-empty string or string array")
        elif _extract_non_empty_string_list(notes) is None:
            errors.append("discovery artifact mutation_risk.notes must be a non-empty string or string array")

    evidence_collected = artifact.get("evidence_collected")
    if not isinstance(evidence_collected, dict):
        errors.append("discovery artifact is missing object field `evidence_collected`")
    else:
        for key in ("snapshots", "screenshots", "failed_probes"):
            values = evidence_collected.get(key)
            if not isinstance(values, list):
                errors.append(f"discovery artifact evidence_collected.{key} must be an array")

    discovery_budget_used = artifact.get("discovery_budget_used")
    if not isinstance(discovery_budget_used, dict):
        errors.append("discovery artifact is missing object field `discovery_budget_used`")
    else:
        snapshot_count = _coerce_non_negative_number(
            discovery_budget_used.get("snapshot_count", discovery_budget_used.get("snapshots"))
        )
        if snapshot_count is None:
            errors.append("discovery artifact discovery_budget_used must include a non-negative snapshot count")
        elif snapshot_count > 5:
            errors.append("discovery artifact discovery_budget_used snapshot count exceeds the Pack A discovery budget")

        screenshot_count = _coerce_non_negative_number(
            discovery_budget_used.get("screenshot_count", discovery_budget_used.get("screenshots"))
        )
        if screenshot_count is None:
            errors.append("discovery artifact discovery_budget_used must include a non-negative screenshot count")
        elif screenshot_count > 3:
            errors.append("discovery artifact discovery_budget_used screenshot count exceeds the Pack A discovery budget")

        elapsed_seconds = _coerce_non_negative_number(
            discovery_budget_used.get("elapsed_seconds", discovery_budget_used.get("elapsed_wall_time_s"))
        )
        if elapsed_seconds is None:
            errors.append("discovery artifact discovery_budget_used must include non-negative elapsed wall time")
        elif elapsed_seconds > 90:
            errors.append("discovery artifact discovery_budget_used elapsed wall time exceeds the Pack A discovery budget")

    recommended_next_step = artifact.get("recommended_next_step")
    handoff_target = artifact.get("handoff_target")
    if handoff_target not in {"androperator-skill-author-by-recording", "raw-androperator", "human", "none"}:
        errors.append(
            "discovery artifact handoff_target must be one of `androperator-skill-author-by-recording`, `raw-androperator`, `human`, or `none`"
        )
    if recommended_next_step not in {
        "use_existing_skill",
        "proceed_to_recording",
        "iterate_discovery",
        "one_shot_direct_automation",
        "escalate_to_human",
        "decline",
    }:
        errors.append(
            "discovery artifact recommended_next_step must be one of `use_existing_skill`, `proceed_to_recording`, `iterate_discovery`, `one_shot_direct_automation`, `escalate_to_human`, or `decline`"
        )
    expected_handoff_target_by_route = {
        "use_existing_skill": "none",
        "proceed_to_recording": expected_recording_handoff,
        "iterate_discovery": "none",
        "one_shot_direct_automation": "raw-androperator",
        "escalate_to_human": "human",
        "decline": "none",
    }
    expected_handoff_target = expected_handoff_target_by_route.get(recommended_next_step)
    if expected_handoff_target is not None and handoff_target != expected_handoff_target:
        errors.append(
            f"discovery artifact handoff_target must be `{expected_handoff_target}` when recommended_next_step is `{recommended_next_step}`"
        )
    handoff_reasoning = artifact.get("handoff_reasoning")
    if not isinstance(handoff_reasoning, str) or not handoff_reasoning.strip():
        errors.append("discovery artifact handoff_reasoning must be a non-empty string")
    skill_classification = artifact.get("skill_classification")
    if recommended_next_step == "proceed_to_recording":
        if skill_classification not in {"shared-general", "personalized-local"}:
            errors.append(
                "discovery artifact skill_classification must be `shared-general` or `personalized-local` when recommended_next_step is `proceed_to_recording`"
            )
        if isinstance(existing_skill_verdict, dict) and existing_skill_verdict.get("status") == "match":
            errors.append("discovery artifact cannot route to `proceed_to_recording` when existing_skill_verdict.status is `match`")
    elif skill_classification is not None:
        errors.append("discovery artifact skill_classification must be omitted unless recommended_next_step is `proceed_to_recording`")

    return errors


def _skill_generation_failure_reason(skill_score: dict[str, Any]) -> str | None:
    if skill_score.get("skill_generation_passed"):
        return None
    if not skill_score.get("route_requirements_met", True):
        return "skill_route_not_proven"
    if not skill_score.get("skill_emitted"):
        return "skill_not_emitted"
    if not skill_score.get("skill_valid"):
        return "skill_invalid"
    replay_status = skill_score.get("replay_status")
    if replay_status == "skipped":
        return "skill_replay_skipped"
    if replay_status == "error":
        return "skill_replay_error"
    if replay_status == "no_answer":
        return "skill_replay_no_answer"
    if replay_status == "fail":
        return "skill_replay_failed"
    return "skill_generation_failed"


def _apply_skill_generation_outcome(result: dict[str, Any], skill_score: dict[str, Any]) -> dict[str, Any]:
    next_result = dict(result)
    next_result["skill_score"] = skill_score

    outcome = result.get("outcome")
    if not isinstance(outcome, dict):
        return next_result

    next_outcome = dict(outcome)
    if next_outcome.get("status") == "pass" and not skill_score.get("skill_generation_passed", True):
        next_outcome["status"] = "fail"
        next_outcome["failure_reason"] = _skill_generation_failure_reason(skill_score)
    elif next_outcome.get("status") == "pass" and "failure_reason" not in next_outcome:
        next_outcome["failure_reason"] = None
    next_result["outcome"] = next_outcome
    return next_result


def _evaluate_skill_route_requirements(transcript: str, skill_generation: Any) -> dict[str, Any]:
    required_authoring_front_door = (
        skill_generation.get("required_authoring_front_door").strip()
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("required_authoring_front_door"), str)
        else None
    )
    required_proving_handoff = (
        skill_generation.get("required_proving_handoff").strip()
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("required_proving_handoff"), str)
        else None
    )

    start_marker = (
        skill_generation.get("skill_start_marker")
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("skill_start_marker"), str)
        else "ANDROPERATOR_SKILL_START"
    )
    end_marker = (
        skill_generation.get("skill_end_marker")
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("skill_end_marker"), str)
        else "ANDROPERATOR_SKILL_END"
    )
    route_transcript = _strip_marked_blocks(transcript, start_marker, end_marker)
    command_execution_records = list(_iter_command_execution_records(route_transcript))
    bundled_skills_list_positions = [
        line_number
        for line_number, record in command_execution_records
        if _is_bundled_skills_list_command(record)
    ]
    bundled_skills_list_line_numbers = [position + 1 for position in bundled_skills_list_positions]
    bundled_skills_list_signatures: set[str] = set()
    runtime_skill_discovery_signatures: set[str] = set()
    runtime_skill_discovery_positions: list[int] = []
    for line_number, record in command_execution_records:
        if _is_bundled_skills_list_command(record):
            for token_list in _extract_command_token_lists(record):
                signature = _canonicalize_registry_command_tokens(token_list)
                if signature is not None:
                    bundled_skills_list_signatures.add(signature)
        if not _is_runtime_skill_discovery_command(record):
            continue
        runtime_skill_discovery_positions.append(line_number)
        for token_list in _extract_command_token_lists(record):
            signature = _canonicalize_registry_command_tokens(token_list)
            if signature is not None:
                runtime_skill_discovery_signatures.add(signature)

    bundled_skills_list_seen = len(bundled_skills_list_positions) > 0
    runtime_skill_discovery_seen = len(runtime_skill_discovery_positions) > 0
    runtime_skill_discovery_before_authoring = bool(
        runtime_skill_discovery_positions
        and bundled_skills_list_positions
        and min(runtime_skill_discovery_positions) < min(bundled_skills_list_positions)
    )

    discovery_artifacts = _extract_discovery_artifacts(route_transcript)
    discovery_artifact_count = len(discovery_artifacts)
    discovery_artifact_seen = discovery_artifact_count > 0
    discovery_artifact_errors: list[str] = []
    if discovery_artifact_count == 1:
        discovery_artifact_line_number, discovery_artifact = discovery_artifacts[0]
        discovery_artifact_errors = _validate_discovery_artifact(
            discovery_artifact,
            skill_generation=skill_generation,
            runtime_probe_signatures=runtime_skill_discovery_signatures,
            authoring_probe_signatures=bundled_skills_list_signatures,
        )
        if bundled_skills_list_line_numbers and discovery_artifact_line_number <= min(bundled_skills_list_line_numbers):
            discovery_artifact_errors.append(
                "structured discovery artifact must appear after `androperator bundled-skills list`"
            )
    elif discovery_artifact_count > 1:
        discovery_artifact_errors.append("expected exactly one structured discovery artifact before skill emission")

    discovery_artifact_valid = discovery_artifact_count == 1 and len(discovery_artifact_errors) == 0
    required_authoring_front_door_line = (
        _find_transcript_token_line(route_transcript, required_authoring_front_door)
        if required_authoring_front_door is not None
        else None
    )
    required_authoring_front_door_explicitly_seen = required_authoring_front_door is None or required_authoring_front_door_line is not None
    required_authoring_front_door_after_authoring = required_authoring_front_door is None or bool(
        required_authoring_front_door_line is not None
        and (
            not bundled_skills_list_positions
            or required_authoring_front_door_line > min(bundled_skills_list_positions)
        )
    )
    required_authoring_front_door_seen = bool(
        required_authoring_front_door is None
        or (
            discovery_artifact_valid
            and required_authoring_front_door_explicitly_seen
            and required_authoring_front_door_after_authoring
        )
    )
    required_proving_handoff_seen = required_proving_handoff is None
    if required_proving_handoff is not None and discovery_artifact_valid:
        _, artifact = discovery_artifacts[0]
        if artifact.get("recommended_next_step") == "proceed_to_recording" and artifact.get("handoff_target") == required_proving_handoff:
            required_proving_handoff_seen = True
    route_requirement_errors: list[str] = []
    if required_authoring_front_door is not None or required_proving_handoff is not None:
        if not runtime_skill_discovery_seen:
            route_requirement_errors.append(
                "missing structured command evidence for runtime-skill discovery (`androperator skills for-app/search/get`)"
            )
        elif not runtime_skill_discovery_before_authoring:
            route_requirement_errors.append(
                "runtime-skill discovery must appear before `androperator bundled-skills list`"
            )
        if not bundled_skills_list_seen:
            route_requirement_errors.append(
                "missing structured command evidence for `androperator bundled-skills list`"
            )
    route_requirement_errors.extend(discovery_artifact_errors)
    if required_authoring_front_door is not None and not required_authoring_front_door_explicitly_seen:
        route_requirement_errors.append(
            f"missing explicit transcript signal for required_authoring_front_door `{required_authoring_front_door}`"
        )
    elif required_authoring_front_door is not None and not required_authoring_front_door_after_authoring:
        route_requirement_errors.append(
            f"required_authoring_front_door `{required_authoring_front_door}` must appear after `androperator bundled-skills list`"
        )
    if required_authoring_front_door is not None and not required_authoring_front_door_seen:
        route_requirement_errors.append(
            f"missing structured discovery artifact for required_authoring_front_door `{required_authoring_front_door}`"
        )
    if required_proving_handoff is not None and not required_proving_handoff_seen:
        route_requirement_errors.append(
            f"missing structured discovery handoff for required_proving_handoff `{required_proving_handoff}`"
        )

    return {
        "required_authoring_front_door": required_authoring_front_door,
        "required_proving_handoff": required_proving_handoff,
        "runtime_skill_discovery_seen": runtime_skill_discovery_seen,
        "runtime_skill_discovery_before_authoring": runtime_skill_discovery_before_authoring,
        "bundled_skills_list_seen": bundled_skills_list_seen,
        "discovery_artifact_count": discovery_artifact_count,
        "discovery_artifact_seen": discovery_artifact_seen,
        "discovery_artifact_valid": discovery_artifact_valid,
        "required_authoring_front_door_explicitly_seen": required_authoring_front_door_explicitly_seen,
        "required_authoring_front_door_after_authoring": required_authoring_front_door_after_authoring,
        "required_authoring_front_door_seen": required_authoring_front_door_seen,
        "required_proving_handoff_seen": required_proving_handoff_seen,
        "route_requirements_met": len(route_requirement_errors) == 0,
        "route_requirement_errors": route_requirement_errors,
    }


def _apply_skill_generation_contract(skill_score: dict[str, Any], transcript: str, skill_generation: Any) -> dict[str, Any]:
    next_skill_score = dict(skill_score)
    route_requirements = _evaluate_skill_route_requirements(transcript, skill_generation)
    next_skill_score.update(route_requirements)
    next_skill_score["skill_generation_passed"] = bool(
        next_skill_score.get("skill_emitted")
        and next_skill_score.get("skill_valid")
        and next_skill_score.get("replay_status") == "pass"
        and next_skill_score.get("replay_answer_correct")
        and next_skill_score.get("route_requirements_met")
    )
    return next_skill_score


def _synthesize_skill_score_for_contract(
    *,
    transcript: str,
    skill_generation: Any,
    androperator_cmd: list[str],
    operator_package: str,
    existing_skill_score: dict[str, Any] | None = None,
) -> dict[str, Any]:
    next_skill_score = dict(existing_skill_score) if isinstance(existing_skill_score, dict) else {}
    start_marker = (
        skill_generation.get("skill_start_marker")
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("skill_start_marker"), str)
        else "ANDROPERATOR_SKILL_START"
    )
    end_marker = (
        skill_generation.get("skill_end_marker")
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("skill_end_marker"), str)
        else "ANDROPERATOR_SKILL_END"
    )

    skill_json = extract_skill(transcript, start_marker, end_marker)
    skill_emitted = skill_json is not None
    skill_valid = False
    skill_validation_errors: list[str] = []
    if skill_json is not None:
        skill_valid, skill_validation_errors = validate_skill(
            skill_json,
            androperator_cmd,
            operator_package,
        )

    next_skill_score["skill_emitted"] = skill_emitted
    next_skill_score["skill_valid"] = skill_valid
    next_skill_score["skill_validation_errors"] = skill_validation_errors
    if "replay_attempted" not in next_skill_score or not isinstance(next_skill_score.get("replay_attempted"), bool):
        next_skill_score["replay_attempted"] = False
    if not isinstance(next_skill_score.get("replay_status"), str) or not next_skill_score.get("replay_status"):
        next_skill_score["replay_status"] = "skipped" if not skill_emitted or not skill_valid else "error"
    if "replay_answer_normalized" not in next_skill_score:
        next_skill_score["replay_answer_normalized"] = None
    if "replay_answer_correct" not in next_skill_score or not isinstance(next_skill_score.get("replay_answer_correct"), bool):
        next_skill_score["replay_answer_correct"] = False
    if "replay_wall_clock_s" not in next_skill_score or not isinstance(next_skill_score.get("replay_wall_clock_s"), (int, float)):
        next_skill_score["replay_wall_clock_s"] = 0.0
    if (
        next_skill_score.get("replay_status") == "error"
        and skill_emitted
        and skill_valid
        and not isinstance(next_skill_score.get("replay_error"), str)
    ):
        next_skill_score["replay_error"] = "rescore missing replay metadata in result.json"
    return next_skill_score


def _replay_error_skill_score(
    error: Exception,
    *,
    skill_emitted: bool | None = None,
    skill_valid: bool | None = None,
    skill_validation_errors: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "skill_emitted": False if skill_emitted is None else skill_emitted,
        "skill_valid": False if skill_valid is None else skill_valid,
        "skill_validation_errors": [] if skill_validation_errors is None else list(skill_validation_errors),
        "replay_attempted": False,
        "replay_status": "error",
        "replay_answer_normalized": None,
        "replay_answer_correct": False,
        "replay_wall_clock_s": 0.0,
        "replay_error": str(error) if str(error) else error.__class__.__name__,
    }


def _attach_skill_score(
    *,
    run_dir: Path,
    result: dict[str, Any],
    spec: dict[str, Any],
    skill_prompt_name: str | None,
    env: Environment,
) -> dict[str, Any]:
    if skill_prompt_name is None or not spec.get("skill_generation"):
        return result
    skill_generation = spec.get("skill_generation")
    replay_timeout_s = int(skill_generation.get("replay_timeout_s", 60)) if isinstance(skill_generation, dict) else 60
    start_marker = (
        skill_generation.get("skill_start_marker")
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("skill_start_marker"), str)
        else "ANDROPERATOR_SKILL_START"
    )
    end_marker = (
        skill_generation.get("skill_end_marker")
        if isinstance(skill_generation, dict) and isinstance(skill_generation.get("skill_end_marker"), str)
        else "ANDROPERATOR_SKILL_END"
    )
    transcript_path = run_dir / "transcript.txt"
    transcript = transcript_path.read_text(encoding="utf-8") if transcript_path.exists() else ""
    skill_json = extract_skill(transcript, start_marker, end_marker)
    skill_emitted = skill_json is not None
    skill_valid = False
    skill_validation_errors: list[str] = []
    if skill_json is not None:
        skill_valid, skill_validation_errors = validate_skill(
            skill_json,
            env.androperator_cmd,
            env.operator_package,
        )
    try:
        skill_score = run_replay(
            run_dir=run_dir,
            androperator_cmd=env.androperator_cmd,
            operator_package=env.operator_package,
            device_serial=env.device_serial,
            timeout_s=replay_timeout_s,
        )
    except Exception as exc:
        skill_score = _replay_error_skill_score(
            exc,
            skill_emitted=skill_emitted,
            skill_valid=skill_valid,
            skill_validation_errors=skill_validation_errors,
        )
    skill_score = _apply_skill_generation_contract(skill_score, transcript, skill_generation)
    replay_result = _apply_skill_generation_outcome(result, skill_score)
    _write_json_file(run_dir / "result.json", replay_result)
    return replay_result


def _extract_domains(transcript: str) -> list[str]:
    domains = set()
    for domain in re.findall(r"(?:https?://)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})", transcript):
        domains.add(domain.lower())
    return sorted(domains)


def _classify_failure(status: str, transcript: str, used_disallowed_tool: bool) -> str:
    lowered = transcript.lower()
    if status == "timeout":
        return "timeout"
    if used_disallowed_tool:
        return "tool_usage"
    if "settings" in lowered or "android version" in lowered or "about phone" in lowered or "about device" in lowered:
        return "navigation"
    if "docs.androperator.com" in lowered or "androperator.com" in lowered:
        return "docs"
    return "unknown"


def _probe_agent_binary_version(agent: BaseAgent) -> str:
    command = agent.build_command("", "")
    binary = command[0]
    probe = subprocess.run(
        [binary, "--version"],
        check=False,
        capture_output=True,
        text=True,
        env={
            "PATH": os.environ["PATH"],
            "HOME": os.environ["HOME"],
            "LANG": os.environ.get("LANG", "C.UTF-8"),
            "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        },
    )
    output = (probe.stdout or probe.stderr or "").strip()
    if probe.returncode == 0 and output:
        return output.splitlines()[0].strip()
    return "unknown"


def _terminate_process_group(proc: subprocess.Popen[str], logger) -> None:
    if proc.poll() is not None:
        return
    try:
        pgid = os.getpgid(proc.pid)
    except ProcessLookupError:
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
        logger.kill("SIGTERM", pgid)
    except ProcessLookupError:
        return
    logger.state("sigterm_sent")
    time.sleep(5)
    if proc.poll() is None:
        try:
            os.killpg(pgid, signal.SIGKILL)
            logger.kill("SIGKILL", pgid)
            logger.state("sigkill_sent")
        except ProcessLookupError:
            return


def _hash_env(env_overrides: dict[str, Any]) -> str:
    payload = json.dumps(env_overrides, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _sanitize_env_overrides(env_overrides: dict[str, Any]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, value in env_overrides.items():
        if any(token in key.upper() for token in _SENSITIVE_KEY_RE):
            sanitized[key] = "[REDACTED]"
        else:
            sanitized[key] = value
    return sanitized


def _build_config(
    *,
    run_id: str,
    eval_id: str,
    agent: BaseAgent,
    knowledge_mode: str,
    runtime_target: str,
    prompt_path: Path,
    prompt_sha256: str,
    work_dir: Path,
    runs_dir: Path,
    env: Environment,
    command: list[str],
    env_overrides: dict[str, Any],
    label: str | None,
    timeout_s: int,
    max_turns: int | None,
    agent_binary_version: str,
    display_androperator_cmd: list[str],
    display_work_dir: str,
    display_cwd: str,
    display_runs_dir: str,
    skill_prompt_path: Path | None = None,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "eval_id": eval_id,
        "agent": {
            "type": agent.config.type_id,
            "model": agent.config.model,
            "extra_flags": list(agent.config.extra_flags),
        },
        "knowledge_mode": knowledge_mode,
        "runtime_target": runtime_target,
        "spec": {
            "prompt_file": prompt_path.name,
            "prompt_sha256": prompt_sha256,
            **(
                {"skill_prompt_file": skill_prompt_path.name}
                if skill_prompt_path is not None and skill_prompt_path.name != prompt_path.name
                else {}
            ),
        },
        "run_label": label,
        "invocation": {
            "command": command,
            "work_dir": display_work_dir,
            "env_overrides": env_overrides,
        },
        "environment": {
            "device_serial": env.device_serial,
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "cwd": display_cwd,
            "agent_binary_version": agent_binary_version,
            "env_hash": _hash_env(env_overrides),
            "runs_dir": display_runs_dir,
            "androperator_cmd": display_androperator_cmd,
            "runtime_androperator_cmd": env.androperator_cmd,
            "androperator_version": env.androperator_version,
            "ground_truth_android_version": env.ground_truth_android_version,
            "androperator_npm_version": env.androperator_npm_version,
            "operator_package": env.operator_package,
        },
        "timeout_s": timeout_s,
        "max_turns": max_turns,
    }


def _build_result(
    *,
    run_id: str,
    eval_id: str,
    eval_version: str,
    started_at: str,
    finished_at: str,
    agent: BaseAgent,
    knowledge_mode: str,
    runtime_target: str,
    prompt_path: Path,
    prompt_sha256: str,
    label: str | None,
    command: list[str],
    work_dir: Path,
    env: Environment,
    env_overrides: dict[str, Any],
    ground_truth_rechecked_at: str | None,
    transcript: str,
    status: str,
    failure_reason: str | None,
    score_result,
    wall_clock_s: float,
    timeout_s: int,
    max_turns: int | None,
    first_result_seen_at: float | None,
    turns_counted: int | None,
    display_androperator_cmd: list[str],
    display_work_dir: str,
    display_cwd: str,
    display_runs_dir: str,
    skill_prompt_path: Path | None = None,
) -> dict[str, Any]:
    androperator_commands_detected = _count_androperator_results(transcript)
    answer_emitted = score_result.answer_extracted_raw is not None
    violations = {"used_adb": bool(score_result.used_disallowed_tool)}
    diagnostics = {
        "used_snapshot": "snapshot" in transcript.lower(),
        "used_open_settings": "open settings" in transcript.lower() or "com.android.settings" in transcript.lower(),
        "navigated_settings": any(token in transcript.lower() for token in ["about phone", "about device", "android version"]),
        "failure_classification": _classify_failure(status, transcript, score_result.used_disallowed_tool),
        "domains_accessed": _extract_domains(transcript),
    }
    return {
        "run_id": run_id,
        "eval_id": eval_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "agent": {
            "type": agent.config.type_id,
            "model": agent.config.model,
            "extra_flags": list(agent.config.extra_flags),
        },
        "knowledge_mode": knowledge_mode,
        "runtime_target": runtime_target,
        "spec": {
            "eval_version": eval_version,
            "prompt_file": prompt_path.name,
            "prompt_sha256": prompt_sha256,
            **({"skill_prompt_file": skill_prompt_path.name} if skill_prompt_path is not None else {}),
        },
        "run_label": label,
        "invocation": {
            "command": command,
            "work_dir": display_work_dir,
            "env_overrides": env_overrides,
        },
        "environment": {
            "device_serial": env.device_serial,
            "ground_truth_android_version": env.ground_truth_android_version,
            "ground_truth_collected_at": env.ground_truth_collected_at,
            "ground_truth_rechecked_at": ground_truth_rechecked_at,
            "androperator_cmd": display_androperator_cmd,
            "androperator_version": env.androperator_version,
            "androperator_npm_version": env.androperator_npm_version,
            "operator_package": env.operator_package,
            "cwd": display_cwd,
            "runs_dir": display_runs_dir,
        },
        "outcome": {
            "status": status,
            "answer_extracted_raw": score_result.answer_extracted_raw,
            "answer_normalized": score_result.answer_normalized,
            "ground_truth_normalized": score_result.ground_truth_normalized,
            "answer_correct": score_result.answer_correct if status != "error" else False,
            "failure_reason": failure_reason,
        },
        "metrics": {
            "wall_clock_s": wall_clock_s,
            "time_to_first_androperator_command_s": first_result_seen_at,
            "timeout_budget_s": timeout_s,
            "androperator_commands_detected": androperator_commands_detected,
            "actions_per_turn": None,
            "answer_emitted": answer_emitted,
            "violations": violations,
            "diagnostics": diagnostics,
            "used_disallowed_tool": bool(score_result.used_disallowed_tool),
            "turns_counted": turns_counted,
            "turns_budget": max_turns,
        },
        "artifacts": {"transcript": "transcript.txt", "config": "config.json"},
    }


def run_eval(
    spec: dict,
    env: Environment,
    agent: BaseAgent,
    knowledge_mode: str,
    timeout_s: int,
    runs_dir: Path,
    label: str | None = None,
    max_turns: int | None = None,
    skill_prompt_name: str | None = None,
) -> Path:
    eval_id = spec["eval_id"]
    eval_version = spec.get("version", spec.get("eval_version", "1.0.0"))
    runtime_target = spec.get("runtime_target", "local-dev")
    runs_dir.mkdir(parents=True, exist_ok=True)
    run_id = make_run_id(eval_id, agent.config.type_id, agent.config.model, label, timezone_name=env.device_timezone)
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    logger = get_logger(run_id, log_file=run_dir / "harness.log", timestamp_timezone_name=env.device_timezone)
    logger.state("starting")

    work_dir = Path(tempfile.mkdtemp()) if knowledge_mode == "public-surface" else REPO_ROOT
    temp_work_dir = knowledge_mode == "public-surface"
    _ensure_context_file_if_needed(work_dir, agent, knowledge_mode)

    prompt_path = Path("")
    started_at = None
    finished_at = None
    prompt_text = ""
    prompt_sha256 = ""
    command: list[str] = []
    transcript_parts: list[str] = []
    transcript_text = ""
    answer_extracted_raw: str | None = None
    ground_truth_rechecked_at: str | None = None
    first_result_seen_at: float | None = None
    turns = 0
    turn_count_parse_failed = False
    turns_counted: int | None = None
    status = "error"
    failure_reason: str | None = None
    score_result = None
    agent_overrides: dict[str, Any] = {}
    proc: subprocess.Popen[str] | None = None
    timer: threading.Timer | None = None
    timeout_triggered = threading.Event()
    transcript_path = run_dir / "transcript.txt"
    transcript_handle = None
    transcript_bytes_written = 0
    transcript_truncated = False
    answer_found_logged = False
    display_androperator_cmd: list[str] = ["androperator"]
    display_work_dir = "<tempdir>"
    display_cwd = "<redacted>"
    display_runs_dir = "<redacted>"

    try:
        _ensure_agent_binary_available(agent)
        prompt_path = _load_prompt_path(spec, knowledge_mode, skill_prompt_name)
        display_androperator_cmd, path_prefix = _prepare_androperator_launcher(
            work_dir,
            env.androperator_cmd,
            knowledge_mode,
            runtime_target,
        )
        display_work_dir = _display_work_dir(work_dir, knowledge_mode)
        display_cwd = _display_cwd(knowledge_mode)
        display_runs_dir = _display_runs_dir(runs_dir, knowledge_mode)
        prompt_text = build_prompt(
            str(prompt_path),
            {
                "ANDROPERATOR_CMD": shlex.join(display_androperator_cmd),
                "ANDROPERATOR_OPERATOR_PACKAGE": env.operator_package,
                "DEVICE_SERIAL": env.device_serial,
                "DOCS_URL": DOCS_URL,
                **({"REPO_ROOT": str(REPO_ROOT)} if knowledge_mode == "full-repo" else {}),
            },
        )
        prompt_sha256 = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()
        base_env = _minimal_base_env(env.device_serial, env.operator_package, display_androperator_cmd, path_prefix=path_prefix)
        agent_overrides = agent.build_env(base_env)
        final_env = {**base_env, **agent_overrides}
        command = agent.build_command(prompt_text, str(work_dir))
        agent_binary_version = _probe_agent_binary_version(agent)
        config_env_overrides = {
            "ANDROID_SERIAL": env.device_serial,
            "ANDROPERATOR_CMD": shlex.join(display_androperator_cmd),
            "ANDROPERATOR_OPERATOR_PACKAGE": env.operator_package,
            **({"EVAL_LABEL": label} if label is not None else {}),
            **agent_overrides,
        }
        sanitized_config_env_overrides = _sanitize_env_overrides(config_env_overrides)
        config = _build_config(
            run_id=run_id,
            eval_id=eval_id,
            agent=agent,
            knowledge_mode=knowledge_mode,
            runtime_target=spec.get("runtime_target", "local-dev"),
            prompt_path=prompt_path,
            prompt_sha256=prompt_sha256,
            work_dir=work_dir,
            runs_dir=runs_dir,
            env=env,
            command=command,
            env_overrides=sanitized_config_env_overrides,
            label=label,
            timeout_s=timeout_s,
            max_turns=max_turns,
            agent_binary_version=agent_binary_version,
            display_androperator_cmd=display_androperator_cmd,
            display_work_dir=display_work_dir,
            display_cwd=display_cwd,
            display_runs_dir=display_runs_dir,
        )
        logger.spawn(command=command, work_dir=display_work_dir, env_overrides=config_env_overrides)
        logger.env_summary(
            runtime_target=runtime_target,
            device_serial=env.device_serial,
            androperator_cmd=display_androperator_cmd,
            operator_package=env.operator_package,
            androperator_version=env.androperator_version,
            androperator_npm_version=env.androperator_npm_version,
        )
        if (
            runtime_target == "published"
            and env.requested_operator_package is not None
            and env.requested_operator_package != RELEASE_OPERATOR_PACKAGE
        ):
            logger.warning(
                "published_operator_package_override",
                requested_operator_package=env.requested_operator_package,
                default_operator_package=RELEASE_OPERATOR_PACKAGE,
            )
        _run_keyevent(env.device_serial, "KEYCODE_WAKEUP", logger)
        _run_keyevent(env.device_serial, "KEYCODE_HOME", logger)
        time.sleep(0.5)

        started_at = format_timestamp(env.device_timezone)
        started_mono = time.monotonic()
        logger.state("agent_spawned")

        transcript_handle = transcript_path.open("w", encoding="utf-8")

        def _on_timeout() -> None:
            if proc is None or proc.poll() is not None:
                return
            timeout_triggered.set()
            logger.state("timeout_triggered")
            logger.timeout(time.monotonic() - started_mono)
            _terminate_process_group(proc, logger)

        proc = subprocess.Popen(
            command,
            cwd=str(work_dir),
            env=final_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )

        if proc.stdout is None:
            raise RuntimeError("agent stdout unavailable")

        timer = threading.Timer(timeout_s, _on_timeout)
        timer.daemon = True
        timer.start()

        for raw_line in proc.stdout:
            line = agent.normalize_line(raw_line)
            if not transcript_truncated:
                encoded_line = line.encode("utf-8")
                if transcript_bytes_written >= TRANSCRIPT_CAP_BYTES:
                    marker = "[TRANSCRIPT_TRUNCATED]\n"
                    transcript_handle.write(marker)
                    transcript_handle.flush()
                    transcript_parts.append(marker)
                    transcript_truncated = True
                else:
                    transcript_handle.write(line)
                    transcript_handle.flush()
                    transcript_parts.append(line)
                    transcript_bytes_written += len(encoded_line)
            if answer_extracted_raw is None:
                answer = _extract_answer_candidate(raw_line, line)
                if answer is not None:
                    answer_extracted_raw = answer
                    if not answer_found_logged:
                        logger.state("answer_found")
                        answer_found_logged = True
            try:
                if agent.count_turn(raw_line):
                    turns += 1
                    if max_turns is not None and turns >= max_turns and answer_extracted_raw is None:
                        status = "budget_exceeded"
                        failure_reason = "budget_exceeded"
                        logger.warning("turn_budget_reached", turns=turns, max_turns=max_turns)
                        _terminate_process_group(proc, logger)
                        break
            except Exception as exc:
                turn_count_parse_failed = True
                logger.warning("turn_count_failed", error=str(exc) if str(exc) else exc.__class__.__name__)
            if line.startswith("[Androperator-Result]") and first_result_seen_at is None:
                first_result_seen_at = time.monotonic() - started_mono

        proc.wait()
        if timer is not None:
            timer.cancel()
            timer.join(timeout=6.0)
        if transcript_handle is not None:
            transcript_handle.close()
            transcript_handle = None

        transcript_text = "".join(transcript_parts)
        finished_at = format_timestamp(env.device_timezone)
        wall_clock_s = time.monotonic() - started_mono
        score_result = score(
            transcript_text,
            env.ground_truth_android_version,
            answer_extracted_raw=answer_extracted_raw,
            allow_transcript_fallback=True,
        )
        if score_result.answer_extracted_raw is not None and status != "budget_exceeded":
            status = "pass" if score_result.answer_correct else "fail"
        elif status != "budget_exceeded" and timeout_triggered.is_set():
            status = "timeout"
        elif status != "budget_exceeded":
            status = "no_answer"
        if turn_count_parse_failed:
            logger.warning("turn_count_parse_failed")
        if agent.config.type_id in {"codex", "kimi"}:
            if turns < 2:
                turns_counted = None
                logger.warning("turn_count_approximate", agent=agent.config.type_id, turns=turns)
            else:
                turns_counted = turns
        else:
            if turns > 0 and not turn_count_parse_failed:
                turns_counted = turns
            else:
                turns_counted = None
                logger.warning("turn_count_unreliable", agent=agent.config.type_id, turns=turns)
        if status == "error":
            failure_reason = failure_reason or "unexpected_error"
        elif status == "budget_exceeded":
            failure_reason = failure_reason or "budget_exceeded"
        else:
            failure_reason = None
        logger.score(
            outcome_status=status,
            answer_normalized=score_result.answer_normalized if score_result.answer_normalized is not None else "no_answer",
            violations={"used_adb": bool(score_result.used_disallowed_tool)},
        )
        result = _build_result(
            run_id=run_id,
            eval_id=eval_id,
            eval_version=eval_version,
            started_at=started_at or finished_at or "",
            finished_at=finished_at or started_at or "",
            agent=agent,
            knowledge_mode=knowledge_mode,
            runtime_target=spec.get("runtime_target", "local-dev"),
            prompt_path=prompt_path,
            prompt_sha256=prompt_sha256,
            label=label,
            command=command,
            work_dir=work_dir,
            env=env,
            env_overrides=sanitized_config_env_overrides,
            ground_truth_rechecked_at=ground_truth_rechecked_at,
            transcript=transcript_text,
            status=status,
            failure_reason=failure_reason,
            score_result=score_result,
            wall_clock_s=wall_clock_s,
            timeout_s=timeout_s,
            max_turns=max_turns,
            first_result_seen_at=first_result_seen_at,
            turns_counted=turns_counted,
            display_androperator_cmd=display_androperator_cmd,
            display_work_dir=display_work_dir,
            display_cwd=display_cwd,
            display_runs_dir=display_runs_dir,
        )
        config = _build_config(
            run_id=run_id,
            eval_id=eval_id,
            agent=agent,
            knowledge_mode=knowledge_mode,
            runtime_target=spec.get("runtime_target", "local-dev"),
            prompt_path=prompt_path,
            prompt_sha256=prompt_sha256,
            work_dir=work_dir,
            runs_dir=runs_dir,
            env=env,
            command=command,
            env_overrides=sanitized_config_env_overrides,
            label=label,
            timeout_s=timeout_s,
            max_turns=max_turns,
            agent_binary_version=agent_binary_version,
            display_androperator_cmd=display_androperator_cmd,
            display_work_dir=display_work_dir,
            display_cwd=display_cwd,
            display_runs_dir=display_runs_dir,
            skill_prompt_path=prompt_path if skill_prompt_name is not None else None,
        )
        write_run(run_dir, result, config, transcript_text)
        result = _attach_skill_score(
            run_dir=run_dir,
            result=result,
            spec=spec,
            skill_prompt_name=skill_prompt_name,
            env=env,
        )
        logger.state("completed")
        logger.result(
            status,
            score_result.answer_normalized if score_result.answer_normalized is not None else None,
            env.ground_truth_android_version,
            turns_counted,
            wall_clock_s,
        )
        return run_dir
    except Exception as exc:
        if proc is not None and proc.poll() is None:
            _terminate_process_group(proc, logger)
        if timer is not None:
            timer.cancel()
            timer.join(timeout=6.0)
        finished_at = format_timestamp(env.device_timezone if "env" in locals() else None)
        transcript_text = "".join(transcript_parts)
        wall_clock_s = time.monotonic() - started_mono if "started_mono" in locals() else 0.0
        failure_reason = str(exc) if str(exc) else exc.__class__.__name__
        status = "error"
        if score_result is None:
            score_result = score(
                transcript_text,
                env.ground_truth_android_version,
                answer_extracted_raw=answer_extracted_raw,
                allow_transcript_fallback=True,
            )
        logger.error(exc)
        logger.score(
            outcome_status=status,
            answer_normalized=score_result.answer_normalized if score_result.answer_normalized is not None else "no_answer",
            violations={"used_adb": bool(score_result.used_disallowed_tool)},
        )
        result = _build_result(
            run_id=run_id,
            eval_id=eval_id,
            eval_version=eval_version,
            started_at=started_at or finished_at,
            finished_at=finished_at,
            agent=agent,
            knowledge_mode=knowledge_mode,
            runtime_target=spec.get("runtime_target", "local-dev"),
            prompt_path=prompt_path,
            prompt_sha256=prompt_sha256,
            label=label,
            command=command,
            work_dir=work_dir,
            env=env,
            env_overrides=_sanitize_env_overrides({
                "ANDROID_SERIAL": env.device_serial,
                "ANDROPERATOR_CMD": shlex.join(display_androperator_cmd),
                "ANDROPERATOR_OPERATOR_PACKAGE": env.operator_package,
            }),
            ground_truth_rechecked_at=ground_truth_rechecked_at,
            transcript=transcript_text,
            status=status,
            failure_reason=failure_reason,
            score_result=score_result,
            wall_clock_s=wall_clock_s,
            timeout_s=timeout_s,
            max_turns=max_turns,
            first_result_seen_at=first_result_seen_at,
            turns_counted=turns_counted,
            display_androperator_cmd=display_androperator_cmd,
            display_work_dir=display_work_dir,
            display_cwd=display_cwd,
            display_runs_dir=display_runs_dir,
            skill_prompt_path=prompt_path if skill_prompt_name is not None else None,
        )
        config = _build_config(
            run_id=run_id,
            eval_id=eval_id,
            agent=agent,
            knowledge_mode=knowledge_mode,
            runtime_target=spec.get("runtime_target", "local-dev"),
            prompt_path=prompt_path,
            prompt_sha256=prompt_sha256,
            work_dir=work_dir,
            runs_dir=runs_dir,
            env=env,
            command=command,
            env_overrides=_sanitize_env_overrides({
                "ANDROID_SERIAL": env.device_serial,
                "ANDROPERATOR_CMD": shlex.join(display_androperator_cmd),
                "ANDROPERATOR_OPERATOR_PACKAGE": env.operator_package,
                **agent_overrides,
            }),
            label=label,
            timeout_s=timeout_s,
            max_turns=max_turns,
            agent_binary_version="unknown",
            display_androperator_cmd=display_androperator_cmd,
            display_work_dir=display_work_dir,
            display_cwd=display_cwd,
            display_runs_dir=display_runs_dir,
            skill_prompt_path=prompt_path if skill_prompt_name is not None else None,
        )
        if transcript_handle is not None:
            transcript_handle.close()
            transcript_handle = None
        write_run(run_dir, result, config, transcript_text)
        result = _attach_skill_score(
            run_dir=run_dir,
            result=result,
            spec=spec,
            skill_prompt_name=skill_prompt_name,
            env=env,
        )
        logger.state("completed")
        logger.result(
            status,
            score_result.answer_normalized if score_result.answer_normalized is not None else None,
            env.ground_truth_android_version,
            turns_counted,
            wall_clock_s,
        )
        return run_dir
    finally:
        if transcript_handle is not None:
            transcript_handle.close()
        if timer is not None:
            timer.cancel()
            timer.join(timeout=6.0)
        logger.close()
        if temp_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
