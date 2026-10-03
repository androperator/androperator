#!/usr/bin/env python3
"""Live shade preservation and Android ingress rejection without accessibility."""
import argparse
import json
import shlex
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OPERATOR = 'com.androperator.operator.dev'
FIXTURE = 'com.androperator.fixture.media'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    records = []

    def adb(*command):
        result = subprocess.run(['adb', '-s', args.device, 'shell', shlex.join(command)], text=True, capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr
        return result.stdout

    def cli(*command):
        result = subprocess.run(['node', 'apps/node/dist/cli/index.js', *command, '--device', args.device, '--operator-package', OPERATOR, '--no-daemon'], cwd=ROOT, text=True, capture_output=True, timeout=45)
        value = json.loads(result.stdout)
        records.append(value)
        assert result.returncode == 0, value
        return json.loads(value.get('envelope', value)['stepResults'][0]['data']['payload'])

    def shade():
        # SystemUI's own state is independent of Androperator's accessibility path.
        result = adb('dumpsys', 'activity', 'service', 'com.android.systemui/.SystemUIService')
        assert 'mExpandedVisible=true' in result, 'Notification shade is not expanded'
        return result

    original = adb('settings', 'get', 'secure', 'accessibility_enabled').strip()
    original_services = adb('settings', 'get', 'secure', 'enabled_accessibility_services').strip()
    try:
        adb('input', 'keyevent', 'KEYCODE_WAKEUP')
        adb('wm', 'dismiss-keyguard')
        time.sleep(1)
        adb('cmd', 'statusbar', 'expand-notifications')
        time.sleep(2)
        (args.output / 'shade-before.txt').write_text(shade())
        session = cli('media', 'list', '--app', FIXTURE)['sessions'][0]['mediaSessionId']
        cli('notifications', 'list', '--app', FIXTURE)
        cli('media', 'status', '--session', session)
        (args.output / 'shade-after.txt').write_text(shade())
        adb('settings', 'put', 'secure', 'enabled_accessibility_services', '')
        adb('settings', 'put', 'secure', 'accessibility_enabled', '0')
        time.sleep(2)
        read = {'id': 'read', 'type': 'list_notifications', 'params': {'applicationId': FIXTURE, 'limit': 1, 'maxTextChars': 1}}
        ui = {'id': 'ui', 'type': 'snapshot_ui'}
        mutations = [
            {'id': 'mutation', 'type': 'dismiss_notification', 'params': {'notificationKey': 'test-key'}},
            {'id': 'mutation', 'type': 'invoke_notification_action', 'params': {'notificationKey': 'test-key', 'actionId': 'test-action'}},
        ]
        controls = [
            {'id': operation, 'type': 'media_' + operation, 'params': {'mediaSessionId': session, **({'positionMs': 0} if operation == 'seek' else {})}}
            for operation in ['pause', 'seek', 'play']
        ]
        service_cases = [[read], *[[control] for control in controls], *[[read, control] for control in controls], *[[control, read] for control in controls]]
        cases = [*service_cases, [read, ui], [ui, read], [ui], [*controls, ui], [ui, *controls]]
        for mutation in mutations:
            cases.extend([[mutation], [read, mutation], [mutation, read], [*controls, mutation], [mutation, *controls]])
        for actions in cases:
            command_id = 'ingress-' + str(uuid.uuid4())
            command = {'commandId': command_id, 'taskId': 'ingress-proof', 'source': 'androperator', 'expectedFormat': 'android-ui-automator', 'timeoutMs': 3000, 'actions': actions}
            adb('am', 'broadcast', '-a', 'app.androperator.operator.ACTION_AGENT_COMMAND', '-p', OPERATOR, '--es', 'payload', json.dumps(command), '--receiver-foreground')
            deadline = time.monotonic() + 10
            while True:
                logs = adb('logcat', '-d', '-v', 'raw')
                matches = [line.split('[Androperator-Result] ', 1)[1] for line in logs.splitlines() if '[Androperator-Result] ' in line and command_id in line]
                if matches:
                    break
                assert time.monotonic() < deadline, 'No correlated Android ingress result'
                time.sleep(0.2)
            result = json.loads(matches[-1])
            records.append({'command': command, 'result': result})
            assert result['commandId'] == command_id and result['taskId'] == 'ingress-proof'
            if actions in service_cases:
                assert result['status'] == 'success', result
            else:
                assert result['errorCode'] == 'SERVICE_UNAVAILABLE' and not result.get('stepResults'), result
        (args.output / 'shade-after-ingress.txt').write_text(shade())
    finally:
        adb('settings', 'put', 'secure', 'enabled_accessibility_services', original_services)
        adb('settings', 'put', 'secure', 'accessibility_enabled', original)
        adb('cmd', 'statusbar', 'collapse')
        (args.output / 'evidence.json').write_text(json.dumps(records, indent=2))
    print('Passed open-shade service reads/controls and direct Android mixed/UI ingress rejection without partial results.')


if __name__ == '__main__':
    main()
