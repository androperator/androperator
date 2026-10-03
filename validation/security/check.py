#!/usr/bin/env python3
"""Run pinned maintained security rules and report findings through reviewdog."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
LOCK = Path(__file__).with_name("tools.json")
REQUIREMENTS = Path(__file__).with_name("requirements.txt")
REVIEWS = Path(__file__).with_name("reviewed-findings.json")
# Audit rules require manual context review; retain these concrete execution risks.
AUDIT_RULES = {"curl-pipe-bash", "spawn-shell-true"}
# Exact paths only: these are not supported by the scanner's shell and HTML parsers.
PARSER_EXCLUSIONS = {
    "gradlew": "generated Gradle wrapper; validated with sh -n",
    "sites/docs/overrides/main.html": "Jinja template; validated by the docs build",
}


def run(command, **kwargs):
    # Commands are constructed as argv lists; refs are resolved before use and no shell is started.
    return subprocess.run(command, cwd=ROOT, check=True, text=True, shell=False, **kwargs)  # nosemgrep: dangerous-subprocess-use-audit


def download(url, digest, cache):
    target = cache / digest
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        descriptor, filename = tempfile.mkstemp(dir=cache)
        os.close(descriptor)
        temporary = Path(filename)
        try:
            run(["curl", "--fail", "--location", "--silent", "--show-error",
                 "--retry", "2", "--output", str(temporary), url])
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
                raise ValueError(f"Checksum mismatch downloading {url}")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return target


def extract(archive, destination):
    # Python 3.11 is supported; reject links and escaping paths before extracting.
    with tarfile.open(archive) as bundle:
        for member in bundle.getmembers():
            path = destination / member.name
            if not path.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Archive contains an escaping path")
            if not (member.isfile() or member.isdir()):
                raise ValueError("Archive contains an unsupported entry")
        for member in bundle.getmembers():
            path = destination / member.name
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, path.open("wb") as target:
                    shutil.copyfileobj(source, target)


def install(lock, cache, temporary):
    machine = platform.machine()
    machine = "arm64" if machine == "aarch64" else machine
    host = f"{platform.system()}-{machine}"
    tool = lock["reviewdog"]
    if host not in tool["assets"]:
        raise ValueError(f"Unsupported platform: {host}")
    asset, digest = tool["assets"][host]
    archive = download(
        f"https://github.com/reviewdog/reviewdog/releases/download/v{tool['version']}/{asset}",
        digest, cache)
    extract(archive, temporary / "reviewdog-release")
    reporter = temporary / "reviewdog"
    shutil.copyfile(temporary / "reviewdog-release" / "reviewdog", reporter)
    reporter.chmod(0o755)

    version = lock["semgrep"]["version"]
    requirements_digest = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}"
    environment = cache / f"semgrep-{version}-py{python_version}-{requirements_digest}"
    scanner = environment / "bin" / "semgrep"
    # A failed install leaves no completion marker, so the next run retries it.
    marker = environment / ".installed"
    if not scanner.exists() or not marker.exists():
        run([sys.executable, "-m", "venv", str(environment)])
        run([str(environment / "bin" / "python"), "-m", "pip", "install",
             "--disable-pip-version-check", "--require-hashes", "--only-binary=:all:",
             "-r", str(REQUIREMENTS)])
        marker.write_text(version)
    binaries = {"semgrep": str(scanner), "reviewdog": str(reporter)}
    rules = lock["rules"]
    archive = download(
        f"https://codeload.github.com/{rules['repository']}/tar.gz/{rules['commit']}",
        rules["sha256"], cache)
    extract(archive, temporary / "rules")
    rules_root = temporary / "rules" / f"semgrep-rules-{rules['commit']}"
    return binaries, [str(rules_root / name) for name in rules["directories"]]


def security_rule(result):
    metadata = result["extra"].get("metadata", {})
    return (metadata.get("category") in {"security", "audit"}
            and (bool({"vuln", "secure default"} & set(metadata.get("subcategory", [])))
                 or result["check_id"] in AUDIT_RULES))


def reviewed_finding(result, reviews):
    for review in reviews:
        if (result["path"] == review["path"] and result["check_id"] == review["rule"]
                and {key: result["start"][key] for key in ("line", "col")} == review["start"]
                and {key: result["end"][key] for key in ("line", "col")} == review["end"]):
            path = ROOT / result["path"]
            if hashlib.sha256(path.read_bytes()).hexdigest() == review["file_sha256"]:
                return True
    return False


def diagnostics(scan, reviews=()):
    if scan.get("errors"):
        raise ValueError(f"Semgrep reported errors: {json.dumps(scan['errors'])}")
    if "results" not in scan or not isinstance(scan["results"], list):
        raise ValueError("Semgrep did not return a results list")
    findings = []
    reviewed_count = 0
    for result in scan["results"]:
        if not security_rule(result):
            continue
        if reviewed_finding(result, reviews):
            reviewed_count += 1
            continue
        extra = result["extra"]
        findings.append({
            "message": extra["message"],
            "severity": {"INFO": "INFO", "WARNING": "WARNING", "ERROR": "ERROR"}[extra["severity"]],
            "location": {"path": result["path"], "range": {
                "start": {"line": result["start"]["line"], "column": result["start"]["col"]},
                "end": {"line": result["end"]["line"], "column": result["end"]["col"]}}},
            "code": {"value": result["check_id"]},
        })
    if reviewed_count:
        print(f"Matched {reviewed_count} reviewed exceptions with unchanged file checksums.", file=sys.stderr)
    return {"source": {"name": "Semgrep"}, "diagnostics": findings}


def escape_annotation(value, property_value=False):
    value = str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    if property_value:
        value = value.replace(":", "%3A").replace(",", "%2C")
    return value


def emit_annotations(report):
    for finding in report["diagnostics"]:
        location = finding["location"]
        start = location["range"]["start"]
        level = {"ERROR": "error", "WARNING": "warning", "INFO": "notice"}[finding["severity"]]
        properties = f"file={escape_annotation(location['path'], True)},line={start['line']},col={start.get('column', 1)}"
        message = f"[{finding['code']['value']}] {finding['message']}"
        print(f"::{level} {properties}::{escape_annotation(message)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="origin/main", help="Comparison ref (default: origin/main)")
    parser.add_argument("--full", action="store_true", help="Report findings across the entire tree")
    parser.add_argument("--reporter", choices=("local", "github-annotations"), default="local")
    args = parser.parse_args()
    base = None
    targets = ["."]
    if not args.full:
        resolved = run(["git", "rev-parse", "--verify", "--end-of-options", f"{args.base}^{{commit}}"],
                       capture_output=True).stdout.strip()
        base = run(["git", "merge-base", "HEAD", resolved], capture_output=True).stdout.strip()
        paths = run(["git", "diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z",
                     "--diff-filter=ACMRTUXB", base, "--"], capture_output=True).stdout
        changed_paths = [path for path in paths.split("\0") if path]
        for path in changed_paths:
            if path in PARSER_EXCLUSIONS:
                print(f"Excluded {path}: {PARSER_EXCLUSIONS[path]}", file=sys.stderr)
        targets = [f"./{path}" for path in changed_paths if path not in PARSER_EXCLUSIONS]
        if not targets:
            print("No changed files to scan.", file=sys.stderr)
            return 0
    lock = json.loads(LOCK.read_text())
    cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "androperator-security"
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="androperator-security-") as directory:
        temporary = Path(directory)
        binaries, rules = install(lock, cache, temporary)
        command = [binaries["semgrep"], "scan", "--json", "--strict", "--metrics=off",
                   "--disable-version-check", "--no-rewrite-rule-ids", "--timeout=15", "--exclude=.worktrees"]
        for path, reason in PARSER_EXCLUSIONS.items():
            command.append(f"--exclude=/{path}")
            if args.full and (ROOT / path).exists():
                print(f"Excluded {path}: {reason}", file=sys.stderr)
        for rule in rules:
            command.extend(["--config", rule])
        command.extend(["--", *targets])
        print("Running pinned maintained security rules...", file=sys.stderr)
        environment = dict(os.environ, SEMGREP_LOG_FILE=str(temporary / "semgrep.log"),
                           SEMGREP_SETTINGS_FILE=str(temporary / "settings.yml"))
        try:
            scan = json.loads(run(command, capture_output=True, env=environment).stdout)
        except subprocess.CalledProcessError as error:
            if error.stdout:
                diagnostics(json.loads(error.stdout))
            raise
        review_data = json.loads(REVIEWS.read_text())
        reviews = review_data["findings"] if review_data["rules_commit"] == lock["rules"]["commit"] else []
        report = diagnostics(scan, reviews)
        command = [binaries["reviewdog"], "-f=rdjson", f"-reporter={'rdjson' if args.reporter == 'github-annotations' else 'local'}",
                   "-name=security", "-fail-level=any"]
        if base:
            command.extend(["-filter-mode=file", f"-diff=git diff --no-ext-diff --no-textconv -U0 {shlex.quote(base)}"])
        else:
            command.append("-filter-mode=nofilter")
        # The executable is a verified release; cache location is trusted local configuration.
        # Arguments are passed directly; the diff command contains only a resolved, quoted SHA.
        result = subprocess.run(  # nosemgrep: dangerous-subprocess-use-audit, dangerous-subprocess-use-tainted-env-args
            command, cwd=ROOT, input=json.dumps(report), text=True, shell=False,  # nosemgrep: dangerous-subprocess-use-tainted-env-args
            capture_output=args.reporter == "github-annotations")
        if args.reporter == "github-annotations":
            if result.stderr:
                print(result.stderr, file=sys.stderr, end="")
            emit_annotations(json.loads(result.stdout))
        return result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (subprocess.CalledProcessError, ValueError, OSError, KeyError) as error:
        print(f"Security scan failed; findings are incomplete: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr, file=sys.stderr)
        sys.exit(2)
