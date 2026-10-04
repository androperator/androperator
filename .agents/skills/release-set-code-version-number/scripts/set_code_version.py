#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def die(message: str) -> None:
    print(f"release-set-code-version-number: {message}", file=sys.stderr)
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


def run_no_capture(cmd: list[str], cwd: Path | None = None) -> None:
    try:
        subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            check=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        die(str(exc))


def replace_in_file(path: Path, pattern: str, replacement: str, *, count: int = 0) -> bool:
    content = path.read_text(encoding="utf-8")
    new_content, replacements = re.subn(pattern, replacement, content, count=count, flags=re.MULTILINE)
    if replacements == 0:
        return False
    path.write_text(new_content, encoding="utf-8")
    return True


def remove_bundled_skill_artifacts(repo_root: Path) -> list[str]:
    bundled_skills_root = repo_root / "apps" / "node" / "bundled-skills"
    removed: list[str] = []
    if not bundled_skills_root.exists():
        return removed

    for path in bundled_skills_root.rglob(".DS_Store"):
        if path.is_file() or path.is_symlink():
            path.unlink()
            removed.append(str(path.relative_to(repo_root)))
    return removed


def update_package_lock(path: Path, old_version: str, new_version: str) -> None:
    package_lock = json.loads(path.read_text(encoding="utf-8"))
    root_package = package_lock.get("packages", {}).get("")
    if (
        package_lock.get("version") != old_version
        or not isinstance(root_package, dict)
        or root_package.get("version") != old_version
    ):
        die(f"{path} does not match version {old_version}")

    package_lock["version"] = new_version
    root_package["version"] = new_version
    path.write_text(json.dumps(package_lock, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    raw_args = sys.argv[1:]
    full_flag_count = raw_args.count("--full")
    full_validation = full_flag_count == 1
    if "--full" in raw_args:
        raw_args.remove("--full")
    if len(raw_args) != 2 or full_flag_count > 1:
        die("usage: .agents/skills/release-set-code-version-number/scripts/set_code_version.py <old_version> <new_version> [--full]")

    old_version, new_version = raw_args
    version_pattern = r"^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$"
    if not re.match(version_pattern, old_version) or not re.match(version_pattern, new_version):
        die("versions must look like semver")

    repo_root = Path(run(["git", "rev-parse", "--show-toplevel"]).strip())
    os.chdir(repo_root)

    removed_artifacts = remove_bundled_skill_artifacts(repo_root)
    tracked_status = run(["git", "status", "--porcelain"]).strip()
    if tracked_status:
        die("working tree has uncommitted or untracked changes")

    package_json_path = repo_root / "apps" / "node" / "package.json"
    package_data = json.loads(package_json_path.read_text(encoding="utf-8"))
    if package_data.get("version") != old_version:
        die(f"apps/node/package.json is {package_data.get('version')}, expected {old_version}")

    package_data["version"] = new_version
    package_json_path.write_text(json.dumps(package_data, indent=2) + "\n", encoding="utf-8")

    updated_files: list[str] = ["apps/node/package.json"]

    internal_replacements = {
        "scripts/fake_adb.sh": (re.escape(f"{old_version}-d"), f"{new_version}-d"),
    }

    for relative_path, (pattern, replacement) in internal_replacements.items():
        path = repo_root / relative_path
        if replace_in_file(path, pattern, replacement):
            updated_files.append(relative_path)


    package_lock_path = repo_root / "apps" / "node" / "package-lock.json"
    update_package_lock(package_lock_path, old_version, new_version)
    updated_files.append("apps/node/package-lock.json")

    dependency_install_ran = full_validation or not (repo_root / "apps" / "node" / "node_modules").is_dir()
    if dependency_install_ran:
        run_no_capture(["npm", "--prefix", "apps/node", "ci"], cwd=repo_root)

    run_no_capture(["npm", "--prefix", "apps/node", "run", "build"], cwd=repo_root)
    if full_validation:
        run_no_capture(["npm", "--prefix", "apps/node", "run", "test"], cwd=repo_root)
        validation_summary = "npm --prefix apps/node ci && npm --prefix apps/node run build && npm --prefix apps/node run test"
    else:
        run_no_capture(
            [
                "node",
                "--test",
                "apps/node/dist/test/unit/versionCompatibility.test.js",
                "apps/node/dist/test/unit/versionCommand.test.js",
            ],
            cwd=repo_root,
        )
        validation_summary = "npm --prefix apps/node run build && node --test version compatibility tests"

    run_no_capture(["git", "add", *updated_files], cwd=repo_root)
    commit_message = f"chore(build): set code version to {new_version}"
    run_no_capture(["git", "commit", "-m", commit_message], cwd=repo_root)

    print(f"Bumped code version from {old_version} to {new_version}")
    for path in removed_artifacts:
        print(f"removed stray artifact {path}")
    for path in updated_files:
        print(f"updated {path}")
    print(f"Validation passed: {validation_summary}")
    print(f"Commit created: {commit_message}")


if __name__ == "__main__":
    main()
