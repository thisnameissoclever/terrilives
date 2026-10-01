"""Publish immutable progress records and one terminal render receipt."""
import hashlib
import json
import os


def create_json(path, value):
    with path.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(value, indent=2) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


class SnapshotWriter:
    def __init__(self, directory):
        self.directory = directory
        self.sequence = 0
        self.manifest = []

    def publish(self, label, value):
        if not label or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in label):
            raise ValueError('Expected a lowercase evidence label')
        self.sequence += 1
        path = self.directory / f'{self.sequence:06d}-{label}.json'
        create_json(path, value)
        self.manifest.append({'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})

    def finish(self, value):
        if os.name != 'nt':
            raise OSError('Publication requires Windows non-replacing rename semantics')
        pending = self.directory / 'status.pending'
        create_json(pending, dict(value, evidence_files=self.manifest))
        os.rename(pending, self.directory / 'status.json')


def read_terminal(directory, *, process_exited):
    if process_exited is not True:
        raise ValueError('Observe the actual writer process exit before reading the terminal receipt')
    receipt = json.loads((directory / 'status.json').read_text(encoding='utf-8'))
    if receipt.get('state') not in ('complete', 'failed'):
        raise ValueError('Receipt is not terminal')
    seen = set()
    for entry in receipt['evidence_files']:
        name = entry['file']
        if name in seen or '/' in name or '\\' in name or ':' in name or name in ('', '.', '..'):
            raise ValueError('Expected unique leaf evidence filenames')
        seen.add(name)
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('Evidence hash mismatch: ' + name)
    return receipt
