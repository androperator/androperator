"""Verify strict semantic targeting across background rotation on a synthetic fixture.

Build/install fixture/build.sh and the matching debug Operator first. Outputs are
private diagnostic evidence; sanitize before sharing. No coordinate actions run.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    sequence = 0

    def capture(name, command):
        nonlocal sequence
        sequence += 1
        result = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=90)
        path = args.output / f'{sequence:03d}-{name}'
        path.write_bytes(result.stdout)
        path.with_suffix(path.suffix + '.stderr').write_bytes(result.stderr)
        return result

    def adb(*command):
        result = capture('adb.txt', ['adb', '-s', args.device, *command])
        if result.returncode:
            raise RuntimeError(result.stderr.decode())
        return result.stdout.decode()

    def cli(*command):
        result = capture(command[0] + '.json', [
            'node', 'apps/node/dist/cli/index.js', *command,
            '--device', args.device, '--operator-package', 'com.androperator.operator.dev', '--no-daemon',
        ])
        data = json.loads(result.stdout)
        assert data.get('isCanonicalTerminal'), data
        return data['envelope']

    def query(description, visibility='on_screen'):
        envelope = cli('query', '--desc', description, '--visibility', visibility)
        assert envelope['status'] == 'success', envelope
        return json.loads(envelope['stepResults'][0]['data']['query'])

    auto_rotation = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').strip()
    user_rotation = adb('shell', 'settings', 'get', 'system', 'user_rotation').strip()
    failures = []
    expected = {'LEFT_TARGET': 0, 'RIGHT_TARGET': 0}
    try:
        adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
        adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
        adb('shell', 'am', 'start', '-W', '-n', 'com.androperator.operator.dev/androperator.activity.MainActivity')
        time.sleep(1)
        # Reset only the account-free fixture, never the Operator or other apps.
        adb('shell', 'am', 'force-stop', 'com.androperator.rotationfixture')
        assert cli('open', 'com.androperator.rotationfixture')['status'] == 'success'
        for rotation in (0, 1, 3, 0):
            adb('shell', 'settings', 'put', 'system', 'user_rotation', str(rotation))
            # Wait for independently observed fixture orientation, not dispatch completion.
            for attempt in range(10):
                snapshot = cli('snapshot')
                if f'ROTATION={rotation}' in json.dumps(snapshot):
                    break
                time.sleep(0.3)
            else:
                raise AssertionError(f'Fixture did not reach rotation {rotation}')
            activities = adb('shell', 'dumpsys', 'activity', 'activities')
            resumed = '\n'.join(line for line in activities.splitlines() if 'topResumedActivity' in line)
            assert 'com.androperator.rotationfixture' in resumed, resumed
            adb('shell', 'dumpsys', 'display')
            for target in expected:
                raw = query(target, 'all')
                assert raw['totalMatches'] == 1, raw
                eligible = query(target)
                action = cli('click', '--desc', target, '--strict')
                receipt = action['stepResults'][0]['data']
                if action['status'] == 'success':
                    assert receipt['candidate_count'] == '1', receipt
                    assert receipt['dispatch_accepted'] == 'true', receipt
                    expected[target] += 1
                else:
                    failures.append({'rotation': rotation, 'target': target, 'receipt': receipt})
                    assert receipt['dispatch_method'] == 'none', receipt
                    assert receipt['dispatch_accepted'] == 'false', receipt
                if eligible['totalMatches'] != 1:
                    failures.append({'rotation': rotation, 'target': target, 'eligibleCount': eligible['totalMatches']})
                post = json.dumps(cli('snapshot'))
                assert f'LEFT_COUNT={expected["LEFT_TARGET"]} RIGHT_COUNT={expected["RIGHT_TARGET"]}' in post, post
            hidden = cli('click', '--desc', 'HIDDEN_TARGET', '--strict')
            assert hidden['status'] == 'failed', hidden
            assert hidden['stepResults'][0]['data']['dispatch_method'] == 'none', hidden
            screen = capture('screen.png', ['adb', '-s', args.device, 'exec-out', 'screencap', '-p'])
            assert screen.returncode == 0 and screen.stdout.startswith(b'\x89PNG\r\n\x1a\n'), 'Screenshot unavailable'
        adb('logcat', '-d', '-t', '10000')
    finally:
        adb('shell', 'settings', 'put', 'system', 'user_rotation', user_rotation)
        adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', auto_rotation)
        (args.output / 'summary.json').write_text(json.dumps({'failures': failures, 'counts': expected}, indent=2))
    print(json.dumps({'failures': failures, 'counts': expected}, indent=2))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
