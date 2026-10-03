#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
proof="$script_dir/run_cli_contract_proof.sh"
bash -n "$proof"
"$proof" --help | grep -Fq -- '--device <device_serial>'
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
mkdir "$test_dir/bin"
for arguments in '--device' '--output-dir' '--device example --output-dir relative' '--unknown value' '--device a --device b --output-dir /tmp/example'; do
    # Intentional splitting exercises argument vectors, not shell evaluation.
    if "$proof" $arguments > /dev/null 2>&1; then
        echo "Invalid argument vector accepted: $arguments" >&2
        exit 1
    fi
done
cat > "$test_dir/bin/adb" <<'FAKE'
#!/usr/bin/env python3
import json, os, pathlib, signal, sys
args = sys.argv[1:]
with open(os.environ['FAKE_ADB_LOG'], 'a') as log:
    log.write(' '.join(args) + '\n')
path = pathlib.Path(os.environ['FAKE_ADB_STATE'])
state = json.loads(path.read_text()) if path.exists() else {
    'system.accelerometer_rotation': '1', 'system.user_rotation': '0', 'system.font_scale': '1',
    'secure.enabled_accessibility_services': 'com.androperator.operator.dev/androperator.operator.accessibilityservice.OperatorAccessibilityService',
    'secure.accessibility_enabled': '1'}
if 'settings' in args:
    command, namespace, key, *value = args[args.index('settings') + 1:]
    key = namespace + '.' + key
    if command == 'get': print(state.get(key, 'null'))
    elif command == 'delete': state.pop(key, None)
    elif command == 'put':
        # adb shell drops an empty argument; reproduce the real device failure.
        if not value or not value[0]:
            print('Bad arguments', file=sys.stderr)
            sys.exit(1)
        state[key] = value[0]
    path.write_text(json.dumps(state))
    if os.environ.get('FAKE_MODE') == 'signal-service-disabled' and command == 'delete' and key == 'secure.enabled_accessibility_services':
        with open(os.environ['FAKE_EVENTS'], 'a') as events:
            events.write(json.dumps({'trigger': 'service-disabled', 'state': state}) + '\n')
        os.kill(os.getppid(), signal.SIGTERM)
elif 'input' in args:
    print('SurfaceOrientation: ' + state['system.user_rotation'])
else: print('device')
FAKE
cat > "$test_dir/bin/sleep" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
cat > "$test_dir/bin/fake-cli" <<'FAKE'
#!/usr/bin/env python3
import json, os, pathlib, signal, sys
args = sys.argv[1:]
with open(os.environ['FAKE_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\n')
mode = os.environ.get('FAKE_MODE', '')
state = json.loads(pathlib.Path(os.environ['FAKE_ADB_STATE']).read_text())
if args[:2] == ['on-screen-log', 'clear']:
    with open(os.environ['FAKE_EVENTS'], 'a') as events:
        events.write(json.dumps({'trigger': 'clear', 'state': state}) + '\n')
changed_failure = (mode == 'rotation-failure' and args[0] == 'snapshot' and state['system.user_rotation'] == '1')
changed_failure |= (mode == 'font-failure' and state['system.font_scale'] == '1.5')
if changed_failure:
    with open(os.environ['FAKE_EVENTS'], 'a') as events:
        events.write(json.dumps({'trigger': mode, 'state': state}) + '\n')
    print(json.dumps({'code': 'TEST_FAILURE'}))
    sys.exit(7)
if mode == 'signal' and args[0] == 'snapshot':
    os.kill(os.getppid(), signal.SIGTERM)
if mode == 'broken-json' and args[0] == 'snapshot':
    print('not json')
    sys.exit(0)
if mode == 'failure' and args[0] == 'snapshot':
    print(json.dumps({'error': {'code': 'TEST_FAILURE'}}))
    sys.exit(7)
if mode == 'cleanup-failure' and args[:2] == ['on-screen-log', 'clear']:
    print(json.dumps({'error': {'code': 'TEST_FAILURE'}}))
    sys.exit(9)
invalid = '--edge-offset-dp' in args and args[args.index('--edge-offset-dp') + 1] == '1000'
invalid |= '12px' in args
invalid |= args[:2] == ['on-screen-log', 'set'] and '--text' not in args
invalid |= args[:2] == ['on-screen-log', 'clear'] and '--text' in args
if invalid:
    code = 'ON_SCREEN_LOG_LAYOUT_INVALID' if '--edge-offset-dp' in args else 'USAGE'
    print(json.dumps({'code': code}))
    sys.exit(1)
data = {}
if args[:2] == ['on-screen-log', 'set']:
    data = {'visible': 'true', 'rendered': 'true', 'truncated': 'true' if 'CLI-TRUNCATION' in args[args.index('--text') + 1] else 'false'}
elif args[:2] == ['on-screen-log', 'clear']:
    data = {'visible': 'false'}
elif args[0] == 'screenshot':
    if mode != 'missing-image':
        pathlib.Path(args[args.index('--path') + 1]).write_bytes(b'fake-image')
else:
    previous = [json.loads(line) for line in open(os.environ['FAKE_LOG'])]
    last_set = next((c for c in reversed(previous) if c[:2] == ['on-screen-log', 'set']), [])
    data = {'operator_overlay_visible': 'true' if ('CLI-EXPIRY-NEW' in last_set or 'CLI-ROTATED' in last_set) else 'false'}
print(json.dumps({'envelope': {'status': 'success', 'stepResults': [{'success': True, 'data': data}]}}))
FAKE
chmod +x "$test_dir/bin/"*
export PATH="$test_dir/bin:$PATH"
export ANDROPERATOR_CLI_PROOF_EXECUTABLE="$test_dir/bin/fake-cli"
export FAKE_ADB_STATE="$test_dir/adb-state.json"
export FAKE_ADB_LOG="$test_dir/adb.log"
export FAKE_EVENTS="$test_dir/events.jsonl"
export FAKE_LOG="$test_dir/commands.jsonl"
"$proof" --device example --output-dir "$test_dir/success" > /dev/null
python3 - "$FAKE_LOG" "$test_dir/success/captures.tsv" <<'PY'
import json, sys
commands = [json.loads(line) for line in open(sys.argv[1])]
assert all('--device' in c and c[c.index('--device') + 1] == 'example' for c in commands)
assert all('--operator-package' in c and c[c.index('--operator-package') + 1] == 'com.androperator.operator.dev' for c in commands)
for cycle in range(1, 11):
    index = next(i for i, c in enumerate(commands) if f'CLI-CYCLE-{cycle}-A' in c)
    batch = commands[index:index + 5]
    assert [c[:2] if c[0] == 'on-screen-log' else c[:1] for c in batch] == [
        ['on-screen-log', 'set'], ['screenshot'], ['on-screen-log', 'set'], ['screenshot'], ['on-screen-log', 'clear']]
    assert f'CLI-CYCLE-{cycle}-B' in batch[2]
assert commands[-1][:2] == ['on-screen-log', 'clear']
assert len(open(sys.argv[2]).readlines()) == 31
PY
grep -Fq 'settings delete secure enabled_accessibility_services' "$FAKE_ADB_LOG"
for mode in failure broken-json signal cleanup-failure missing-image signal-service-disabled rotation-failure font-failure; do
    export FAKE_MODE="$mode"
    : > "$FAKE_LOG"
    : > "$FAKE_ADB_LOG"
    : > "$FAKE_EVENTS"
    status=0
    "$proof" --device example --output-dir "$test_dir/$mode" > /dev/null 2>&1 || status=$?
    [[ $status -ne 0 ]] || { echo "Failed to propagate $mode" >&2; exit 1; }
    python3 - "$FAKE_LOG" <<'PY'
import json, sys
commands = [json.loads(line) for line in open(sys.argv[1])]
assert commands[-1][:2] == ['on-screen-log', 'clear'], commands
PY
    python3 - "$FAKE_ADB_STATE" <<'PYRESTORE'
import json, sys
state = json.load(open(sys.argv[1]))
assert state['system.accelerometer_rotation'] == '1'
assert state['system.user_rotation'] == '0'
assert state['system.font_scale'] == '1'
assert state['secure.accessibility_enabled'] == '1'
assert state['secure.enabled_accessibility_services'] == 'com.androperator.operator.dev/androperator.operator.accessibilityservice.OperatorAccessibilityService'
PYRESTORE
    python3 - "$FAKE_EVENTS" "$mode" <<'PYCHANGED'
import json, sys
events = [json.loads(line) for line in open(sys.argv[1])]
mode = sys.argv[2]
component = 'com.androperator.operator.dev/androperator.operator.accessibilityservice.OperatorAccessibilityService'
assert events[-1]['trigger'] == 'clear'
assert events[-1]['state']['secure.enabled_accessibility_services'] == component, 'Clear ran before service restoration'
if mode == 'signal-service-disabled':
    changed = next(event for event in events if event['trigger'] == 'service-disabled')
    assert 'secure.enabled_accessibility_services' not in changed['state']
elif mode == 'rotation-failure':
    changed = next(event for event in events if event['trigger'] == mode)
    assert changed['state']['system.user_rotation'] == '1'
    assert events[-1]['state']['system.user_rotation'] == '0'
elif mode == 'font-failure':
    changed = next(event for event in events if event['trigger'] == mode)
    assert changed['state']['system.font_scale'] == '1.5'
    assert events[-1]['state']['system.font_scale'] == '1'
PYCHANGED
done
echo 'CLI proof harness tests passed (argument parsing, cases, capture ordering, failure propagation, interruption cleanup).'
