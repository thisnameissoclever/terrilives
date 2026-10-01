"""Replay the fixed covered-bed export check in an archive without raw PNGs."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys

from PIL import Image

root = Path(sys.argv[1]).resolve()
base = root / 'assets/models/bedroom'
sys.path.insert(0, str(base))
from double_bed_batch import groups, row_key, expected_keys
from double_bed_receipt import read_terminal


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


raw = base / 'owner-review-pending/double-bed/candidate-03/contributions-01'
export = base / 'export/double-bed-covered'
assert not list(raw.glob('*.png')), 'Archive must not depend on ignored raw PNGs'
proof = read_terminal(raw, process_exited=True)  # Original worker exit was observed.
assert proof['state'] == 'complete' and proof['pilot'] is False
assert len(proof['renders']) == 288
assert {row_key(row) for row in proof['renders']} == expected_keys(False)
assert len({row['path'] for row in proof['renders']}) == 288
for name, expected in proof['signature']['scripts'].items():
    assert digest(base / name) == expected, name
source = base / 'owner-review-pending/double-bed/candidate-02/double-bed-authoring.blend'
assert digest(source) == proof['signature']['source_sha256']
manifest = json.loads((export / 'manifest.json').read_text())
assert digest(export / 'manifest.json') == '0c9b1c854d2a74993b1d3e9fb9297e75c4fa5ca59762daa531c363d57acca2cb'
assert manifest['source_receipt_sha256'] == digest(raw / 'status.json')
assert manifest['encoding'] == 'scene-linear-premultiplied-visible-additive'
assert manifest['pilot'] is False and manifest['static'] is True
assert manifest['pixel_density'] == 2 and [manifest['width'], manifest['height']] == [116, 109]
assert manifest['crop'] == [44, 102, 276, 320]
assert manifest['picking'] == 'visible-owner-fill-alpha'
for name, expected in manifest['export_signature'].items():
    assert digest(base / name) == expected, name
scene_keys = set()
layers, coverage = set(), set()
for scene in manifest['scenes']:
    key = (scene['occupancy'], scene['facing'], *scene['palettes'], scene['sample'])
    assert key not in scene_keys
    scene_keys.add(key)
    assert [body['place'] for body in scene['bodies']] == [i for i in (0, 1) if key[0] & (1 << i)]
    refs = [(scene['furniture'], 'RGBA'), (scene['outline'], 'RGBA')]
    for body in scene['bodies']:
        refs.extend([(body, 'RGBA'), (body['coverage'], 'L')])
    for ref, mode in refs:
        path = PurePosixPath(ref['path'])
        assert not path.is_absolute() and '..' not in path.parts and '\\' not in str(path)
        target = export / path
        assert digest(target) == ref['sha256'], target
        with Image.open(target) as image:
            image.load()
            assert image.mode == mode and image.size == (232, 218), target
            assert hashlib.sha256(image.tobytes()).hexdigest() == ref['pixels_sha256'], target
        (layers if mode == 'RGBA' else coverage).add(str(path))
assert scene_keys == set(groups(False)) and len(scene_keys) == 64
assert len(layers) == 69
report = json.loads((export / 'comparison.json').read_text())
assert {tuple(row['group']) for row in report['comparisons']} == scene_keys
assert all(row['scene']['max_error'] <= 4 and row['scene']['p95_error'] <= 1
           for row in report['comparisons'])
assert report['unique_layers'] == 69 and report['layer_texels'] == 3489744
for path in export.rglob('*.png'):
    with Image.open(path) as image:
        image.load()
print(json.dumps({'verdict': 'PASS', 'scenes': len(scene_keys), 'layers': len(layers),
                  'coverage_masks': len(coverage), 'raw_pngs_required': False}))
