from __future__ import annotations

from dataclasses import dataclass
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




def detect_disallowed_tool(transcript: str) -> bool:
    cleaned = _ANSI_PATTERN.sub("", transcript)
    return _DISALLOWED_TOOL_PATTERN.search(cleaned) is not None
















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
