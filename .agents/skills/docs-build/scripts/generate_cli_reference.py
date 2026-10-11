#!/usr/bin/env python3

from __future__ import annotations

import re
import sys
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

try:
    import yaml
except ImportError as exc:
    raise ImportError("PyYAML is required to generate the CLI reference") from exc


@dataclass(frozen=True)
class CommandInfo:
    name: str
    aliases: list[str]
    group: str
    summary: str
    syntax: list[str]
    flags: list[str]
    subcommands: list[str]
    docs_visibility: str
    docs_alias_of: str | None


@dataclass(frozen=True)
class DetailLink:
    href: str | None
    label: str
    planned_href: str | None = None
    status: str | None = None
    phase: str | None = None
    action_links: tuple[str, ...] = ()
    see_also: tuple[tuple[str, str], ...] = ()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def registry_path() -> Path:
    return repo_root() / "apps" / "node" / "src" / "cli" / "registry.ts"


def commands_dir() -> Path:
    return repo_root() / "apps" / "node" / "src" / "cli" / "commands"


def ownership_path() -> Path:
    return repo_root() / "sites" / "docs" / "ownership.yaml"


def read_yaml(path: Path) -> object:
    if not path.exists():
        raise FileNotFoundError(f"Missing ownership file: {path}")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def command_from_metadata(metadata: dict) -> CommandInfo:
    name = metadata["name"]
    syntax = []
    for raw_line in metadata.get("topLevelBlock", "").splitlines():
        line = raw_line.strip()
        if line.startswith(name):
            primary = re.split(r"\s{2,}", line, maxsplit=1)[0].strip()
            if primary not in syntax:
                syntax.append(primary)
    visibility = metadata.get("docsVisibility", "normal")
    if visibility == "normal" and not syntax:
        raise ValueError(f"Public command {name} has no primary syntax")
    if "documentedFlags" not in metadata:
        raise ValueError(f"Command {name} has no documentedFlags metadata")
    return CommandInfo(
        name=name, aliases=metadata.get("synonyms", []), group=metadata["group"],
        summary=metadata["summary"], syntax=syntax, flags=metadata["documentedFlags"],
        subcommands=list(metadata.get("subtopics", {})),
        docs_visibility=visibility, docs_alias_of=metadata.get("docsAliasOf"),
    )


def load_commands() -> list[CommandInfo]:
    # Evaluate registry metadata so loops, constants and quoted strings are all
    # covered. Importing this module does not invoke command handlers.
    script = Path(__file__).with_name("list_cli_commands.mjs")
    result = subprocess.run(["node", str(script)], cwd=repo_root(), check=True,
                            capture_output=True, text=True)
    metadata = json.loads(result.stdout)
    if not metadata:
        raise ValueError("CLI registry is empty; build apps/node first")
    return [command_from_metadata(item) for item in metadata]


def parse_detail_link(command_name: str, raw: object) -> DetailLink:
    if not isinstance(raw, dict):
        raise ValueError(f"command_details.{command_name} must be a mapping")
    label = raw.get("label")
    href = raw.get("href")
    planned_href = raw.get("planned_href")
    status = raw.get("status")
    phase = raw.get("phase")
    if not isinstance(label, str) or not label:
        raise ValueError(f"command_details.{command_name} must include label")
    if href is not None and not isinstance(href, str):
        raise ValueError(f"command_details.{command_name}.href must be a string")
    if planned_href is not None and not isinstance(planned_href, str):
        raise ValueError(f"command_details.{command_name}.planned_href must be a string")
    if href is None and planned_href is None:
        raise ValueError(f"command_details.{command_name} must include href or planned_href")

    action_values: list[str] = []
    action = raw.get("action")
    actions = raw.get("actions")
    if isinstance(action, str):
        action_values.append(action)
    if isinstance(actions, list):
        for item in actions:
            if not isinstance(item, str) or not item:
                raise ValueError(f"command_details.{command_name}.actions must contain strings")
            action_values.append(item)
    elif actions is not None:
        raise ValueError(f"command_details.{command_name}.actions must be a list")

    see_also_values: list[tuple[str, str]] = []
    see_also = raw.get("see_also", [])
    if see_also is None:
        see_also = []
    if not isinstance(see_also, list):
        raise ValueError(f"command_details.{command_name}.see_also must be a list")
    for item in see_also:
        if not isinstance(item, dict):
            raise ValueError(f"command_details.{command_name}.see_also entries must be mappings")
        item_href = item.get("href")
        item_label = item.get("label")
        if not isinstance(item_href, str) or not isinstance(item_label, str):
            raise ValueError(f"command_details.{command_name}.see_also entries need href and label")
        see_also_values.append((item_href, item_label))

    return DetailLink(
        href=href,
        label=label,
        planned_href=planned_href,
        status=status if isinstance(status, str) else None,
        phase=phase if isinstance(phase, str) else None,
        action_links=tuple(action_values),
        see_also=tuple(see_also_values),
    )


def load_command_details(path: Path | None = None) -> dict[str, DetailLink]:
    data = read_yaml(path or ownership_path())
    if not isinstance(data, dict):
        raise ValueError("ownership.yaml must load as a mapping")
    raw_details = data.get("command_details")
    if not isinstance(raw_details, dict):
        raise ValueError("ownership.yaml must include command_details")
    details: dict[str, DetailLink] = {}
    for command_name, raw in raw_details.items():
        if not isinstance(command_name, str) or not command_name:
            raise ValueError("command_details keys must be non-empty strings")
        details[command_name] = parse_detail_link(command_name, raw)
    return details


def markdown_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", "<br>")


def anchor_for_command(command: CommandInfo) -> str:
    return f"command-{command.name.replace('_', '-').replace(' ', '-')}"


def command_ref(command: CommandInfo) -> str:
    return f"[`{command.name}`](#{anchor_for_command(command)})"


def format_code_list(items: list[str]) -> str:
    return ", ".join(f"`{item}`" for item in items) if items else "-"


def format_detail_link(detail: DetailLink | None) -> str:
    if detail is None:
        return "-"
    if detail.href:
        return f"[{detail.label}]({detail.href})"
    planned = f"`{detail.planned_href}`" if detail.planned_href else detail.label
    suffix = f" ({detail.phase})" if detail.phase else ""
    return f"Planned: {planned}{suffix}"


def action_anchor(action: str) -> str:
    return action.replace("_", "-")


def format_action_links(detail: DetailLink | None) -> str:
    if detail is None or not detail.action_links:
        return "-"
    return ", ".join(
        f"[`{action}`](actions.md#action-{action_anchor(action)})"
        for action in detail.action_links
    )


def format_see_also(detail: DetailLink | None) -> str:
    if detail is None or not detail.see_also:
        return "-"
    return ", ".join(f"[{label}]({href})" for href, label in detail.see_also)


def alias_notes(commands: list[CommandInfo]) -> dict[str, list[str]]:
    notes: dict[str, list[str]] = {}
    for command in commands:
        if command.docs_visibility != "alias" or not command.docs_alias_of:
            continue
        canonical = command.docs_alias_of.split()[0]
        alias_text = command.name
        if command.subcommands:
            alias_text = f"{command.name} {'|'.join(command.subcommands)}"
        notes.setdefault(canonical, []).append(
            f"`{alias_text}` is an alias for `{command.docs_alias_of}`."
        )
    return notes


def public_commands(commands: list[CommandInfo]) -> list[CommandInfo]:
    return [command for command in commands if command.docs_visibility == "normal"]


def render_index(commands: list[CommandInfo], command_details: dict[str, DetailLink]) -> str:
    lines = [
        "| Command | Details | Summary |",
        "| --- | --- | --- |",
    ]
    for command in commands:
        detail = command_details.get(command.name)
        lines.append(
            "| "
            + " | ".join(
                [
                    command_ref(command),
                    markdown_cell(format_detail_link(detail)),
                    markdown_cell(command.summary),
                ]
            )
            + " |"
        )
    return "\n".join(lines)


def render_command_section(command: CommandInfo, notes: list[str], detail: DetailLink | None) -> str:
    lines = [
        f'<a id="{anchor_for_command(command)}"></a>',
        f"### `{command.name}`",
        "",
        command.summary,
        "",
        f"- Group: {command.group}",
        f"- Syntax: {format_code_list(command.syntax)}",
        f"- Primary flags: {format_code_list(command.flags)}",
        f"- Details: {format_detail_link(detail)}",
    ]
    action_links = format_action_links(detail)
    if action_links != "-":
        lines.append(f"- Action links: {action_links}")
    see_also = format_see_also(detail)
    if see_also != "-":
        lines.append(f"- See also: {see_also}")
    if command.aliases:
        lines.append(f"- Command aliases: {format_code_list(command.aliases)}")
    if notes:
        lines.append(f"- Alias notes: {' '.join(notes)}")
    if command.subcommands:
        lines.append(f"- Subcommands: {format_code_list(command.subcommands)}")
    lines.append("")
    return "\n".join(lines)


def require_command_details(commands: list[CommandInfo], command_details: dict[str, DetailLink]) -> None:
    missing = [command.name for command in public_commands(commands) if command.name not in command_details]
    if missing:
        raise ValueError(
            "Missing command detail ownership for: " + ", ".join(missing),
        )


def render_reference(commands: list[CommandInfo], command_details: dict[str, DetailLink] | None = None) -> str:
    visible_commands = public_commands(commands)
    notes_by_command = alias_notes(commands)
    command_details = command_details or {}
    require_command_details(commands, command_details)

    lines = [
        "# CLI Reference",
        "",
        "This page is generated from the Node CLI registry and command sources.",
        "",
        "Use this page as a command index. Detailed behavior, output shapes, and recovery guidance live in the authored API pages.",
        "",
        "## Command Index",
        "",
        render_index(visible_commands, command_details),
        "",
        "## Commands",
        "",
    ]

    for command in visible_commands:
        lines.append(render_command_section(
            command,
            notes_by_command.get(command.name, []),
            command_details.get(command.name),
        ))

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    registry = registry_path()
    if not registry.exists():
        raise FileNotFoundError(f"Missing source file: {registry}")
    if not commands_dir().exists():
        raise FileNotFoundError(f"Missing command directory: {commands_dir()}")

    commands = load_commands()
    command_details = load_command_details()

    sys.stdout.write(render_reference(commands, command_details))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
