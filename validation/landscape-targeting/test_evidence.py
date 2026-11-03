import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from evidence import run_recorded


class RecordedCommandTest(unittest.TestCase):
    def test_timeout_keeps_the_attempt_and_partial_output_without_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory) / 'click'
            command = ['node', 'cli.js', 'click', '--desc', 'RIGHT_TARGET', '--strict']

            def timeout(*args, **kwargs):
                # The attempt must already be durable when the process starts.
                self.assertEqual(command, json.loads(prefix.with_suffix('.command.json').read_text())['command'])
                raise subprocess.TimeoutExpired(command, 45, output=b'partial stdout', stderr=b'partial stderr')

            with patch('evidence.subprocess.run', side_effect=timeout) as launch:
                with self.assertRaises(subprocess.TimeoutExpired):
                    run_recorded(command, prefix, directory)
            self.assertEqual(1, launch.call_count)
            self.assertEqual('partial stdout', prefix.with_suffix('.json').read_text())
            self.assertEqual('partial stderr', prefix.with_suffix('.stderr').read_text())
            metadata = json.loads(prefix.with_suffix('.command.json').read_text())
            self.assertTrue(metadata['timedOut'])
            self.assertIsNone(metadata['returncode'])

    def test_failed_cli_keeps_its_exact_receipt_and_exit_code(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory) / 'click'
            result = subprocess.CompletedProcess(['node'], 1, '{"code":"FAILED"}', 'diagnostic')
            with patch('evidence.subprocess.run', return_value=result):
                self.assertIs(result, run_recorded(['node'], prefix, directory))
            self.assertEqual(result.stdout, prefix.with_suffix('.json').read_text())
            metadata = json.loads(prefix.with_suffix('.command.json').read_text())
            self.assertFalse(metadata['timedOut'])
            self.assertEqual(1, metadata['returncode'])
