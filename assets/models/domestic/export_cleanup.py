"""Validate a complete bake and publish its registered 2x runtime frames."""
import hashlib
import json
from pathlib import Path
from PIL import Image

BASE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    proof = json.loads((BASE / 'cleanup/proof.json').read_text())
    if proof['state'] != 'complete' or proof['completed'] != proof['expected'] or proof['expected'] != 192:
        raise ValueError('Cleanup bake is incomplete')
    if digest(BASE / 'cleanup.blend') != proof['model_sha256']:
        raise ValueError('Cleanup model changed since the bake')
    for variant in ('green', 'blue', 'red'):
        source = BASE / 'cleanup' / variant
        out = BASE / 'export/cleanup' / variant
        out.mkdir(parents=True, exist_ok=True)
        manifest = json.loads((source / 'manifest.json').read_text())
        for row in manifest['frames']:
            path = source / row['path']
            if digest(path) != row['sha256']:
                raise ValueError(f'Cleanup frame changed: {path}')
            clip = manifest['clips'][row['action']]
            image = Image.open(path).convert('RGBA').resize((clip['width']*2, clip['height']*2), Image.Resampling.LANCZOS)
            image.save(out / row['path'])
            row['sha256'] = digest(out / row['path'])
        manifest['pixel_density'] = 2
        (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
