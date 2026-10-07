"""Verify retained producer inputs against the original source and archive hashes."""
import gzip
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[5]
index = json.loads((Path(__file__).parent / 'source-index.json').read_text())
manifest = root / index['sourceManifest']

def digest_file(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

if digest_file(manifest) != index['sourceManifestSHA256']:
    raise ValueError('Retained source manifest changed')
declared = json.loads(manifest.read_text())['inputs']
if len(index['records']) != len(declared) or {row['originalAbsolutePath']: row['originalSHA256'] for row in index['records']} != declared:
    raise ValueError('Source index does not cover exactly the declared input inventory')
for row in index['records']:
    path = (root / row['retained']).resolve()
    if not path.is_relative_to(root) or digest_file(path) != row['retainedSHA256']:
        raise ValueError('Retained source bytes changed: ' + row['original'])
    if row['gzip']:
        with gzip.open(path, 'rb') as restored:
            actual = hashlib.file_digest(restored, 'sha256').hexdigest()
    else:
        actual = digest_file(path)
    if actual != row['originalSHA256']:
        raise ValueError('Original byte round-trip changed: ' + row['original'])
editable = [row for row in index['records'] if row.get('editableFinalScene')]
if len(editable) != 1 or editable[0]['gzip']:
    raise ValueError('The final editable Blender scene must remain a raw file')
print(json.dumps({'pass': True, 'inputs': len(index['records']), 'rerendered': False, 'portableRebuildVerified': False}))
