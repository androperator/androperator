import contextlib
import io
import subprocess
import unittest
from unittest.mock import patch

import test_runner


class RunnerTests(unittest.TestCase):
    def invoke(self, args, side_effect):
        with patch.object(test_runner.subprocess, 'run', side_effect=side_effect) as run:
            with contextlib.redirect_stdout(io.StringIO()):
                status = test_runner.main(args)
        return status, run.call_args_list

    def test_failure_survives_later_success(self):
        status, calls = self.invoke(['--suite', 'android', '--suite', 'evals'],
                                   [subprocess.CompletedProcess([], 1), subprocess.CompletedProcess([], 0)])
        self.assertEqual(status, 1)
        self.assertEqual(len(calls), 2)

    def test_build_failure_blocks_consumers_but_runs_independent_suite(self):
        status, calls = self.invoke(['--suite', 'node', '--suite', 'validation', '--suite', 'evals'],
                                   [subprocess.CompletedProcess([], 1), subprocess.CompletedProcess([], 0)])
        self.assertEqual(status, 1)
        self.assertEqual([call.args[0][0] for call in calls], ['npm', 'uv'])

    def test_missing_program_fails(self):
        status, _ = self.invoke(['--suite', 'evals'], FileNotFoundError('uv'))
        self.assertEqual(status, 1)

    def test_device_requires_explicit_selection_and_serial(self):
        for args in [['--suite', 'instrumentation'], ['--device', 'example'],
                     ['--suite', 'mcp-device', '--device', ' '], ['--suite', 'unknown']]:
            with self.subTest(args=args), patch.object(test_runner.subprocess, 'run') as run:
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    test_runner.main(args)
                run.assert_not_called()

    def test_selected_serial_is_forwarded_to_device_suites(self):
        status, calls = self.invoke(['--suite', 'instrumentation', '--device', 'test-device'],
                                   lambda *a, **k: subprocess.CompletedProcess([], 0))
        self.assertEqual(status, 0)
        self.assertEqual(calls[0].kwargs['env']['ANDROID_SERIAL'], 'test-device')
        self.assertEqual(calls[0].kwargs['env']['ANDROPERATOR_SMOKE_DEVICE'], 'test-device')

    def test_default_never_runs_device_commands(self):
        status, calls = self.invoke([], lambda *a, **k: subprocess.CompletedProcess([], 0))
        self.assertEqual(status, 0)
        commands = [call.args[0] for call in calls]
        self.assertEqual(commands[0], ['npm', '--prefix', 'apps/node', 'run', 'build'])
        self.assertFalse(any('connectedDebugAndroidTest' in c or 'validation/test_mcp_stdio_smoke.mjs' in c for c in commands))


class NodeDiscoveryTests(unittest.TestCase):
    def test_flat_nested_and_cli_tests_and_failure_exit(self):
        import shutil
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'scripts').mkdir()
            shutil.copy(test_runner.ROOT / 'apps/node/scripts/test.mjs', root / 'scripts/test.mjs')
            for name in ['test/unit/flat', 'test/unit/nested/deep', 'cli/command', 'test/integration/flat']:
                path = root / 'dist' / f'{name}.test.js'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('console.log("discovered: ' + name + '");')
            command = ['node', str(root / 'scripts/test.mjs')]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Running 4 Node test files', result.stdout)
            result = subprocess.run(command + ['--unit'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Running 3 Node test files', result.stdout)
            # Add a test in a new source area after the first run. No runner edits.
            new_test = root / 'dist/new-feature/deep/future.test.js'
            new_test.parent.mkdir(parents=True)
            new_test.write_text('console.log("future test executed"); process.exit(7);')
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Running 5 Node test files', result.stdout)
            self.assertIn('future test executed', result.stdout)
            new_test.unlink()
            path.write_text('process.exit(7);')
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
