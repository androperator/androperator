#!/usr/bin/env python3
"""Explicit live debug fixture proof; never runs on an ordinary PR/push."""
import argparse
import json
import shlex
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = 'com.androperator.fixture.media'
OPERATOR = 'com.androperator.operator.dev'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', required=True)
    parser.add_argument('--secure-lock', action='store_true', help='Temporarily set/remove a PIN on a controlled emulator')
    parser.add_argument('--controls', action='store_true', help='Also exercise session ambiguity, ignored control and replacement races')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    evidence = []

    def run(command, *, raw=False, timeout=90):
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f'{command[0]} failed: {result.stdout}\n{result.stderr}')
        return result.stdout if raw else json.loads(result.stdout)

    def adb(*command):
        if command[0] == 'shell':
            command = ('shell', shlex.join(command[1:]))
        return run(['adb', '-s', args.device, *command], raw=True)

    def cli(*command, expected_error=None):
        result = subprocess.run(['node', 'apps/node/dist/cli/index.js', *command, '--device', args.device, '--operator-package', OPERATOR, '--no-daemon'], cwd=ROOT, text=True, capture_output=True, timeout=90)
        value = json.loads(result.stdout)
        evidence.append({'command': list(command), 'exitCode': result.returncode, 'result': value})
        if expected_error is None:
            assert result.returncode == 0, value
        else:
            assert result.returncode != 0 and value.get('envelope', value).get('errorCode') == expected_error, value
        return value

    def payload(result):
        envelope = result.get('envelope', result)
        assert envelope.get('status') == 'success', result
        step = envelope['stepResults'][0]
        assert step['success'], result
        return json.loads(step['data']['payload'])

    def sample():
        return json.loads(adb('shell', 'run-as', PACKAGE, 'cat', 'files/media-proof.json'))

    def control(operation):
        adb('shell', 'am', 'broadcast', '--receiver-foreground', '-n', PACKAGE + '/androperator.operator.debug.MediaProofActivity$Control', '--es', 'operation', operation)

    try:
        adb('shell', 'am', 'force-stop', PACKAGE)
        # Caller must install the matching debug APK and provision permissions first.
        with tempfile.TemporaryDirectory() as folder:
            media = Path(folder) / 'proof.mp4'
            run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(media)], raw=True)
            adb('push', str(media), '/data/local/tmp/media-proof.mp4')
        adb('shell', 'run-as', PACKAGE, 'mkdir', '-p', 'files')
        adb('shell', 'run-as', PACKAGE, 'cp', '/data/local/tmp/media-proof.mp4', 'files/media-proof.mp4')
        adb('shell', 'am', 'start', '-n', PACKAGE + '/androperator.operator.debug.MediaProofActivity')
        time.sleep(2)
        control('resume')
        listed = payload(cli('media', 'list', '--app', PACKAGE))
        session_id = listed['sessions'][0]['mediaSessionId']
        payload(cli('media', 'pause', '--session', session_id, '--wait-timeout-ms', '2000'))
        assert sample()['actualPlaying'] is False
        payload(cli('media', 'play', '--session', session_id, '--wait-timeout-ms', '2000'))
        assert sample()['actualPlaying'] is True
        moving_before = sample()
        observed = payload(cli('media', 'observe', '--session', session_id, '--duration-ms', '2000'))
        moving_after = sample()
        assert observed['newPlayerReportCount'] > 0 and observed['samples'], observed
        assert observed['session']['playerReportSequence'] - observed['initialSession']['playerReportSequence'] == observed['newPlayerReportCount']
        assert observed['endedElapsedMs'] - observed['startedElapsedMs'] >= 2000, observed
        assert observed['session']['playbackType'] == 'local', observed
        assert moving_after['actualPositionMs'] != moving_before['actualPositionMs']
        evidence.append({'boundedObservationActualProgress': {'before': moving_before, 'after': moving_after}})
        # Compare real progression at two speeds before freezing callback reports.
        for operation, expected_speed in [('resume', 1), ('speed-two', 2)]:
            control(operation)
            start = sample()
            time.sleep(1.2)
            end = sample()
            state = payload(cli('media', 'status', '--session', session_id))['session']
            assert state['playbackSpeed'] == expected_speed, state
            assert end['actualPositionMs'] != start['actualPositionMs'], (start, end)
            evidence.append({'speed': expected_speed, 'before': start, 'after': end})
        control('buffering')
        buffered = payload(cli('media', 'status', '--session', session_id))['session']
        time.sleep(1)
        buffered_later = payload(cli('media', 'status', '--session', session_id))['session']
        assert buffered['state'] == 'buffering' and buffered['estimatedPositionMs'] == buffered_later['estimatedPositionMs']
        control('unknown')
        unknown = payload(cli('media', 'status', '--session', session_id))['session']
        assert unknown['reportedPositionMs'] is None and unknown['estimatedPositionMs'] is None, unknown
        control('resume')
        payload(cli('media', 'pause', '--session', session_id, '--wait-timeout-ms', '2000'))
        pauses = sample()['pauseCommands']
        already = payload(cli('media', 'pause', '--session', session_id, '--wait-timeout-ms', '2000'))
        time.sleep(0.2)
        assert already['dispatched'] and already['targetStateObserved'] and sample()['pauseCommands'] == pauses + 1
        payload(cli('media', 'play', '--session', session_id, '--wait-timeout-ms', '2000'))
        control('stall')
        deadline = time.monotonic() + 10
        while sample()['actualPlaying']:
            assert time.monotonic() < deadline, 'Fixture did not acknowledge stall'
            time.sleep(0.1)
        first = payload(cli('media', 'status', '--session', session_id))['session']
        assert first['evidence'] == 'player_report', first
        control('inactive')
        assert payload(cli('media', 'list', '--app', PACKAGE))['total'] == 0
        cli('media', 'status', '--session', session_id, expected_error='MEDIA_SESSION_EXPIRED')
        control('reactivate')
        reactivated = payload(cli('media', 'status', '--session', session_id))['session']
        for key in ['mediaSessionId', 'evidence', 'reportedPositionMs', 'positionUpdatedElapsedMs']:
            assert reactivated[key] == first[key], (first, reactivated)
        actual = sample()
        adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP')
        time.sleep(1)
        before = sample()
        assert before['screenOn'] is False, before
        quiet = payload(cli('media', 'observe', '--session', session_id, '--duration-ms', '1000'))
        assert quiet['newPlayerReportCount'] == 0 and quiet['samples'] == [], quiet
        assert quiet['reportedPositionDeltaMs'] == 0, quiet
        assert quiet['session']['playerReportReceivedElapsedMs'] == quiet['initialSession']['playerReportReceivedElapsedMs']
        assert quiet['session']['estimatedPositionMs'] > quiet['initialSession']['estimatedPositionMs'], quiet
        assert quiet['deviceState']['screenOn'] is False, quiet
        for _ in range(3):
            payload(cli('notifications', 'list', '--app', PACKAGE))
            current = payload(cli('media', 'status', '--session', session_id))['session']
            assert current['reportedPositionMs'] == first['reportedPositionMs']
            assert current['positionUpdatedElapsedMs'] == first['positionUpdatedElapsedMs']
            assert current['positionUpdateAgeMs'] >= first['positionUpdateAgeMs']
            time.sleep(4)
        after = sample()
        assert after['screenOn'] is False and after['screenOnEvents'] == before['screenOnEvents'], (before, after)
        assert after['actualPositionMs'] == actual['actualPositionMs'], (actual, after)
        evidence.append({'independentFixtureBefore': before, 'independentFixtureAfter': after})
        control('unpublished-play')
        moving_before = sample()
        time.sleep(1.2)
        moving_after = sample()
        unchanged = payload(cli('media', 'status', '--session', session_id))['session']
        assert moving_after['actualPlaying'] and moving_after['actualPositionMs'] != moving_before['actualPositionMs']
        assert unchanged['positionUpdatedElapsedMs'] == first['positionUpdatedElapsedMs']
        evidence.append({'unchangedReportWithActualProgress': {'before': moving_before, 'after': moving_after}})
        run(['node', 'validation/notifications-media/http-helper-observe.mjs', args.device, session_id, str(args.output / 'http-helper.json')], raw=True)
        if args.secure_lock:
            run(['python3', 'validation/notifications-media/lock-matrix.py', '--device', args.device, '--session', session_id, '--output', str(args.output / 'locked')], raw=True, timeout=180)
            session_id = json.loads((args.output / 'locked' / 'lifecycle.json').read_text())['mediaSessionId']
        if args.controls:
            if args.secure_lock:
                # Locked replacement proof deliberately leaves a controller with no callbacks.
                # Start a fresh fixture only after credential cleanup, outside that proof.
                adb('shell', 'am', 'force-stop', PACKAGE)
                adb('shell', 'am', 'start', '-n', PACKAGE + '/androperator.operator.debug.MediaProofActivity')
                time.sleep(2)
                session_id = payload(cli('media', 'list', '--app', PACKAGE))['sessions'][0]['mediaSessionId']
            control('resume')
            control('second')
            sessions = payload(cli('media', 'list', '--app', PACKAGE))['sessions']
            assert len(sessions) == 2, sessions
            other = next(session['mediaSessionId'] for session in sessions if session['mediaSessionId'] != session_id)
            cli('media', 'status', '--app', PACKAGE, expected_error='MEDIA_SESSION_AMBIGUOUS')
            payload(cli('media', 'status', '--session', other))
            cli('media', 'pause', '--session', other, expected_error='MEDIA_ACTION_UNSUPPORTED')
            control('remove-second')
            cli('media', 'status', '--session', other, expected_error='MEDIA_SESSION_EXPIRED')
            control('ignore')
            ignored = cli('media', 'pause', '--session', session_id, '--wait-timeout-ms', '300', expected_error='MEDIA_POSTCONDITION_TIMEOUT')
            assert ignored['envelope']['stepResults'][0]['data']['dispatched'] == 'true'
            control('replace-on-pause')
            replaced = cli('media', 'pause', '--app', PACKAGE, '--wait-timeout-ms', '2000', expected_error='MEDIA_SESSION_EXPIRED')
            assert replaced['envelope']['stepResults'][0]['data']['dispatched'] == 'true'
            cli('media', 'status', '--session', session_id, expected_error='MEDIA_SESSION_EXPIRED')
    finally:
        (args.output / 'evidence.json').write_text(json.dumps(evidence, indent=2))
    print('Passed controlled pause/play, stale-report and screen-off observation proof.')


if __name__ == '__main__':
    main()
