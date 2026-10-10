"""Shared local and CI test suite definitions. No device work runs by default."""
import argparse
import os
from pathlib import Path
import subprocess
import shlex
import sys

ROOT = Path(__file__).resolve().parent.parent
DEFAULT = ['android', 'node', 'evals', 'validation']


def run_commands(commands, env):
    for command in commands:
        try:
            result = subprocess.run(command, cwd=ROOT, env=env, check=False)
        except OSError as error:
            print(f'Cannot run {command[0]}: {error}', flush=True)
            return False
        if result.returncode:
            print(f'Command failed ({result.returncode}): {shlex.join(command)}', flush=True)
            return False
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', action='append', choices=DEFAULT + ['instrumentation', 'mcp-device'],
                        help='Select a suite; repeat to select several. Default: all off-device suites.')
    parser.add_argument('--device', help='Required serial for explicitly selected device suites.')
    args = parser.parse_args(argv)
    selected = list(dict.fromkeys(args.suite or DEFAULT))
    device_suites = {'instrumentation', 'mcp-device'} & set(selected)
    if device_suites and (not args.device or not args.device.strip()):
        parser.error('Device suites require --device <device_serial>.')
    if args.device is not None and not device_suites:
        parser.error('--device requires an explicitly selected device suite.')
    env = os.environ.copy()
    env['ANDROPERATOR_INSTALL_SKIP_NODE_TESTS'] = '1'
    if args.device:
        env['ANDROID_SERIAL'] = args.device
        env['ANDROPERATOR_SMOKE_DEVICE'] = args.device
    suites = {
        'android': [['./gradlew', 'unitTest']],
        'node': [['npm', '--prefix', 'apps/node', 'test']],
        'evals': [['uv', 'run', '--project', 'evals', '--extra', 'dev', 'pytest', 'evals/harness', '-v']],
        'validation': [
            ['node', '--test', 'validation/agent-loop-latency/benchmark.test.cjs'],
            ['node', '--test', 'validation/persistent-cli/test.cjs'],
            ['node', '--test', 'validation/render-verification/policy.test.cjs'],
            ['node', '--test', 'validation/render-verification/full-resolution-example.test.mjs'],
            ['node', '--test', 'validation/agent-loop-latency/screenshot-scales.test.cjs'],
            ['node', '--test', 'validation/agent-loop-latency/jev-screenshots.test.cjs'],
            ['node', '--test', 'validation/agent-loop-latency/decisions.test.cjs'],
            ['python3', '-m', 'unittest', 'discover', '-s', 'validation/npm-release'],
            ['python3', '-m', 'unittest', 'discover', '-s', 'validation/cloudflare'],
            ['node', 'validation/video-stream-verification/test-video-stream.mjs'],
            ['node', 'validation/skill-temp-files/test-play-store.mjs'],
            ['python3', '-m', 'unittest', 'discover', '-s', 'validation'],
            ['python3', '-m', 'unittest', 'discover', '-s', 'validation/sensitive-hierarchy-access'],
            ['python3', '-m', 'unittest', 'discover', '-s', 'validation/result-transport-reliability'],
            ['python3', '-m', 'unittest', 'discover', '-s', 'validation/foreground-observation'],
            ['bash', 'validation/test_blocked_terms_policy.sh'],
            ['bash', 'validation/install/test_install.sh'],
            ['bash', 'validation/homebrew/test_release_dispatch.sh'],
            *[['bash', str(path.relative_to(ROOT))] for path in sorted(
                (ROOT / 'validation/on-screen-logs').glob('test_*.sh'))],
        ],
        'instrumentation': [['./gradlew', 'connectedDebugAndroidTest', '-Dorg.gradle.parallel=false']],
        'mcp-device': [['node', 'validation/test_mcp_stdio_smoke.mjs']],
    }
    results = {}
    needs_node = set(selected) & {'node', 'validation', 'mcp-device'}
    built = True
    if needs_node:
        print('\n=== node-build ===', flush=True)
        built = run_commands([['npm', '--prefix', 'apps/node', 'run', 'build']], env)
        results['node-build'] = 'PASS' if built else 'FAIL'
    for suite in selected:
        print(f'\n=== {suite} ===', flush=True)
        if suite in needs_node and not built:
            results[suite] = 'BLOCKED (Node build failed)'
        else:
            results[suite] = 'PASS' if run_commands(suites[suite], env) else 'FAIL'
    print('\nTest results:', flush=True)
    for suite, status in results.items():
        print(f'  {suite}: {status}', flush=True)
    return 0 if all(status == 'PASS' for status in results.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
