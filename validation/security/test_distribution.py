import gzip
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

from check_distribution import check_directory, check_file, check_package_files, main


def archive_bytes(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return output.getvalue()


class DistributionTests(unittest.TestCase):
    def test_source_suppressions_are_permitted(self):
        check_file('dist/cli/index.js', b'// nosemgrep: reviewed-rule\nexport {};')

    def test_tooling_and_rules_are_rejected(self):
        for name, content in [
            ('validation/security/check.py', b''),
            ('assets/semgrep-rules/rule.yml', b''),
            ('lib/reviewdog', b''),
            ('.venv/lib/tool.py', b''),
            ('dist/tool.js', b'spawn("semgrep", args)'),
            ('package.json', b'{"dependencies":{"semgrep":"1"}}'),
            ('install.sh', b'python validation/security/check.py'),
            ('classes.dex', b'\x00Lcom/semgrep/Scanner;\x00'),
            ('resources.arsc', 'semgrep'.encode('utf-16-le')),
            ('assets/taint.yml', b'rules:\n  - id: example\n    languages: [python]\n    mode: taint'),
            ('assets/rule.json', b'{"rules":[{"languages":["python"],"pattern-regex":"bad"}]}'),
            ('assets/rule.yml', b'rules:\n  - id: example\n    languages: [python]\n    pattern: bad()'),
        ]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                check_file(name, content)

    def test_compressed_content_is_inspected(self):
        for content in [gzip.compress(b'semgrep'), archive_bytes({'tool.txt': 'reviewdog'})]:
            with self.assertRaises(ValueError):
                check_file('assets/data', content)
        with self.assertRaises((EOFError, OSError)):
            check_file('assets/broken.gz', b'\x1f\x8b')

    def test_directory_requires_real_readable_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(ValueError):
                check_directory(root / 'missing')
            with self.assertRaises(ValueError):
                check_directory(root)
            (root / 'index.html').write_text('<h1>Product</h1>')
            self.assertEqual(check_directory(root), 1)
            (root / 'link').symlink_to(root / 'index.html')
            with self.assertRaises(ValueError):
                check_directory(root)
            (root / 'link').unlink()
            (root / 'payload').write_text('semgrep')
            self.assertEqual(main(['--directory', str(root)]), 1)

    def test_apk_scans_entries_and_rejects_invalid_archives(self):
        with tempfile.TemporaryDirectory() as temporary:
            apk = Path(temporary) / 'operator.apk'
            self.assertEqual(main(['--apk', str(apk)]), 1)
            apk.write_bytes(b'not a zip')
            self.assertEqual(main(['--apk', str(apk)]), 1)
            apk.write_bytes(archive_bytes({'classes.dex': b'code'}))
            self.assertEqual(main(['--apk', str(apk)]), 1)
            apk.write_bytes(archive_bytes({'AndroidManifest.xml': b'manifest', 'classes.dex': b'code'}))
            self.assertEqual(main(['--apk', str(apk)]), 0)
            apk.write_bytes(archive_bytes({'AndroidManifest.xml': b'manifest', 'assets/renamed.txt': 'semgrep'}))
            self.assertEqual(main(['--apk', str(apk)]), 1)

    def test_npm_list_checks_actual_file_contents(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'dist/cli').mkdir(parents=True)
            (root / 'dist/cli/index.js').write_text('// nosemgrep: example\nexport {};')
            files = [{'path': 'dist/cli/index.js'}]
            check_package_files(root, files)
            with self.assertRaises(ValueError):
                check_package_files(root, [])
            with self.assertRaises(ValueError):
                check_package_files(root, files + [{'path': '../outside'}])
            (root / 'package.json').write_text('{"scripts":{"postinstall":"semgrep scan"}}')
            with self.assertRaises(ValueError):
                check_package_files(root, files + [{'path': 'package.json'}])


if __name__ == '__main__':
    unittest.main()
