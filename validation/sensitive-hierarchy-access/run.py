#!/usr/bin/env python3
"""Serialized English Settings capture regression; artifacts are private."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
import zlib

ROOT = Path(__file__).resolve().parents[2]


def envelope(result):
    value = result['envelope']
    assert value['commandId'] and value['taskId'], 'Missing correlation'
    assert value['status'] == 'success', value
    assert value['stepResults'] and all(s['success'] for s in value['stepResults']), value
    return value['stepResults'][0]['data']


def query(result):
    value = json.loads(envelope(result)['query'])
    assert value['schemaVersion'] == 1 and not value['truncated'], value
    assert value['nodes'] and value['returnedCount'] == len(value['nodes']), value
    return value['nodes']


def internet(nodes):
    assert any(n['label'] == 'Internet' for n in nodes), 'Missing Internet heading'
    assert nodes[0]['nodePath'] == '0' and nodes[0]['accessibilityDataSensitive'] is True, 'Root sensitivity must be true'
    assert any((n['resourceId'] or '').startswith('com.android.settings:') for n in nodes), 'Not Settings content'
    wifi = [n for n in nodes if n['resourceId'] == 'com.android.settings:id/switchWidget']
    assert len(wifi) == 1 and wifi[0]['checkable'] is True, 'Missing unique Wi-Fi switch'
    assert any('Wi-Fi' in n['label'] for n in nodes), 'Missing Wi-Fi label'
    return wifi[0]


def parity(nodes, xml):
    wifi = internet(nodes)
    tree = ET.fromstring(xml)
    root = tree.find('node')
    assert root is not None and root.get('package') == 'com.android.settings', 'Wrong XML application root'
    assert root.get('accessibility-data-sensitive') == 'true', 'XML root sensitivity'
    matches = [n for n in tree.iter('node') if n.get('resource-id') == wifi['resourceId']]
    assert len(matches) == 1, 'XML Wi-Fi switch not unique'
    match = matches[0]
    for field in ('checked', 'checkable', 'enabled', 'selected', 'clickable'):
        assert match.get(field) == str(wifi[field]).lower(), f'Wi-Fi {field} mismatch'
    assert match.get('accessibility-data-sensitive') == str(wifi['accessibilityDataSensitive']).lower()
    b = wifi['bounds']
    assert match.get('bounds') == f"[{int(b['left'])},{int(b['top'])}][{int(b['right'])},{int(b['bottom'])}]"
    # Connected-network evidence is conditional on what this screen actually reports.
    for node in nodes:
        if node['label'] == 'Connected':
            assert any(n.get('text') == 'Connected' for n in tree.iter('node')), 'Connected row absent in XML'


def decode_png(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, compressed, header = 8, b'', None
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos+4])[0]
        kind, payload = data[pos+4:pos+8], data[pos+8:pos+8+size]
        assert zlib.crc32(kind + payload) & 0xffffffff == struct.unpack('>I', data[pos+8+size:pos+12+size])[0]
        if kind == b'IHDR':
            header = struct.unpack('>IIBBBBB', payload)
        if kind == b'IDAT':
            compressed += payload
        pos += size + 12
        if kind == b'IEND':
            break
    width, height, depth, color, _, _, interlace = header
    assert width > 0 and height > 0 and depth == 8 and interlace == 0
    channels = {2: 3, 6: 4}[color]
    decoded = zlib.decompress(compressed)
    stride = width * channels + 1
    assert len(decoded) == height * stride and all(decoded[y * stride] <= 4 for y in range(height))


SETTINGS_PACKAGE = 'com.android.settings'
SETTINGS_PROCESSES = ('com.google.android.settings.intelligence', SETTINGS_PACKAGE)


def homepage_at_top(nodes, api='35'):
    """Require the real expanded homepage and its first navigation row on screen."""
    visible = [node for node in nodes if node.get('visibleToUser') is True and node.get('onScreen') is True]
    def unique_id(resource_id):
        return [node for node in visible if node.get('resourceId') == SETTINGS_PACKAGE + ':id/' + resource_id]
    homepage = unique_id('settings_homepage_container')
    content = unique_id('main_content_scrollable_container')
    network = [node for node in visible if node.get('label') == 'Network & internet']
    if len(homepage) != 1 or len(content) != 1 or len(network) != 1:
        return False
    if api == '35':
        return homepage[0].get('scrollable') is True
    # API 36 has a fixed header, not the API-35 collapsing outer scroll scope.
    google = [node for node in visible if node.get('label') == 'Google']
    return len(google) == 1 and len(unique_id('search_action_bar')) == 1


def prepare_settings(run, cli, device, evidence, clock=time.monotonic, sleep=time.sleep, api='35'):
    """Reset known navigation processes once, then verify; never replay failed commands."""
    started = clock()
    deadline = started + 60
    evidence.update(status='running', deadlineSeconds=60, maxObservations=5, observations=0)

    def remaining():
        seconds = deadline - clock()
        assert seconds > 0, 'Settings preparation deadline exhausted (60 seconds)'
        return min(45, seconds)

    def adb(*command):
        return run(['adb', '-s', device, 'shell', *command], timeout=remaining())

    try:
        evidence['initialActivities'] = adb('dumpsys', 'activity', 'activities')
        for package in SETTINGS_PROCESSES:
            adb('am', 'force-stop', package)
        envelope(cli('open', SETTINGS_PACKAGE, process_timeout=remaining()))
        evidence['launchedActivities'] = adb('dumpsys', 'activity', 'activities')
        for attempt in range(5):
            nodes = query(cli('query', '--visibility', 'all', '--limit', '1000',
                              process_timeout=remaining()))
            evidence['observations'] = attempt + 1
            remaining()
            if homepage_at_top(nodes, api):
                evidence.update(status='passed', postcondition='Settings homepage at start; Network & internet visible')
                return
            if attempt < 4:
                sleep(min(0.25, remaining()))
        raise AssertionError('Settings homepage/top selectors unavailable after 5 observations')
    except Exception as error:
        evidence.update(status='failed', error=str(error))
        raise
    finally:
        evidence['elapsedSeconds'] = clock() - started


def internet_destination_ready(nodes):
    """The outgoing Network page also has switchWidget (Airplane mode)."""
    return (any(node.get('resourceId') == 'com.android.settings:id/collapsing_toolbar'
                and node.get('label') == 'Internet' for node in nodes)
            and any(node.get('label') == 'Wi-Fi' for node in nodes)
            and any(node.get('resourceId') == 'com.android.settings:id/switchWidget' for node in nodes))


def prepare_internet(cli, evidence, clock=time.monotonic, sleep=time.sleep):
    """Observe the destination without replaying navigation or retrying failed queries."""
    started = clock()
    deadline = started + 15
    evidence.update(status='running', deadlineSeconds=15, maxObservations=30, observations=0)

    def remaining():
        seconds = deadline - clock()
        assert seconds > 0, 'Internet destination did not become ready within 15 seconds'
        return seconds

    try:
        for attempt in range(30):
            nodes = query(cli('query', '--visibility', 'all', '--limit', '1000',
                              process_timeout=remaining()))
            evidence['observations'] = attempt + 1
            remaining()
            if internet_destination_ready(nodes):
                evidence.update(status='passed', postcondition='Internet toolbar, Wi-Fi row and switch present')
                return
            if attempt < 29:
                sleep(min(0.25, remaining()))
        raise AssertionError('Internet destination unavailable after 30 observations')
    except Exception as error:
        evidence.update(status='failed', error=str(error))
        raise
    finally:
        evidence['elapsedSeconds'] = clock() - started


def record_source(run):
    """Record tracked source relative to HEAD and inventory non-ignored untracked files."""
    run(['git', 'rev-parse', 'HEAD'])
    run(['git', 'diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'])
    run(['git', 'ls-files', '--others', '--exclude-standard', '-z'])


def best_effort(action):
    """Retain secondary failures without replacing the original verdict."""
    try:
        action()
        return {'passed': True}
    except Exception as error:
        return {'passed': False, 'error': str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--operator-package', required=True)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--api', choices=('35', '36'), default='35', help='Expected device API (release gate: 35)')
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    lock = open(Path(tempfile.gettempdir()) / ('androperator-device-' + hashlib.sha256(args.device.encode()).hexdigest() + '.lock'), 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    count = 0
    stage = 'prerequisites'
    internet_preparation = {'status': 'not_started'}
    preparation = {'status': 'not_started', 'device': args.device, 'operatorPackage': args.operator_package, 'expectedApi': args.api}

    def run(command, timeout=45):
        nonlocal count
        count += 1
        name = args.out / f'{count:02d}'
        name.with_suffix('.command.json').write_text(json.dumps(command))
        name.with_suffix('.context.json').write_text(json.dumps({'stage': stage, 'timeoutSeconds': timeout,
            'device': args.device, 'operatorPackage': args.operator_package}))
        try:
            completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            for suffix, output in (('.stdout', error.stdout), ('.stderr', error.stderr)):
                name.with_suffix(suffix).write_text(output.decode(errors='replace') if isinstance(output, bytes) else output or '')
            raise AssertionError(f'Command exceeded {timeout}s; see {name}.command.json/.stdout/.stderr') from error
        except OSError as error:
            name.with_suffix('.stderr').write_text(str(error))
            raise AssertionError(f'Command could not start; see {name}.stderr') from error
        name.with_suffix('.exit.json').write_text(json.dumps({'returncode': completed.returncode}))
        name.with_suffix('.stdout').write_text(completed.stdout)
        name.with_suffix('.stderr').write_text(completed.stderr)
        assert completed.returncode == 0, f'{command[:4]} failed; see {name}.stdout/.stderr'
        return completed.stdout

    def cli(*command, process_timeout=45):
        return json.loads(run(['node', 'apps/node/dist/cli/index.js', *command, '--device', args.device,
                               '--operator-package', args.operator_package, '--no-daemon', '--timeout', '15000'], timeout=process_timeout))

    def wait(text):
        envelope(cli('wait', '--text', text, '--timeout', '15000'))

    try:
        record_source(run)
        run(['node', 'apps/node/dist/cli/index.js', '--version'])
        assert run(['adb', '-s', args.device, 'shell', 'getprop', 'ro.build.version.sdk']).strip() == args.api, f'Expected API {args.api}'
        locale = run(['adb', '-s', args.device, 'shell', 'getprop', 'persist.sys.locale']).strip()
        if not locale:
            locale = run(['adb', '-s', args.device, 'shell', 'getprop', 'ro.product.locale']).strip()
        assert locale.startswith('en'), f'English locale required, got {locale!r}'
        run(['adb', '-s', args.device, 'shell', 'getprop', 'ro.build.fingerprint'])
        run(['adb', '-s', args.device, 'shell', 'dumpsys', 'accessibility'])
        run(['adb', '-s', args.device, 'shell', 'dumpsys', 'package', args.operator_package])
        stage = 'preparation'
        prepare_settings(run, cli, args.device, preparation, api=args.api)
        (args.out / 'preparation.json').write_text(json.dumps(preparation, indent=2))
        stage = 'internet-navigation'
        envelope(cli('scroll-until', 'up', '--text', 'Network & internet', '--click'))
        wait('Internet')
        envelope(cli('click', '--text', 'Internet'))
        stage = 'internet-readiness'
        prepare_internet(cli, internet_preparation)
        (args.out / 'internet-preparation.json').write_text(json.dumps(internet_preparation, indent=2))
        stage = 'internet-capture-parity'
        captures = [query(cli('query', '--visibility', 'all', '--limit', '1000')) for _ in range(3)]
        for nodes in captures:
            internet(nodes)
        execution = {'commandId': 'sensitivity-raw', 'taskId': 'sensitivity-raw', 'source': 'validation',
                     'expectedFormat': 'android-ui-automator', 'timeoutMs': 15000, 'mode': 'direct',
                     'actions': [{'id': 'query', 'type': 'query_ui', 'params': {'visibility': 'all', 'limit': 1000}}]}
        raw = query(cli('exec', json.dumps(execution)))
        mcp_result = json.loads(run(['node', 'validation/sensitive-hierarchy-access/mcp-query.mjs', args.device, args.operator_package]))
        assert not mcp_result.get('isError'), mcp_result
        mcp = json.loads(next(c['text'] for c in mcp_result['content'] if c['type'] == 'text'))
        mcp_nodes = query(mcp)
        # MCP sanitization can omit path-named fields; compare the public state evidence.
        fields = ('resourceId', 'className', 'label', 'bounds', 'checked', 'enabled', 'accessibilityDataSensitive')
        assert [[n.get(f) for f in fields] for n in mcp['query']['nodes']] == [[n.get(f) for f in fields] for n in mcp_nodes], 'MCP parsed metadata differs from raw payload'
        xml = envelope(cli('snapshot'))['text']
        (args.out / 'internet.xml').write_text(xml)
        for nodes in [*captures, raw, mcp_nodes]:
            parity(nodes, xml)
        screenshot = args.out / 'internet.png'
        envelope(cli('screenshot', '--path', str(screenshot)))
        decode_png(screenshot)
        stage = 'display-control'
        envelope(cli('back'))
        envelope(cli('back'))
        envelope(cli('scroll-until', 'down', '--text', 'Display & touch', '--click'))
        wait('Brightness level')
        control = query(cli('query', '--visibility', 'all', '--limit', '1000'))
        assert any(n['label'] == 'Brightness level' for n in control), 'Normal screen control failed'
        assert all('accessibilityDataSensitive' in n for n in control)
        (args.out / 'result.json').write_text(json.dumps({'passed': True, 'queries': 5, 'control': 'Display & touch'}))
    except Exception as error:
        (args.out / 'failure.txt').write_text(str(error))
        (args.out / 'failure.json').write_text(json.dumps({'stage': stage, 'error': str(error)}))
        stage = 'failure-evidence'
        screenshot_result = best_effort(lambda: envelope(cli('screenshot', '--path', str(args.out / 'failure.png'))))
        (args.out / 'failure-screenshot.json').write_text(json.dumps(screenshot_result))
        raise
    finally:
        (args.out / 'internet-preparation.json').write_text(json.dumps(internet_preparation, indent=2))
        (args.out / 'preparation.json').write_text(json.dumps(preparation, indent=2))
        stage = 'cleanup'
        cleanup = best_effort(lambda: envelope(cli('press', 'home')))
        (args.out / 'cleanup.json').write_text(json.dumps(cleanup))
        lock.close()


if __name__ == '__main__':
    main()
