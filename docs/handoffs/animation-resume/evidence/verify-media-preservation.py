import hashlib, io, json, re, subprocess, tomllib
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
def previous(path):
    return subprocess.check_output(['git', 'show', 'HEAD:' + path], cwd=root)
old = tomllib.loads(previous('assets/sprites/atlas.toml').decode())
new = tomllib.loads((root / 'assets/sprites/atlas.toml').read_text())
old_pages = [Image.open(io.BytesIO(previous('web/public/' + p))).convert('RGBA') for p in old['pages']]
new_pages = [Image.open(root / 'web/public' / p).convert('RGBA') for p in new['pages']]
for a, b in zip(old['sprite'], new['sprite']):
    for key in ('name', 'w', 'h', 'pixel_density'):
        assert a.get(key, 1) == b.get(key, 1), (key, a['name'])
    crop = lambda pages, s: pages[s.get('page', 0)].crop((s['x'], s['y'], s['x'] + s['w'], s['y'] + s['h'])).tobytes()
    assert crop(old_pages, a) == crop(new_pages, b), a['name']
old_ts = previous('web/src/render/atlas.ts').decode()
new_ts = (root / 'web/src/render/atlas.ts').read_text()
tables = ('SPRITE_ANCHORS', 'SPRITE_CONTENT_TOPS', 'SPRITE_CONTENT_BOUNDS', 'SPRITE_PAIRS',
          'SPRITE_PAIR_COVERAGE', 'SPRITE_PAIR_MASKS', 'SPRITE_DINING_SUPPORT', 'INTERACTION_SPRITES',
          'BED_CATALOG', 'BED_LAYERS', 'BED_COVERAGE', 'BED_LAYER_TRIMS', 'RIGGED_SIM_CLIPS', 'RIGGED_SIM_VARIANTS',
          'SURFACE_LAYOUTS', 'SPRITE_HAND_ANCHORS', 'SPRITE_HAND_FOREGROUND')
def table(source, name):
    value = re.search(r'export const ' + name + r'[^=]*= (.*?);\r?\n', source, re.S).group(1)
    value = re.sub(r'(?m)^\s*(\d+):', lambda m: '"' + m[1] + '":', value)
    value = re.sub(r',\s*([}\]])', r'\1', value)
    return json.loads(value)
for name in tables:
    a, b = table(old_ts, name), table(new_ts, name)
    if isinstance(a, dict):
        for key, value in a.items(): assert b[key] == value, (name, key)
    else: assert a == b, name
result = dict(pass_=True, base=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip(),
              preserved=len(old['sprite']), appended=len(new['sprite']) - len(old['sprite']),
              preserved_tables=list(tables), pages=new['pages'])
(root / 'output/media-preservation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k != 'pages'}, indent=2))
