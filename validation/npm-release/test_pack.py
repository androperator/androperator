import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release_pack', Path(__file__).with_name('pack.py'))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class ReleaseArchiveTests(unittest.TestCase):
    def test_archive_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'release.tgz'
            def write(entries):
                with tarfile.open(archive, 'w:gz') as target:
                    for name, content, kind in entries:
                        entry = tarfile.TarInfo(name)
                        entry.type = kind
                        entry.size = len(content)
                        target.addfile(entry, io.BytesIO(content))
            valid = [
                ('package/package.json', b'{"name":"androperator","version":"1.0.0"}', tarfile.REGTYPE),
                ('package/dist/cli/index.js', b'console.log("fixture");', tarfile.REGTYPE),
            ]
            write(valid)
            self.assertEqual(pack.validate_archive(archive, '1.0.0'), 2)
            with self.assertRaises(ValueError):
                pack.validate_archive(archive, '2.0.0')
            for entries in [[], valid[:1],
                            [valid[0], (valid[1][0], b'', tarfile.REGTYPE)],
                            [valid[0], valid[1], valid[1]],
                            valid + [('package/../escape', b'', tarfile.REGTYPE)],
                            valid + [('package/link', b'', tarfile.SYMTYPE)]]:
                with self.subTest(entries=entries):
                    write(entries)
                    with self.assertRaises(ValueError):
                        pack.validate_archive(archive, '1.0.0')
            archive.write_bytes(b'broken')
            with self.assertRaises(tarfile.TarError):
                pack.validate_archive(archive, '1.0.0')

    def test_real_hooks_cannot_hide_invalid_packed_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'dist/cli').mkdir(parents=True)
            (root / 'dist/cli/index.js').write_text('export {};')
            manifest = {'name': 'androperator', 'version': '1.0.0', 'files': ['dist/'],
                        'scripts': {'prepack': 'node hook.cjs before', 'postpack': 'node hook.cjs after'}}
            (root / 'package.json').write_text(json.dumps(manifest))
            (root / 'hook.cjs').write_text(
                "const fs = require('node:fs');\n"
                "const p = JSON.parse(fs.readFileSync('package.json'));\n"
                "p.version = process.argv[2] === 'before' ? '9.9.9' : '1.0.0';\n"
                "fs.writeFileSync('package.json', JSON.stringify(p));\n")
            output = root / 'release.tgz'
            with patch.dict(os.environ, {'npm_config_cache': str(root / 'cache')}):
                with self.assertRaisesRegex(ValueError, 'name/version'):
                    pack.pack_release(root, '1.0.0', output)
            self.assertEqual(json.loads((root / 'package.json').read_text())['version'], '1.0.0')
            self.assertFalse(output.exists())

    def test_retained_archive_is_published_without_hooks_or_repacking(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'dist/cli').mkdir(parents=True)
            cli = root / 'dist/cli/index.js'
            cli.write_text('export {};')
            (root / 'hook.cjs').write_text(
                "const fs = require('node:fs');\n"
                "if (process.argv[2] === 'before') fs.writeFileSync('dist/packed.txt', 'packed');\n"
                "else if (process.argv[2] === 'after') fs.unlinkSync('dist/packed.txt');\n"
                "else fs.writeFileSync('publish-hook-ran', 'unexpected');\n")
            (root / 'package.json').write_text(json.dumps({
                'name': 'androperator', 'version': '1.0.0', 'files': ['dist/'],
                'scripts': {'prepack': 'node hook.cjs before', 'postpack': 'node hook.cjs after',
                            'prepublishOnly': 'node hook.cjs publish', 'publish': 'node hook.cjs publish'},
            }))
            output = root / 'release.tgz'
            with patch.dict(os.environ, {'npm_config_cache': str(root / 'cache')}):
                self.assertEqual(pack.pack_release(root, '1.0.0', output), 3)
                self.assertFalse((root / 'dist/packed.txt').exists())
                with tarfile.open(output) as archive:
                    self.assertEqual(archive.extractfile('package/dist/packed.txt').read(), b'packed')
                digest = hashlib.sha256(output.read_bytes()).hexdigest()
                cli.unlink()
                subprocess.run(['npm', 'publish', str(output), '--dry-run', '--ignore-scripts=true',
                                '--access', 'public', '--tag', 'latest', '--registry', 'http://127.0.0.1:9',
                                '--fetch-retries=0'], cwd=root,
                               check=True, capture_output=True, text=True)
                self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), digest)
                self.assertFalse((root / 'publish-hook-ran').exists())


if __name__ == '__main__':
    unittest.main()
