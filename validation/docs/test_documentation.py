"""Documentation contracts: run after building apps/node, without a device."""
from pathlib import Path
from tempfile import TemporaryDirectory
import importlib.util
import json
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]

def module(name):
    path = ROOT / '.agents/skills/docs-build/scripts' / (name + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value

cli = module('generate_cli_reference')
corpus = module('generate_llms_full')

class DocumentationTests(unittest.TestCase):
    def test_public_registry_coverage_and_primary_syntax(self):
        registry = json.loads(subprocess.check_output([
            'node', '--input-type=module', '-e',
            "import {COMMANDS} from './apps/node/dist/cli/registry.js'; "
            "console.log(JSON.stringify(Object.values(COMMANDS).filter(c => "
            "(c.docsVisibility ?? 'normal') === 'normal').map(c => c.name)))"
        ], cwd=ROOT, text=True))
        commands = cli.load_commands()
        visible = cli.public_commands(commands)
        rendered = cli.render_reference(commands, cli.load_command_details())
        self.assertEqual(set(registry), {c.name for c in visible})
        self.assertEqual(len(registry), len(visible))
        for name in registry:
            self.assertIn(f'### `{name}`', rendered)
        for name in ['notifications', 'media', 'query', 'on-screen-log']:
            self.assertTrue(next(c for c in visible if c.name == name).syntax)

    def test_rebase_preserves_examples_and_external_urls(self):
        source = ('[self](#result) [sibling](actions.md#click) '
                  '[parent](../setup.md) [home](../index.md) '
                  '[remote](https://example.com/a.md)\n'
                  '`[literal](actions.md)`\n```json\n'
                  '{"text":"[data](actions.md)"}\n```\n')
        result = corpus.rebase_links(source, 'api/overview.md')
        for target in ['api/overview/#result', 'api/actions/#click', 'setup/', '']:
            self.assertIn('(https://docs.androperator.com/' + target + ')', result)
        self.assertIn('[remote](https://example.com/a.md)', result)
        self.assertIn('`[literal](actions.md)`', result)
        self.assertIn('{"text":"[data](actions.md)"}', result)
        self.assertEqual(corpus.canonical_reference('image.png', 'api/a.md'),
                         'https://docs.androperator.com/api/image.png')
        self.assertEqual(corpus.canonical_reference('/setup.md?view=all#x', 'api/a.md'),
                         'https://docs.androperator.com/setup/?view=all#x')

    def test_page_boundaries_and_provenance(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary)
            (path / 'index.md').write_text('# Home\n[Setup](setup.md)\n')
            result = corpus.render_llms_full(path, [('__top_level__', [('Home', 'index.md')])],
                                             'Source revision: `test-revision`.')
        self.assertIn('Source revision: `test-revision`.', result)
        self.assertIn('Source: [Home](https://docs.androperator.com/) | `index.md`', result)
        self.assertIn('[Setup](https://docs.androperator.com/setup/)', result)

    def test_all_public_pages_have_index_routes(self):
        nav = corpus.load_nav_entries(ROOT / 'sites/docs/mkdocs.yml')
        index = (ROOT / 'sites/docs/static/llms.txt').read_text()
        for _, pages in nav:
            for _, path in pages:
                self.assertIn(corpus.canonical_page_url(path), index, path)

    def test_complete_execution_examples_validate_without_dispatch(self):
        examples = []
        for page in (ROOT / 'docs').rglob('*.md'):
            if 'internal' in page.parts:
                continue
            for body in re.findall(r'^```json\n(.*?)^```', page.read_text(), re.M | re.S):
                value = json.loads(body)
                if isinstance(value, dict) and all(key in value for key in
                        ['commandId', 'taskId', 'source', 'expectedFormat', 'timeoutMs', 'actions']):
                    examples.append({'page': str(page.relative_to(ROOT)), 'value': value})
        self.assertTrue(examples)
        script = """
import {readFileSync} from 'node:fs';
import {validateExecution,validatePayloadSize} from './apps/node/dist/domain/executions/validateExecution.js';
for (const {page,value} of JSON.parse(readFileSync(0,'utf8'))) {
  try { validatePayloadSize(JSON.stringify(value)); validateExecution(value); }
  catch (error) { console.error(page, error); process.exitCode=1; }
}
"""
        result = subprocess.run(['node', '--input-type=module', '-e', script],
                                input=json.dumps(examples), cwd=ROOT, text=True,
                                capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_json_examples_and_compatibility_relationship(self):
        nav = corpus.load_nav_entries(ROOT / 'sites/docs/mkdocs.yml')
        for _, pages in nav:
            for _, path in pages:
                source = ROOT / 'docs' / path
                if not source.exists():
                    continue  # Generated CLI has no authored JSON examples.
                for kind, body in re.findall(r'^```(json|ndjson)\n(.*?)^```', source.read_text(), re.M | re.S):
                    with self.subTest(page=path, example=body[:60]):
                        if kind == 'ndjson':
                            for line in body.splitlines():
                                if line.strip(): json.loads(line)
                        else:
                            value = json.loads(body)
                            if isinstance(value, dict) and value.get('compatible') is False:
                                version = value['cliVersion']
                                for item in value['remediation']:
                                    for artifact_version in re.findall(r'operator-v([0-9.]+)\.apk', item):
                                        self.assertEqual(version, artifact_version)

if __name__ == '__main__':
    unittest.main()
