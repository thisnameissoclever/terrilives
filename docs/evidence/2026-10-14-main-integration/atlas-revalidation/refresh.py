"""Refresh atlas provenance only after exact source-region revalidation."""
from pathlib import Path
import hashlib
import json
import tomllib

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


proof = json.loads((OUT / 'comparison.json').read_text(encoding='utf-8'))
assert proof['status'] == 'PASS'
assert len(proof['sprites']) == proof['dependentSpriteCount'] == 184
assert all(row['equal'] for row in proof['sprites'])
atlas_bytes = (ROOT / 'assets/sprites/atlas.toml').read_bytes()
assert sha(atlas_bytes) == proof['currentAtlasSha256']
atlas = tomllib.loads(atlas_bytes.decode('utf-8'))
for row in proof['companionPages']:
    assert sha((ROOT / row['path']).read_bytes()) == row['expected']

replacements = {
    'web/public/atlas-07ddff9af239320fabb2b8981a021f00b948d165add92fc15422e0c43579f38c.png': 30,
    'web/public/atlas-46baa25eec4ac518023109de3dfc78c019f5342ec44e6f6663287d0883f23d80.png': 34,
}
changes = []
for name in ('fixture-depth', 'aquarium-depth'):
    path = ROOT / 'assets/models/sims/character-repair' / name / 'manifest.json'
    before = path.read_bytes()
    manifest = json.loads(before)
    assert manifest['atlasSha256'] == proof['oldAtlasSha256']
    backup = OUT / (name + '-manifest-before.json')
    assert not backup.exists(), 'Retain the existing receipt; do not overwrite it.'
    backup.write_bytes(before)
    manifest['atlasSha256'] = proof['currentAtlasSha256']
    replaced = []
    if name == 'fixture-depth':
        for old, page in replacements.items():
            old_hash = manifest['coverageSources'].pop(old)
            current = 'web/public/' + atlas['pages'][page]
            current_hash = sha((ROOT / current).read_bytes())
            manifest['coverageSources'][current] = current_hash
            replaced.append(dict(old=old, oldSha256=old_hash, current=current, currentSha256=current_hash))
    path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    changes.append(dict(path=path.relative_to(ROOT).as_posix(), beforeSha256=sha(before),
                        afterSha256=sha(path.read_bytes()), coverageSources=replaced))

for row in proof['companionPages']:
    assert sha((ROOT / row['path']).read_bytes()) == row['expected']
receipt = dict(status='PASS', comparisonSha256=sha((OUT / 'comparison.json').read_bytes()),
               atlasSha256=proof['currentAtlasSha256'], changes=changes,
               companionPagesUnchanged=True)
(OUT / 'refresh.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt))
