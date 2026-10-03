from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath
import re
import json
from typing import Any


ANSWER_PATTERN = re.compile(r"^ANDROPERATOR_EVAL_ANSWER:\s*(\S.*?)\s*$", re.MULTILINE)
_WRAPPED_ANSWER_PATTERN = re.compile(
    r"^ANDROPERATOR_(?:\s*\n\s*)EVAL_ANSWER:\s*(\S.*?)\s*$",
    re.MULTILINE,
)
_ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_DISALLOWED_TOOL_PATTERN = re.compile(r"^(?:\$|>)\s+adb\s+shell\b", re.MULTILINE | re.IGNORECASE)


def normalize_version(v: str) -> str:
    v = v.strip().lower()
    if v.startswith("android "):
        v = v[len("android "):].strip()
    match = re.search(r"\d+", v)
    return match.group(0) if match else v


def extract_answer(transcript: str) -> str | None:
    matches = ANSWER_PATTERN.findall(transcript)
    if matches:
        return matches[-1]
    wrapped_matches = _WRAPPED_ANSWER_PATTERN.findall(transcript)
    return wrapped_matches[-1] if wrapped_matches else None


def extract_answer_from_line(line: str) -> str | None:
    matches = ANSWER_PATTERN.findall(line)
    if matches:
        return matches[-1]
    wrapped_matches = _WRAPPED_ANSWER_PATTERN.findall(line)
    return wrapped_matches[-1] if wrapped_matches else None


def _iter_text_values(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _iter_text_values(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _iter_text_values(item)


def extract_answer_from_json_line(line: str) -> str | None:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    # Handle Kimi CLI format: {"role": "assistant", "content": [...]}
    if payload.get("role") == "assistant":
        content = payload.get("content")
        if isinstance(content, list):
            text_parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text = item.get("text")
                    if isinstance(text, str):
                        text_parts.append(text)
            if text_parts:
                match = extract_answer_from_line("".join(text_parts))
                if match is not None:
                    return match
        elif isinstance(content, str):
            match = extract_answer_from_line(content)
            if match is not None:
                return match

    payload_type = payload.get("type")
    if payload_type == "assistant":
        message = payload.get("message")
        if isinstance(message, dict):
            for text in _iter_text_values(message.get("content")):
                match = extract_answer_from_line(text)
                if match is not None:
                    return match
    elif payload_type == "message":
        if payload.get("role") == "assistant":
            for text in _iter_text_values(payload.get("content")):
                match = extract_answer_from_line(text)
                if match is not None:
                    return match
    elif payload_type == "result":
        result_text = payload.get("result")
        if isinstance(result_text, str):
            match = extract_answer_from_line(result_text)
            if match is not None:
                return match
    elif payload_type == "item.completed":
        item = payload.get("item")
        if isinstance(item, dict) and item.get("type") == "agent_message":
            text = item.get("text")
            if isinstance(text, str):
                match = extract_answer_from_line(text)
                if match is not None:
                    return match
    return None


def extract_answer_from_transcript(transcript: str) -> str | None:
    answer = extract_answer(transcript)
    if answer is not None:
        return answer
    for line in transcript.splitlines():
        answer = extract_answer_from_line(line)
        if answer is not None:
            return answer
        answer = extract_answer_from_json_line(line)
        if answer is not None:
            return answer
    return None


def extract_skill(transcript: str, start_marker: str, end_marker: str) -> str | None:
    pattern = re.compile(
        r"^[ \t]*"
        + re.escape(start_marker)
        + r"[ \t]*$\n?"
        + r"(.*?)"
        + r"\n?^[ \t]*"
        + re.escape(end_marker)
        + r"[ \t]*$",
        re.DOTALL | re.MULTILINE,
    )
    matches = pattern.findall(transcript)
    if not matches:
        return None
    candidate = matches[-1].strip()
    decoded: Any = candidate
    for _ in range(2):
        if not isinstance(decoded, str):
            break
        try:
            parsed = json.loads(decoded)
        except json.JSONDecodeError:
            break
        if isinstance(parsed, str):
            decoded = parsed.strip()
            continue
        return decoded if isinstance(decoded, str) else candidate
    if isinstance(decoded, str):
        return decoded.strip()
    return candidate


def detect_disallowed_tool(transcript: str) -> bool:
    cleaned = _ANSI_PATTERN.sub("", transcript)
    return _DISALLOWED_TOOL_PATTERN.search(cleaned) is not None


def _require_string_field(payload: dict[str, Any], field: str, errors: list[str]) -> None:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        errors.append(f"missing or invalid string field: {field}")


def _require_string_list_field(payload: dict[str, Any], field: str, errors: list[str], *, allow_empty: bool = True) -> None:
    value = payload.get(field)
    if not isinstance(value, list):
        errors.append(f"missing or invalid array field: {field}")
        return
    if not allow_empty and len(value) == 0:
        errors.append(f"array field must not be empty: {field}")
        return
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"invalid string item in {field}[{index}]")


def _require_inline_content_coverage(
    payload: dict[str, Any],
    *,
    paths_field: str,
    contents_field: str,
    errors: list[str],
) -> None:
    paths = payload.get(paths_field)
    if not isinstance(paths, list):
        return
    contents = payload.get(contents_field)
    if not isinstance(contents, dict):
        if len(paths) > 0:
            errors.append(f"missing or invalid object field: {contents_field}")
        return
    for path in paths:
        if not isinstance(path, str) or not path.strip():
            continue
        content = contents.get(path)
        if not isinstance(content, str):
            errors.append(f"missing inline content for {path} in {contents_field}")


def _is_safe_relative_path(value: str) -> bool:
    if "\\" in value:
        return False
    windows_candidate = PureWindowsPath(value)
    if windows_candidate.is_absolute() or windows_candidate.drive or windows_candidate.root:
        return False
    if any(part == ".." for part in windows_candidate.parts):
        return False
    candidate = PurePosixPath(value)
    if candidate.is_absolute():
        return False
    return not any(part == ".." for part in candidate.parts)


def _require_safe_path_field(payload: dict[str, Any], field: str, errors: list[str]) -> None:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        return
    if not _is_safe_relative_path(value.strip()):
        errors.append(f"unsafe path field: {field}")


def _require_safe_path_list_field(payload: dict[str, Any], field: str, errors: list[str]) -> None:
    value = payload.get(field)
    if not isinstance(value, list):
        return
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            continue
        if not _is_safe_relative_path(item.strip()):
            errors.append(f"unsafe path in {field}[{index}]")


def validate_skill(skill_json: str, androperator_cmd: list[str], operator_package: str) -> tuple[bool, list[str]]:
    errors: list[str] = []
    try:
        payload = json.loads(skill_json)
    except json.JSONDecodeError as exc:
        return False, [f"invalid JSON: {exc.msg}"]

    if not isinstance(payload, dict):
        return False, ["skill payload must be a JSON object"]

    required_fields = (
        "id",
        "applicationId",
        "intent",
        "summary",
        "path",
        "skillFile",
        "scripts",
        "artifacts",
    )
    for field in required_fields:
        if field in {"scripts", "artifacts"}:
            continue
        _require_string_field(payload, field, errors)

    _require_string_list_field(payload, "scripts", errors, allow_empty=False)
    _require_string_list_field(payload, "artifacts", errors, allow_empty=True)
    for field in ("path", "skillFile"):
        _require_safe_path_field(payload, field, errors)
    _require_safe_path_list_field(payload, "scripts", errors)
    _require_safe_path_list_field(payload, "artifacts", errors)
    _require_inline_content_coverage(payload, paths_field="scripts", contents_field="scriptContents", errors=errors)
    _require_inline_content_coverage(payload, paths_field="artifacts", contents_field="artifactContents", errors=errors)

    if errors:
        return False, errors

    return True, []


@dataclass
class ScorerResult:
    answer_extracted_raw: str | None
    answer_normalized: str | None
    ground_truth_normalized: str
    answer_correct: bool
    used_disallowed_tool: bool


def score(
    transcript: str,
    ground_truth: str,
    answer_extracted_raw: str | None = None,
    allow_transcript_fallback: bool = True,
) -> ScorerResult:
    raw_answer = answer_extracted_raw
    if raw_answer is None and allow_transcript_fallback:
        raw_answer = extract_answer_from_transcript(transcript)
    answer_normalized = normalize_version(raw_answer) if raw_answer is not None else None
    ground_truth_normalized = normalize_version(ground_truth)
    answer_correct = answer_normalized is not None and answer_normalized == ground_truth_normalized
    return ScorerResult(
        answer_extracted_raw=raw_answer,
        answer_normalized=answer_normalized,
        ground_truth_normalized=ground_truth_normalized,
        answer_correct=answer_correct,
        used_disallowed_tool=detect_disallowed_tool(transcript),
    )
