import gzip
import io
import hashlib
import json
import os
import subprocess
import tarfile
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from check_distribution import check_directory, check_file, check_npm_archive, check_npm, main


def archive_bytes(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return output.getvalue()


class DistributionTests(unittest.TestCase):
    def test_source_suppressions_are_permitted(self):
        check_file('dist/cli/index.js', b'// nosemgrep: reviewed-rule\nexport {};')

    def test_public_docs_reject_all_security_references(self):
        for name, content in [
            ('api/index.html', b'<code>// nosemgrep: reviewed-rule</code>'),
            ('search/search_index.json', b'{"text":"Semgrep CE"}'),
            ('llms-full.txt', b'Run validation/security/check.py'),
            ('sitemap.xml', b'<loc>/internal/design/security-checks/</loc>'),
            ('internal/design/security-checks/index.html', b'<h1>Internal</h1>'),
            ('page.html.gz', gzip.compress(b'nosemgrep: rule')),
        ]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                check_file(name, content, public_docs=True)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'index.html').write_text('<h1>Product docs</h1>')
            self.assertEqual(main(['--public-docs', str(root)]), 0)
            (root / 'llms-full.txt').write_text('// nosemgrep: reviewed-rule')
            self.assertEqual(main(['--public-docs', str(root)]), 1)

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

    def test_npm_archive_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'package.tgz'
            def write_archive(extra=None):
                with tarfile.open(archive, 'w:gz') as packed:
                    for name, content in {
                        'package/package.json': b'{"name":"fixture"}',
                        'package/dist/cli/index.js': b'// nosemgrep: example\nexport {};',
                    }.items():
                        entry = tarfile.TarInfo(name)
                        entry.size = len(content)
                        packed.addfile(entry, io.BytesIO(content))
                    if extra is not None:
                        packed.addfile(extra, io.BytesIO(b''))
            write_archive()
            self.assertEqual(check_npm_archive(archive), 2)
            self.assertEqual(main(['--npm-archive', str(archive)]), 0)
            for name, kind in [('package/../outside', tarfile.REGTYPE),
                               ('package/link', tarfile.SYMTYPE),
                               ('package/package.json', tarfile.REGTYPE)]:
                entry = tarfile.TarInfo(name)
                entry.type = kind
                write_archive(entry)
                with self.subTest(name=name), self.assertRaises(ValueError):
                    check_npm_archive(archive)
            with tarfile.open(archive, 'w:gz'):
                pass
            self.assertEqual(main(['--npm-archive', str(archive)]), 1)
            archive.write_bytes(b'broken')
            self.assertEqual(main(['--npm-archive', str(archive)]), 1)
            with self.assertRaises(SystemExit):
                main(['--npm-archive', str(archive), '--output', str(archive)])

    def test_real_pack_hooks_cannot_hide_prohibited_archive_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / 'source'
            (package / 'dist/cli').mkdir(parents=True)
            (package / 'dist/cli/index.js').write_text('export {};')
            (package / 'package.json').write_text(json.dumps({
                'name': 'distribution-boundary-fixture', 'version': '1.0.0',
                'files': ['dist/'],
                'scripts': {'prepack': 'node hook.cjs before',
                            'postpack': 'node hook.cjs after'},
            }))
            # The hook itself is excluded from the archive. Postpack cleans the
            # source, proving that inspecting source files would miss the payload.
            (package / 'hook.cjs').write_text(
                "const fs = require('node:fs');\n"
                "if (process.argv[2] === 'before') {\n"
                "  fs.writeFileSync('dist/injected.txt', 'semgrep');\n"
                "} else { fs.unlinkSync('dist/injected.txt'); }\n")
            output = root / 'release.tgz'
            with patch.dict(os.environ, {'npm_config_cache': str(root / 'cache')}):
                with self.assertRaisesRegex(ValueError, 'package/dist/injected.txt'):
                    check_npm(output, package)
            self.assertFalse((package / 'dist/injected.txt').exists())
            self.assertFalse(output.exists())

    def test_checked_archive_is_retained_and_publish_dry_run_runs_no_hooks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / 'source'
            (package / 'dist/cli').mkdir(parents=True)
            (package / 'dist/cli/index.js').write_text('export {};')
            (package / 'hook.cjs').write_text(
                "require('node:fs').writeFileSync('published-hook-ran', 'unexpected');\n")
            (package / 'package.json').write_text(json.dumps({
                'name': 'distribution-boundary-fixture', 'version': '1.0.0',
                'files': ['dist/'], 'scripts': {'prepublishOnly': 'node hook.cjs'},
            }))
            output = root / 'release.tgz'
            with patch.dict(os.environ, {'npm_config_cache': str(root / 'cache')}):
                self.assertEqual(check_npm(output, package), 2)
                digest = hashlib.sha256(output.read_bytes()).hexdigest()
                # Mutating the source after checking cannot change the retained tarball.
                (package / 'dist/cli/index.js').write_text('semgrep')
                self.assertEqual(check_npm_archive(output), 2)
                subprocess.run(['npm', 'publish', str(output), '--dry-run', '--ignore-scripts=true',
                                '--access', 'public', '--tag', 'latest'], cwd=package,
                               check=True, capture_output=True, text=True)
                self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), digest)
                self.assertFalse((package / 'published-hook-ran').exists())


if __name__ == '__main__':
    unittest.main()
