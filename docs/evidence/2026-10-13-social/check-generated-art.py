"""Compare every released sprite and architecture record with this branch."""
import json
from pathlib import Path
import subprocess
import sys
import tomllib

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'assets/sprites/gen'))
from atlas_pixels import AtlasPages

base = '04160fe215fb8238e8b9aaff2f8493e7ff6a20d4'


def previous(path):
    name = Path(path).relative_to(root).as_posix()
    return subprocess.check_output(['git', 'show', f'{base}:{name}'], cwd=root)


manifest = root / 'assets/sprites/atlas.toml'
old = tomllib.loads(previous(manifest).decode())
new = tomllib.loads(manifest.read_text())
assert len(new['sprite']) == len(old['sprite']) + 40
with AtlasPages(root, manifest=old, read_bytes=previous) as before, AtlasPages(root) as after:
    if '--mutate-pixel' in sys.argv:
        row = new['sprite'][0]
        page = after.page(row.get('page', 0))
        point = (row['x'] + row['w'] // 2, row['y'] + row['h'] // 2)
        red, green, blue, alpha = page.getpixel(point)
        page.putpixel(point, ((red + 1) % 256, green, blue, alpha))
    for left, right in zip(old['sprite'], new['sprite']):
        assert {k: v for k, v in left.items() if k not in ('x', 'y', 'page')} == {
            k: v for k, v in right.items() if k not in ('x', 'y', 'page')}, left['name']
        assert before.crop(left).tobytes() == after.crop(right).tobytes(), left['name']


def architecture(text):
    return json.loads(text.split('export const ARCHITECTURE = ', 1)[1].split(' as const;', 1)[0])


path = root / 'web/src/render/architecture-data.ts'
before = architecture(previous(path).decode())
after = architecture(path.read_text())
before['baseSpriteId'] += 40
for row in before['sprites']:
    row['id'] += 40
assert before == after
report = {'base': base, 'historicalSpriteMetadataAndPixelsPreserved': len(old['sprite']),
          'newConversationSprites': 40,
          'architectureChange': 'base and sprite ids shifted by 40 only', 'verdict': 'PASS'}
(Path(__file__).parent / 'generated-metadata.json').write_text(
    json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
