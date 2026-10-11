#!/usr/bin/env python3

from __future__ import annotations

import sys
import html
import re
import json
import hashlib
import subprocess
from urllib.parse import urljoin, urlsplit, urlunsplit
from pathlib import Path

try:
    import yaml
except ImportError as exc:
    raise ImportError(
        "PyYAML is required to run generate_llms_full.py. "
        "Please install it (e.g. via sites/docs/requirements.txt)."
    ) from exc


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def docs_site_dir() -> Path:
    return repo_root() / "sites" / "docs"


def load_nav_entries(mkdocs_path: Path) -> list[tuple[str, list[tuple[str, str]]]]:
    if not mkdocs_path.exists():
        raise FileNotFoundError(f"Missing MkDocs config: {mkdocs_path}")
    data = yaml.safe_load(mkdocs_path.read_text(encoding="utf-8"))
    nav = data.get("nav")
    if not isinstance(nav, list):
        raise ValueError(f"{mkdocs_path} does not contain a list nav")

    top_level: list[tuple[str, str]] = []
    sections: list[tuple[str, list[tuple[str, str]]]] = []

    def walk(node: object, section_name: str | None = None) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item, section_name)
            return
        if not isinstance(node, dict):
            raise ValueError(f"Unexpected nav entry type: {type(node)!r}")
        for title, value in node.items():
            if isinstance(value, str):
                if value.startswith(("http://", "https://")):
                    continue
                if section_name is None:
                    top_level.append((title, value))
                else:
                    for section_title, pages in sections:
                        if section_title == section_name:
                            pages.append((title, value))
                            break
                    else:
                        raise ValueError(f"Internal nav error for section {section_name!r}")
            elif isinstance(value, list):
                sections.append((title, []))
                walk(value, title)
            else:
                raise ValueError(f"Unsupported nav value for {title!r}: {type(value)!r}")

    walk(nav, None)
    ordered: list[tuple[str, list[tuple[str, str]]]] = []
    if top_level:
        ordered.append(("__top_level__", top_level))
    ordered.extend(sections)
    return ordered


def read_page(build_dir: Path, page_path: str) -> str:
    resolved = (build_dir / page_path).resolve()
    if build_dir.resolve() not in resolved.parents and resolved != build_dir.resolve():
        raise ValueError(f"Page path escapes build directory: {page_path}")
    if not resolved.exists():
        raise FileNotFoundError(f"Missing built page: {resolved}")
    return resolved.read_text(encoding="utf-8").rstrip("\n")


def decode_code_entities(markdown: str) -> str:
    return re.sub(
        r"<code>(.*?)</code>",
        lambda match: f"<code>{html.unescape(match.group(1))}</code>",
        markdown,
        flags=re.DOTALL,
    )


DOCS_URL = "https://docs.androperator.com/"


def canonical_page_url(page_path: str) -> str:
    route = page_path.removesuffix(".md")
    if route == "index":
        route = ""
    elif route.endswith("/index"):
        route = route[:-5]
    else:
        route += "/"
    return urljoin(DOCS_URL, route)


def canonical_reference(href: str, page_path: str) -> str:
    if urlsplit(href).scheme or href.startswith("//"):
        return href
    # Resolve Markdown against its source filename before converting .md to
    # MkDocs directory routes. Fragments belong to the original page.
    resolved = urlsplit(urljoin(DOCS_URL + page_path, href))
    path = resolved.path
    if path.endswith(".md"):
        path = urlsplit(canonical_page_url(path.lstrip("/"))).path
    return urlunsplit((resolved.scheme, resolved.netloc, path, resolved.query, resolved.fragment))


def rebase_links(markdown: str, page_path: str) -> str:
    lines = []
    fence = None
    for line in markdown.splitlines(keepends=True):
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            lines.append(line)
            continue
        if fence is None:
            # Inline code and fenced examples are data, never links to rewrite.
            pieces = re.split(r"(`+[^`]*`+)", line)
            for index in range(0, len(pieces), 2):
                pieces[index] = re.sub(
                    r"(\]\()([^\s)]+)([^)]*\))",
                    lambda m: m[1] + canonical_reference(m[2], page_path) + m[3],
                    pieces[index],
                )
            line = "".join(pieces)
        lines.append(line)
    return "".join(lines)


def build_provenance(build_dir: Path, nav_entries) -> str:
    root = repo_root()
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, check=True,
                              capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=normal"],
                           cwd=root, check=True, capture_output=True, text=True).stdout
    # Content identity remains useful for uncommitted preview builds. Include
    # the page paths so page moves and reordering affect the digest.
    digest = hashlib.sha256()
    for _, pages in nav_entries:
        for _, path in pages:
            digest.update(path.encode() + b"\0" + read_page(build_dir, path).encode() + b"\0")
    version = json.loads((root / "apps/node/package.json").read_text())["version"]
    state = " with uncommitted changes" if dirty else ""
    return (f"Source revision: `{revision}`{state}. Source CLI package version: `{version}`.\n"
            f"Assembled content SHA-256: `{digest.hexdigest()}`.\n"
            "These docs describe this source build, not proof of the currently published release. "
            "Check installed CLI/Operator compatibility before relying on version-specific behavior.")


def render_llms_full(
    build_dir: Path,
    nav_entries: list[tuple[str, list[tuple[str, str]]]],
    provenance: str = "",
) -> str:
    lines: list[str] = [
        "# Androperator Documentation",
        "",
        "Optional full reference compiled from the public navigation pages; installed skills and internal design notes are separate.",
        "",
        provenance,
        "",
    ]

    for section_title, pages in nav_entries:
        if section_title != "__top_level__":
            lines.append(f"# {section_title}")
            lines.append("")
        for page_title, page_path in pages:
            page_content = rebase_links(decode_code_entities(read_page(build_dir, page_path)), page_path)
            lines.append(f"Source: [{page_title}]({canonical_page_url(page_path)}) | `{page_path}`")
            lines.append("")
            if not page_content.lstrip().startswith("#"):
                lines.append(f"## {page_title}")
            lines.append(page_content)
            lines.append("")
            lines.append("---")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    root = repo_root()
    docs_dir = docs_site_dir()
    build_dir = docs_dir / ".build"
    mkdocs_path = docs_dir / "mkdocs.yml"
    output_paths = [
        docs_dir / "site" / "llms-full.txt",
        docs_dir / "static" / "llms-full.txt",
        root / "sites" / "androperator-public" / "llms-full.txt",
    ]

    nav_entries = load_nav_entries(mkdocs_path)
    rendered = render_llms_full(build_dir, nav_entries, build_provenance(build_dir, nav_entries))

    for output_path in output_paths:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
        print(f"Successfully generated {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
