#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from posixpath import normpath
from urllib.parse import urlparse

try:
    import yaml
except ImportError as exc:
    raise ImportError("PyYAML is required to run validate_docs_routes.py") from exc


DOCS_HOST = "docs.androperator.com"
REQUIRED_SITE_FILES = [
    "index.html",
    "404.html",
    "robots.txt",
    "llms.txt",
    "llms-full.txt",
    "sitemap.xml",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate that expected docs routes and machine-facing files exist in the built docs site."
    )
    parser.add_argument("--site-dir", required=True, help="Built docs site directory, usually sites/docs/site")
    parser.add_argument("--generated-docs-dir", required=True, help="Path to assembled markdown docs, usually sites/docs/.build")
    parser.add_argument("--llms-txt", required=True, help="Path to sites/docs/static/llms.txt")
    parser.add_argument("--mkdocs-yml", default="sites/docs/mkdocs.yml", help="Path to sites/docs/mkdocs.yml")
    return parser.parse_args()


def nav_paths(mkdocs_yml: Path) -> list[str]:
    if not mkdocs_yml.exists():
        raise FileNotFoundError(f"Missing MkDocs config: {mkdocs_yml}")
    data = yaml.safe_load(mkdocs_yml.read_text(encoding="utf-8"))
    nav = data.get("nav")
    if not isinstance(nav, list):
        raise ValueError(f"{mkdocs_yml} does not contain a list nav")

    paths: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            raise ValueError(f"Unexpected nav entry type: {type(node)!r}")
        for _, value in node.items():
            if isinstance(value, str):
                if value.startswith(("http://", "https://")):
                    continue
                paths.append(value)
            elif isinstance(value, list):
                walk(value)
            else:
                raise ValueError(f"Unsupported nav value: {type(value)!r}")

    walk(nav)
    return paths


def markdown_output_to_site_path(output: str) -> str:
    if output == "index.md":
        return "index.html"
    if output.endswith(".md"):
        return output[:-3].rstrip("/") + "/index.html"
    return output


def docs_url_to_site_path(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != DOCS_HOST:
        return None
    path = parsed.path or "/"
    if path == "/":
        return "index.html"
    if path.endswith("/"):
        return path.lstrip("/") + "index.html"
    return path.lstrip("/")


def iter_markdown_link_hrefs(text: str) -> list[str]:
    hrefs: list[str] = []
    for match in re.finditer(r"\[([^\]]+)\]\(", text):
        start = match.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            ch = text[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    hrefs.append(text[start:i].strip())
                    break
            i += 1
    return hrefs


def parse_markdown_links(markdown_path: Path) -> list[str]:
    links: list[str] = []
    text = markdown_path.read_text(encoding="utf-8")
    for href in iter_markdown_link_hrefs(text):
        if (
            not href
            or href.startswith("#")
            or "://" in href
            or href.startswith("mailto:")
            or href.startswith("tel:")
        ):
            continue
        links.append(href)
    return links


def resolve_relative_markdown_link(page_path: Path, generated_docs_dir: Path, href: str) -> tuple[str | None, str | None]:
    clean_href = href.split("#", 1)[0].split("?", 1)[0].strip()
    if not clean_href:
        return None, None

    if clean_href.startswith("/"):
        return clean_href.lstrip("/"), None

    relative_page = page_path.relative_to(generated_docs_dir)
    relative_target = Path(relative_page.parent, clean_href)

    if clean_href.endswith(".md"):
        candidate_paths = [Path(normpath(str(relative_target)))]
    elif clean_href.endswith("/"):
        candidate_paths = [Path(normpath(str(relative_target / "index.md")))]
    else:
        candidate_paths = [
            Path(normpath(str(relative_target.with_suffix(".md")))),
            Path(normpath(str(relative_target / "index.md"))),
        ]

    for candidate in candidate_paths:
        if any(part == ".." for part in candidate.parts):
            continue
        candidate_md = generated_docs_dir / candidate
        if candidate_md.exists():
            return markdown_output_to_site_path(str(candidate)), None

    return None, f"unresolvable relative markdown link: {href}"


def generated_doc_link_to_site_path(page_path: Path, generated_docs_dir: Path, href: str) -> tuple[str | None, str | None]:
    return resolve_relative_markdown_link(page_path, generated_docs_dir, href)


def check_inner_page_links(generated_docs_dir: Path, site_dir: Path) -> list[str]:
    errors: list[str] = []
    for md_file in sorted(generated_docs_dir.rglob("*.md")):
        text = md_file.read_text(encoding="utf-8")
        for href in iter_markdown_link_hrefs(text):
            raw = href.split("#", 1)[0].split("?", 1)[0].strip()
            if not raw or raw.startswith("#") or raw.startswith("http") or raw.startswith("mailto:") or raw.startswith("tel:"):
                continue
            target, error = resolve_relative_markdown_link(md_file, generated_docs_dir, raw)
            if error is not None:
                errors.append(f"inner-page-link: {md_file.relative_to(generated_docs_dir)} -> {raw} ({error})")
                continue
            if target is None:
                continue
            resolved_site_path = Path(target)
            candidate_site_path = site_dir / resolved_site_path
            if not candidate_site_path.exists():
                errors.append(f"inner-page-link: {md_file.relative_to(generated_docs_dir)} -> {raw} (missing {resolved_site_path})")
                continue
    return errors


def validate_existing_paths(site_dir: Path, relative_paths: list[str], label: str) -> list[str]:
    missing: list[str] = []
    for relative_path in relative_paths:
        if not (site_dir / relative_path).exists():
            missing.append(f"{label}: missing {relative_path}")
    return missing


def main() -> int:
    args = parse_args()
    site_dir = Path(args.site_dir).resolve()
    generated_docs_dir = Path(args.generated_docs_dir).resolve()
    llms_txt_path = Path(args.llms_txt).resolve()
    mkdocs_yml = Path(args.mkdocs_yml).resolve()

    failures: list[str] = []
    failures.extend(validate_existing_paths(site_dir, REQUIRED_SITE_FILES, "required site file"))

    expected_page_paths = [markdown_output_to_site_path(output) for output in nav_paths(mkdocs_yml)]
    failures.extend(validate_existing_paths(site_dir, expected_page_paths, "nav page"))

    generated_doc_targets: list[str] = []
    for markdown_path in sorted(generated_docs_dir.rglob("*.md")):
        for href in parse_markdown_links(markdown_path):
            target, error = generated_doc_link_to_site_path(markdown_path, generated_docs_dir, href)
            if error is not None:
                failures.append(f"generated docs link: {markdown_path.relative_to(generated_docs_dir)} -> {href} ({error})")
                continue
            if target is not None:
                generated_doc_targets.append(target)
    failures.extend(validate_existing_paths(site_dir, generated_doc_targets, "generated docs link"))

    llms_urls = re.findall(r"https://[^\s)]+", llms_txt_path.read_text(encoding="utf-8"))
    llms_targets = [target for url in llms_urls if (target := docs_url_to_site_path(url)) is not None]
    failures.extend(validate_existing_paths(site_dir, llms_targets, "llms.txt route"))

    failures.extend(check_inner_page_links(generated_docs_dir, site_dir))

    if failures:
        print("Docs route validation failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print(
        f"Docs route validation passed: {len(expected_page_paths)} nav pages, "
        f"{len(generated_doc_targets)} generated-doc links, {len(llms_targets)} llms.txt routes, "
        f"inner-page links checked."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
