#!/usr/bin/env python3
"""Explicit-device integration check; retains every receipt and never replays uncertain input."""
import argparse
import json
import re
import subprocess
import time
from pathlib import Path
import xml.etree.ElementTree as ET
from evidence import run_recorded

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--operator-package', default='com.androperator.operator.dev')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
args.output.mkdir(parents=True, exist_ok=False)
cli = root / 'apps/node/dist/cli/index.js'
flags = ['--device', args.device, '--operator-package', args.operator_package, '--no-daemon', '--output', 'json']
sequence = 0
started = time.monotonic()


def adb(*command):
    return subprocess.run(['adb', '-s', args.device, *command], check=True, capture_output=True, text=True, timeout=30).stdout


def call(label, *command, error=None):
    global sequence
    assert time.monotonic() - started < 240, 'Integration time budget exhausted'
    sequence += 1
    prefix = args.output / f'{sequence:02d}-{label}'
    result = run_recorded(['node', str(cli), *command, *flags], prefix, root)
    value = json.loads(result.stdout)
    envelope = value.get('envelope', {})
    if error:
        assert result.returncode != 0 and envelope.get('errorCode') == error, value
        receipt = envelope['stepResults'][0]['data']
        assert receipt['dispatch_method'] == 'none' and receipt['dispatch_accepted'] == 'false', receipt
        assert receipt['candidate_count'] == ('2' if error == 'NODE_AMBIGUOUS' else '0'), receipt
    elif command[0] == 'doctor':
        assert result.returncode == 0 and value['criticalOk'], value
    else:
        assert result.returncode == 0 and envelope.get('status') == 'success', value
    return value


def observe(label, rotation):
    # Rotation is asynchronous. Fresh read-only observations may wait for geometry,
    # but an action or failed observation is never retried by this harness.
    for attempt in range(6):
        raw = args.output / f'{label}-{attempt}.xml'
        value = call(label, 'snapshot', '--compact', '--max-nodes', '100', '--raw-path', str(raw.resolve()))
        assert not value['compact']['truncated']
        nodes = value['compact']['nodes']
        bounds = list(map(int, re.findall(r'\d+', nodes[0]['bounds'])))
        actual_rotation = ET.parse(raw).getroot().attrib['rotation']
        if (bounds[2] > bounds[3]) == (rotation in (1, 3)) and actual_rotation == str(rotation):
            return nodes
        time.sleep(.2)
    raise AssertionError(f'Display did not settle: expected rotation={rotation}, last rotation={actual_rotation}, bounds={bounds}')


def count(nodes, label):
    matches = [n for n in nodes if n.get('contentDescription') == label]
    assert len(matches) == 1, matches
    return int(matches[0]['text'].split('=')[1])


original_accel = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').strip()
original_rotation = adb('shell', 'settings', 'get', 'system', 'user_rotation').strip()
try:
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    call('doctor', 'doctor')
    call('initialize-operator', 'open', args.operator_package)
    call('open-fixture', 'open', 'com.androperator.landscapefixture')
    summary = []
    for index, rotation in enumerate((0, 1, 3, 0)):
        adb('shell', 'settings', 'put', 'system', 'user_rotation', str(rotation))
        nodes = observe(f'before-{index}', rotation)
        before = {label: count(nodes, label) for label in ('LEFT_TARGET', 'RIGHT_TARGET')}
        for label in before:
            value = call(f'click-{index}-{label}', 'click', '--desc', label, '--strict')
            receipt = value['envelope']['stepResults'][0]['data']
            assert receipt['candidate_count'] == '1' and receipt['dispatch_accepted'] == 'true', receipt
        after = observe(f'after-{index}', rotation)
        assert all(count(after, label) == previous + 1 for label, previous in before.items())
        summary.append({'rotation': rotation, 'counts': {label: count(after, label) for label in before}})
    for label in ('HIDDEN_TARGET', 'OFFSCREEN_TARGET'):
        call(label, 'click', '--desc', label, '--strict', error='NODE_NOT_FOUND')
    call('ambiguity', 'click', '--desc', 'AMBIGUOUS_TARGET', '--strict', error='NODE_AMBIGUOUS')
    final = observe('after-rejections', 0)
    assert all(count(final, label) == value for label, value in summary[-1]['counts'].items())
    assert all(n.get('text') == 'AMBIGUOUS_TARGET=0' for n in final if n.get('contentDescription') == 'AMBIGUOUS_TARGET')
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary))
finally:
    for key, value in [('user_rotation', original_rotation), ('accelerometer_rotation', original_accel)]:
        adb('shell', 'settings', 'delete' if value == 'null' else 'put', 'system', key, *([] if value == 'null' else [value]))
