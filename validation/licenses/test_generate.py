#!/usr/bin/env python3
"""Regression checks for offline notices and missing dependency coverage."""
import importlib.util
from html.parser import HTMLParser
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('licenses', ROOT / 'scripts/licenses/generate.py')
GENERATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GENERATOR)


class LicenseInventoryTest(unittest.TestCase):
    def setUp(self):
        self.metadata = json.loads((ROOT / 'scripts/licenses/metadata.json').read_text())
        self.texts = ROOT / 'scripts/licenses/texts'

    def test_every_reviewed_dependency_renders_with_offline_text(self):
        rendered = GENERATOR.render(self.metadata['modules'], self.metadata, self.texts)
        for coordinate in self.metadata['modules']:
            self.assertIn(coordinate, rendered)
        self.assertIn('Copyright 2008, Google Inc.', rendered)
        self.assertIn('Boost Software License', rendered)
        self.assertNotIn('Google Play Services', rendered)
        self.assertNotIn('ICU4C', rendered)
        self.assertNotIn('org.slf4j:', rendered)
        self.assertNotIn('io.ktor:', rendered)
        self.assertNotIn('<script', rendered)
        self.assertEqual(rendered, GENERATOR.render(reversed(self.metadata['modules']), self.metadata, self.texts))

    def test_removed_integrations_cannot_return_to_the_reviewed_inventory(self):
        forbidden = ('com.google.android.gms:', 'io.ktor:', 'org.slf4j:',
                     'com.squareup.okhttp3:', 'com.squareup.okio:',
                     'org.jetbrains.kotlinx:kotlinx-coroutines-play-services:')
        self.assertFalse(any(c.startswith(forbidden) for c in self.metadata['modules']))

    def test_every_local_license_link_has_a_bundled_destination(self):
        class Links(HTMLParser):
            def __init__(self):
                super().__init__()
                self.ids = set()
                self.anchors = set()

            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if 'id' in attrs:
                    self.ids.add(attrs['id'])
                if attrs.get('href', '').startswith('#'):
                    self.anchors.add(attrs['href'][1:])

        links = Links()
        links.feed(GENERATOR.render(self.metadata['modules'], self.metadata, self.texts))
        self.assertTrue(links.anchors)
        self.assertEqual(links.anchors, links.ids)

    def test_new_dependency_or_version_requires_review(self):
        for coordinate in ('example:unknown:1', 'org.jetbrains.kotlin:kotlin-stdlib:999'):
            with self.assertRaisesRegex(ValueError, 'Review license metadata'):
                GENERATOR.render([coordinate], self.metadata, self.texts)

    def test_missing_or_empty_license_is_rejected(self):
        with tempfile.TemporaryDirectory() as path:
            texts = Path(path)
            for content in (None, ''):
                if content is not None:
                    (texts / 'Apache-2.0.txt').write_text(content)
                with self.assertRaises((ValueError, FileNotFoundError)):
                    GENERATOR.render(['androidx.activity:activity:1.9.3'], self.metadata, texts)

    def test_metadata_text_is_escaped(self):
        coordinate = 'androidx.activity:activity:1.9.3'
        self.metadata['modules'][coordinate]['name'] = '<script>bad</script>'
        rendered = GENERATOR.render([coordinate], self.metadata, self.texts)
        self.assertIn('&lt;script&gt;bad&lt;/script&gt;', rendered)
        self.assertNotIn('<script>', rendered)


if __name__ == '__main__':
    unittest.main()
