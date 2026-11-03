#!/usr/bin/env python3
"""Verify bounded scroll outcomes through the branch-local CLI and independent counters."""
import argparse
import json
from pathlib import Path
import re
import sys
import time

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'validation/landscape-targeting'))
from evidence import run_recorded

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
flags = ['--device', args.device, '--operator-package', 'com.androperator.operator.dev', '--no-daemon', '--output', 'json']
sequence = 0
started = time.monotonic()


def call(label, *command, error=None):
    global sequence
    assert time.monotonic() - started < 240, 'Integration time budget exhausted'
    sequence += 1
    result = run_recorded(['node', str(root / 'apps/node/dist/cli/index.js'), *command, *flags],
                          args.output / f'{sequence:02d}-{label}', root)
    value = json.loads(result.stdout)
    if command[0] == 'doctor':
        assert result.returncode == 0 and value['criticalOk'], value
        return value
    envelope = value.get('envelope', {})
    steps = envelope.get('stepResults', [])
    if error:
        assert result.returncode != 0 and len(steps) == 1 and not steps[0]['success'], value
        assert (envelope.get('errorCode') or steps[0].get('data', {}).get('errorCode')) == error, value
    else:
        assert result.returncode == 0 and envelope.get('status') == 'success' and all(step['success'] for step in steps), value
    return value


def observe(label, rows=None, clicks=None, at_start=False, target_visible=False):
    for attempt in range(6):
        value = call(f'{label}-{attempt}', 'snapshot', '--compact', '--max-nodes', '100')
        compact = value['compact']
        assert not compact['truncated']
        status = [node for node in compact['nodes'] if node.get('contentDescription') == 'RESULT_COUNTER']
        assert len(status) == 1
        match = re.fullmatch(r'CLICK_COUNT=(\d+) SCROLL_Y=(\d+) ROWS=(\d+)', status[0]['text'])
        assert match, status
        count, position, actual_rows = map(int, match.groups())
        visible = any(node.get('contentDescription') == 'BUDGET_TARGET' and node.get('visibleToUser') for node in compact['nodes'])
        if (rows is None or actual_rows == rows) and (clicks is None or count == clicks) and (not at_start or position == 0) and (not target_visible or visible):
            return {'clicks': count, 'position': position, 'rows': actual_rows, 'targetVisible': visible}
        time.sleep(.2)
    raise AssertionError(f'Fixture state did not settle: {status}')


def outcome(value, reason, count, limit):
    data = value['envelope']['stepResults'][0]['data']
    assert data['termination_reason'] == reason, data
    assert data['scrolls_executed'] == str(count), data
    assert data['max_scrolls'] == str(limit), data
    return data


call('doctor', 'doctor')
call('open', 'open', 'com.androperator.scrollfixture')
call('long', 'click', '--desc', 'LONG_LIST', '--strict')
observe('long-ready', rows=30, clicks=0, at_start=True)
budget = call('budget', 'scroll-until', 'down', '--desc', 'BUDGET_TARGET', '--click', error='NODE_NOT_FOUND')
data = outcome(budget, 'MAX_SCROLLS_REACHED', 10, 10)
assert json.loads(data['scroll_progress'])['reason'] == 'signature_changed'
after_budget = observe('after-budget', rows=30, clicks=0)
assert after_budget['position'] > 0 and not after_budget['targetVisible']

# Each remaining case is a fresh fixture scenario after a known terminal outcome.
call('reset-long', 'click', '--desc', 'LONG_LIST', '--strict')
observe('reset-ready', rows=30, clicks=0, at_start=True)
call('jump-end', 'click', '--desc', 'JUMP_TO_END', '--strict')
boundary = observe('boundary', rows=30, clicks=0, target_visible=True)
stopped = call('stationary', 'scroll-until', 'down', '--desc', 'MISSING_TARGET', '--click', error='NODE_NOT_FOUND')
outcome(stopped, 'NO_POSITION_CHANGE', 2, 10)
after_stationary = observe('after-stationary', rows=30, clicks=0)
assert after_stationary['position'] == boundary['position']

plain = call('plain-stationary', 'scroll-until', 'down', '--desc', 'MISSING_TARGET', error='TARGET_NOT_FOUND')
data = outcome(plain, 'NO_POSITION_CHANGE', 3, 20)
assert data['max_duration_ms'] == '10000'
observe('after-plain', rows=30, clicks=0)

call('short', 'click', '--desc', 'SHORT_LIST', '--strict')
observe('short-ready', rows=2, clicks=0, at_start=True)
found = call('found', 'scroll-until', 'down', '--desc', 'BUDGET_TARGET', '--click')
data = found['envelope']['stepResults'][0]['data']
assert data['termination_reason'] == 'TARGET_FOUND' and 0 < int(data['scrolls_executed']) <= 10, data
assert data['max_scrolls'] == '10' and 'scroll_progress' in data
observe('after-found', rows=2, clicks=1, target_visible=True)
summary = {'budget': budget['envelope']['stepResults'][0]['data']['termination_reason'],
           'stationary': stopped['envelope']['stepResults'][0]['data']['termination_reason'],
           'foundScrolls': int(data['scrolls_executed']), 'foundClicks': 1}
(args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary))
