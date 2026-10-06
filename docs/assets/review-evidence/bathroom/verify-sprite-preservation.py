"""Prove a candidate atlas preserves every published sprite record and metadata table.

Usage: python docs/assets/review-evidence/bathroom/verify-sprite-preservation.py [BASE] [OUTPUT]

BASE is a Git revision whose committed atlas is the published baseline (default
`origin/main`). The working tree holds the candidate. Every baseline record must
keep its name, logical size, pixel density and decoded RGBA crop, and every
baseline table entry must survive unchanged. OUTPUT (default
`.local-build/sprite-preservation.json`) receives the dated receipt.
"""
import io
import json
import re
import subprocess
import sys
import tomllib
from datetime import date
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
TABLES = ('SPRITE_ANCHORS', 'SPRITE_CONTENT_TOPS', 'SPRITE_CONTENT_BOUNDS', 'SPRITE_PAIRS',
          'SPRITE_PAIR_COVERAGE', 'SPRITE_PAIR_MASKS', 'SPRITE_DINING_SUPPORT', 'INTERACTION_SPRITES',
          'BED_CATALOG', 'BED_LAYERS', 'BED_COVERAGE', 'BED_LAYER_TRIMS',
          'SEATING_SPRITES', 'SEATING_LAYERS', 'SEATING_COVERAGE', 'SEATING_MASKS',
          'RIGGED_SIM_CLIPS', 'RIGGED_SIM_VARIANTS', 'SURFACE_LAYOUTS', 'SPRITE_HAND_ANCHORS',
          'SPRITE_HAND_FOREGROUND')


def committed(revision, path):
    return subprocess.check_output(['git', 'show', f'{revision}:{path}'], cwd=ROOT)


def table(source, name):
    value = re.search(r'export const ' + name + r'[^=]*= (.*?);\r?\n', source, re.S).group(1)
    value = re.sub(r'(?m)^\s*(\d+):', lambda m: '"' + m[1] + '":', value)
    value = re.sub(r',\s*([}\]])', r'\1', value)
    return json.loads(value)


def crop(pages, sprite):
    page = pages[sprite.get('page', 0)]
    return page.crop((sprite['x'], sprite['y'], sprite['x'] + sprite['w'], sprite['y'] + sprite['h'])).tobytes()


def main(base='origin/main', output='.local-build/sprite-preservation.json'):
    old = tomllib.loads(committed(base, 'assets/sprites/atlas.toml').decode())
    new = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())
    if len(new['sprite']) < len(old['sprite']):
        raise AssertionError('candidate atlas dropped records')
    old_pages = [Image.open(io.BytesIO(committed(base, 'web/public/' + p))).convert('RGBA') for p in old['pages']]
    new_pages = [Image.open(ROOT / 'web/public' / p).convert('RGBA') for p in new['pages']]
    for a, b in zip(old['sprite'], new['sprite']):
        for key in ('name', 'w', 'h', 'pixel_density'):
            if a.get(key, 1) != b.get(key, 1):
                raise AssertionError(f'{key} changed for {a["name"]}')
        if crop(old_pages, a) != crop(new_pages, b):
            raise AssertionError(f'decoded pixels changed for {a["name"]}')
    old_ts = committed(base, 'web/src/render/atlas.ts').decode()
    new_ts = (ROOT / 'web/src/render/atlas.ts').read_text()
    for name in TABLES:
        a, b = table(old_ts, name), table(new_ts, name)
        if isinstance(a, dict):
            for key, value in a.items():
                if b.get(key) != value:
                    raise AssertionError(f'{name}[{key}] changed')
        elif a != b:
            raise AssertionError(f'{name} changed')
    base_sha = subprocess.check_output(['git', 'rev-parse', base], cwd=ROOT).decode().strip()
    result = dict(result='passed', date=date.today().isoformat(), base=base_sha, preserved=len(old['sprite']),
                  appended=len(new['sprite']) - len(old['sprite']), preserved_tables=list(TABLES), pages=new['pages'])
    destination = ROOT / output
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + '\n', newline='\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'pages'}, indent=2))


if __name__ == '__main__':
    main(*sys.argv[1:])
