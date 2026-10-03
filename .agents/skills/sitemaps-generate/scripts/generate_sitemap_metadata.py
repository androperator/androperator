#!/usr/bin/env python3

import argparse
import gzip
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
NS = {"sm": SITEMAP_NS}
ET.register_namespace("", SITEMAP_NS)

LANDING_BASE_URL = "https://clawperator.com"  # Preserved legacy landing surface.
DOCS_BASE_URL = "https://docs.androperator.com"


def parse_args():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    landing = subparsers.add_parser("landing")
    landing.add_argument("--repo-root", default=".")

    docs = subparsers.add_parser("docs")
    docs.add_argument("--repo-root", default=".")
    docs.add_argument("--sitemap-path", required=True)
    docs.add_argument("--source-map-path", required=True)

    return parser.parse_args()


def parse_git_iso(value):
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)


def run_git_last_modified(repo_root, relative_path):
    git_root, git_path = resolve_git_target(repo_root, relative_path)
    absolute_path = git_root / git_path
    if not absolute_path.exists():
        raise FileNotFoundError(str(absolute_path))
    if has_local_changes(git_root, git_path):
        return datetime.now(timezone.utc).replace(microsecond=0)
    result = subprocess.run(
        ["git", "log", "-1", "--format=%cI", "--", git_path],
        cwd=git_root,
        capture_output=True,
        text=True,
        check=False,
    )
    value = result.stdout.strip()
    if not value:
        raise RuntimeError(f"no git commit timestamp found for {relative_path}")
    return parse_git_iso(value)


def max_git_last_modified(repo_root, relative_paths):
    timestamps = []
    for relative_path in relative_paths:
        try:
            timestamps.append(run_git_last_modified(repo_root, relative_path))
        except FileNotFoundError:
            continue
    if not timestamps:
        raise RuntimeError(f"no usable timestamp sources found for {relative_paths}")
    return max(timestamps)


def has_local_changes(git_root, git_path):
    result = subprocess.run(
        ["git", "status", "--short", "--", git_path],
        cwd=git_root,
        capture_output=True,
        text=True,
        check=False,
    )
    return bool(result.stdout.strip())


def resolve_git_target(repo_root, relative_path):
    return repo_root, relative_path


def format_iso(dt):
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "+00:00")


def landing_manifest():
    return [
        {
            "loc": f"{LANDING_BASE_URL}/",
            "priority": "1.0",
            "sources": [
                "sites/landing-clawperator/app/page.js",
                "sites/landing-clawperator/app/layout.js",
            ],
        },
        {
            "loc": f"{LANDING_BASE_URL}/agents",
            "priority": "0.9",
            "sources": [
                "sites/landing-clawperator/app/agents/page.js",
                "sites/landing-clawperator/app/layout.js",
            ],
        },
        {
            "loc": f"{LANDING_BASE_URL}/index.md",
            "priority": "0.9",
            "sources": [
                "sites/landing-clawperator/public/index.md",
            ],
        },
        {
            "loc": f"{LANDING_BASE_URL}/skill.md",
            "priority": "0.9",
            "sources": [
                "sites/landing-clawperator/public/skill.md",
            ],
        },
        {
            "loc": f"{LANDING_BASE_URL}/agents.md",
            "priority": "0.8",
            "sources": [
                "sites/landing-clawperator/public/agents.md",
            ],
        },
        {
            "loc": f"{LANDING_BASE_URL}/install.sh",
            "priority": "0.8",
            "sources": [
                "sites/androperator-public/install.sh",
            ],
        },
        {
            "loc": f"{LANDING_BASE_URL}/llms.txt",
            "priority": "0.9",
            "sources": [
                "sites/landing-clawperator/public/llms.txt",
            ],
        },
        {
            "loc": f"{LANDING_BASE_URL}/llms-full.txt",
            "priority": "0.8",
            "sources": [
                "sites/landing-clawperator/public/llms-full.txt",
            ],
        },
        {
            "loc": f"{LANDING_BASE_URL}/operator.apk",
            "priority": "0.7",
            "sources": [
                "docs/setup.md",
            ],
        },
    ]


def write_xml(tree, path):
    ET.indent(tree, space="  ")
    tree.write(path, encoding="utf-8", xml_declaration=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write("\n")


def set_child_text(parent, tag, text):
    node = parent.find(f"sm:{tag}", NS)
    if node is None:
        node = ET.SubElement(parent, f"{{{SITEMAP_NS}}}{tag}")
    node.text = text


def generate_landing_sitemaps(repo_root):
    public_dir = repo_root / "sites/landing-clawperator/public"
    landing_path = public_dir / "landing-sitemap.xml"
    sitemap_index_path = public_dir / "sitemap.xml"

    manifest = landing_manifest()

    landing_root = ET.Element(f"{{{SITEMAP_NS}}}urlset")
    for entry in manifest:
        url_node = ET.SubElement(landing_root, f"{{{SITEMAP_NS}}}url")
        ET.SubElement(url_node, f"{{{SITEMAP_NS}}}loc").text = entry["loc"]
        lastmod = max_git_last_modified(repo_root, entry["sources"])
        ET.SubElement(url_node, f"{{{SITEMAP_NS}}}lastmod").text = format_iso(lastmod)
        ET.SubElement(url_node, f"{{{SITEMAP_NS}}}priority").text = entry["priority"]
    write_xml(ET.ElementTree(landing_root), landing_path)

    landing_lastmod = max_git_last_modified(repo_root, [source for entry in manifest for source in entry["sources"]])
    docs_lastmod = max_git_last_modified(
        repo_root,
        docs_source_inputs(repo_root, repo_root / "sites/docs/source-map.yaml") + ["sites/docs/mkdocs.yml"],
    )

    index_root = ET.Element(f"{{{SITEMAP_NS}}}sitemapindex")
    for loc, lastmod in [
        (f"{LANDING_BASE_URL}/landing-sitemap.xml", landing_lastmod),
        ("https://docs.clawperator.com/sitemap.xml", docs_lastmod),
    ]:
        sitemap_node = ET.SubElement(index_root, f"{{{SITEMAP_NS}}}sitemap")
        ET.SubElement(sitemap_node, f"{{{SITEMAP_NS}}}loc").text = loc
        ET.SubElement(sitemap_node, f"{{{SITEMAP_NS}}}lastmod").text = format_iso(lastmod)
    write_xml(ET.ElementTree(index_root), sitemap_index_path)


def parse_source_map(source_map_path):
    pages = []
    current_page = None
    in_sources = False
    sources_indent = None

    with source_map_path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.rstrip("\n")
            stripped = line.strip()
            indent = len(line) - len(line.lstrip(" "))

            if in_sources and stripped:
                if indent <= sources_indent:
                    in_sources = False
                    sources_indent = None
                elif stripped.startswith("- "):
                    current_page["sources"].append(stripped[2:].strip())
                    continue

            if stripped.startswith("- output:"):
                output = stripped.split(":", 1)[1].strip()
                current_page = {"output": output, "sources": []}
                pages.append(current_page)
                in_sources = False
                sources_indent = None
                continue

            if current_page and stripped == "sources:":
                in_sources = True
                sources_indent = indent
                continue

    return pages


def docs_source_inputs(repo_root, source_map_path):
    inputs = {"sites/docs/source-map.yaml"}
    for page in parse_source_map(source_map_path):
        for source in page.get("sources", []):
            inputs.add(source)
    return sorted(inputs)


def docs_priority_for_output(output_path):
    mapping = {
        "index.md": "1.0",
        "ai-agents/node-api-for-agents.md": "1.0",
        "design/operator-llm-playbook.md": "0.9",
        "reference/cli-reference.md": "0.9",
        "reference/api-overview.md": "0.9",
        "getting-started/first-time-setup.md": "0.8",
        "getting-started/openclaw-first-run.md": "0.8",
    }
    return mapping.get(output_path, "0.6")


def docs_output_from_url(url):
    parsed = urlparse(url)
    path = parsed.path
    if path in {"", "/"}:
        return "index.md"
    trimmed = path.lstrip("/").rstrip("/")
    return f"{trimmed}.md"


def docs_sources_by_output(source_map_path):
    mapping = {}
    for page in parse_source_map(source_map_path):
        mapping[page["output"]] = page.get("sources", [])
    return mapping


def generated_docs_fallback(output_path):
    return f"sites/docs/.build/{output_path}"


def patch_docs_sitemap(repo_root, sitemap_path, source_map_path):
    tree = ET.parse(sitemap_path)
    root = tree.getroot()
    source_mapping = docs_sources_by_output(source_map_path)

    for url_node in root.findall("sm:url", NS):
        loc_node = url_node.find("sm:loc", NS)
        if loc_node is None or not loc_node.text:
            continue
        output = docs_output_from_url(loc_node.text)
        sources = source_mapping.get(output)
        if not sources:
            continue
        usable_sources = list(sources)
        fallback_path = generated_docs_fallback(output)
        if fallback_path not in usable_sources:
            usable_sources.append(fallback_path)
        lastmod = max_git_last_modified(repo_root, usable_sources)
        set_child_text(url_node, "lastmod", format_iso(lastmod))
        set_child_text(url_node, "priority", docs_priority_for_output(output))

    write_xml(tree, sitemap_path)
    gzip_path = sitemap_path.with_suffix(sitemap_path.suffix + ".gz")
    if gzip_path.exists():
        with sitemap_path.open("rb") as src, gzip.open(gzip_path, "wb") as dest:
            dest.write(src.read())


def main():
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()

    if args.command == "landing":
        generate_landing_sitemaps(repo_root)
        return

    if args.command == "docs":
        patch_docs_sitemap(
            repo_root=repo_root,
            sitemap_path=Path(args.sitemap_path).resolve(),
            source_map_path=Path(args.source_map_path).resolve(),
        )
        return

    raise SystemExit(f"unsupported command: {args.command}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
