#!/usr/bin/env python3
"""Fixed transport series. Install the matching Operator and activate only its service first."""
import argparse
from collections import deque
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]


def inspect_result(value, full_query=False, internet=False):
    envelope = value.get('envelope', {})
    assert envelope.get('commandId') and envelope.get('taskId'), value
    assert envelope.get('status') == 'success', value
    assert envelope['stepResults'] and all(step['success'] for step in envelope['stepResults']), value
    if full_query:
        query = json.loads(envelope['stepResults'][0]['data']['query'])
        assert not query['truncated'] and query['nodes'], query
        if internet:
            nodes = query['nodes']
            assert nodes[0]['accessibilityDataSensitive'] is True, 'Missing sensitive root'
            assert any(n['label'] == 'Internet' for n in nodes), 'Missing Internet heading'
            assert any(n['resourceId'] == 'com.android.settings:id/switchWidget' for n in nodes), 'Missing Wi-Fi switch'
    return envelope


def classify_result(stdout, exit_code, full_query=False, internet=False):
    """Keep delivery, Android action, and fixture verdicts independently observable."""
    outcome = {'success': False, 'canonicalEnvelopeReceived': False,
               'failureCategory': 'host_or_transport'}
    try:
        value = json.loads(stdout)
        assert isinstance(value, dict), 'CLI output is not an object'
        envelope = value.get('envelope')
        identity = envelope if isinstance(envelope, dict) else value.get('details', {})
        if isinstance(identity, dict):
            outcome.update({key: identity.get(key) for key in ('commandId', 'taskId')})
        outcome['code'] = value.get('code')
        # The branch-local CLI only exposes an envelope after transport validation.
        # Require its canonical shape before counting delivery, even on nonzero exit.
        if (value.get('isCanonicalTerminal') is True and value.get('terminalSource') == 'androperator_result'
                and isinstance(envelope, dict) and envelope.get('commandId') and envelope.get('taskId')
                and envelope.get('status') in ('success', 'failed')
                and isinstance(envelope.get('stepResults'), list)):
            outcome['canonicalEnvelopeReceived'] = True
            outcome['failureCategory'] = 'android_action'
            assert envelope['status'] == 'success', value
            assert envelope['stepResults'] and all(step['success'] for step in envelope['stepResults']), value
            outcome['failureCategory'] = 'host_exit'
            assert exit_code == 0, value
            outcome['failureCategory'] = 'fixture'
            inspect_result(value, full_query, internet)
            outcome.update(success=True, failureCategory=None)
        else:
            raise AssertionError(value)
    except (ValueError, KeyError, TypeError, AssertionError) as error:
        outcome['failure'] = str(error)[:1000]
    return outcome


def capture_failure_observations(adb, out, stem):
    """Observe before another attempt; never dispatch an Operator action or reset ADB."""
    observations = []
    for label, command in (
        ('device-buffer', [*adb, 'logcat', '-d', '-v', 'threadtime', '-t', '5000']),
        ('host-processes', ['ps', '-axo', 'pid,ppid,stat,command']),
        ('device-state', [*adb, 'get-state']),
        ('device-processes', [*adb, 'shell', 'ps', '-A']),
    ):
        started = time.time()
        observation_error = {}
        try:
            result = subprocess.run(command, capture_output=True, timeout=10)
        except subprocess.TimeoutExpired as error:
            observation_error = {'timedOut': True}
            result = subprocess.CompletedProcess(command, 124, error.stdout or b'', error.stderr or b'')
        except OSError as error:
            observation_error = {'spawnError': str(error)}
            result = subprocess.CompletedProcess(command, 127, b'', str(error).encode())
        # Private bounded evidence; retain explicit truncation and observation failure.
        limit = 8 * 1024 * 1024
        for name, data in (('stdout', result.stdout), ('stderr', result.stderr)):
            (out / f'{stem}.{label}.{name}').write_bytes(data[-limit:])
        observations.append({'label': label, 'invocation': command, 'startedAtUnix': started,
                             'exitCode': result.returncode,
                             'stdoutTruncated': len(result.stdout) > limit,
                             'stderrTruncated': len(result.stderr) > limit, **observation_error})
    (out / f'{stem}.observations.json').write_text(json.dumps(observations, indent=2))


def run_declared_series(command, prepare_internet):
    for cycle in range(20):
        # Repeating open after a failed dispatch can replay an uncertain mutation.
        # Leave the remaining declared attempts unrun instead.
        if not command(f'cycle-{cycle + 1}-open', 'open', 'com.android.settings'):
            return
        command(f'cycle-{cycle + 1}-query', 'query', '--visibility', 'all', '--limit', '1000', full_query=True)
    prepare_internet()
    for attempt in range(20):
        command(f'internet-{attempt + 1}', 'query', '--visibility', 'all', '--limit', '1000', full_query=True, internet=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--trace-adb-shell', action='store_true',
                        help='Enable ADB shell-protocol diagnostics for this series only')
    parser.add_argument('--operator-package', required=True)
    parser.add_argument('--apk', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    environment = {**os.environ, 'ANDROPERATOR_NO_DAEMON': '1'}
    if args.trace_adb_shell:
        environment['ADB_TRACE'] = 'shell'
    lock = open(Path(tempfile.gettempdir()) / ('androperator-device-' + hashlib.sha256(args.device.encode()).hexdigest() + '.lock'), 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    adb = ['adb', '-s', args.device]
    def shell(*command):
        return subprocess.check_output([*adb, 'shell', *command], text=True, timeout=30).strip()
    assert shell('getprop', 'ro.build.version.sdk') == '35'
    locale = shell('getprop', 'persist.sys.locale') or shell('getprop', 'ro.product.locale')
    assert locale.startswith('en'), locale
    service = args.operator_package + '/androperator.operator.accessibilityservice.OperatorAccessibilityService'
    assert shell('settings', 'get', 'secure', 'enabled_accessibility_services') == service
    sources = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
               for p in sorted((ROOT / 'apps/node/dist').rglob('*.js')) if 'test' not in p.parts}
    metadata = {'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'builtJavascriptHashes': sources, 'apkSha256': hashlib.sha256(args.apk.read_bytes()).hexdigest(),
                'device': args.device, 'operatorPackage': args.operator_package, 'locale': locale,
                'fingerprint': shell('getprop', 'ro.build.fingerprint'),
                'package': shell('dumpsys', 'package', args.operator_package),
                'declaredSeries': {'immediateOpenQueryCycles': 20, 'fullInternetQueries': 20},
                'adbTrace': environment.get('ADB_TRACE')}
    (args.out / 'metadata.json').write_text(json.dumps(metadata, indent=2))
    # Keep a bounded independent stream around every attempt, including failures.
    recent = deque(maxlen=5000)
    # The validation harness intentionally selects trusted local adb/aapt2 executables via CLI or environment; commands use argv with no host shell.
    # nosemgrep: dangerous-subprocess-use-tainted-env-args
    logcat = subprocess.Popen([*adb, 'logcat', '-v', 'time', '-T', '1'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=environment)
    def drain():
        for line in logcat.stdout:
            recent.append(line[:8192])
    thread = threading.Thread(target=drain, daemon=True)
    thread.start()
    attempts = []
    def command(label, *command, full_query=False, internet=False):
        start = time.monotonic()
        invocation = ['node', str(ROOT / 'apps/node/dist/cli/index.js'), *command,
                      '--device', args.device, '--operator-package', args.operator_package]
        try:
            proc = subprocess.run(invocation, cwd=ROOT,
                                  env=environment,
                                  capture_output=True, timeout=50)
        except subprocess.TimeoutExpired as error:
            proc = subprocess.CompletedProcess(invocation, 124, error.stdout or b'', error.stderr or b'')
        stem = f'{len(attempts) + 1:03d}-{label}'
        (args.out / (stem + '.stdout')).write_bytes(proc.stdout)
        (args.out / (stem + '.stderr')).write_bytes(proc.stderr)
        (args.out / (stem + '.logcat')).write_text(''.join(list(recent)))
        entry = {'label': label, 'elapsedMs': round((time.monotonic() - start) * 1000),
                 'exitCode': proc.returncode, 'outputBytes': len(proc.stdout), 'success': False,
                 'invocation': invocation}
        entry.update(classify_result(proc.stdout, proc.returncode, full_query, internet))
        entry['independentReaderExitAtCompletion'] = logcat.poll()
        attempts.append(entry)
        (args.out / 'attempts.json').write_text(json.dumps(attempts, indent=2))
        if not entry['success']:
            capture_failure_observations(adb, args.out, stem)
            (args.out / (stem + '.post-failure.logcat')).write_text(''.join(list(recent)))
        print(json.dumps(entry), flush=True)
        return entry['success']
    try:
        def prepare_internet():
            preparation = shell('am', 'start', '-a', 'android.settings.WIFI_SETTINGS')
            (args.out / 'internet-preparation.txt').write_text(preparation)
            time.sleep(2)
        run_declared_series(command, prepare_internet)
    finally:
        (args.out / 'summary.json').write_text(json.dumps({
            'declaredAttempts': 60, 'completedAttempts': len(attempts),
            'failedAttempts': sum(not entry['success'] for entry in attempts),
            'canonicalEnvelopesReceived': sum(entry['canonicalEnvelopeReceived'] for entry in attempts),
            'failureCategories': {category: sum(entry['failureCategory'] == category for entry in attempts)
                                  for category in ('host_or_transport', 'android_action', 'host_exit', 'fixture')},
            'unrunAttempts': 60 - len(attempts),
            'independentReaderExitBeforeCleanup': logcat.poll(),
        }, indent=2))
        logcat.terminate()
        logcat.wait(timeout=5)
        thread.join(timeout=5)
    return 0 if len(attempts) == 60 and all(a['success'] for a in attempts) else 1


if __name__ == '__main__':
    raise SystemExit(main())
