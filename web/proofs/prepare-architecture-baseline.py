"""Materialize exact baseline renderer sources for the isolated overhead proof."""
import hashlib
import json
from pathlib import Path
import subprocess

BASELINE = '22ffd8b6e5f9d03191f521f908a20e1bfc02c70a'
FILES = ('sprites.ts', 'sprites.wgsl', 'atlas.ts', 'device.ts', 'instances.ts', 'iso.ts', 'daylight.ts')
ROOT = Path(__file__).resolve().parents[2]
DESTINATION = Path(__file__).resolve().parent / '.architecture-baseline' / BASELINE


def prepare():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name in FILES:
        source = 'web/src/render/' + name
        data = subprocess.check_output(['git', 'show', BASELINE + ':' + source], cwd=ROOT)
        target = DESTINATION / name
        if target.exists():
            assert target.read_bytes() == data, 'Existing baseline snapshot changed: ' + name
        else:
            target.write_bytes(data)
        hashes[name] = hashlib.sha256(data).hexdigest()
    manifest = {'baseline': BASELINE, 'files': hashes}
    (DESTINATION / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', newline='\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    prepare()
