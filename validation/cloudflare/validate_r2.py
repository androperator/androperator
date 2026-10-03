"""Exercise scoped R2 upload credentials without touching release objects."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import uuid


def validate(env, run=subprocess.run):
    account = env.get('ANDROPERATOR_CLOUDFLARE_ACCOUNT_ID', '')
    bucket = env.get('ANDROPERATOR_CLOUDFLARE_R2_BUCKET', '')
    if not re.fullmatch(r'[0-9a-f]{32}', account):
        raise ValueError('A valid Cloudflare account ID is required.')
    if bucket != 'androperator-downloads':
        raise ValueError('Validation is restricted to androperator-downloads.')
    for name in ('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'):
        if not env.get(name, '').strip():
            raise ValueError(f'{name} is required.')
    key = f'_validation/{uuid.uuid4().hex}.txt'
    print(f'Validation object: {key}', flush=True)
    command = ['aws', '--endpoint-url', f'https://{account}.r2.cloudflarestorage.com',
               's3api']

    def invoke(operation, *arguments):
        result = run(command + [operation, '--bucket', bucket, *arguments],
                     env=env, check=True, capture_output=True, text=True, timeout=60)
        return json.loads(result.stdout or '{}')

    def exists():
        listing = invoke('list-objects-v2', '--prefix', key)
        return any(item['Key'] == key for item in listing.get('Contents', []))

    if exists():
        raise RuntimeError('Validation object already exists; refusing to overwrite it.')
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / 'source.txt'
        downloaded = Path(directory) / 'downloaded.txt'
        source.write_bytes(f'Androperator R2 credential validation: {key}\n'.encode())
        try:
            invoke('put-object', '--key', key, '--body', str(source))
            invoke('get-object', '--key', key, str(downloaded))
            if source.read_bytes() != downloaded.read_bytes():
                raise RuntimeError('Downloaded object does not match the uploaded bytes.')
        finally:
            # Also delete after an ambiguous upload failure, which may have stored the object.
            invoke('delete-object', '--key', key)
            if exists():
                raise RuntimeError('Validation object remains after deletion.')
    print('R2 upload, download comparison, and verified deletion passed.', flush=True)


if __name__ == '__main__':
    validate(os.environ.copy())
