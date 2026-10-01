"""Compare occupied composites and encode the new chair at two texels per pixel."""
import hashlib
import json
import math
from pathlib import Path
import sys

from PIL import Image

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'furniture')]
from armchair_batch import FACINGS, VARIANTS, OWNERS, digest, signature, validate_rows, write_json
from export_contributions import compare_reconstruction, validate_ownership
from layer_partition import encode_contribution

SIZE = (192, 240)


def validate_anchor(anchor):
    if (not isinstance(anchor, list) or len(anchor) != 2
            or any(type(value) not in (int, float) or not math.isfinite(value)
                   or abs(value-want) > .002 for value, want in zip(anchor, (48, 116.00044)))):
        raise ValueError('Armchair camera registration changed')


def read_original(path):
    with Image.open(path) as image:
        if image.format != 'PNG' or image.mode != 'RGBA' or image.size != (768, 960):
            raise ValueError('Expected full-resolution RGBA PNG at 768x960')
        image.load()
        return image.copy()


def load_records(directory):
    proof = json.loads((directory/'raw-proof.json').read_text())
    inputs = proof['signature']['inputs']
    models = [name for name in inputs if name.endswith('/armchair-authoring.blend')]
    if len(models) != 1 or proof['signature'] != signature(BASE.parent/models[0]):
        raise ValueError('Armchair render signature changed')
    validate_rows(proof['renders'], complete=True)
    if (proof.get('state') != 'complete' or not proof.get('blender_version')
            or not proof.get('blender_build_hash')):
        raise ValueError('Armchair render batch is not complete')
    validate_anchor(proof.get('anchor'))
    records = {}
    for row in proof['renders']:
        path = (directory/row['path']).resolve()
        if path.parent != directory.resolve() or digest(path) != row['sha256']:
            raise ValueError('Armchair render path or hash mismatch')
        read_original(path)
        records[row['facing'], row['frame'], row['variant'], row['owner']] = path
    return proof, records


def export(directory, output):
    proof, records = load_records(directory)
    output.mkdir(parents=True, exist_ok=False)
    manifest = {'version': 1, 'pixel_density': 2, 'width': 96, 'height': 120,
                'anchor': proof['anchor'], 'empty': [], 'frames': [],
                'raw_proof_sha256': digest(directory/'raw-proof.json')}

    def save(image, prefix):
        name = hashlib.sha256(image.tobytes()).hexdigest()+'.png'
        path = output/prefix/name
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
        return {'path': path.relative_to(output).as_posix(), 'sha256': digest(path)}

    metrics = []
    for facing in FACINGS:
        image = read_original(records[facing, 0, 'green', 'empty'])
        manifest['empty'].append({'facing': facing,
                                 **save(image.resize(SIZE, Image.Resampling.LANCZOS), 'empty')})
        for frame in range(4):
            palettes, coverage = {}, {}
            for variant in VARIANTS:
                images = {owner: read_original(records[facing, frame, variant, owner]) for owner in OWNERS}
                encoded = {owner: encode_contribution(images[owner], SIZE)
                           for owner in ('sim', 'furniture', 'lines')}
                palettes[variant] = encoded
                for owner, image in encoded.items():
                    alpha = image.getchannel('A').tobytes()
                    if owner in coverage and coverage[owner] != alpha:
                        raise ValueError('Shirt palette changed geometry coverage')
                    coverage[owner] = alpha
                comparison = compare_reconstruction(images['beauty'], encoded['sim'],
                                                    encoded['furniture'], encoded['lines'])
                metrics.append({'facing': facing, 'frame': frame, 'variant': variant, **comparison})
                manifest['frames'].append({'facing': facing, 'frame': frame, 'variant': variant,
                                          'body': save(encoded['sim'], 'layers'),
                                          'furniture': save(encoded['furniture'], 'layers'),
                                          'outline': save(encoded['lines'], 'layers')})
            validate_ownership(palettes)
    assert len(manifest['frames']) == 48 and len(manifest['empty']) == 4
    write_json(output/'manifest.json', manifest)
    report = {'production_export': True, 'checked_groups': len(metrics), 'comparisons': metrics,
              'encoder_sha256': digest(Path(__file__)),
              'partition_sha256': digest(BASE.parent/'furniture/layer_partition.py'),
              'comparison_sha256': digest(BASE.parent/'furniture/export_contributions.py'),
              'raw_proof_sha256': digest(directory/'raw-proof.json'),
              'manifest_sha256': digest(output/'manifest.json')}
    write_json(directory/'export-comparison.json', report)
    print(f'PASS: {len(metrics)} independent occupied comparisons and unchanged palette coverage.')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise ValueError('Pass the complete raw directory and a new export directory')
    export(*map(Path, sys.argv[1:]))
