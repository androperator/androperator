#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path


def die(message: str) -> None:
    print(f"release-update-published-version: {message}", file=sys.stderr)
    sys.exit(1)


def run(cmd: list[str], cwd: Path | None = None) -> str:
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            check=True,
            text=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        details = stderr or stdout or str(exc)
        die(details)
    return result.stdout


def replace_required(path: Path, pattern: str, replacement: str, *, fatal: bool = True) -> bool:
    if not path.exists():
        if fatal:
            die(f"missing required file: {path}")
        print(f"warning: optional file missing, skipping edit: {path}", file=sys.stderr)
        return False

    content = path.read_text(encoding="utf-8")
    new_content, replacements = re.subn(pattern, replacement, content, flags=re.MULTILINE)
    if replacements == 0:
        if fatal:
            die(f"expected pattern not found in {path}")
        print(f"warning: optional pattern not found, skipping edit: {path}", file=sys.stderr)
        return False

    if new_content != content:
        path.write_text(new_content, encoding="utf-8")
        return True
    return False


def parse_version(version: str) -> tuple[int, int, int]:
    match = re.match(r"^([0-9]+)\.([0-9]+)\.([0-9]+)", version)
    if not match:
        die(f"could not parse version {version}")
    return tuple(int(part) for part in match.groups())


def current_release_marker_html(version: str) -> re.Pattern[str]:
    tag_href = re.escape(f"https://github.com/androperator/androperator/releases/tag/v{version}")
    release_text = re.escape(version)
    return re.compile(rf'<strong>Current release:\s*<a href="{tag_href}">{release_text}</a></strong>')


def current_release_marker_text(version: str) -> str:
    return f"**Current release: [{version}](https://github.com/androperator/androperator/releases/tag/v{version})**"


def published_version_output_problems(repo_root: Path, version: str) -> list[str]:
    problems: list[str] = []

    html_path = repo_root / "sites" / "docs" / "site" / "index.html"
    html_marker = current_release_marker_html(version)
    if not html_path.exists():
        problems.append(f"missing built docs homepage: {html_path}")
    elif not html_marker.search(html_path.read_text(encoding="utf-8")):
        problems.append(f"{html_path}: missing current release marker for {version}")

    expected_text = current_release_marker_text(version)
    artifact_paths = [
        repo_root / "sites" / "docs" / "static" / "llms-full.txt",
        repo_root / "sites" / "docs" / "site" / "llms-full.txt",
        repo_root / "sites" / "androperator-public" / "llms-full.txt",
    ]
    for artifact_path in artifact_paths:
        if not artifact_path.exists():
            problems.append(f"missing generated release artifact: {artifact_path}")
            continue
        content = artifact_path.read_text(encoding="utf-8")
        if expected_text not in content:
            problems.append(f"{artifact_path}: missing current release marker for {version}")

    return problems


def update_compatibility_versioned_apk_downloads(path: Path, version: str) -> bool:
    """
    Best-effort migration of release follow-up "version injection" into the
    compatibility remediation example.

    The original script targeted `docs/compatibility.md` and a different
    markdown shape. The current public doc lives at
    `docs/troubleshooting/compatibility.md` and contains hardcoded versioned
    download URLs inside the failing-doctor remediation example.
    """

    if not path.exists():
        print(f"warning: compatibility doc missing, skipping: {path}", file=sys.stderr)
        return False

    content = path.read_text(encoding="utf-8")
    changed = False

    # Update the version badge at the top of the page
    # Pattern matches: **Current release: [X.Y.Z](https://github.com/androperator/androperator/releases/tag/vX.Y.Z)**
    badge_pattern = r'(\*\*Current release: \[)[0-9]+\.[0-9]+\.[0-9]+(\]\(https://github\.com/androperator/androperator/releases/tag/v)[0-9]+\.[0-9]+\.[0-9]+(\)\*\*)'
    badge_repl = f"\\g<1>{version}\\g<2>{version}\\g<3>"
    content, replacements = re.subn(badge_pattern, badge_repl, content, flags=re.MULTILINE)
    changed = changed or replacements > 0

    # Update versioned URLs inside the remediation bullet strings.
    # Note: intentionally only matches numeric x.y.z versions (not `v<version>` templates).
    url_apk_pat = r"(https://downloads\.androperator\.com/operator/)v([0-9]+\.[0-9]+\.[0-9]+)/operator-v\2\.apk"
    url_apk_repl = f"\\1v{version}/operator-v{version}.apk"
    content, replacements = re.subn(url_apk_pat, url_apk_repl, content, flags=re.MULTILINE)
    changed = changed or replacements > 0

    url_sha_pat = (
        r"(https://downloads\.androperator\.com/operator/)v([0-9]+\.[0-9]+\.[0-9]+)/operator-v\2\.apk\.sha256"
    )
    url_sha_repl = f"\\1v{version}/operator-v{version}.apk.sha256"
    content, replacements = re.subn(url_sha_pat, url_sha_repl, content, flags=re.MULTILINE)
    changed = changed or replacements > 0

    filename_apk_pat = r"operator-v([0-9]+\.[0-9]+\.[0-9]+)\.apk"
    filename_apk_repl = f"operator-v{version}.apk"
    content, replacements = re.subn(filename_apk_pat, filename_apk_repl, content, flags=re.MULTILINE)
    changed = changed or replacements > 0

    filename_sha_pat = r"operator-v([0-9]+\.[0-9]+\.[0-9]+)\.apk\.sha256"
    filename_sha_repl = f"operator-v{version}.apk.sha256"
    content, replacements = re.subn(filename_sha_pat, filename_sha_repl, content, flags=re.MULTILINE)
    changed = changed or replacements > 0

    if changed:
        path.write_text(content, encoding="utf-8")
    return changed


def main() -> None:
    if len(sys.argv) != 2:
        die("usage: .agents/skills/release-update-published-version/scripts/update_published_version.py <version>")

    version = sys.argv[1]
    if not re.match(r"^[0-9]+\.[0-9]+\.[0-9]+$", version):
        die("version must be a plain release version like X.Y.Z")

    repo_root = Path(run(["git", "rev-parse", "--show-toplevel"]).strip())
    tracked_status = run(["git", "status", "--porcelain"], cwd=repo_root).strip()
    if tracked_status:
        die("working tree has uncommitted or untracked changes")

    current_branch = run(["git", "branch", "--show-current"], cwd=repo_root).strip()
    if not current_branch:
        die("HEAD is detached; cannot create the published-version follow-up commit")

    repo_slug = run(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], cwd=repo_root).strip()
    published_tag = run(
        ["gh", "release", "view", f"v{version}", "--repo", repo_slug, "--json", "tagName", "--jq", ".tagName"],
        cwd=repo_root,
    ).strip()
    if published_tag != f"v{version}":
        die(f"GitHub Release v{version} was not found")

    npm_version = run(["npm", "view", f"androperator@{version}", "version"], cwd=repo_root).strip()
    if npm_version != version:
        die(f"npm does not report androperator@{version}")

    latest_npm_version = run(["npm", "view", "androperator", "version"], cwd=repo_root).strip()
    if latest_npm_version != version:
        die(f"{version} is not the current npm release (latest is {latest_npm_version})")

    updated_docs: list[Path] = []

    # Update version badge on docs home page
    docs_index_path = repo_root / "docs" / "index.md"
    if replace_required(
        docs_index_path,
        r'(\*\*Current release: \[)[0-9]+\.[0-9]+\.[0-9]+(\]\(https://github\.com/androperator/androperator/releases/tag/v)[0-9]+\.[0-9]+\.[0-9]+(\)\*\*)',
        f"\\g<1>{version}\\g<2>{version}\\g<3>",
        fatal=False,
    ):
        updated_docs.append(docs_index_path)

    preparing_marker = "**Androperator 1.0.0 is being prepared for release.**"
    for marker_path in [docs_index_path, repo_root / "docs" / "troubleshooting" / "compatibility.md"]:
        text = marker_path.read_text(encoding="utf-8")
        if preparing_marker in text:
            marker_path.write_text(text.replace(preparing_marker, current_release_marker_text(version)), encoding="utf-8")
            if marker_path not in updated_docs:
                updated_docs.append(marker_path)

    # The historical `docs/android-operator-apk.md` doc was removed/migrated.
    # Release follow-ups should keep working even when that legacy input is
    # not present.
    update_compatibility_path = repo_root / "docs" / "troubleshooting" / "compatibility.md"
    if update_compatibility_versioned_apk_downloads(update_compatibility_path, version):
        updated_docs.append(update_compatibility_path)

    release_procedure_path = repo_root / "docs" / "internal" / "release-procedure.md"
    if replace_required(
        release_procedure_path,
        r"\.agents/skills/release-create/scripts/create_release\.sh [0-9]+\.[0-9]+\.[0-9]+ \[commit_sha\]",
        f".agents/skills/release-create/scripts/create_release.sh {version} [commit_sha]",
        fatal=False,
    ):
        updated_docs.append(release_procedure_path)

    if replace_required(
        release_procedure_path,
        r"\.agents/skills/release-verify/scripts/release_verify\.sh [0-9]+\.[0-9]+\.[0-9]+",
        f".agents/skills/release-verify/scripts/release_verify.sh {version}",
        fatal=False,
    ):
        if release_procedure_path not in updated_docs:
            updated_docs.append(release_procedure_path)

    replace_required(
        repo_root / "sites" / "androperator-public" / "install.sh",
        r"# install\.sh \(v[0-9]+\.[0-9]+\.[0-9]+\)",
        f"# install.sh (v{version})",
    )

    subprocess.run(["./scripts/docs_build.sh"], cwd=repo_root, check=True)

    published_version_problems = published_version_output_problems(repo_root, version)
    if published_version_problems:
        die(
            "published version verification failed:\n"
            + "\n".join(f"- {problem}" for problem in published_version_problems)
        )

    commit_message = f"docs(release): update published version to {version}"

    # Stage only files that exist (and were likely updated). This avoids
    # aborting the follow-up commit due to removed/migrated doc inputs.
    paths_to_stage = {repo_root / "sites" / "androperator-public" / "install.sh"}
    for p in updated_docs:
        paths_to_stage.add(p)

    stage_args = [str(p.relative_to(repo_root)) for p in paths_to_stage if p.exists()]

    subprocess.run(
        [
            "git",
            "add",
            *stage_args,
        ],
        cwd=repo_root,
        check=True,
    )
    staged_status = run(["git", "diff", "--cached", "--name-only"], cwd=repo_root).strip()
    if not staged_status:
        print(f"published version already current at {version}")
        return
    subprocess.run(["git", "commit", "-m", commit_message], cwd=repo_root, check=True)
    print(commit_message)


if __name__ == "__main__":
    main()
