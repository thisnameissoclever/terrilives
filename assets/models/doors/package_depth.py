"""Package linear surface data as lossless RG16 depth and a floor flag."""
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image

BASE = Path(__file__).resolve().parent / 'export'
manifest = json.loads((BASE / 'manifest.json').read_text())
assert len(manifest['records']) == 40
for record in manifest['records']:
    name = record['name']
    depth = np.load(BASE / f'{name}-depth.npy')
    rgba = np.round(np.clip(depth, 0, 1) * 255).astype(np.uint8)
    rgba[:, :, 3] = 255
    Image.fromarray(rgba).save(BASE / f'{name}Depth.png')
    record['sha256'] = {suffix: hashlib.sha256((BASE / f'{name}{suffix}.png').read_bytes()).hexdigest()
                        for suffix in ('', 'Depth')}
(BASE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
