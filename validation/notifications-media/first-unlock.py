#!/usr/bin/env python3
"""Explicit emulator reboot proof of pre-first-unlock unavailability; restores its temporary PIN."""
import argparse
import json
import secrets
import shlex
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OPERATOR = 'com.androperator.operator.dev'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    records = []

    def adb(*command):
        if command[0] == 'shell':
            command = ('shell', shlex.join(command[1:]))
        result = subprocess.run(['adb', '-s', args.device, *command], text=True, capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    assert adb('shell', 'getprop', 'ro.kernel.qemu') == '1', 'Use a controlled emulator only'
    user_id = adb('shell', 'am', 'get-current-user')
    assert user_id.isdigit()
    pin = str(secrets.randbelow(800000) + 100000)
    created = False
    try:
        grant = adb('shell', 'locksettings', 'set-pin', pin)
        assert 'Pin set to' in grant, 'Use an emulator without an existing credential'
        created = True
        adb('reboot')
        deadline = time.monotonic() + 120
        while True:
            try:
                if adb('shell', 'getprop', 'sys.boot_completed') == '1':
                    break
            except (AssertionError, subprocess.TimeoutExpired):
                pass
            assert time.monotonic() < deadline, 'Emulator did not boot in time'
            time.sleep(1)
        before = adb('shell', 'am', 'get-started-user-state', user_id)
        assert before == 'RUNNING_LOCKED', before
        for command in [
            ['notifications', 'list'], ['media', 'list'],
            ['media', 'status', '--app', 'com.androperator.fixture.media'],
            ['doctor', '--capability', 'background-observation'],
            *[['media', control, '--session', 'pre-unlock-session'] for control in ['pause', 'play']],
            ['media', 'seek', '--session', 'pre-unlock-session', '--position-ms', '0'],
        ]:
            result = subprocess.run(['node', 'apps/node/dist/cli/index.js', *command, '--device', args.device, '--operator-package', OPERATOR, '--no-daemon'], cwd=ROOT, text=True, capture_output=True, timeout=30)
            value = json.loads(result.stdout)
            records.append({'command': command, 'exitCode': result.returncode, 'result': value})
            assert result.returncode != 0 and 'DEVICE_USER_NOT_UNLOCKED' in json.dumps(value), value
        mcp = subprocess.run(['node', 'validation/notifications-media/mcp-error.mjs', args.device, '-', 'DEVICE_USER_NOT_UNLOCKED', str(args.output / 'mcp.json')], cwd=ROOT, text=True, capture_output=True, timeout=30)
        assert mcp.returncode == 0, mcp.stderr
        after = adb('shell', 'am', 'get-started-user-state', user_id)
        assert after == before, after
        records.append({'before': before, 'after': after})
    finally:
        (args.output / 'first-unlock.json').write_text(json.dumps(records, indent=2))
        if created:
            cleared = adb('shell', 'locksettings', 'clear', '--old', pin)
            assert 'cleared' in cleared.lower(), 'Temporary PIN cleanup failed'
            # This is cleanup after the unavailable-state proof, never part of observation.
            adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
            adb('shell', 'wm', 'dismiss-keyguard')
    print('Passed explicit pre-first-unlock CLI/doctor/MCP errors; temporary credential cleared.')


if __name__ == '__main__':
    main()
