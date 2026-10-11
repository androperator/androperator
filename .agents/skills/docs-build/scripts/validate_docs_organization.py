#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


COMPATIBILITY_SELECTOR_ALIASES = {
    "--resource-id": "Use the canonical selector flag --id; selector details live in docs/api/selectors.md.",
    "--content-desc": "Use the canonical selector flag --desc; selector details live in docs/api/selectors.md.",
    "--content-description": "Use the canonical selector flag --desc; selector details live in docs/api/selectors.md.",
    "--content-desc-contains": "Use the canonical selector flag --desc-contains; selector details live in docs/api/selectors.md.",
}


@dataclass(frozen=True)
class DocsOrganizationWarning:
    kind: str
    path: str
    message: str
    line: int | None = None
    suggestion: str | None = None

    def render(self) -> str:
        location = self.path
        if self.line is not None:
            location = f"{location}:{self.line}"
        rendered = f"WARNING docs-organization {self.kind}: {location}: {self.message}"
        if self.suggestion:
            rendered += f" Suggestion: {self.suggestion}"
        return rendered


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def default_docs_root() -> Path:
    return repo_root() / "docs"


def default_build_root() -> Path:
    return repo_root() / "sites" / "docs" / ".build"


def display_path(path: Path, root: Path | None = None) -> str:
    base = root or repo_root()
    try:
        return path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def strip_markdown_markup(text: str) -> str:
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text.strip()


def heading_slug(text: str) -> str:
    text = strip_markdown_markup(text).lower()
    text = re.sub(r"[^a-z0-9\s_-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def anchors_for_markdown(text: str) -> set[str]:
    anchors = set(re.findall(r'<a\s+id=["\']([^"\']+)["\']', text))
    for match in re.finditer(r"(?m)^(#{1,6})\s+(.+?)\s*$", text):
        slug = heading_slug(match.group(2))
        if slug:
            anchors.add(slug)
    return anchors


def iter_markdown_links(text: str) -> list[tuple[int, str]]:
    links: list[tuple[int, str]] = []
    for match in re.finditer(r"(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", text):
        href = match.group(1).strip("<>")
        line = text.count("\n", 0, match.start()) + 1
        links.append((line, href))
    return links


def split_href(href: str) -> tuple[str, str | None]:
    raw = href.split("?", 1)[0]
    if "#" not in raw:
        return raw, None
    path, anchor = raw.split("#", 1)
    return path, anchor or None


def is_external_href(href: str) -> bool:
    return bool(re.match(r"^[a-z][a-z0-9+.-]*:", href))


def resolve_markdown_target(source: Path, build_root: Path, href_path: str) -> Path | None:
    if href_path == "":
        return source
    candidate = (source.parent / href_path).resolve()
    try:
        candidate.relative_to(build_root.resolve())
    except ValueError:
        return None
    if candidate.suffix == "":
        candidate = candidate.with_suffix(".md")
    return candidate


def check_internal_anchors(build_root: Path) -> list[DocsOrganizationWarning]:
    warnings: list[DocsOrganizationWarning] = []
    anchor_cache: dict[Path, set[str]] = {}
    for source in sorted(build_root.rglob("*.md")):
        text = source.read_text(encoding="utf-8")
        for line, href in iter_markdown_links(text):
            if is_external_href(href):
                continue
            href_path, anchor = split_href(href)
            if anchor is None:
                continue
            target = resolve_markdown_target(source, build_root, href_path)
            if target is None or not target.exists():
                warnings.append(DocsOrganizationWarning(
                    kind="anchor",
                    path=display_path(source, build_root),
                    line=line,
                    message=f"link target missing for {href}",
                    suggestion="Fix the relative link or update sites/docs/mkdocs.yml.",
                ))
                continue
            if target not in anchor_cache:
                anchor_cache[target] = anchors_for_markdown(target.read_text(encoding="utf-8"))
            if anchor not in anchor_cache[target]:
                warnings.append(DocsOrganizationWarning(
                    kind="anchor",
                    path=display_path(source, build_root),
                    line=line,
                    message=f"missing anchor #{anchor} in {display_path(target, build_root)}",
                    suggestion="Add an explicit HTML anchor on the canonical owner page.",
                ))
    return warnings


def check_compatibility_aliases(docs_root: Path) -> list[DocsOrganizationWarning]:
    warnings: list[DocsOrganizationWarning] = []
    for source in sorted(docs_root.rglob("*.md")):
        relative = source.relative_to(docs_root)
        if relative.parts and relative.parts[0] == "internal":
            continue
        if str(relative).replace("/", "/") == "api/selectors.md":
            continue
        text = source.read_text(encoding="utf-8")
        for alias, suggestion in COMPATIBILITY_SELECTOR_ALIASES.items():
            pattern = rf"(?<![A-Za-z0-9_-]){re.escape(alias)}(?![A-Za-z0-9_-])"
            for match in re.finditer(pattern, text):
                line = text.count("\n", 0, match.start()) + 1
                warnings.append(DocsOrganizationWarning(
                    kind="compat-alias",
                    path=display_path(source),
                    line=line,
                    message=f"compatibility selector alias {alias} appears in authored public docs",
                    suggestion=suggestion,
                ))
    return warnings


def check_generated_cli_details(cli_reference: Path) -> list[DocsOrganizationWarning]:
    if not cli_reference.exists():
        return [DocsOrganizationWarning(
            kind="command-detail",
            path=display_path(cli_reference),
            message="generated CLI reference is missing",
            suggestion="Run the docs-build assembly workflow.",
        )]

    warnings: list[DocsOrganizationWarning] = []
    text = cli_reference.read_text(encoding="utf-8")
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.startswith("| [`"):
            continue
        cells = split_markdown_table_row(line)
        if len(cells) not in (3, 6):
            continue
        command = cells[0]
        details = cells[1] if len(cells) == 3 else cells[4]
        if details == "-" or details.startswith("Planned:"):
            warnings.append(DocsOrganizationWarning(
                kind="command-detail",
                path=display_path(cli_reference),
                line=line_number,
                message=f"generated command {command} has no Details link",
                suggestion="Add command_details metadata in sites/docs/ownership.yaml.",
            ))
    for match in re.finditer(r"(?m)^### `([^`]+)`\n(?:.*\n){0,8}?\- Details: (-|Planned: .*)$", text):
        line = text.count("\n", 0, match.start()) + 1
        warnings.append(DocsOrganizationWarning(
            kind="command-detail",
            path=display_path(cli_reference),
            line=line,
            message=f"generated command `{match.group(1)}` has no Details link",
            suggestion="Add command_details metadata in sites/docs/ownership.yaml.",
        ))
    return warnings


def split_markdown_table_row(line: str) -> list[str]:
    cells: list[str] = []
    current: list[str] = []
    escaped = False
    for char in line.strip():
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == "\\":
            current.append(char)
            escaped = True
            continue
        if char == "|":
            cells.append("".join(current).strip())
            current = []
            continue
        current.append(char)
    cells.append("".join(current).strip())
    if cells and cells[0] == "":
        cells = cells[1:]
    if cells and cells[-1] == "":
        cells = cells[:-1]
    return cells


def run_checks(docs_root: Path, build_root: Path) -> list[DocsOrganizationWarning]:
    warnings: list[DocsOrganizationWarning] = []
    warnings.extend(check_internal_anchors(build_root))
    warnings.extend(check_compatibility_aliases(docs_root))
    warnings.extend(check_generated_cli_details(build_root / "api" / "cli.md"))
    return warnings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Warning-only docs organization drift checks.")
    parser.add_argument("--docs-root", type=Path, default=default_docs_root())
    parser.add_argument("--build-root", type=Path, default=default_build_root())
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    warnings = run_checks(args.docs_root, args.build_root)
    for warning in warnings:
        print(warning.render(), file=sys.stderr)
    if warnings:
        print(f"Docs organization warning-only check emitted {len(warnings)} warning(s).", file=sys.stderr)
    else:
        print("Docs organization warning-only check emitted no warnings.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
