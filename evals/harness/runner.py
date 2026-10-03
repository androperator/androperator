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
from .scorer import extract_answer_from_transcript, score
from .timeutil import format_timestamp


DOCS_URL = "https://docs.androperator.com"
TRANSCRIPT_CAP_BYTES = 10 * 1024 * 1024
_SENSITIVE_KEY_RE = ("KEY", "SECRET", "TOKEN", "PASSWORD")
def build_prompt(template_path: str, variables: dict) -> str:
    template = Template(Path(template_path).read_text(encoding="utf-8"))
    return template.substitute(variables)


def _load_prompt_path(spec: dict, knowledge_mode: str) -> Path:
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
        prompt_path = _load_prompt_path(spec, knowledge_mode)
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
        )
        write_run(run_dir, result, config, transcript_text)
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
        )
        if transcript_handle is not None:
            transcript_handle.close()
            transcript_handle = None
        write_run(run_dir, result, config, transcript_text)
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
