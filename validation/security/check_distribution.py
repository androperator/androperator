#!/usr/bin/env python3
"""Reject repository security tooling in product distribution outputs."""
import argparse
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = re.compile(r"(?:^|/)(?:validation/security|semgrep[^/]*|reviewdog[^/]*|\.venv)(?:/|$)", re.I)
TOOL_CONTENT = re.compile(rb"\b(?:semgrep|reviewdog)\b|validation/security", re.I)


def check_file(name, content, depth=0):
    if TOOL_PATH.search(name):
        raise ValueError(f"Repository security tooling must not ship: {name}")
    # Also inspect UTF-16 strings in Android resources. Our own nosemgrep comments
    # are permitted: they do not contain a standalone scanner name or rule payload.
    searchable = content.replace(b"\x00", b"")
    if TOOL_CONTENT.search(searchable):
        raise ValueError(f"Scanner integration or rules reference in distribution: {name}")
    if (re.search(rb"^rules:\s*$", content, re.M)
            and re.search(rb"^\s+languages:\s*", content, re.M)
            and re.search(rb"^\s+(?:pattern[\w-]*|mode):", content, re.M)):
        raise ValueError(f"Possible bundled scanner rules: {name}")
    if content.lstrip().startswith(b'{') and b'"rules"' in content:
        try:
            rules = json.loads(content).get('rules', [])
        except (ValueError, UnicodeError):
            rules = []
        if isinstance(rules, list) and any(
                isinstance(rule, dict) and 'languages' in rule
                and any(key == 'mode' or key.startswith('pattern') for key in rule)
                for rule in rules):
            raise ValueError(f"Possible bundled scanner rules: {name}")
    # Inspect common compressed website assets and nested ZIPs rather than treating
    # their compressed bytes as evidence of a clean artifact. Never extract to disk.
    if content.startswith((b"PK\x03\x04", b"PK\x05\x06", b"\x1f\x8b")):
        if depth >= 4:
            raise ValueError(f"Archive nesting exceeds inspection limit: {name}")
        if content.startswith(b"\x1f\x8b"):
            check_file(name + "!gzip", gzip.decompress(content), depth + 1)
        else:
            check_zip(io.BytesIO(content), name, depth + 1)


def check_zip(source, label, depth=0, require_apk=False):
    with zipfile.ZipFile(source) as archive:
        if require_apk and 'AndroidManifest.xml' not in archive.namelist():
            raise ValueError(f"APK has no AndroidManifest.xml: {label}")
        for entry in archive.infolist():
            if not entry.is_dir():
                check_file(f"{label}!/{entry.filename}", archive.read(entry), depth)


def check_directory(directory):
    if not directory.is_dir():
        raise ValueError(f"Distribution directory is missing: {directory}")
    if directory.is_symlink():
        raise ValueError(f"Distribution symlinks are not supported: {directory}")

    def traversal_error(error):
        raise error

    files = 0
    for parent, directories, filenames in os.walk(directory, onerror=traversal_error):
        for name in directories + filenames:
            path = Path(parent) / name
            if path.is_symlink():
                raise ValueError(f"Distribution symlinks are not supported: {path}")
        for name in filenames:
            path = Path(parent) / name
            check_file(path.relative_to(directory).as_posix(), path.read_bytes())
            files += 1
    if not files:
        raise ValueError(f"Distribution directory is empty: {directory}")
    return files


def check_package_files(package_root, files):
    if not any(file['path'] == 'dist/cli/index.js' for file in files):
        raise ValueError('Build the Node package before checking its contents.')
    for file in files:
        name = file['path']
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError(f"Invalid npm package path: {name}")
        check_file(name, (package_root / name).read_bytes())


def check_npm():
    package_root = ROOT / 'apps/node'
    # This is a packaging regression guard. No package lifecycle script is executed.
    packed = subprocess.run(['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'],
                            cwd=package_root, check=True, capture_output=True, text=True)
    files = json.loads(packed.stdout)[0]['files']
    check_package_files(package_root, files)
    return len(files)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--npm', action='store_true', help='Inspect the built npm package file list and contents')
    target.add_argument('--directory', type=Path, help='Inspect a built website directory')
    target.add_argument('--apk', type=Path, help='Inspect the APK archive before publication')
    args = parser.parse_args(argv)
    try:
        if args.npm:
            label = f"npm package ({check_npm()} files)"
        elif args.directory is not None:
            label = f"{args.directory} ({check_directory(args.directory)} files)"
        else:
            check_file(args.apk.name, b'')
            check_zip(args.apk, str(args.apk), require_apk=True)
            label = str(args.apk)
    except (OSError, ValueError, RuntimeError, EOFError, zipfile.BadZipFile,
            subprocess.CalledProcessError) as error:
        print(f"Distribution check failed: {error}", file=sys.stderr)
        return 1
    print(f"Distribution boundary passed: {label}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
