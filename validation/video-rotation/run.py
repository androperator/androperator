#!/usr/bin/env python3
"""Record synthetic orientation markers and independent semantic-click counters."""
import argparse
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'validation/landscape-targeting'))
from evidence import run_recorded

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
sequence = 0
flags = ['--device', args.device, '--operator-package', 'com.androperator.operator.dev', '--no-daemon']


def run(label, command):
    global sequence
    sequence += 1
    return run_recorded(command, args.output / f'{sequence:02d}-{label}', ROOT)


def adb(label, *command):
    result = run(label, ['adb', '-s', args.device, 'shell', *command])
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def cli(label, *command, pending=False):
    result = run(label, ['node', str(ROOT / 'apps/node/dist/cli/index.js'), *command, *flags])
    value = json.loads(result.stdout)
    assert result.returncode == 0 or (pending and value.get('status') == 'finalizing'), value
    return value


rotation = adb('read-rotation', 'settings', 'get', 'system', 'user_rotation')
automatic = adb('read-auto-rotation', 'settings', 'get', 'system', 'accelerometer_rotation')
manifest = args.output / 'bundle/manifest.json'
started = False
stopped = False
try:
    adb('disable-auto-rotation', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('initial-portrait', 'settings', 'put', 'system', 'user_rotation', '0')
    adb('reset-disposable-fixture', 'am', 'start', '-W', '-S', '-n',
        'com.androperator.rotationfixture/.RotationActivity')
    cli('open-fixture', 'open', 'com.androperator.rotationfixture')
    time.sleep(1)
    cli('start', 'evidence', 'video', 'start', '--output-dir', str(manifest.parent), '--duration-seconds', '90')
    started = True
    observations = []
    for index, current in enumerate((0, 1, 3, 0)):
        adb('set-rotation', 'settings', 'put', 'system', 'user_rotation', str(current))
        # Re-observe the marker; never replay a click to wait for readiness.
        for attempt in range(10):
            observed = cli('orientation-observation', 'query', '--text-contains', f'ROTATION={current}')
            nodes = json.loads(observed['envelope']['stepResults'][0]['data']['query'])['nodes']
            if len(nodes) == 1:
                break
            time.sleep(.2)
        assert len(nodes) == 1, observed
        clicked = cli('semantic-click', 'click', '--desc', 'LEFT_TARGET', '--strict')
        assert clicked['envelope']['status'] == 'success', clicked
        value = cli('counter-postcondition', 'query', '--text-contains', f'ROTATION={current}')
        nodes = json.loads(value['envelope']['stepResults'][0]['data']['query'])['nodes']
        assert len(nodes) == 1 and nodes[0]['label'] == (
            f'UP ↑ ROTATION={current} LEFT_COUNT={index + 1} RIGHT_COUNT=0'), value
        observations.append({'rotation': current, 'leftCount': index + 1})
        time.sleep(2)
    stopped = True
    terminal = cli('stop', 'evidence', 'video', 'stop', '--session', str(manifest), pending=True)
    deadline = time.monotonic() + 60
    while terminal.get('status') == 'finalizing' and time.monotonic() < deadline:
        time.sleep(.5)
        terminal = cli('finalization-status', 'evidence', 'video', 'status', '--session', str(manifest))
    result = json.loads(manifest.read_text())
    assert result['status'] == 'complete', result
    captures = json.loads((manifest.parent / 'captures.json').read_text())
    segments = captures[0]['segments']
    assert len(segments) == 3, segments
    assert [s['width'] < s['height'] for s in segments] == [True, False, True], segments
    assert [a['path'] for a in result['artifacts'] if a['kind'] == 'video'] == [s['path'] for s in segments]
    for index, segment in enumerate(segments):
        assert segment['frames'] > 0 and segment['mediaDurationMs'] > 0, segment
        if index:
            assert segments[index - 1]['end'] == segment['start'], segments
        # Extract multiple actual frames. Inspect landscape samples for BOTH markers.
        for sample in (.25, .5, .75):
            timestamp = segment['mediaDurationMs'] / 1000 * sample
            extracted = run('extract-frame', ['ffmpeg', '-v', 'error', '-ss', str(timestamp), '-i',
                str(manifest.parent / segment['path']), '-frames:v', '1',
                str(args.output / f'frame-{index + 1}-{sample}.png')])
            assert extracted.returncode == 0, extracted.stderr
    (args.output / 'summary.json').write_text(json.dumps({'observations': observations, 'segments': segments}, indent=2) + '\n')
finally:
    def restore(key, value):
        adb('restore-' + key, 'settings', 'delete' if value == 'null' else 'put', 'system', key,
            *([] if value == 'null' else [value]))
    try:
        if started and not stopped:
            # Stop once; a timeout must not prevent either settings-restoration attempt.
            run('stop-interrupted-attempt', ['node', str(ROOT / 'apps/node/dist/cli/index.js'),
                'evidence', 'video', 'stop', '--session', str(manifest), *flags])
    finally:
        try:
            restore('user_rotation', rotation)
        finally:
            restore('accelerometer_rotation', automatic)
