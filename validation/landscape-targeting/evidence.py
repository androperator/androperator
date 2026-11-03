"""Keep attempted CLI commands and partial output even when their outcome is unknown."""
import json
import subprocess
from pathlib import Path


def run_recorded(command, prefix, cwd):
    prefix = Path(prefix)
    metadata = {'command': command, 'timeoutSeconds': 45, 'timedOut': False, 'returncode': None}
    command_path = prefix.with_suffix('.command.json')
    command_path.write_text(json.dumps(metadata, indent=2) + '\n')
    stdout, stderr = '', ''
    try:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=45)
        stdout, stderr = result.stdout, result.stderr
        metadata['returncode'] = result.returncode
        return result
    except subprocess.TimeoutExpired as error:
        metadata['timedOut'] = True
        stdout, stderr = error.stdout or '', error.stderr or ''
        raise
    finally:
        prefix.with_suffix('.json').write_text(stdout.decode('utf-8', 'replace') if isinstance(stdout, bytes) else stdout)
        prefix.with_suffix('.stderr').write_text(stderr.decode('utf-8', 'replace') if isinstance(stderr, bytes) else stderr)
        command_path.write_text(json.dumps(metadata, indent=2) + '\n')
