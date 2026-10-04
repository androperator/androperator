#!/usr/bin/env python3
"""Verify the one-time manually published scoped CLI archive before tagging."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess

PACKAGE = '@androperator/cli'
VERSION = '1.1.0'


def verify(metadata, archive):
    if metadata.get('version') != VERSION:
        raise ValueError('Bootstrap publication must be @androperator/cli@1.1.0')
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()
    if metadata.get('dist.integrity') != integrity:
        raise ValueError('Published archive differs from the validated release archive')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    result = subprocess.run(['npm', 'view', f'{PACKAGE}@{VERSION}', 'version',
                             'dist.integrity', '--json'], check=True, capture_output=True, text=True)
    verify(json.loads(result.stdout), args.archive)
    print(f'Verified existing {PACKAGE}@{VERSION}: archive integrity matches the rebuild of {args.commit}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f'Bootstrap verification failed: {error}')
