"""Validate complete occupied scenes and publish their additive owned layers."""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent / 'furniture'))
from layer_partition import encode_contribution, reconstruct_layers
from export_contributions import compare_reconstruction, validate_ownership

FACINGS = ('SE', 'SW', 'NW', 'NE')
VARIANTS = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    source = BASE / 'seated-dining'
    proof = json.loads((source / 'proof.json').read_text())
    assert proof['state'] == 'complete' and len(proof['contact_samples']) == 96
    assert digest(BASE / 'seated-dining.blend') == proof['model_sha256']
    for name, sha in proof['inputs'].items():
        assert digest(BASE.parent / name) == sha, f'Seating producer changed: {name}'
    rows = {}
    for row in proof['renders']:
        key = tuple(row[name] for name in ('facing', 'frame', 'variant', 'owner'))
        assert key not in rows, 'Duplicate seating render'
        path = source / row['path']
        assert path.parent.resolve() == source.resolve() and digest(path) == row['sha256']
        rows[key] = path
    expected = {(f, i, v, o) for f in FACINGS for i in range(8) for v in VARIANTS for o in OWNERS}
    assert set(rows) == expected, 'Seating render coverage incomplete'
    meal_source = BASE / 'seated-meal'
    meal_proof = json.loads((meal_source / 'proof.json').read_text())
    assert meal_proof['state'] == 'complete'
    for name, sha in meal_proof['inputs'].items():
        assert digest(BASE / name) == sha, f'Meal producer changed: {name}'
    meal_rows = {}
    for row in meal_proof['renders']:
        key = tuple(row[name] for name in ('facing', 'frame', 'variant', 'owner'))
        path = meal_source / row['path']
        assert key not in meal_rows and path.parent.resolve() == meal_source.resolve()
        assert digest(path) == row['sha256']
        meal_rows[key] = path
    expected_meal = {(f, i, 'green', o) for f in FACINGS for i in range(8)
                     for o in ('meal', 'meal_lines')}
    assert set(meal_rows) == expected_meal, 'Supported meal coverage incomplete'
    output = BASE / 'export/seated-dining'
    output.mkdir(parents=True, exist_ok=True)
    manifest = dict(version=2, width=80, height=112, pixel_density=2, anchor=proof['anchor'],
                    source_proof_sha256=digest(source / 'proof.json'), frames=[], comparisons=[],
                    meal_proof_sha256=digest(meal_source / 'proof.json'),
                    encoder_sha256=digest(Path(__file__)))
    def save(image):
        name = hashlib.sha256(image.tobytes()).hexdigest() + '.png'
        path = output / name
        image.save(path)
        return dict(path=name, sha256=digest(path))
    for facing in FACINGS:
        for frame in range(8):
            palettes = {}
            coverage = None
            for variant in VARIANTS:
                images = {}
                for owner in OWNERS:
                    with Image.open(rows[facing, frame, variant, owner]) as image:
                        assert image.mode == 'RGBA' and image.size == (640, 896)
                        images[owner] = image.copy()
                box = images['beauty'].getchannel('A').getbbox()
                assert box and box[0] > 0 and box[1] > 0 and box[2] < 640 and box[3] < 896, 'Seating scene clipped'
                encoded = {owner: encode_contribution(images[owner], (160, 224)) for owner in ('sim', 'furniture', 'lines')}
                def layer(owner, palette='green'):
                    with Image.open(meal_rows[facing, frame, palette, owner]) as image:
                        assert image.mode == 'RGBA' and image.size == (640, 896)
                        return encode_contribution(image, (160, 224))
                support = reconstruct_layers(layer('meal'), Image.new('RGBA', (160, 224)), layer('meal_lines'))
                meal = Image.new('RGBA', support.size, (255, 255, 255, 0))
                meal.putalpha(support.getchannel('A'))
                meal_box = meal.getchannel('A').getbbox()
                assert meal_box and 0 < meal_box[0] < meal_box[2] < 160 and 0 < meal_box[1] < meal_box[3] < 224
                meal_anchor = [proof['anchor'][0] - meal_box[0] / 2,
                               proof['anchor'][1] - meal_box[1] / 2]
                alpha = encoded['sim'].getchannel('A').tobytes()
                assert coverage is None or alpha == coverage, 'Shirt palette changed body coverage'
                coverage = alpha
                palettes[variant] = encoded
                metrics = compare_reconstruction(images['beauty'], encoded['sim'], encoded['furniture'], encoded['lines'])
                manifest['comparisons'].append(dict(facing=facing, frame=frame, variant=variant, **metrics))
                manifest['frames'].append(dict(facing=facing, frame=frame, variant=variant,
                                               body=save(encoded['sim']), furniture=save(encoded['furniture']),
                                               meal=save(meal.crop(meal_box)), meal_anchor=meal_anchor,
                                               outline=save(encoded['lines']), reference=save(encode_contribution(images['beauty'], (160, 224)))))
            validate_ownership(palettes)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Published complete fitted dining layers and independent scene comparisons.')


if __name__ == '__main__':
    main()
