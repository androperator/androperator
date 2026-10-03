#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shlex
import shutil
import tempfile
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from evals.harness.agents.base import AgentConfig, BaseAgent
from evals.harness.agents.codex import CodexAgent
from evals.harness.agents.claude import ClaudeAgent
from evals.harness.agents.gemini import GeminiAgent
from evals.harness.agents.kimi import KimiAgent
from evals.harness.artifacts import make_run_id, write_run
from evals.harness.environment import (
    LOCAL_DEV_OPERATOR_PACKAGE,
    RELEASE_OPERATOR_PACKAGE,
    RuntimeInputs,
    REPO_ROOT,
    preflight,
    resolve_inputs,
    _resolve_androperator_cmd,
)
from evals.harness.live_skill_eval import (
    DEFAULT_SKILLS_REGISTRY,
    SOLAX_COLD_START_EVAL_ID,
    run_solax_orchestrated_cold_start_eval,
)
from evals.harness.runner import (
    build_prompt,
    run_eval,
    _apply_skill_generation_contract,
    _apply_skill_generation_outcome,
    _prepare_androperator_launcher,
    _synthesize_skill_score_for_contract,
)
from evals.harness.replay import run_replay, DEFAULT_REPLAY_TIMEOUT_S
from evals.harness.scorer import score
from evals.harness.timeutil import format_timestamp


SUPPORTED_AGENTS = {
    "claude": ClaudeAgent,
    "codex": CodexAgent,
    "gemini": GeminiAgent,
    "kimi": KimiAgent,
}
SUPPORTED_MODES = {"public-surface", "full-repo"}
SUPPORTED_RUNTIMES = {"local-dev", "published"}
DEFAULT_ANDROID_TIMEOUT_S = 300
DEFAULT_ANDROID_MAX_TURNS = 40


def _load_spec(eval_id: str) -> dict:
    spec_path = ROOT / "evals" / "specs" / eval_id / "spec.json"
    if not spec_path.exists():
        raise SystemExit(f"unknown eval: {eval_id}")
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    spec["spec_dir"] = str(spec_path.parent)
    return spec


def _resolve_android_eval_budget(args: argparse.Namespace, spec: dict) -> tuple[int, int]:
    budget = spec.get("budget")
    if not isinstance(budget, dict):
        budget = {}

    spec_timeout_s = budget.get("default_timeout_s")
    if not isinstance(spec_timeout_s, int) or spec_timeout_s <= 0:
        spec_timeout_s = DEFAULT_ANDROID_TIMEOUT_S

    spec_max_turns = budget.get("default_max_turns")
    if not isinstance(spec_max_turns, int) or spec_max_turns <= 0:
        spec_max_turns = DEFAULT_ANDROID_MAX_TURNS

    cli_timeout_s = args.timeout_s
    if not isinstance(cli_timeout_s, int) or cli_timeout_s <= 0:
        cli_timeout_s = None

    cli_max_turns = args.max_turns
    if not isinstance(cli_max_turns, int) or cli_max_turns <= 0:
        cli_max_turns = None

    timeout_s = cli_timeout_s if cli_timeout_s is not None else spec_timeout_s
    max_turns = cli_max_turns if cli_max_turns is not None else spec_max_turns
    return timeout_s, max_turns


def _resolve_prompt_path(eval_id: str, spec: dict, mode: str, skill_prompt: str | None) -> Path:
    spec_dir = Path(spec.get("spec_dir") or (ROOT / "evals" / "specs" / eval_id))
    prompt_name: str | None = skill_prompt
    if prompt_name is None:
        prompt_name = spec["prompts"][mode]
    prompt_path = Path(prompt_name)
    if not prompt_path.is_absolute():
        prompt_path = spec_dir / prompt_path
    return prompt_path


def _load_replay_runtime(config: dict) -> tuple[list[str], str, str]:
    runtime_target = config.get("runtime_target")
    if not isinstance(runtime_target, str) or not runtime_target.strip():
        runtime_target = "local-dev"

    environment = config.get("environment", {})
    operator_package = environment.get("operator_package")
    if not isinstance(operator_package, str) or not operator_package.strip():
        operator_package = RELEASE_OPERATOR_PACKAGE if runtime_target == "published" else LOCAL_DEV_OPERATOR_PACKAGE

    configured_cmd = environment.get("runtime_androperator_cmd")
    if isinstance(configured_cmd, list) and configured_cmd and all(isinstance(part, str) and part for part in configured_cmd):
        androperator_cmd = list(configured_cmd)
    else:
        display_cmd = environment.get("androperator_cmd")
        if runtime_target == "published" and isinstance(display_cmd, list) and display_cmd and all(isinstance(part, str) and part for part in display_cmd):
            androperator_cmd = list(display_cmd)
        else:
            androperator_cmd = _resolve_androperator_cmd(runtime_target)

    return androperator_cmd, operator_package, runtime_target


def _config_used_skill_prompt(config: dict, spec: dict) -> bool:
    skill_generation = spec.get("skill_generation")
    if not isinstance(skill_generation, dict):
        return False
    skill_prompt_name = skill_generation.get("skill_prompt")
    if not isinstance(skill_prompt_name, str) or not skill_prompt_name.strip():
        return False
    config_spec = config.get("spec")
    if not isinstance(config_spec, dict):
        return False
    prompt_file = config_spec.get("prompt_file")
    skill_prompt_file = config_spec.get("skill_prompt_file")
    return prompt_file == skill_prompt_name or skill_prompt_file == skill_prompt_name


def _public_preflight_details(preflight_details: dict | None) -> dict | None:
    if not isinstance(preflight_details, dict):
        return None
    doctor_failure = preflight_details.get("doctor_failure")
    if not isinstance(doctor_failure, dict):
        return None
    summary: dict[str, object] = {}
    for field in ("code", "summary"):
        value = doctor_failure.get(field)
        if isinstance(value, str) and value.strip():
            summary[field] = value
    return {"doctor_failure": summary} if summary else None


def _make_agent(agent_name: str, model: str, knowledge_mode: str) -> BaseAgent:
    agent_cls = SUPPORTED_AGENTS.get(agent_name)
    if agent_cls is None:
        raise SystemExit(f"unsupported agent: {agent_name}")
    config = AgentConfig(type_id=agent_name, model=model, knowledge_mode=knowledge_mode)
    return agent_cls(config)


def _model_shorthand(agent_type: str, model: str) -> str:
    prefix = f"{agent_type}-"
    if model.startswith(prefix):
        remainder = model[len(prefix):]
        return remainder.split("-", 1)[0]
    return model.split("-", 1)[0]


def _render_dry_run(
    *,
    resolved_config: dict,
    prompt_path: Path,
    prompt_sha256: str,
    command: list[str],
    work_dir: str,
    env_overrides: dict,
    prompt_text: str,
) -> None:
    print("resolved config:")
    print(json.dumps(resolved_config, indent=2, sort_keys=False))
    print(f"prompt file path: {prompt_path}")
    print(f"prompt sha256: {prompt_sha256}")
    print("exact agent command:")
    print(json.dumps(command, indent=2))
    print(f"work dir: {work_dir}")
    print("env overrides:")
    print(json.dumps(env_overrides, indent=2, sort_keys=False))
    print("substituted prompt text:")
    print(prompt_text)


def _write_json_file(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def _load_rescore_ground_truth(config: dict, result: dict) -> str:
    ground_truth = (
        config.get("environment", {}).get("ground_truth_android_version")
        or result.get("environment", {}).get("ground_truth_android_version")
    )
    if not isinstance(ground_truth, str) or not ground_truth.strip():
        raise SystemExit("rescore failed: ground truth android version missing")
    return ground_truth.strip()


def _require_object(mapping: dict, key: str, run_id: str) -> dict:
    value = mapping.get(key)
    if not isinstance(value, dict):
        raise SystemExit(
            f"rescore failed: invalid result artifact for {run_id}: missing or non-object {key}"
        )
    return value


def _resolve_run_dir(runs_dir: Path, run_id: str) -> Path:
    root = runs_dir.resolve()
    run_dir = (runs_dir / Path(run_id)).resolve()
    try:
        run_dir.relative_to(root)
    except ValueError as exc:
        raise SystemExit("rescore failed: run_id escapes runs_dir") from exc
    return run_dir


def _rescore_run(runs_dir: Path, run_id: str) -> dict:
    run_dir = _resolve_run_dir(runs_dir, run_id)
    config_path = run_dir / "config.json"
    result_path = run_dir / "result.json"
    transcript_path = run_dir / "transcript.txt"
    if not config_path.exists() or not result_path.exists() or not transcript_path.exists():
        raise SystemExit(f"rescore failed: run artifacts missing for {run_id}")

    config = json.loads(config_path.read_text(encoding="utf-8"))
    result = json.loads(result_path.read_text(encoding="utf-8"))
    transcript = transcript_path.read_text(encoding="utf-8")
    ground_truth = _load_rescore_ground_truth(config, result)
    rescored = dict(result)
    outcome = _require_object(result, "outcome", run_id)
    metrics = _require_object(result, "metrics", run_id)
    rescored["outcome"] = dict(outcome)
    score_result = score(transcript, ground_truth)
    rescored["outcome"]["answer_extracted_raw"] = score_result.answer_extracted_raw
    rescored["outcome"]["answer_normalized"] = score_result.answer_normalized
    rescored["outcome"]["ground_truth_normalized"] = score_result.ground_truth_normalized
    rescored["outcome"]["answer_correct"] = score_result.answer_correct
    if score_result.answer_extracted_raw is not None:
        rescored["outcome"]["status"] = "pass" if score_result.answer_correct else "fail"
    else:
        rescored["outcome"]["status"] = "no_answer"
    rescored["outcome"]["failure_reason"] = None
    rescored["metrics"] = dict(metrics)
    rescored["metrics"]["answer_emitted"] = score_result.answer_extracted_raw is not None
    rescored["metrics"]["used_disallowed_tool"] = bool(score_result.used_disallowed_tool)
    violations = dict(rescored["metrics"].get("violations", {}))
    violations["used_adb"] = bool(score_result.used_disallowed_tool)
    rescored["metrics"]["violations"] = violations
    eval_id = config.get("eval_id") or result.get("eval_id")
    if isinstance(eval_id, str):
        spec = _load_spec(eval_id)
        skill_generation = spec.get("skill_generation")
        skill_score = result.get("skill_score")
        if skill_generation and (_config_used_skill_prompt(config, spec) or isinstance(skill_score, dict)):
            androperator_cmd, operator_package, _ = _load_replay_runtime(config)
            prepared_skill_score = _synthesize_skill_score_for_contract(
                transcript=transcript,
                skill_generation=skill_generation,
                androperator_cmd=androperator_cmd,
                operator_package=operator_package,
                existing_skill_score=skill_score if isinstance(skill_score, dict) else None,
            )
            rescored_skill_score = _apply_skill_generation_contract(
                prepared_skill_score,
                transcript,
                skill_generation,
            )
            rescored = _apply_skill_generation_outcome(rescored, rescored_skill_score)
    result_rescored_path = run_dir / "result-rescored.json"
    _write_json_file(result_rescored_path, rescored)
    return rescored


def _write_preflight_failure_run(
    *,
    args: argparse.Namespace,
    spec: dict,
    agent: BaseAgent,
    failure_reason: str,
    runtime_inputs: RuntimeInputs | None = None,
    skill_prompt: str | None = None,
    preflight_details: dict | None = None,
) -> Path:
    runs_dir = Path(args.runs_dir)
    run_id = make_run_id(args.eval_id, args.agent, args.model, args.label)
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    prompt_path = _resolve_prompt_path(args.eval_id, spec, args.mode, skill_prompt)
    androperator_cmd = (
        runtime_inputs.androperator_cmd
        if runtime_inputs is not None
        else (["androperator"] if args.runtime == "published" else ["node", str(REPO_ROOT / "apps/node/dist/cli/index.js")])
    )
    display_androperator_cmd = list(androperator_cmd)
    default_operator_package = RELEASE_OPERATOR_PACKAGE if args.runtime == "published" else LOCAL_DEV_OPERATOR_PACKAGE
    if runtime_inputs is not None:
        operator_package = runtime_inputs.operator_package
    elif args.runtime == "published":
        operator_package = RELEASE_OPERATOR_PACKAGE
    else:
        env_operator_package = os.environ.get("ANDROPERATOR_OPERATOR_PACKAGE")
        operator_package = (
            env_operator_package.strip()
            if env_operator_package is not None and env_operator_package.strip()
            else default_operator_package
        )
    work_dir = str(ROOT) if args.mode == "full-repo" else "<tempdir>"
    cwd_display = str(ROOT) if args.mode == "full-repo" else "<redacted>"
    runs_dir_display = str(runs_dir) if args.mode == "full-repo" else "<redacted>"
    launcher_work_dir: tempfile.TemporaryDirectory[str] | None = None
    if args.mode == "public-surface":
        launcher_work_dir = tempfile.TemporaryDirectory(prefix="androperator-eval-preflight-")
        display_androperator_cmd, _ = _prepare_androperator_launcher(
            Path(launcher_work_dir.name),
            androperator_cmd,
            args.mode,
            args.runtime,
        )
    prompt_text = build_prompt(
        str(prompt_path),
        {
            **{
                "ANDROPERATOR_CMD": shlex.join(display_androperator_cmd),
                "ANDROPERATOR_OPERATOR_PACKAGE": operator_package,
                "DEVICE_SERIAL": runtime_inputs.device_serial if runtime_inputs is not None else "<unresolved>",
                "DOCS_URL": "https://docs.androperator.com",
            },
            **({"REPO_ROOT": str(REPO_ROOT)} if args.mode == "full-repo" else {}),
        },
    )
    prompt_sha256 = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()
    command = agent.build_command(prompt_text, work_dir)
    persisted_preflight_details = (
        _public_preflight_details(preflight_details) if args.mode == "public-surface" else preflight_details
    )
    started_at = finished_at = format_timestamp()
    result = {
        "run_id": run_id,
        "eval_id": args.eval_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "agent": {
            "type": args.agent,
            "model": args.model,
            "extra_flags": list(agent.config.extra_flags),
        },
        "knowledge_mode": args.mode,
        "runtime_target": args.runtime,
        "spec": {
            "eval_version": spec.get("version", spec.get("eval_version", "1.0.0")),
            "prompt_file": prompt_path.name,
            "prompt_sha256": prompt_sha256,
            **({"skill_prompt_file": prompt_path.name} if skill_prompt is not None else {}),
        },
        "run_label": args.label,
        "invocation": {
            "command": command,
            "work_dir": work_dir,
            "env_overrides": {},
        },
        "environment": {
            "device_serial": runtime_inputs.device_serial if runtime_inputs is not None else None,
            "ground_truth_android_version": None,
            "ground_truth_collected_at": None,
            "ground_truth_rechecked_at": None,
            "androperator_cmd": display_androperator_cmd,
            "runtime_androperator_cmd": androperator_cmd,
            "androperator_version": runtime_inputs.androperator_version if runtime_inputs is not None else None,
            "androperator_npm_version": runtime_inputs.androperator_npm_version if runtime_inputs is not None else None,
            "operator_package": operator_package,
            "cwd": cwd_display,
            "runs_dir": runs_dir_display,
        },
        "outcome": {
            "status": "error",
            "answer_extracted_raw": None,
            "answer_normalized": None,
            "ground_truth_normalized": None,
            "answer_correct": False,
            "failure_reason": failure_reason,
        },
        **({"preflight": persisted_preflight_details} if persisted_preflight_details is not None else {}),
        "metrics": {
            "wall_clock_s": 0.0,
            "time_to_first_androperator_command_s": None,
            "timeout_budget_s": args.timeout_s,
            "androperator_commands_detected": 0,
            "actions_per_turn": None,
            "answer_emitted": False,
            "violations": {"used_adb": False},
            "diagnostics": {
                "used_snapshot": False,
                "used_open_settings": False,
                "navigated_settings": False,
                "failure_classification": "unknown",
                "domains_accessed": [],
            },
            "used_disallowed_tool": False,
            "turns_counted": None,
            "turns_budget": args.max_turns,
        },
        "artifacts": {"transcript": "transcript.txt", "config": "config.json"},
    }
    config = {
        "run_id": run_id,
        "eval_id": args.eval_id,
        "agent": {
            "type": args.agent,
            "model": args.model,
            "extra_flags": list(agent.config.extra_flags),
        },
        "knowledge_mode": args.mode,
        "runtime_target": args.runtime,
        "spec": {
            "prompt_file": prompt_path.name,
            "prompt_sha256": prompt_sha256,
            **({"skill_prompt_file": prompt_path.name} if skill_prompt is not None else {}),
        },
        "run_label": args.label,
        "invocation": {
            "command": command,
            "work_dir": work_dir,
            "env_overrides": {},
        },
        "environment": {
            "device_serial": runtime_inputs.device_serial if runtime_inputs is not None else None,
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "cwd": cwd_display,
            "agent_binary_version": "unknown",
            "env_hash": "",
            "runs_dir": runs_dir_display,
            "androperator_cmd": display_androperator_cmd,
            "runtime_androperator_cmd": androperator_cmd,
            "ground_truth_android_version": None,
            "androperator_npm_version": runtime_inputs.androperator_npm_version if runtime_inputs is not None else None,
            "operator_package": operator_package,
        },
        "timeout_s": args.timeout_s,
        "max_turns": args.max_turns,
        **({"preflight": persisted_preflight_details} if persisted_preflight_details is not None else {}),
    }
    write_run(run_dir, result, config, "")
    if launcher_work_dir is not None:
        launcher_work_dir.cleanup()
    return run_dir


def _minimal_base_env() -> dict[str, str]:
    return {
        "PATH": os.environ["PATH"],
        "HOME": os.environ["HOME"],
        "USER": os.environ.get("USER", ""),
        "LOGNAME": os.environ.get("LOGNAME", os.environ.get("USER", "")),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
    }


def _sanitize_env_overrides(env_overrides: dict[str, str]) -> dict[str, str]:
    redacted: dict[str, str] = {}
    for key, value in env_overrides.items():
        if any(token in key.upper() for token in ("KEY", "SECRET", "TOKEN", "PASSWORD")):
            redacted[key] = "[REDACTED]"
        else:
            redacted[key] = value
    return redacted


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="evals/run_eval.py")
    parser.add_argument("eval_id")
    parser.add_argument("--agent", choices=sorted(SUPPORTED_AGENTS))
    parser.add_argument("--model")
    parser.add_argument("--device")
    parser.add_argument("--operator-package")
    parser.add_argument("--mode", default="public-surface", choices=sorted(SUPPORTED_MODES))
    parser.add_argument("--runtime", default="local-dev", choices=sorted(SUPPORTED_RUNTIMES))
    parser.add_argument("--timeout-s", type=int)
    parser.add_argument("--max-turns", type=int)
    parser.add_argument("--skill-prompt")
    parser.add_argument("--replay")
    parser.add_argument("--replay-timeout-s", type=int, default=DEFAULT_REPLAY_TIMEOUT_S)
    parser.add_argument("--label")
    parser.add_argument("--runs-dir", default=str(ROOT / "evals" / "runs"))
    parser.add_argument("--artifacts-dir", default=argparse.SUPPRESS)
    parser.add_argument("--skills-registry", default=argparse.SUPPRESS)
    parser.add_argument("--runs", type=int, default=argparse.SUPPRESS)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rescore", nargs="?", const="")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.eval_id == SOLAX_COLD_START_EVAL_ID:
        if args.agent is not None:
            parser.error("--agent is not supported for solax-orchestrated-cold-start")
        if args.model is not None:
            parser.error("--model is not supported for solax-orchestrated-cold-start")
        if args.skill_prompt is not None:
            parser.error("--skill-prompt is not supported for solax-orchestrated-cold-start")
        if args.replay is not None:
            parser.error("--replay is not supported for solax-orchestrated-cold-start")
        if args.rescore is not None:
            parser.error("--rescore is not supported for solax-orchestrated-cold-start")
        if args.timeout_s is not None and args.timeout_s != DEFAULT_ANDROID_TIMEOUT_S:
            parser.error("--timeout-s is not supported for solax-orchestrated-cold-start")
        if args.max_turns is not None and args.max_turns != DEFAULT_ANDROID_MAX_TURNS:
            parser.error("--max-turns is not supported for solax-orchestrated-cold-start")
        if args.runs_dir != str(ROOT / "evals" / "runs"):
            parser.error("--runs-dir is not supported for solax-orchestrated-cold-start")
        batch_dir = run_solax_orchestrated_cold_start_eval(
            device_serial=args.device,
            operator_package=args.operator_package,
            runtime=args.runtime,
            runs=getattr(args, "runs", 1),
            artifacts_dir=Path(getattr(args, "artifacts_dir", str(ROOT / "evals" / "artifacts"))),
            skills_registry=Path(getattr(args, "skills_registry", str(DEFAULT_SKILLS_REGISTRY))),
            label=args.label,
            dry_run=args.dry_run,
        )
        print(batch_dir)
        if not args.dry_run:
            summary = json.loads((batch_dir / "summary.json").read_text(encoding="utf-8"))
            print(
                f"{summary['aggregate_status'].upper()} | cold-start | "
                f"{summary['counts']['cold_start_verified']}/{summary['runs_requested']} verified"
            )
        return 0

    if args.eval_id != "android-version":
        raise SystemExit(f"unsupported eval: {args.eval_id}")
    if args.operator_package is not None:
        parser.error("--operator-package is only supported for solax-orchestrated-cold-start")
    if hasattr(args, "artifacts_dir"):
        parser.error("--artifacts-dir is only supported for solax-orchestrated-cold-start")
    if hasattr(args, "skills_registry"):
        parser.error("--skills-registry is only supported for solax-orchestrated-cold-start")
    if hasattr(args, "runs"):
        parser.error("--runs is only supported for solax-orchestrated-cold-start")
    if args.timeout_s is not None and args.timeout_s <= 0:
        parser.error("--timeout-s must be greater than 0")
    if args.max_turns is not None and args.max_turns <= 0:
        parser.error("--max-turns must be greater than 0")

    spec = _load_spec(args.eval_id)
    spec["runtime_target"] = args.runtime
    args.timeout_s, args.max_turns = _resolve_android_eval_budget(args, spec)

    if args.replay is not None:
        if not args.replay:
            raise SystemExit("replay failed: missing run_id")
        run_dir = _resolve_run_dir(Path(args.runs_dir), args.replay)
        config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
        androperator_cmd, operator_package, runtime_target = _load_replay_runtime(config)
        device_serial = config.get("environment", {}).get("device_serial")
        if not isinstance(device_serial, str) or not device_serial.strip():
            raise SystemExit("replay failed: run artifacts missing environment.device_serial")
        skill_score = run_replay(
            run_dir=run_dir,
            androperator_cmd=androperator_cmd,
            operator_package=operator_package,
            device_serial=device_serial,
            timeout_s=args.replay_timeout_s,
        )
        result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
        eval_id = config.get("eval_id") or result.get("eval_id")
        if isinstance(eval_id, str):
            spec = _load_spec(eval_id)
            skill_score = _apply_skill_generation_contract(
                dict(skill_score),
                (run_dir / "transcript.txt").read_text(encoding="utf-8"),
                spec.get("skill_generation"),
            )
        replay_result = _apply_skill_generation_outcome(result, skill_score)
        _write_json_file(run_dir / "result-replay.json", replay_result)
        status = replay_result.get("outcome", {}).get("status", skill_score["replay_status"]).upper()
        answer = skill_score["replay_answer_normalized"] or "none"
        print(run_dir)
        print(f"{status} | replay/{runtime_target} | {skill_score['replay_wall_clock_s']:.1f}s | answer={answer}")
        return 0

    if args.rescore is not None:
        run_id = args.rescore
        if not run_id:
            raise SystemExit("rescore failed: missing run_id")
        run_dir = _resolve_run_dir(Path(args.runs_dir), run_id)
        rescored = _rescore_run(Path(args.runs_dir), run_id)
        status = rescored["outcome"]["status"].upper()
        answer = rescored["outcome"]["answer_normalized"] or "none"
        duration = rescored["metrics"].get("wall_clock_s", 0.0)
        print(run_dir)
        print(f"{status} | rescored | {duration:.1f}s | answer={answer}")
        return 0

    if args.agent is None or args.model is None:
        raise SystemExit("--agent and --model are required unless --rescore is used")

    agent = _make_agent(args.agent, args.model, args.mode)
    resolved_config = {
        "eval_id": args.eval_id,
        "agent": {
            "type": args.agent,
            "model": args.model,
            "knowledge_mode": args.mode,
        },
        "runtime_target": args.runtime,
        "device_serial": None,
        "timeout_s": args.timeout_s,
        "max_turns": args.max_turns,
        "label": args.label,
        "runs_dir": "<redacted>" if args.mode == "public-surface" else str(Path(args.runs_dir)),
    }

    if args.dry_run:
        try:
            inputs = resolve_inputs(args.device, args.runtime)
        except EnvironmentError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        resolved_config["device_serial"] = inputs.device_serial
        dry_run_work_dir = Path(tempfile.mkdtemp(prefix="androperator-eval-")) if args.mode == "public-surface" else REPO_ROOT
        display_androperator_cmd, path_prefix = _prepare_androperator_launcher(
            dry_run_work_dir,
            inputs.androperator_cmd,
            args.mode,
            args.runtime,
        )
        resolved_config["androperator_cmd"] = display_androperator_cmd
        resolved_config["operator_package"] = inputs.operator_package
        resolved_config["androperator_version"] = inputs.androperator_version
        resolved_config["androperator_npm_version"] = inputs.androperator_npm_version
        prompt_path = _resolve_prompt_path(args.eval_id, spec, args.mode, args.skill_prompt)
        prompt_text = build_prompt(
            str(prompt_path),
            {
                "ANDROPERATOR_CMD": shlex.join(display_androperator_cmd),
                "ANDROPERATOR_OPERATOR_PACKAGE": inputs.operator_package,
                "DEVICE_SERIAL": inputs.device_serial,
                "DOCS_URL": "https://docs.androperator.com",
                **({"REPO_ROOT": str(REPO_ROOT)} if args.mode == "full-repo" else {}),
            },
        )
        prompt_sha256 = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()
        command = agent.build_command(prompt_text, str(dry_run_work_dir))
        base_env = _minimal_base_env()
        if path_prefix is not None:
            base_env["PATH"] = f"{path_prefix}{os.pathsep}{base_env['PATH']}"
        env_overrides = _sanitize_env_overrides({
            "ANDROID_SERIAL": inputs.device_serial,
            "ANDROPERATOR_CMD": shlex.join(display_androperator_cmd),
            "ANDROPERATOR_OPERATOR_PACKAGE": inputs.operator_package,
            **({"EVAL_LABEL": args.label} if args.label is not None else {}),
            **agent.build_env({
                **base_env,
                "ANDROID_SERIAL": inputs.device_serial,
                "ANDROPERATOR_CMD": shlex.join(display_androperator_cmd),
                "ANDROPERATOR_OPERATOR_PACKAGE": inputs.operator_package,
            }),
        })
        try:
            _render_dry_run(
                resolved_config=resolved_config,
                prompt_path=prompt_path,
                prompt_sha256=prompt_sha256,
                command=command,
                work_dir=str(dry_run_work_dir),
                env_overrides=env_overrides,
                prompt_text=prompt_text,
            )
        finally:
            if args.mode == "public-surface":
                shutil.rmtree(dry_run_work_dir, ignore_errors=True)
        return 0

    try:
        inputs = resolve_inputs(args.device, args.runtime)
    except EnvironmentError as exc:
        run_dir = _write_preflight_failure_run(
            args=args,
            spec=spec,
            agent=agent,
            failure_reason=str(exc),
            runtime_inputs=None,
            skill_prompt=args.skill_prompt,
            preflight_details=getattr(exc, "details", None),
        )
        result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
        status = result["outcome"]["status"].upper()
        answer = result["outcome"]["answer_normalized"] or "none"
        duration = result["metrics"]["wall_clock_s"]
        print(run_dir)
        print(f"{status} | {args.agent}/{_model_shorthand(args.agent, args.model)} | {duration:.1f}s | answer={answer}")
        return 0

    try:
        env = preflight(args.device, args.runtime, resolved_inputs=inputs)
    except EnvironmentError as exc:
        run_dir = _write_preflight_failure_run(
            args=args,
            spec=spec,
            agent=agent,
            failure_reason=str(exc),
            runtime_inputs=inputs,
            skill_prompt=args.skill_prompt,
            preflight_details=getattr(exc, "details", None),
        )
        result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
        status = result["outcome"]["status"].upper()
        answer = result["outcome"]["answer_normalized"] or "none"
        duration = result["metrics"]["wall_clock_s"]
        print(run_dir)
        print(f"{status} | {args.agent}/{_model_shorthand(args.agent, args.model)} | {duration:.1f}s | answer={answer}")
        return 0

    run_dir = run_eval(
        spec=spec,
        env=env,
        agent=agent,
        knowledge_mode=args.mode,
        timeout_s=args.timeout_s,
        runs_dir=Path(args.runs_dir),
        label=args.label,
        max_turns=args.max_turns,
        skill_prompt_name=args.skill_prompt,
    )

    result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    status = result["outcome"]["status"].upper()
    answer = result["outcome"]["answer_normalized"] or "none"
    duration = result["metrics"]["wall_clock_s"]
    print(run_dir)
    print(f"{status} | {args.agent}/{_model_shorthand(args.agent, args.model)} | {duration:.1f}s | answer={answer}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
