import importlib.util
import json
from pathlib import Path
import unittest
import subprocess
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('transport_series', Path(__file__).with_name('run.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ResultChecks(unittest.TestCase):
    def test_rejects_transport_failure_and_failed_android_action(self):
        for value in ({'code': 'RESULT_TRANSPORT_EXITED'},
                      {'envelope': {'commandId': 'c', 'taskId': 't', 'status': 'failed'}}):
            with self.assertRaises(AssertionError):
                module.inspect_result(value)

    def test_requires_full_internet_fixture(self):
        nodes = [{'label': 'Internet', 'accessibilityDataSensitive': True, 'resourceId': None},
                 {'label': 'Wi-Fi', 'resourceId': 'com.android.settings:id/switchWidget'}]
        value = {'envelope': {'commandId': 'c', 'taskId': 't', 'status': 'success', 'stepResults': [
            {'success': True, 'data': {'query': json.dumps({'nodes': nodes, 'truncated': False})}}]}}
        module.inspect_result(value, True, True)
        for query in ({'nodes': nodes, 'truncated': True}, {'nodes': [], 'truncated': False},
                      {'nodes': nodes[:1], 'truncated': False}):
            value['envelope']['stepResults'][0]['data']['query'] = json.dumps(query)
            with self.assertRaises(AssertionError):
                module.inspect_result(value, True, True)


class SeriesChecks(unittest.TestCase):
    def test_stops_after_failed_open_without_replaying_uncertain_mutation(self):
        calls = []
        prepared = []
        def command(label, *args, **kwargs):
            calls.append(label)
            return label != 'cycle-2-open'
        module.run_declared_series(command, lambda: prepared.append(True))
        self.assertEqual(calls, ['cycle-1-open', 'cycle-1-query', 'cycle-2-open'])
        self.assertEqual(prepared, [])

    def test_retains_failed_read_and_completes_fixed_unique_attempts(self):
        calls = []
        prepared = []
        def command(label, *args, **kwargs):
            calls.append(label)
            return label != 'cycle-1-query'
        module.run_declared_series(command, lambda: prepared.append(True))
        self.assertEqual(len(calls), 60)
        self.assertEqual(len(set(calls)), 60)
        self.assertEqual(prepared, [True])
        self.assertEqual(calls[-1], 'internet-20')


class EvidenceChecks(unittest.TestCase):
    def test_distinguishes_delivery_from_action_and_fixture_failures(self):
        identity = {'commandId': 'query-c', 'taskId': 'query-t'}
        transport = module.classify_result(json.dumps({'code': 'RESULT_TRANSPORT_EXITED', 'details': identity}), 1)
        self.assertFalse(transport['canonicalEnvelopeReceived'])
        self.assertEqual(transport['failureCategory'], 'host_or_transport')
        self.assertEqual(transport['commandId'], 'query-c')
        value = {'isCanonicalTerminal': True, 'terminalSource': 'androperator_result',
                 'envelope': {**identity, 'status': 'failed', 'stepResults': [
                     {'success': False, 'data': {'errorCode': 'UI_TREE_UNAVAILABLE'}}]}}
        action = module.classify_result(json.dumps(value), 1)
        self.assertTrue(action['canonicalEnvelopeReceived'])
        self.assertEqual(action['failureCategory'], 'android_action')
        value['envelope'].update(status='success', stepResults=[{'success': True, 'data': {
            'query': json.dumps({'nodes': [{'accessibilityDataSensitive': False}], 'truncated': False})}}])
        fixture = module.classify_result(json.dumps(value), 0, True, True)
        self.assertTrue(fixture['canonicalEnvelopeReceived'])
        self.assertEqual(fixture['failureCategory'], 'fixture')
        self.assertFalse(fixture['success'])
        success = module.classify_result(json.dumps(value), 0, True)
        self.assertTrue(success['success'])
        self.assertIsNone(success['failureCategory'])
        host = module.classify_result(json.dumps(value), 124)
        self.assertEqual(host['failureCategory'], 'host_exit')
        value['isCanonicalTerminal'] = False
        self.assertFalse(module.classify_result(json.dumps(value), 0)['canonicalEnvelopeReceived'])

    def test_malformed_output_is_retained_without_claiming_delivery(self):
        for stdout in ('', '{', 'null', '[]', '{"envelope": null}'):
            result = module.classify_result(stdout, 124)
            self.assertFalse(result['success'])
            self.assertFalse(result['canonicalEnvelopeReceived'])
            self.assertIn('failure', result)

    def test_failure_observations_are_read_only_targeted_and_keep_timeout_evidence(self):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            self.assertEqual(kwargs['timeout'], 10)
            if command[0] == 'ps':
                raise PermissionError('process listing denied')
            if command[-1] == 'get-state':
                raise subprocess.TimeoutExpired(command, 10, output=b'partial', stderr=b'disconnected')
            return subprocess.CompletedProcess(command, 0, b'evidence', b'')
        with tempfile.TemporaryDirectory() as directory, patch.object(module.subprocess, 'run', side_effect=run):
            out = Path(directory)
            module.capture_failure_observations(['adb', '-s', 'test-device'], out, '001')
            observations = json.loads((out / '001.observations.json').read_text())
            self.assertEqual(observations[2]['exitCode'], 124)
            self.assertTrue(observations[2]['timedOut'])
            self.assertIn('denied', observations[1]['spawnError'])
            self.assertEqual(observations[1]['exitCode'], 127)
            self.assertIn('denied', (out / '001.host-processes.stderr').read_text())
            self.assertEqual((out / '001.device-state.stdout').read_bytes(), b'partial')
            self.assertEqual((out / '001.device-state.stderr').read_bytes(), b'disconnected')
        self.assertEqual(calls, [
            ['adb', '-s', 'test-device', 'logcat', '-d', '-v', 'threadtime', '-t', '5000'],
            ['ps', '-axo', 'pid,ppid,stat,command'],
            ['adb', '-s', 'test-device', 'get-state'],
            ['adb', '-s', 'test-device', 'shell', 'ps', '-A'],
        ])
