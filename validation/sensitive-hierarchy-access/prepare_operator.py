#!/usr/bin/env python3
"""Install and activate one Operator on a dedicated emulator, retaining setup evidence."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time

from run import ROOT, query

PACKAGES = ('com.androperator.operator.dev', 'com.androperator.operator')
SERVICE = '/androperator.operator.accessibilityservice.OperatorAccessibilityService'


def binding_matches(output, service=None):
    fields = {}
    pending_field = None
    for line in output.splitlines():
        key, separator, value = line.strip().partition(':')
        if separator and key in ('Bound services', 'Binding services', 'Enabled services', 'Crashed services'):
            # This fixture supports a single Android user, not ambiguous mixed-user dumps.
            if key in fields or pending_field is not None:
                return False
            fields[key] = value.strip()
            if not fields[key].endswith('}'):
                pending_field = key
        elif pending_field is not None:
            # Android prints additional bound connections on continuation lines.
            fields[pending_field] += line.strip()
            if fields[pending_field].endswith('}'):
                pending_field = None
    if pending_field is not None:
        return False
    if fields.get('Binding services') != '{}' or fields.get('Crashed services') != '{}':
        return False
    if service is None:
        return fields.get('Bound services') == '{}' and fields.get('Enabled services') == '{}'
    return (fields.get('Enabled services') == '{{' + service + '}}'
            and fields.get('Bound services', '').startswith('{Service[')
            and fields['Bound services'].count('Service[') == 1)


def wait_for_binding(run, device, service=None, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + 15
    for _ in range(30):
        remaining = deadline - clock()
        assert remaining > 0, 'Operator binding deadline exhausted'
        state = run(['adb', '-s', device, 'shell', 'dumpsys', 'accessibility'], timeout=remaining)
        assert clock() < deadline, 'Operator binding deadline exhausted'
        if binding_matches(state, service):
            return
        sleep(min(0.25, max(0, deadline - clock())))
    raise AssertionError('Operator binding did not settle within 30 observations')


def prepare_operator(run, cli, device, package, apk):
    assert package in PACKAGES, 'Unsupported Operator package'
    def adb(*command):
        return run(['adb', '-s', device, 'shell', *command], timeout=30)
    assert adb('getprop', 'ro.build.version.sdk').strip() in ('35', '36'), 'API 35 or 36 required'
    # Installing while an old binding is still disconnecting can leave two system
    # connections to the same service. Wait for complete teardown before replacing it.
    adb('settings', 'put', 'secure', 'accessibility_enabled', '0')
    adb('settings', 'delete', 'secure', 'enabled_accessibility_services')
    wait_for_binding(run, device)
    for operator in PACKAGES:
        adb('am', 'force-stop', operator)
    run(['adb', '-s', device, 'install', '-r', str(apk)], timeout=120)
    adb('am', 'start', '-n', package + '/androperator.activity.MainActivity')
    adb('settings', 'put', 'secure', 'enabled_accessibility_services', package + SERVICE)
    adb('settings', 'put', 'secure', 'accessibility_enabled', '1')
    cli('grant-device-permissions')
    wait_for_binding(run, device, package + SERVICE)
    doctor = cli('doctor')
    assert doctor.get('criticalOk') is True, doctor
    # A handshake alone previously passed with an unusable accessibility connection.
    query(cli('query', '--visibility', 'all', '--limit', '1000'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--operator-package', required=True, choices=PACKAGES)
    parser.add_argument('--apk', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    args.apk = args.apk.resolve(strict=True)
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    metadata = {'device': args.device, 'operatorPackage': args.operator_package,
                'apkSha256': hashlib.sha256(args.apk.read_bytes()).hexdigest()}
    count = 0
    def run(command, timeout=45):
        nonlocal count
        count += 1
        prefix = args.out / f'{count:02d}'
        prefix.with_suffix('.command.json').write_text(json.dumps(command))
        try:
            result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            for suffix, data in (('.stdout', error.stdout), ('.stderr', error.stderr)):
                prefix.with_suffix(suffix).write_text(data.decode(errors='replace') if isinstance(data, bytes) else data or '')
            raise AssertionError(f'Setup command exceeded {timeout}s; see {prefix}') from error
        prefix.with_suffix('.stdout').write_text(result.stdout)
        prefix.with_suffix('.stderr').write_text(result.stderr)
        prefix.with_suffix('.result.json').write_text(json.dumps({'exitCode': result.returncode, 'timeoutSeconds': timeout}))
        assert result.returncode == 0, f'Setup command failed; see {prefix}'
        return result.stdout
    def cli(*command):
        return json.loads(run(['node', 'apps/node/dist/cli/index.js', *command, '--device', args.device,
                               '--operator-package', args.operator_package, '--no-daemon']))
    lock_path = Path(tempfile.gettempdir()) / ('androperator-device-' + hashlib.sha256(args.device.encode()).hexdigest() + '.lock')
    with lock_path.open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            prepare_operator(run, cli, args.device, args.operator_package, args.apk)
            metadata['passed'] = True
        except Exception as error:
            metadata.update(passed=False, error=str(error))
            raise
        finally:
            (args.out / 'result.json').write_text(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
