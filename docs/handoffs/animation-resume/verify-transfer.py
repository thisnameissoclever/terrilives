"""Verify the byte inventory and available source dependencies of a handoff."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
INVENTORY = HERE/'inventory.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify():
    inventory = json.loads(INVENTORY.read_text())
    failures = []
    retained = {row['sha256']:ROOT/row['path'] for row in inventory['files']}
    gaps = json.loads((HERE/'historical-gaps.json').read_text())['bindings']
    allowed_gaps = {(row['receipt'], row['path'], row['sha256']) for row in gaps}
    observed_gaps = []
    for row in inventory['files']:
        path = ROOT/row['path']
        if not path.is_file() or digest(path) != row['sha256']:
            failures.append(row['path'])
    models = ROOT/'assets/models'
    receipts = [models/'bathroom/actions/review/toilet/loop-01/proof.json',
                models/'bathroom/actions/review/toilet/ink-01/proof.json']
    receipts.extend((models/'bathroom/actions/review').glob('**/proof.json'))
    bindings = set()
    for receipt in receipts:
        proof = json.loads(receipt.read_text())
        for name, expected in proof.get('inputs', {}).items():
            bindings.add((name, expected))
            candidates = [models/name, receipt.parent/'source'/name,
                          receipt.parent/'source'/Path(name).name]
            if expected in retained:
                candidates.append(retained[expected])
            if not any(path.is_file() and digest(path) == expected for path in candidates):
                key = (receipt.relative_to(ROOT).as_posix(), name, expected)
                if key in allowed_gaps:
                    observed_gaps.append(key)
                else:
                    failures.append('source input in '+str(receipt.relative_to(ROOT))+': '+name)
    if failures:
        raise SystemExit('Transfer validation failed:\n'+'\n'.join(sorted(set(failures))))
    print(json.dumps(dict(files=len(inventory['files']), source_bindings=len(bindings),
                          bytes=sum(row['bytes'] for row in inventory['files']),
                          documented_rejected_source_gaps=len(observed_gaps), result='passed')))


def capture():
    paths = set(subprocess.check_output(['git', 'diff', '--cached', '--name-only', '-z'], cwd=ROOT).decode().split('\0'))
    if INVENTORY.is_file():
        paths.update(row['path'] for row in json.loads(INVENTORY.read_text())['files'])
    rows = []
    with subprocess.Popen(['git', 'cat-file', '--batch'], cwd=ROOT,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE) as reader:
        for name in sorted(filter(None, paths)):
            path = ROOT/name
            if path == INVENTORY or not path.is_file():
                continue
            reader.stdin.write((':'+name+'\n').encode())
            reader.stdin.flush()
            header = reader.stdout.readline().split()
            if len(header) != 3 or header[1] != b'blob':
                raise SystemExit('Missing staged blob: '+name)
            size = int(header[2])
            staged = reader.stdout.read(size)
            if len(staged) != size or reader.stdout.read(1) != b'\n':
                raise SystemExit('Incomplete staged blob: '+name)
            current = path.read_bytes()
            if staged != current:
                raise SystemExit('Staged bytes differ from current file: '+name)
            rows.append(dict(path=name, bytes=len(current), sha256=hashlib.sha256(current).hexdigest()))
        reader.stdin.close()
        if reader.wait() != 0:
            raise SystemExit('Staged byte reader failed')
    INVENTORY.write_text(json.dumps(dict(version=1,
        base='1a138df6438d5e984f6190956b46aaf9a69f4dc9', branch='twcx/bathroom-action-poses',
        files=rows), indent=2)+'\n', newline='\n')
    print('Captured byte inventory for '+str(len(rows))+' files')


if __name__ == '__main__':
    if sys.argv[1:] == ['--capture-staged']:
        capture()
    else:
        verify()
