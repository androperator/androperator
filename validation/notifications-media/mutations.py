#!/usr/bin/env python3
"""Explicit N2 fixture acceptance. Requires installed APKs and run.py's local media file."""
import argparse
import json
import re
import shlex
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = 'com.androperator.fixture.media'
OPERATOR = 'com.androperator.operator.dev'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    evidence = []

    def adb(*command):
        if command[0] == 'shell':
            command = ('shell', shlex.join(command[1:]))
        return subprocess.check_output(['adb', '-s', args.device, *command], cwd=ROOT, text=True, timeout=30)

    def control(operation):
        adb('shell', 'am', 'broadcast', '--receiver-foreground', '-n', PACKAGE + '/androperator.operator.debug.MediaProofActivity$Control', '--es', 'operation', operation)
        time.sleep(.3)

    def sample():
        return json.loads(adb('shell', 'run-as', PACKAGE, 'cat', 'files/media-proof.json'))

    def cli(*command, error=None, allow_disconnected=False):
        result = subprocess.run(['node', 'apps/node/dist/cli/index.js', *command, '--device', args.device, '--operator-package', OPERATOR, '--no-daemon'], cwd=ROOT, text=True, capture_output=True, timeout=90)
        value = json.loads(result.stdout)
        evidence.append({'command': command, 'exitCode': result.returncode, 'result': value})
        envelope = value.get('envelope', value)
        if allow_disconnected and envelope.get('errorCode') == 'NOTIFICATION_LISTENER_DISCONNECTED':
            return None
        if error:
            assert result.returncode != 0 and envelope.get('errorCode', value.get('code')) == error, value
            return envelope
        assert result.returncode == 0 and envelope['status'] == 'success', value
        return json.loads(envelope['stepResults'][0]['data']['payload'])

    def wait_for_session():
        deadline = time.monotonic() + 10
        sessions = cli('media', 'list', '--app', PACKAGE)['sessions']
        while not sessions:
            assert time.monotonic() < deadline, 'Fixture session was not published after launch/recovery'
            time.sleep(.2)
            sessions = cli('media', 'list', '--app', PACKAGE)['sessions']
        return sessions[0]['mediaSessionId']

    def active_notification_keys():
        dump = adb('shell', 'dumpsys', 'notification', '--noredact')
        assert 'Notification List:' in dump, 'Missing independent active notification section'
        active = re.split(r'\n  \S', dump.split('Notification List:', 1)[1], maxsplit=1)[0]
        return re.findall(r'key=([^\s]+)', active)

    def button():
        return next(item for item in cli('notifications', 'list', '--app', PACKAGE)['notifications'] if '|8124|' in item['key'])

    def action(item, error=None):
        return cli('notifications', 'action', item['key'], '--action', item['actions'][0]['actionId'], error=error)

    def seek(position, error=None, wait=2000, tolerance=100):
        return cli('media', 'seek', '--session', session_id, '--position-ms', str(position), '--wait-timeout-ms', str(wait), '--position-tolerance-ms', str(tolerance), error=error)

    try:
        api = int(adb('shell', 'getprop', 'ro.build.version.sdk').strip())
        adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
        adb('shell', 'wm', 'dismiss-keyguard')
        adb('shell', 'am', 'force-stop', PACKAGE)
        adb('shell', 'am', 'start', '-n', PACKAGE + '/androperator.operator.debug.MediaProofActivity')
        time.sleep(2)
        session_id = wait_for_session()
        control('post')
        original = button()
        cli('media', 'status', '--session', session_id)
        cli('media', 'pause', '--session', session_id, '--wait-timeout-ms', '2000')
        assert sample()['actualPlaying'] is False
        before = sample()
        result = seek(20000)
        after = sample()
        assert result['targetPositionObserved'] and abs(after['actualPositionMs'] - 20000) <= 100, (result, after)
        assert after['seekCommands'] == before['seekCommands'] + 1
        cli('media', 'play', '--session', session_id, '--wait-timeout-ms', '2000')
        assert sample()['actualPlaying'] is True
        before = sample()
        assert action(original)['dispatched']
        time.sleep(.3)
        after = sample()
        assert after['buttonCommands'] == before['buttonCommands'] + 1, (before, after)
        assert original['key'] in active_notification_keys()
        dismissed = cli('notifications', 'dismiss', original['key'], '--wait-timeout-ms', '2000')
        assert dismissed['dispatched'] and dismissed['removalObserved'], dismissed
        assert original['key'] not in active_notification_keys(), 'Notification still active in independent system dump'
        evidence.append({'completeFlow': True, 'beforeButton': before, 'afterButton': after, 'seekActual': result['session']['reportedPositionMs']})
        cli('notifications', 'dismiss', original['key'], error='NOTIFICATION_EXPIRED')
        action(original, error='NOTIFICATION_EXPIRED')
        ongoing = next(item for item in cli('notifications', 'list', '--app', PACKAGE)['notifications'] if '|8123|' in item['key'])
        cli('notifications', 'dismiss', ongoing['key'], error='NOTIFICATION_NOT_DISMISSIBLE')
        control('post')
        stale = button()
        control('update')
        action(stale, error='NOTIFICATION_ACTION_EXPIRED')
        current = button()
        control('cancel-button')
        canceled = action(current, error='NOTIFICATION_ACTION_CANCELLED')
        assert canceled['stepResults'][0]['data']['dispatched'] == 'false'
        control('input')
        current = button()
        assert current['actions'][0]['requiresInput']
        action(current, error='NOTIFICATION_ACTION_INPUT_UNSUPPORTED')
        if api >= 31:
            control('authentication')
            current = button()
            assert current['actions'][0]['requiresAuthentication']
            action(current, error='NOTIFICATION_ACTION_AUTHENTICATION_UNSUPPORTED')
        control('post')
        stale = button()
        old_pid = adb('shell', 'pidof', OPERATOR).strip()
        assert old_pid.isdigit(), 'Expected one Operator process before restart'
        adb('shell', 'run-as', OPERATOR, 'kill', '-9', old_pid)
        deadline = time.monotonic() + 30
        while cli('notifications', 'list', '--app', PACKAGE, allow_disconnected=True) is None:
            assert time.monotonic() < deadline, 'Listener did not recover after actual process death'
            time.sleep(.5)
        assert adb('shell', 'pidof', OPERATOR).strip() != old_pid
        action(stale, error='NOTIFICATION_ACTION_EXPIRED')
        session_id = wait_for_session()
        cli('media', 'pause', '--session', session_id, '--wait-timeout-ms', '2000')
        duration = cli('media', 'status', '--session', session_id)['session']['durationMs']
        assert isinstance(duration, int) and duration > 0
        seek(duration + 1, error='MEDIA_POSITION_OUT_OF_RANGE')
        control('duration-zero')
        seek(1, error='MEDIA_POSITION_OUT_OF_RANGE')
        seek(0)
        control('duration-unknown')
        seek(10000)
        control('duration-normal')
        control('second')
        sessions = cli('media', 'list', '--app', PACKAGE)['sessions']
        unsupported = next(s['mediaSessionId'] for s in sessions if s['mediaSessionId'] != session_id)
        cli('media', 'seek', '--session', unsupported, '--position-ms', '0', error='MEDIA_ACTION_UNSUPPORTED')
        cli('media', 'seek', '--app', PACKAGE, '--position-ms', '0', error='MEDIA_SESSION_AMBIGUOUS')
        control('remove-second')
        before = sample()
        control('ignore')
        ignored = seek(40000, error='MEDIA_POSTCONDITION_TIMEOUT', wait=300, tolerance=0)
        after = sample()
        assert after['seekCommands'] == before['seekCommands'] + 1 and after['actualPositionMs'] == before['actualPositionMs'], (before, after)
        assert ignored['stepResults'][0]['data']['dispatched'] == 'true'
        assert ignored['stepResults'][0]['data']['positionToleranceMs'] == '0'
        timed_out = cli('media', 'seek', '--session', session_id, '--position-ms', '40000', '--wait-timeout-ms', '30000', '--position-tolerance-ms', '0', '--timeout', '1000', error='COMMAND_TIMEOUT')
        assert timed_out['stepResults'][0]['data']['dispatched'] == 'true'
        assert timed_out['stepResults'][0]['data']['requestedPositionMs'] == '40000'
        assert sample()['seekCommands'] == after['seekCommands'] + 1
        control('normal')
        control('post')
        current = button()
        # Each transport exercises the same three mutations and independently samples effects.
        subprocess.run(['node', 'validation/notifications-media/mutation-transports.mjs', args.device, session_id, current['key'], current['actions'][0]['actionId'], str(args.output / 'transports.json')], cwd=ROOT, check=True, timeout=120)
        # A stale PLAYING report plus extrapolation must never confirm an ignored seek.
        cli('media', 'play', '--session', session_id, '--wait-timeout-ms', '2000')
        control('stall')
        control('ignore')
        stale_report = cli('media', 'status', '--session', session_id)['session']
        target = stale_report['reportedPositionMs'] + 1000
        seek(target, error='MEDIA_POSTCONDITION_TIMEOUT', wait=1300, tolerance=1000)
        later = cli('media', 'status', '--session', session_id)['session']
        assert later['positionUpdatedElapsedMs'] == stale_report['positionUpdatedElapsedMs']
        control('resume')
        control('replace-on-seek')
        before = sample()
        replaced = seek(10000, error='MEDIA_SESSION_EXPIRED')
        assert replaced['stepResults'][0]['data']['dispatched'] == 'true'
        assert sample()['seekCommands'] == before['seekCommands'] + 1
        seek(10000, error='MEDIA_SESSION_EXPIRED')
        evidence.append({'api': api, 'passed': True, 'finalSample': sample()})
    finally:
        (args.output / 'evidence.json').write_text(json.dumps(evidence, indent=2))
    print('Passed N2 integrated flow, failure cases, independent effects and transport parity.')


if __name__ == '__main__':
    main()
