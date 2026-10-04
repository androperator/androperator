import base64
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).with_name('verify_bootstrap.py'))
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapTests(unittest.TestCase):
    def test_only_exact_published_archive_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'release.tgz'
            archive.write_bytes(b'validated archive')
            metadata = {'version': '1.1.0',
                        'dist.integrity': 'sha512-' + base64.b64encode(
                            hashlib.sha512(archive.read_bytes()).digest()).decode()}
            bootstrap.verify(metadata, archive)
            for field, value in [('version', '1.1.1'),
                                 ('dist.integrity', 'sha512-wrong')]:
                with self.subTest(field=field), self.assertRaises(ValueError):
                    bootstrap.verify({**metadata, field: value}, archive)
            for field in metadata:
                with self.subTest(missing=field), self.assertRaises(ValueError):
                    bootstrap.verify({k: v for k, v in metadata.items() if k != field}, archive)
            archive.write_bytes(b'changed archive')
            with self.assertRaises(ValueError):
                bootstrap.verify(metadata, archive)
