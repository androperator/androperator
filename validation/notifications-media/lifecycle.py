#!/usr/bin/env python3
"""Notification lifecycle and Operator process recovery while the independent player stays locked/off."""
import argparse
import json
import shlex
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OPERATOR = 'com.androperator.operator.dev'
FIXTURE = 'com.androperator.fixture.media'
LISTENER = OPERATOR + '/action.notification.NotificationListenerService'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    records = []
    recovered_session = None

    def adb(*command):
        result = subprocess.run(['adb', '-s', args.device, 'shell', shlex.join(command)], text=True, capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr
        return result.stdout

    def cli(*command, error=None, allow_error=False):
        result = subprocess.run(['node', 'apps/node/dist/cli/index.js', *command, '--device', args.device,
                                 '--operator-package', OPERATOR, '--no-daemon', '--timeout', '3000'], cwd=ROOT, text=True, capture_output=True, timeout=30)
        value = json.loads(result.stdout)
        records.append({'command': command, 'exitCode': result.returncode, 'result': value})
        if error is not None:
            assert result.returncode != 0 and value.get('envelope', value).get('errorCode', value.get('code')) == error, value
        elif not allow_error:
            assert result.returncode == 0, value
        return value

    def mcp_error(session_id, code):
        result = subprocess.run(['node', 'validation/notifications-media/mcp-error.mjs', args.device, session_id, code, str(args.output.with_name(code + '-mcp.json'))], cwd=ROOT, text=True, capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr

    def payload(result):
        envelope = result.get('envelope', result)
        if envelope.get('status') != 'success':
            return None
        return json.loads(envelope['stepResults'][0]['data']['payload'])

    def notifications():
        return payload(cli('notifications', 'list', '--app', FIXTURE))['notifications']

    def control(operation):
        adb('am', 'broadcast', '--receiver-foreground', '-n', FIXTURE + '/androperator.operator.debug.MediaProofActivity$Control', '--es', 'operation', operation)
        time.sleep(0.2)

    def sample():
        return json.loads(adb('run-as', FIXTURE, 'cat', 'files/media-proof.json'))

    def wait_notifications():
        deadline = time.monotonic() + 30
        while True:
            result = payload(cli('notifications', 'list', '--app', FIXTURE, allow_error=True))
            if result is not None:
                return result['notifications']
            assert time.monotonic() < deadline, 'Listener did not recover without opening the Operator'
            time.sleep(0.5)

    api = int(adb('getprop', 'ro.build.version.sdk').strip())

    def set_listener_allowed(allowed):
        if api >= 27:
            adb('cmd', 'notification', 'allow_listener' if allowed else 'disallow_listener', LISTENER)
        else:
            # NotificationManager's shell grant implementation starts in API 27.
            current = adb('settings', 'get', 'secure', 'enabled_notification_listeners').strip()
            components = [item for item in current.split(':') if item not in ('', 'null', LISTENER)]
            if allowed:
                components.append(LISTENER)
            adb('settings', 'put', 'secure', 'enabled_notification_listeners', ':'.join(components))
        time.sleep(0.5)

    before = sample()
    assert not before['screenOn'] and before['deviceLocked'], before
    try:
        existing = notifications()
        assert any(item['ongoing'] for item in existing), existing
        control('post')
        posted = next(item for item in notifications() if item['text'] == 'post')
        assert posted['progress'] == {'value': 42, 'max': 100, 'indeterminate': False}
        control('update')
        updated = next(item for item in notifications() if item['key'] == posted['key'])
        assert updated['text'] == 'update' and updated['actions'][0]['actionId'] != posted['actions'][0]['actionId'], updated
        control('group')
        assert any(item['groupSummary'] for item in notifications())
        control('remove')
        assert all(item['key'] != posted['key'] for item in notifications())
        control('many')
        large = payload(cli('notifications', 'list', '--app', FIXTURE, '--limit', '100', '--max-text-chars', '1024'))
        assert len(json.dumps(large, ensure_ascii=False, separators=(',', ':')).encode()) <= 64000
        assert large['total'] >= len(large['notifications']) >= 2
        assert payload(cli('notifications', 'list', '--app', FIXTURE, '--limit', '1'))['truncated']
        set_listener_allowed(False)
        try:
            cli('notifications', 'list', '--app', FIXTURE, error='NOTIFICATION_ACCESS_DENIED')
            cli('media', 'list', '--app', FIXTURE, error='NOTIFICATION_ACCESS_DENIED')
            mcp_error('-', 'NOTIFICATION_ACCESS_DENIED')
        finally:
            set_listener_allowed(True)
        reconnected = wait_notifications()
        assert reconnected, 'Existing notifications disappeared after listener reconnection'
        old_session = payload(cli('media', 'list', '--app', FIXTURE))['sessions'][0]['mediaSessionId']
        old_pid = adb('pidof', OPERATOR).strip()
        assert old_pid.isdigit(), 'Expected exactly one Operator process'
        adb('run-as', OPERATOR, 'kill', '-9', old_pid)
        recovered = wait_notifications()
        assert recovered, 'Independent fixture notifications must survive Operator restart'
        assert adb('pidof', OPERATOR).strip() != old_pid
        recovered_session = payload(cli('media', 'list', '--app', FIXTURE))['sessions'][0]['mediaSessionId']
        assert recovered_session != old_session
        cli('media', 'status', '--session', old_session, error='MEDIA_SESSION_EXPIRED')
        mcp_error(old_session, 'MEDIA_SESSION_EXPIRED')
        cli('doctor', '--capability', 'background-observation')
        control('clear')
        assert notifications() == []
        control('post')
        assert len(notifications()) == 1
        after = sample()
        assert not after['screenOn'] and after['deviceLocked'], after
        assert after['sampleCount'] > before['sampleCount']
        assert after['screenOnEvents'] == before['screenOnEvents'] and after['screenOffEvents'] == before['screenOffEvents'], (before, after)
        records.append({'before': before, 'after': after})
    finally:
        args.output.write_text(json.dumps({'mediaSessionId': recovered_session, 'evidence': records}, indent=2))
    print(json.dumps({'mediaSessionId': recovered_session}))


if __name__ == '__main__':
    main()
