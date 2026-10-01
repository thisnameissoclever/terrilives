"""Materialize pinned render sources and the current content appearance fixture."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tomllib

BASELINE = '22ffd8b6e5f9d03191f521f908a20e1bfc02c70a'
FILES = ('sprites.ts', 'sprites.wgsl', 'atlas.ts', 'device.ts', 'instances.ts', 'iso.ts', 'daylight.ts',
         'tiles.ts', 'sky.ts', 'edge-walls.ts', 'lighting.ts', 'sprite-anchors.ts', 'sprite-size.ts')
ROOT = Path(__file__).resolve().parents[2]
DESTINATION = Path(__file__).resolve().parent / '.architecture-baseline' / BASELINE
PROFILE = Path(__file__).resolve().parent / 'fixtures' / 'architecture' / 'appearance-profiles.json'


def appearance_profiles(source):
    coverings = tomllib.loads(source.decode('utf-8'))['covering']
    assert [row['name'] for row in coverings] == ['Boards', 'Tiles', 'Carpet'], 'Benchmark covering IDs changed'
    looks = [row[key] for row in coverings for key in ('hue', 'strength', 'lightness')]
    return {
        'schema': 1,
        'source': {'path': 'content/lot.toml', 'sha256': hashlib.sha256(source).hexdigest(),
                   'fields': 'covering[].hue,strength,lightness in content order'},
        'coveringNames': [row['name'] for row in coverings],
        'profiles': {
            'shipped-content': {'description': 'Current checked-in covering looks; authored architecture should encode identity shifts.',
                                'coveringLooks': looks},
            'altered-zero-look': {'description': 'Previous benchmark profile: zero hue, strength and lightness for every covering; requests an altered desaturated appearance.',
                                  'coveringLooks': [0.0] * len(looks)},
        },
    }


def prepare_profile(check=False):
    expected = appearance_profiles((ROOT / 'content' / 'lot.toml').read_bytes())
    data = json.dumps(expected, indent=2) + '\n'
    if check:
        assert PROFILE.read_text() == data, 'Appearance profile differs from checked-in content; regenerate before benchmarking'
    else:
        PROFILE.write_text(data, newline='\n')
    print(json.dumps({'appearanceSource': expected['source'], 'checked': check}))


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
    if sys.argv[1:] == ['--check-profile']:
        prepare_profile(check=True)
    else:
        assert not sys.argv[1:], 'Expected no arguments or --check-profile'
        prepare()
        prepare_profile()
