#!/usr/bin/env python3
"""Pack and validate the exact npm archive retained for release publication."""
import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def validate_archive(path, version):
    files = {}
    with tarfile.open(path, 'r:gz') as archive:
        for entry in archive:
            relative = PurePosixPath(entry.name)
            if (relative.is_absolute() or '..' in relative.parts
                    or not relative.parts or relative.parts[0] != 'package'):
                raise ValueError(f'Invalid archive path: {entry.name}')
            if entry.isdir():
                continue
            if not entry.isfile() or relative.as_posix() in files:
                raise ValueError(f'Unsupported or duplicate archive entry: {entry.name}')
            files[relative.as_posix()] = entry
        if not {'package/package.json', 'package/dist/cli/index.cjs'} <= files.keys():
            raise ValueError('Archive must contain package.json and the built CLI entry point')
        with archive.extractfile(files['package/package.json']) as source:
            manifest = json.load(source)
        if manifest.get('name') != '@androperator/cli' or manifest.get('version') != version:
            raise ValueError('Packed package name/version does not match the intended release')
        if manifest.get('bin') != {'androperator': 'dist/cli/index.cjs'}:
            raise ValueError('Packed package must expose the androperator executable')
        if not files['package/dist/cli/index.cjs'].size:
            raise ValueError('Packed CLI entry point is empty')
    return len(files)


def pack_release(package_root, version, output):
    # Hooks finish before inspection; postpack may restore or remove source files.
    with tempfile.TemporaryDirectory(prefix='androperator-npm-release-') as temporary:
        result = subprocess.run(
            ['npm', 'pack', '--json', '--ignore-scripts=false', '--pack-destination', temporary],
            cwd=package_root, check=True, capture_output=True, text=True)
        packages = json.loads(result.stdout)
        if not isinstance(packages, list) or len(packages) != 1:
            raise ValueError('Expected exactly one npm archive')
        filename = packages[0]['filename']
        if not isinstance(filename, str) or Path(filename).name != filename or not filename.endswith('.tgz'):
            raise ValueError('npm pack returned an invalid archive filename')
        archive = Path(temporary) / filename
        count = validate_archive(archive, version)
        shutil.copyfile(archive, output)
        return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True, help='Expected version from the release tag')
    parser.add_argument('--output', required=True, type=Path, help='Destination tarball for publication')
    args = parser.parse_args()
    try:
        count = pack_release(ROOT / 'apps/node', args.version, args.output)
    except subprocess.CalledProcessError as error:
        parser.exit(1, f'npm pack failed:\n{error.stdout or ""}{error.stderr or ""}\n')
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
        parser.exit(1, f'npm release packing failed: {error}\n')
    print(f'Validated npm release archive ({count} files): {args.output}')
