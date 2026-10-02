"""Compare published sprite identities, decoded pixels and registration."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tomllib

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'assets/sprites/gen'))
from test_lamp_prefix import preserved_table


def main():
    base = sys.argv[1]
    def previous(path):
        return subprocess.check_output(['git', 'show', f'{base}:{path}'], cwd=ROOT)
    before = tomllib.loads(previous('assets/sprites/atlas.toml').decode())['sprite']
    after = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite']
    old_image = Image.open(io.BytesIO(previous('web/public/atlas.png'))).convert('RGBA')
    new_image = Image.open(ROOT/'web/public/atlas.png').convert('RGBA')
    for index, old in enumerate(before):
        new = after[index]
        assert {k: v for k, v in old.items() if k not in ('x', 'y')} == {k: v for k, v in new.items() if k not in ('x', 'y')}, index
        def pixels(image, row):
            return image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes()
        assert pixels(old_image, old) == pixels(new_image, new), old['name']
    old_source = previous('web/src/render/atlas.ts').decode()
    new_source = (ROOT/'web/src/render/atlas.ts').read_text()
    tables = ['SPRITE_ANCHORS', 'SPRITE_CONTENT_TOPS', 'SPRITE_CONTENT_BOUNDS',
              'SPRITE_PAIRS', 'INTERACTION_SPRITES', 'SPRITE_HAND_ANCHORS',
              'SPRITE_HAND_FOREGROUND', 'RIGGED_SIM_CLIPS', 'RIGGED_SIM_VARIANTS',
              'SURFACE_LAYOUTS', 'BED_CATALOG', 'BED_LAYERS']
    checked = []
    for name in tables:
        old = preserved_table(old_source, name, len(before))
        new = preserved_table(new_source, name, len(before))
        assert all(key in new and value == new[key] for key, value in old.items()), name
        checked.append({'name': name, 'preserved_entries': len(old),
                        'additional_entries': sorted(set(new)-set(old))})
    result = {'passed': True, 'base': base, 'preserved_sprites': len(before),
              'atlas_sha256': hashlib.sha256((ROOT/'web/public/atlas.png').read_bytes()).hexdigest(),
              'metadata': checked}
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
