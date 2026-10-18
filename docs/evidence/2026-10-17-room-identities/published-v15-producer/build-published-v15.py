import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.local-build/p15-a481'
REF = 'a481d7c7be0708c4523d9a156513b6696aaff6f6'
OUT = ROOT / '.superpowers/sdd/2026-10-17-room-identities'
PREFIXES = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'crates',
            'content', 'assets/sprites/atlas.toml', 'web/public/audio/voice']
tree = subprocess.check_output(['git', 'ls-tree', '-rz', REF, '--', *PREFIXES], cwd=ROOT)
entries = []
for row in tree.split(b'\0'):
    if not row:
        continue
    metadata, raw_path = row.split(b'\t', 1)
    mode, kind, oid = metadata.decode().split()
    assert kind == 'blob' and mode in ('100644', '100755')
    path = raw_path.decode('utf-8')
    data = (SOURCE / path).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    assert actual == oid, f'Original source mismatch: {path}'
    entries.append({'path': path, 'git_blob': oid, 'bytes': len(data),
                    'sha256': hashlib.sha256(data).hexdigest()})
manifest_path = OUT / 'published-v15-inputs.json'
manifest_path.write_text(json.dumps({'source': REF, 'files': entries}, indent=2), encoding='utf-8')
versions = {}
for executable in ['rustc', 'cargo', 'wasm-pack']:
    versions[executable] = subprocess.check_output([executable, '--version'], cwd=SOURCE, text=True).strip()
command = ['wasm-pack', 'build', 'crates/terri-wasm', '--target', 'web',
           '--out-dir', '../../web/src/wasm', '--mode', 'no-install', '--', '--locked']
env = os.environ.copy()
env['CARGO_BUILD_JOBS'] = '1'
env['CARGO_TARGET_DIR'] = str(ROOT / '.local-build/p15-target')
receipt_path = OUT / 'published-v15-build.json'
receipt = {'source': REF, 'producer': str(SOURCE), 'command': command,
           'versions': versions, 'input_manifest': str(manifest_path.relative_to(ROOT)),
           'input_count': len(entries), 'target': env['CARGO_TARGET_DIR'],
           'build_jobs': 1, 'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'complete': False, 'source_unchanged': None}
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps({'phase': 'source-verified', 'inputs': len(entries), 'command': command}), flush=True)
start = time.monotonic()
with (OUT / 'published-v15-build.log').open('wb') as log:
    process = subprocess.Popen(command, cwd=SOURCE, env=env, stdout=log, stderr=subprocess.STDOUT)
    receipt['pid'] = process.pid
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    code = process.wait()
changed = []
for entry in entries:
    data = (SOURCE / entry['path']).read_bytes()
    if hashlib.sha256(data).hexdigest() != entry['sha256']:
        changed.append(entry['path'])
receipt.update({'complete': True, 'exit': code, 'elapsed_seconds': round(time.monotonic() - start, 2),
                'source_unchanged': not changed, 'changed_inputs': changed,
                'ended_utc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
if code == 0 and not changed:
    receipt['artifacts'] = []
    for name in ['terri_wasm.js', 'terri_wasm_bg.wasm', 'terri_wasm.d.ts']:
        path = SOURCE / 'web/src/wasm' / name
        data = path.read_bytes()
        receipt['artifacts'].append({'path': str(path.relative_to(ROOT)), 'bytes': len(data),
                                     'sha256': hashlib.sha256(data).hexdigest()})
receipt_path.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps({'phase': 'complete', 'exit': code, 'source_unchanged': not changed,
                  'elapsed_seconds': receipt['elapsed_seconds']}), flush=True)
sys.exit(code if code else (1 if changed else 0))
