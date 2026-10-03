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
import shutil
import tarfile
import tempfile
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = re.compile(r"(?:^|/)(?:validation/security|semgrep[^/]*|reviewdog[^/]*|\.venv)(?:/|$)", re.I)
DOCS_REFERENCE = re.compile(rb"semgrep|reviewdog|validation/security|security-checks|check_distribution", re.I)
TOOL_CONTENT = re.compile(rb"\b(?:semgrep|reviewdog)\b|validation/security", re.I)


def check_file(name, content, depth=0, public_docs=False):
    if TOOL_PATH.search(name):
        raise ValueError(f"Repository security tooling must not ship: {name}")
    # Also inspect UTF-16 strings in Android resources. Our own nosemgrep comments
    # are permitted: they do not contain a standalone scanner name or rule payload.
    searchable = content.replace(b"\x00", b"")
    if public_docs and (DOCS_REFERENCE.search(name.encode()) or DOCS_REFERENCE.search(searchable)):
        raise ValueError(f"Development security reference in published documentation: {name}")
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
            check_file(name + "!gzip", gzip.decompress(content), depth + 1, public_docs=public_docs)
        else:
            check_zip(io.BytesIO(content), name, depth + 1, public_docs=public_docs)


def check_zip(source, label, depth=0, require_apk=False, public_docs=False):
    with zipfile.ZipFile(source) as archive:
        if require_apk and 'AndroidManifest.xml' not in archive.namelist():
            raise ValueError(f"APK has no AndroidManifest.xml: {label}")
        for entry in archive.infolist():
            if not entry.is_dir():
                check_file(f"{label}!/{entry.filename}", archive.read(entry), depth, public_docs=public_docs)


def check_directory(directory, public_docs=False):
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
            check_file(path.relative_to(directory).as_posix(), path.read_bytes(), public_docs=public_docs)
            files += 1
    if not files:
        raise ValueError(f"Distribution directory is empty: {directory}")
    return files


def check_npm_archive(archive_path):
    names = set()
    with tarfile.open(archive_path, 'r:gz') as archive:
        for entry in archive:
            relative = PurePosixPath(entry.name)
            if (relative.is_absolute() or '..' in relative.parts
                    or not relative.parts or relative.parts[0] != 'package'):
                raise ValueError(f"Invalid npm archive path: {entry.name}")
            if entry.isdir():
                continue
            if not entry.isfile():
                raise ValueError(f"Unsupported npm archive entry: {entry.name}")
            if entry.name in names:
                raise ValueError(f"Duplicate npm archive entry: {entry.name}")
            names.add(entry.name)
            with archive.extractfile(entry) as content:
                check_file(entry.name, content.read())
    if not {'package/package.json', 'package/dist/cli/index.js'} <= names:
        raise ValueError('npm archive must contain package.json and the built CLI entry point.')
    return len(names)


def check_npm(output=None, package_root=None):
    package_root = package_root or ROOT / 'apps/node'
    with tempfile.TemporaryDirectory(prefix='androperator-npm-pack-') as temporary:
        # Run packaging hooks before inspecting bytes. Postpack may change the source
        # tree, so neither a dry-run list nor source-file reads prove archive contents.
        packed = subprocess.run(['npm', 'pack', '--json', '--ignore-scripts=false',
                                 '--pack-destination', temporary], cwd=package_root,
                                check=True, capture_output=True, text=True)
        filename = json.loads(packed.stdout)[0]['filename']
        if not isinstance(filename, str) or Path(filename).name != filename or not filename.endswith('.tgz'):
            raise ValueError('npm pack returned an invalid archive filename.')
        archive = Path(temporary) / filename
        count = check_npm_archive(archive)
        if output is not None:
            # Preserve the checked archive for publication; never repack it.
            shutil.copyfile(archive, output)
        return count


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--npm', action='store_true', help='Pack with lifecycle hooks enabled and inspect the resulting npm archive')
    target.add_argument('--npm-archive', type=Path, help='Inspect an existing npm tarball without running hooks')
    parser.add_argument('--output', type=Path, help='With --npm, retain the checked tarball at this path')
    target.add_argument('--directory', type=Path, help='Inspect a built website directory')
    target.add_argument('--public-docs', type=Path, help='Inspect published docs, rejecting even suppression comments and internal security references')
    target.add_argument('--apk', type=Path, help='Inspect the APK archive before publication')
    args = parser.parse_args(argv)
    if args.output is not None and not args.npm:
        parser.error("--output requires --npm")
    try:
        if args.npm:
            label = f"npm package ({check_npm(args.output)} files)"
        elif args.npm_archive is not None:
            label = f"{args.npm_archive} ({check_npm_archive(args.npm_archive)} files)"
        elif args.public_docs is not None:
            label = f"{args.public_docs} ({check_directory(args.public_docs, public_docs=True)} files; public docs)"
        elif args.directory is not None:
            label = f"{args.directory} ({check_directory(args.directory)} files)"
        else:
            check_file(args.apk.name, b'')
            check_zip(args.apk, str(args.apk), require_apk=True)
            label = str(args.apk)
    except (OSError, ValueError, RuntimeError, EOFError, zipfile.BadZipFile, tarfile.TarError,
            subprocess.CalledProcessError) as error:
        print(f"Distribution check failed: {error}", file=sys.stderr)
        return 1
    print(f"Distribution boundary passed: {label}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
