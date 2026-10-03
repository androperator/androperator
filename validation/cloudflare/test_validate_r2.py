import json
from pathlib import Path
import subprocess
import unittest

from validate_r2 import validate


class ValidationTests(unittest.TestCase):
    def exercise(self, failure=None):
        objects = {}
        operations = []

        def run(command, **kwargs):
            operation = command[4]
            operations.append(operation)
            key = command[command.index('--key') + 1] if '--key' in command else None
            output = {}
            if operation == 'list-objects-v2':
                if failure == 'list':
                    raise subprocess.CalledProcessError(1, command)
                output = {'Contents': [{'Key': key} for key in objects]}
            elif operation == 'put-object':
                objects[key] = Path(command[command.index('--body') + 1]).read_bytes()
                if failure == 'upload':
                    raise subprocess.CalledProcessError(1, command)
            elif operation == 'get-object':
                Path(command[-1]).write_bytes(b'wrong' if failure == 'compare' else objects[key])
            elif operation == 'delete-object':
                if failure == 'delete':
                    raise subprocess.CalledProcessError(1, command)
                if failure != 'remains':
                    objects.pop(key, None)
            return subprocess.CompletedProcess(command, 0, json.dumps(output), '')

        env = {'ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID': 'a' * 32,
               'ANDROPERATOR_CLOUDFLARE_R2_BUCKET': 'androperator-downloads',
               'AWS_ACCESS_KEY_ID': 'test', 'AWS_SECRET_ACCESS_KEY': 'test'}
        if failure:
            with self.assertRaises((RuntimeError, subprocess.CalledProcessError)):
                validate(env, run)
        else:
            validate(env, run)
        return objects, operations

    def test_success_removes_object(self):
        objects, operations = self.exercise()
        self.assertFalse(objects)
        self.assertEqual(operations, ['list-objects-v2', 'put-object', 'get-object',
                                     'delete-object', 'list-objects-v2'])

    def test_failed_upload_and_comparison_still_clean_up(self):
        for failure in ('upload', 'compare'):
            with self.subTest(failure=failure):
                objects, operations = self.exercise(failure)
                self.assertFalse(objects)
                self.assertIn('delete-object', operations)

    def test_cleanup_failure_is_not_success(self):
        for failure in ('delete', 'remains'):
            with self.subTest(failure=failure):
                objects, _ = self.exercise(failure)
                self.assertTrue(objects)

    def test_listing_failure_prevents_mutation(self):
        _, operations = self.exercise('list')
        self.assertEqual(operations, ['list-objects-v2'])

    def test_wrong_bucket_or_missing_inputs_prevent_commands(self):
        for env in ({}, {'ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID': 'a' * 32,
                         'ANDROPERATOR_CLOUDFLARE_R2_BUCKET': 'downloads'}):
            with self.assertRaises(ValueError):
                validate(env, lambda *args, **kwargs: self.fail('Unexpected AWS invocation'))


if __name__ == '__main__':
    unittest.main()
