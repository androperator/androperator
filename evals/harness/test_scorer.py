from __future__ import annotations

from evals.harness.scorer import (
    extract_answer,
    extract_answer_from_transcript,
    extract_skill,
    normalize_version,
    score,
    validate_skill,
)


def test_normalize_version():
    assert normalize_version("15") == "15"
    assert normalize_version("Android 15") == "15"
    assert normalize_version("android 15") == "15"
    assert normalize_version("  Android 15  ") == "15"
    assert normalize_version("14") == "14"


def test_extract_answer_last_occurrence_wins():
    transcript_single = "some output\nANDROPERATOR_EVAL_ANSWER: 15\nmore output"
    assert extract_answer(transcript_single) == "15"

    transcript_multi = "ANDROPERATOR_EVAL_ANSWER: 14\nlater...\nANDROPERATOR_EVAL_ANSWER: 15"
    assert extract_answer(transcript_multi) == "15"

    transcript_none = "no answer here"
    assert extract_answer(transcript_none) is None


def test_score_pass():
    result = score("ANDROPERATOR_EVAL_ANSWER: Android 15\n", "15")
    assert result.answer_correct is True
    assert result.answer_normalized == "15"
    assert result.answer_extracted_raw == "Android 15"


def test_score_fail():
    result = score("ANDROPERATOR_EVAL_ANSWER: 14\n", "15")
    assert result.answer_correct is False


def test_score_no_answer():
    result = score("no answer", "15")
    assert result.answer_correct is False
    assert result.answer_extracted_raw is None


def test_score_can_disable_transcript_fallback():
    result = score("ANDROPERATOR_EVAL_ANSWER: 15\n", "15", allow_transcript_fallback=False)
    assert result.answer_correct is False
    assert result.answer_extracted_raw is None


def test_extract_answer_malformed_marker_no_value():
    transcript_malformed = "ANDROPERATOR_EVAL_ANSWER:\n"
    assert extract_answer(transcript_malformed) is None


def test_extract_answer_whitespace_only():
    transcript_whitespace_only = "ANDROPERATOR_EVAL_ANSWER:   \n"
    assert extract_answer(transcript_whitespace_only) is None


def test_extract_answer_inside_json_blob_does_not_match():
    transcript_inside_json = '{"output": "ANDROPERATOR_EVAL_ANSWER: 15"}'
    assert extract_answer(transcript_inside_json) is None


def test_extract_answer_from_assistant_json_line():
    transcript_json_line = (
        '{"type":"assistant","message":{"role":"assistant","content":['
        '{"type":"text","text":"The snapshot clearly shows the Android version.\\n\\nANDROPERATOR_EVAL_ANSWER: 16"}'
        ']}}'
    )
    assert extract_answer_from_transcript(transcript_json_line) == "16"


def test_extract_answer_from_result_json_line():
    transcript_result_json = (
        '{"type":"result","result":"The snapshot clearly shows the Android version.\\n\\nANDROPERATOR_EVAL_ANSWER: 16"}'
    )
    assert extract_answer_from_transcript(transcript_result_json) == "16"


def test_extract_answer_from_kimi_json_line_with_string_content():
    transcript_kimi_string = (
        '{"role":"assistant","content":"The snapshot clearly shows the Android version.\\n\\nANDROPERATOR_EVAL_ANSWER: 16"}'
    )
    assert extract_answer_from_transcript(transcript_kimi_string) == "16"


def test_extract_answer_from_kimi_json_line_with_text_item_list():
    transcript_kimi_list = (
        '{"role":"assistant","content":['
        '{"type":"text","text":"The snapshot clearly shows the Android version.\\n\\nANDROPERATOR_"},'
        '{"type":"text","text":"EVAL_ANSWER: "},'
        '{"type":"text","text":"16"}'
        ']}'
    )
    assert extract_answer_from_transcript(transcript_kimi_list) == "16"


def test_extract_answer_ignores_tool_role_message_json():
    transcript_tool_json = (
        '{"type":"message","role":"tool","content":"ANDROPERATOR_EVAL_ANSWER: 16"}'
    )
    assert extract_answer_from_transcript(transcript_tool_json) is None


def test_extract_answer_line_start_inside_multiline_string_matches():
    transcript_linestart = "some output\nANDROPERATOR_EVAL_ANSWER: 15\nmore output"
    assert extract_answer(transcript_linestart) == "15"


def test_extract_answer_multiword_answer_is_captured():
    transcript_multiword = "ANDROPERATOR_EVAL_ANSWER: Android 15\n"
    assert extract_answer(transcript_multiword) == "Android 15"


def test_extract_answer_trailing_whitespace_is_stripped():
    transcript_trailing = "ANDROPERATOR_EVAL_ANSWER: 15   \n"
    assert extract_answer(transcript_trailing) == "15"


def test_extract_answer_wrapped_marker_is_captured():
    transcript_wrapped = "The device page is visible.\nANDROPERATOR_\nEVAL_ANSWER: 15\n"
    assert extract_answer(transcript_wrapped) == "15"
    assert extract_answer_from_transcript(transcript_wrapped) == "15"


def test_extract_skill_single_block():
    transcript = "before\nANDROPERATOR_SKILL_START\n{\"foo\":1}\nANDROPERATOR_SKILL_END\nafter"
    assert extract_skill(transcript, "ANDROPERATOR_SKILL_START", "ANDROPERATOR_SKILL_END") == "{\"foo\":1}"


def test_extract_skill_last_block_wins():
    transcript = (
        "ANDROPERATOR_SKILL_START\n{\"v\":1}\nANDROPERATOR_SKILL_END\n"
        "ANDROPERATOR_SKILL_START\n{\"v\":2}\nANDROPERATOR_SKILL_END"
    )
    assert extract_skill(transcript, "ANDROPERATOR_SKILL_START", "ANDROPERATOR_SKILL_END") == "{\"v\":2}"


def test_extract_skill_decodes_json_string_literal_block():
    transcript = (
        "ANDROPERATOR_SKILL_START\n"
        "\"{\\\"id\\\":\\\"com.example.android-version\\\",\\\"applicationId\\\":\\\"com.example\\\","
        "\\\"intent\\\":\\\"android-version\\\",\\\"summary\\\":\\\"Determine Android version\\\","
        "\\\"path\\\":\\\"skills/com.example.android-version\\\","
        "\\\"skillFile\\\":\\\"skills/com.example.android-version/SKILL.md\\\","
        "\\\"scripts\\\":[\\\"skills/com.example.android-version/scripts/run.js\\\"],"
        "\\\"artifacts\\\":[]}\"\n"
        "ANDROPERATOR_SKILL_END"
    )
    assert extract_skill(transcript, "ANDROPERATOR_SKILL_START", "ANDROPERATOR_SKILL_END") == (
        "{\"id\":\"com.example.android-version\",\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\",\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"artifacts\":[]}"
    )


def test_extract_skill_no_block():
    assert extract_skill("no markers here", "ANDROPERATOR_SKILL_START", "ANDROPERATOR_SKILL_END") is None


def test_extract_skill_requires_standalone_marker_lines():
    transcript = 'before "ANDROPERATOR_SKILL_START {\\\"foo\\\":1} ANDROPERATOR_SKILL_END" after'
    assert extract_skill(transcript, "ANDROPERATOR_SKILL_START", "ANDROPERATOR_SKILL_END") is None


def test_validate_skill_accepts_minimal_registry_shape():
    skill_json = (
        "{\"id\":\"com.example.android-version\",\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\",\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"scriptContents\":{\"skills/com.example.android-version/scripts/run.js\":\"console.log('hi')\\n\"},"
        "\"artifacts\":[]}"
    )
    ok, errors = validate_skill(skill_json, ["androperator"], "com.androperator.operator.dev")
    assert ok is True
    assert errors == []


def test_validate_skill_rejects_invalid_json():
    ok, errors = validate_skill("{not-json}", ["androperator"], "com.androperator.operator.dev")
    assert ok is False
    assert errors and errors[0].startswith("invalid JSON:")


def test_validate_skill_rejects_missing_required_fields():
    skill_json = (
        "{\"id\":\"com.example.android-version\","
        "\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\","
        "\"summary\":\"\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[],"
        "\"artifacts\":[]}"
    )
    ok, errors = validate_skill(skill_json, ["androperator"], "com.androperator.operator.dev")
    assert ok is False
    assert "missing or invalid string field: summary" in errors
    assert "array field must not be empty: scripts" in errors


def test_validate_skill_rejects_blank_required_strings():
    skill_json = (
        "{\"id\":\" \",\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\",\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"scriptContents\":{\"skills/com.example.android-version/scripts/run.js\":\"console.log('hi')\\n\"},"
        "\"artifacts\":[]}"
    )
    ok, errors = validate_skill(skill_json, ["androperator"], "com.androperator.operator.dev")
    assert ok is False
    assert "missing or invalid string field: id" in errors


def test_validate_skill_rejects_missing_inline_script_contents():
    skill_json = (
        "{\"id\":\"com.example.android-version\",\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\",\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"artifacts\":[]}"
    )
    ok, errors = validate_skill(skill_json, ["androperator"], "com.androperator.operator.dev")
    assert ok is False
    assert "missing or invalid object field: scriptContents" in errors


def test_validate_skill_rejects_missing_inline_artifact_contents():
    skill_json = (
        "{\"id\":\"com.example.android-version\",\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\",\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"skills/com.example.android-version/scripts/run.js\"],"
        "\"scriptContents\":{\"skills/com.example.android-version/scripts/run.js\":\"console.log('hi')\\n\"},"
        "\"artifacts\":[\"skills/com.example.android-version/version.txt\"]}"
    )
    ok, errors = validate_skill(skill_json, ["androperator"], "com.androperator.operator.dev")
    assert ok is False
    assert "missing or invalid object field: artifactContents" in errors


def test_validate_skill_rejects_unsafe_relative_paths():
    skill_json = (
        "{\"id\":\"com.example.android-version\",\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\",\"summary\":\"Determine Android version\","
        "\"path\":\"../skills/com.example.android-version\","
        "\"skillFile\":\"skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"../skills/com.example.android-version/scripts/run.js\"],"
        "\"scriptContents\":{\"../skills/com.example.android-version/scripts/run.js\":\"console.log('hi')\\n\"},"
        "\"artifacts\":[\"/tmp/version.txt\"],"
        "\"artifactContents\":{\"/tmp/version.txt\":\"15\"}}"
    )
    ok, errors = validate_skill(skill_json, ["androperator"], "com.androperator.operator.dev")
    assert ok is False
    assert "unsafe path field: path" in errors
    assert "unsafe path in scripts[0]" in errors
    assert "unsafe path in artifacts[0]" in errors


def test_validate_skill_rejects_windows_style_paths():
    skill_json = (
        "{\"id\":\"com.example.android-version\",\"applicationId\":\"com.example\","
        "\"intent\":\"android-version\",\"summary\":\"Determine Android version\","
        "\"path\":\"skills/com.example.android-version\","
        "\"skillFile\":\"C:/skills/com.example.android-version/SKILL.md\","
        "\"scripts\":[\"..\\\\skills\\\\com.example.android-version\\\\scripts\\\\run.js\"],"
        "\"scriptContents\":{\"..\\\\skills\\\\com.example.android-version\\\\scripts\\\\run.js\":\"console.log('hi')\\n\"},"
        "\"artifacts\":[\"\\\\\\\\server\\\\share\\\\version.txt\"],"
        "\"artifactContents\":{\"\\\\\\\\server\\\\share\\\\version.txt\":\"15\"}}"
    )
    ok, errors = validate_skill(skill_json, ["androperator"], "com.androperator.operator.dev")
    assert ok is False
    assert "unsafe path field: skillFile" in errors
    assert "unsafe path in scripts[0]" in errors
    assert "unsafe path in artifacts[0]" in errors
