#!/usr/bin/env python3
"""Locked/off observations and media controls with temporary emulator credential cleanup."""
import argparse
import json
import secrets
import re
import shlex
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = 'com.androperator.fixture.media'
OPERATOR = 'com.androperator.operator.dev'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--session', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    records = []

    def run(command):
        return subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=90)

    def adb(*command):
        result = run(['adb', '-s', args.device, 'shell', shlex.join(command)])
        assert result.returncode == 0, result.stderr
        return result.stdout

    def sample():
        return json.loads(adb('run-as', PACKAGE, 'cat', 'files/media-proof.json'))

    def cli(*command):
        result = run(['node', 'apps/node/dist/cli/index.js', *command, '--device', args.device,
                      '--operator-package', OPERATOR, '--no-daemon'])
        value = json.loads(result.stdout)
        records.append({'command': command, 'exitCode': result.returncode, 'result': value})
        assert result.returncode == 0, value
        return value

    def set_screen(screen_on):
        before = sample()
        if before['screenOn'] == screen_on:
            return
        counter = 'screenOnEvents' if screen_on else 'screenOffEvents'
        adb('input', 'keyevent', 'KEYCODE_WAKEUP' if screen_on else 'KEYCODE_SLEEP')
        deadline = time.monotonic() + 10
        while True:
            current = sample()
            if current['screenOn'] == screen_on and current[counter] > before[counter]:
                return
            assert time.monotonic() < deadline, 'Fixture did not acknowledge setup power transition'
            time.sleep(0.1)

    def controls(label, screen_on):
        before = sample()
        for operation in ['pause', 'seek', 'play']:
            command = ['media', operation, '--session', args.session, '--wait-timeout-ms', '2000']
            if operation == 'seek':
                command += ['--position-ms', '10000', '--position-tolerance-ms', '100']
            previous = sample()
            cli(*command)
            current = sample()
            assert current[operation + 'Commands'] == previous[operation + 'Commands'] + 1, (previous, current)
            if operation == 'seek':
                assert abs(current['actualPositionMs'] - 10000) <= 100, current
            else:
                assert current['actualPlaying'] == (operation == 'play'), current
            assert current['deviceLocked'] and current['screenOn'] == screen_on, current
            assert current['screenOnEvents'] == before['screenOnEvents'] and current['screenOffEvents'] == before['screenOffEvents'], (before, current)
            records.append({'control': operation, 'case': label, 'before': previous, 'after': current})

    def reject_mixed():
        control = {'id': 'control', 'type': 'media_play', 'params': {'mediaSessionId': args.session}}
        for blocked in [
            {'id': 'blocked', 'type': 'snapshot_ui'},
            {'id': 'blocked', 'type': 'dismiss_notification', 'params': {'notificationKey': 'fixture-key'}},
            {'id': 'blocked', 'type': 'invoke_notification_action', 'params': {'notificationKey': 'fixture-key', 'actionId': 'fixture-action'}},
        ]:
            for actions in [[control, blocked], [blocked, control]]:
                before = sample()
                command_id = 'locked-mixed-' + str(uuid.uuid4())
                command = {'commandId': command_id, 'taskId': 'locked-mixed', 'source': 'validation', 'expectedFormat': 'android-ui-automator', 'timeoutMs': 3000, 'actions': actions}
                adb('am', 'broadcast', '-a', 'app.androperator.operator.ACTION_AGENT_COMMAND', '-p', OPERATOR, '--es', 'payload', json.dumps(command), '--receiver-foreground')
                deadline = time.monotonic() + 10
                while True:
                    logs = adb('logcat', '-d', '-v', 'raw')
                    matches = [line.split('[Androperator-Result] ', 1)[1] for line in logs.splitlines() if '[Androperator-Result] ' in line and command_id in line]
                    if matches:
                        break
                    assert time.monotonic() < deadline, 'Missing mixed-execution rejection'
                    time.sleep(.2)
                result = json.loads(matches[-1])
                assert result['errorCode'] == 'SERVICE_UNAVAILABLE' and not result.get('stepResults'), result
                after = sample()
                for key in ['playCommands', 'screenOnEvents', 'screenOffEvents', 'screenOn', 'deviceLocked']:
                    assert after[key] == before[key], (before, after)
                records.append({'mixedRejection': command, 'result': result, 'before': before, 'after': after})

    def observations(label, screen_on=False):
        before = sample()
        assert before['screenOn'] == screen_on and before['deviceLocked'], before
        for command in [
            ('notifications', 'list', '--app', PACKAGE),
            ('media', 'list', '--app', PACKAGE),
            ('media', 'status', '--session', args.session),
            ('doctor', '--capability', 'background-observation'),
        ]:
            cli(*command)
        mcp = run(['node', 'validation/notifications-media/mcp-observe.mjs', args.device,
                   args.session, str(args.output / (label + '-mcp.json')), str(screen_on).lower()])
        assert mcp.returncode == 0, mcp.stderr
        after = sample()
        assert after['screenOn'] == screen_on and after['deviceLocked'], (before, after)
        assert before['screenOnEvents'] == after['screenOnEvents'], (before, after)
        assert before['screenOffEvents'] == after['screenOffEvents'], (before, after)
        records.append({'case': label, 'before': before, 'after': after})
        controls(label, screen_on)
        if label in ['secure-off-no-accessibility', 'secure-on']:
            if screen_on:
                set_screen(False)
                set_screen(True)
            reject_mixed()
            # Re-prepare the lit lock screen between independent transport series;
            # legacy keyguard can sleep on its own during a long combined run.
            for selected in (['typed', 'http', 'mcp'] if screen_on else [None]):
                if screen_on:
                    set_screen(False)
                    set_screen(True)
                suffix = ('-' + selected) if selected else ''
                command = ['node', 'validation/notifications-media/locked-transports.mjs', args.device, args.session, str(args.output / (label + suffix + '-controls.json'))]
                if selected:
                    command.append(selected)
                transport = run(command)
                assert transport.returncode == 0, transport.stderr

    assert adb('getprop', 'ro.kernel.qemu').strip() == '1', 'Secure-lock setup requires a controlled emulator'
    pin = str(secrets.randbelow(800000) + 100000)
    created = False
    original_accessibility = adb('settings', 'get', 'secure', 'accessibility_enabled').strip()
    original_services = adb('settings', 'get', 'secure', 'enabled_accessibility_services').strip()
    try:
        grant = adb('locksettings', 'set-pin', pin)
        assert 'Pin set to' in grant, 'Could not create a temporary PIN; use an emulator without an existing credential'
        created = True
        adb('am', 'broadcast', '--receiver-foreground', '-n', PACKAGE + '/androperator.operator.debug.MediaProofActivity$Control', '--es', 'operation', 'resume')
        set_screen(True)
        set_screen(False)
        observations('secure-off')
        adb('settings', 'put', 'secure', 'enabled_accessibility_services', '')
        adb('settings', 'put', 'secure', 'accessibility_enabled', '0')
        time.sleep(2)
        assert re.search(r'(?:Bound services:|services:)\s*\{\s*\}', adb('dumpsys', 'accessibility')), 'Accessibility services still bound'
        observations('secure-off-no-accessibility')
        time.sleep(9)
        observations('secure-off-expired-cache')
        lifecycle = run(['python3', 'validation/notifications-media/lifecycle.py', '--device', args.device, '--output', str(args.output / 'lifecycle.json')])
        assert lifecycle.returncode == 0, lifecycle.stderr
        args.session = json.loads(lifecycle.stdout)['mediaSessionId']
        set_screen(True)
        observations('secure-on', screen_on=True)
        set_screen(False)
        observations('secure-relocked-off')
        for operation, expected_error in [('ignore', 'MEDIA_POSTCONDITION_TIMEOUT'), ('replace-on-seek', 'MEDIA_SESSION_EXPIRED')]:
            adb('am', 'broadcast', '--receiver-foreground', '-n', PACKAGE + '/androperator.operator.debug.MediaProofActivity$Control', '--es', 'operation', operation)
            before = sample()
            result = run(['node', 'apps/node/dist/cli/index.js', 'media', 'seek', '--session', args.session, '--position-ms', '40000', '--wait-timeout-ms', '500', '--position-tolerance-ms', '0', '--device', args.device, '--operator-package', OPERATOR, '--no-daemon'])
            assert result.stdout.strip(), f'CLI returned no JSON: {result.stderr}'
            value = json.loads(result.stdout)
            envelope = value.get('envelope', value)
            assert result.returncode != 0 and envelope['errorCode'] == expected_error, value
            assert envelope['stepResults'][0]['data']['dispatched'] == 'true', value
            after = sample()
            assert after['seekCommands'] == before['seekCommands'] + 1
            for key in ['screenOnEvents', 'screenOffEvents', 'deviceLocked', 'screenOn']:
                assert after[key] == before[key], (before, after)
            records.append({'lockedFailure': operation, 'result': value, 'before': before, 'after': after})
            adb('am', 'broadcast', '--receiver-foreground', '-n', PACKAGE + '/androperator.operator.debug.MediaProofActivity$Control', '--es', 'operation', 'normal')
    finally:
        (args.output / 'lock-matrix.json').write_text(json.dumps(records, indent=2))
        try:
            adb('settings', 'put', 'secure', 'enabled_accessibility_services', original_services)
            adb('settings', 'put', 'secure', 'accessibility_enabled', original_accessibility)
        finally:
            if created:
                cleared = adb('locksettings', 'clear', '--old', pin)
                assert 'cleared' in cleared.lower(), 'Temporary PIN cleanup failed'
    print('Passed locked/on-off observations, media controls and mixed-list rejection; temporary PIN removed and accessibility restored.')


if __name__ == '__main__':
    main()
