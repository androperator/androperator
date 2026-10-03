from __future__ import annotations

from evals.harness.agents.base import AgentConfig
from evals.harness.agents.claude import ClaudeAgent


def test_normalize_line_extracts_assistant_text_from_stream_json():
    agent = ClaudeAgent(AgentConfig(type_id="claude", model="claude-sonnet-4-6", knowledge_mode="public-surface"))
    line = (
        '{"role":"assistant","content":['
        '{"type":"text","text":"ANDROPERATOR_EVAL_ANSWER: 15"}'
        '],"tool_calls":[]}\n'
    )

    assert agent.normalize_line(line) == "ANDROPERATOR_EVAL_ANSWER: 15\n"


def test_normalize_line_extracts_tool_text_from_stream_json():
    agent = ClaudeAgent(AgentConfig(type_id="claude", model="claude-sonnet-4-6", knowledge_mode="public-surface"))
    line = '{"role":"tool","content":[{"type":"text","text":"tool output"}],"tool_call_id":"tool_1"}\n'

    assert agent.normalize_line(line) == "tool output\n"


def test_count_turn_accepts_role_only_assistant_json():
    agent = ClaudeAgent(AgentConfig(type_id="claude", model="claude-sonnet-4-6", knowledge_mode="public-surface"))
    line = '{"role":"assistant","content":[{"type":"text","text":"Hello"}]}\n'

    assert agent.count_turn(line) is True
