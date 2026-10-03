#!/usr/bin/env python3
"""Verify the declaration in compiled resources, not just source XML."""
import argparse
import subprocess
import re

parser = argparse.ArgumentParser()
parser.add_argument('--aapt2', required=True)
parser.add_argument('apks', nargs='+')
args = parser.parse_args()
for apk in args.apks:
    resources = subprocess.run([args.aapt2, 'dump', 'resources', apk], check=True, capture_output=True, text=True).stdout
    resource_id = re.search(r'resource (0x[0-9a-f]+) xml/accessibility_service_config', resources)[1]
    manifest = subprocess.run([args.aapt2, 'dump', 'xmltree', apk, '--file', 'AndroidManifest.xml'], check=True, capture_output=True, text=True).stdout
    service = manifest.split('androperator.operator.accessibilityservice.OperatorAccessibilityService', 1)[1].split('E: service', 1)[0]
    assert 'android.accessibilityservice' in service and '@' + resource_id in service, 'Service metadata is not bound to the inspected configuration'
    block = resources.split('xml/accessibility_service_config\n', 1)[1].split('    resource ', 1)[0]
    entries = re.findall(r'\((?:v([0-9]+))?\) \(file\) (\S+)', block)
    eligible = [(int(version or 0), path) for version, path in entries if int(version or 0) <= 31]
    assert eligible, 'No service configuration for API 31+'
    resource = max(eligible)[1]
    result = subprocess.run([args.aapt2, 'dump', 'xmltree', apk, '--file', resource], check=True, capture_output=True, text=True)
    matches = [line for line in result.stdout.splitlines() if 'isAccessibilityTool' in line]
    assert len(matches) == 1 and ('true' in matches[0] or '0xffffffff' in matches[0]), result.stdout
    print(f'{apk}: packaged isAccessibilityTool=true')
