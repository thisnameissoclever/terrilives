"""Verify occupied composites and encode registered, padding-trimmed sprites."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent/'furniture'))
from export_contributions import compare_reconstruction, validate_ownership
from layer_partition import encode_contribution
from bunk_batch import FACINGS, VARIANTS, OWNERS, digest, signature, validate_rows, write_json

SIZE = (320,352)
# Remove transparent margins only; all owners share this integer texel crop.
CROP = (60,40,260,312)


def cropped_anchor(anchor):
    return [anchor[0]-CROP[0]/2, anchor[1]-CROP[1]/2]


def trim_padding(image):
    if image.size != SIZE:
        raise ValueError('Unexpected registered image dimensions')
    bounds = image.getchannel('A').getbbox()
    if bounds and (bounds[0] < CROP[0] or bounds[1] < CROP[1]
                   or bounds[2] > CROP[2] or bounds[3] > CROP[3]):
        raise ValueError('Padding crop would remove visible pixels')
    return image.crop(CROP)


def export(directory, output, pilot=False):
    proof = json.loads((directory/'raw-proof.json').read_text())
    model_inputs = [name for name in proof['signature']['inputs'] if name.endswith('/bunk-authoring.blend')]
    if len(model_inputs) != 1:
        raise ValueError('Missing or ambiguous authoring model')
    model = BASE.parent/model_inputs[0]
    if proof['signature'] != signature(model, pilot):
        raise ValueError('Render signature changed')
    validate_rows(proof['renders'], pilot, complete=True)
    if proof['state'] != 'complete':
        raise ValueError('Render batch is not complete')
    anchor = proof['anchor']
    if len(anchor) != 2 or any(abs(a-b) > .002 for a,b in zip(anchor, (80,144.00044))):
        raise ValueError('Render camera registration changed')
    records = {}
    for row in proof['renders']:
        path = (directory/row['path']).resolve()
        if path.parent != directory.resolve() or digest(path) != row['sha256']:
            raise ValueError('Render path or hash mismatch')
        with Image.open(path) as image:
            if image.mode != 'RGBA' or image.format != 'PNG' or image.size != (1280,1408):
                raise ValueError('Expected full-resolution RGBA PNG')
        records[row['facing'], row['frame'], row['variant'], row['owner']] = path
    manifest = {'version':1, 'pixel_density':2, 'width':100, 'height':136,
                'anchor':cropped_anchor(anchor), 'source_canvas':[160,176],
                'crop_texels':list(CROP), 'empty':[], 'frames':[],
                'raw_proof_sha256':digest(directory/'raw-proof.json')}
    def save(image, prefix):
        cropped = trim_padding(image)
        name = hashlib.sha256(cropped.tobytes()).hexdigest()+'.png'
        path = output/prefix/name
        path.parent.mkdir(parents=True, exist_ok=True)
        cropped.save(path)
        return {'path':path.relative_to(output).as_posix(), 'sha256':digest(path)}
    metrics = []
    facings, frames = (('SE',), (0,)) if pilot else (FACINGS, range(4))
    for facing in facings:
        if not pilot:
            with Image.open(records[facing,0,'green','empty']) as image:
                manifest['empty'].append({'facing':facing, **save(image.resize(SIZE,Image.Resampling.LANCZOS),'empty')})
        for frame in frames:
            palettes = {}
            coverage = {}
            for variant in VARIANTS:
                images = {}
                for owner in OWNERS:
                    with Image.open(records[facing,frame,variant,owner]) as image:
                        images[owner] = image.copy()
                encoded = {owner:encode_contribution(images[owner],SIZE) for owner in ('sim','furniture','lines')}
                palettes[variant] = encoded
                for owner, image in encoded.items():
                    alpha = image.getchannel('A').tobytes()
                    if owner in coverage and coverage[owner] != alpha:
                        raise ValueError('Palette changed geometry coverage')
                    coverage[owner] = alpha
                    trim_padding(image)
                comparison = compare_reconstruction(images['beauty'],encoded['sim'],encoded['furniture'],encoded['lines'])
                metrics.append({'facing':facing, 'frame':frame, 'variant':variant, **comparison})
                if not pilot:
                    manifest['frames'].append({'facing':facing, 'frame':frame, 'variant':variant,
                        'body':save(encoded['sim'],'layers'), 'furniture':save(encoded['furniture'],'layers'),
                        'outline':save(encoded['lines'],'layers')})
            validate_ownership(palettes)
    report = {'production_export':not pilot, 'checked_groups':len(metrics), 'comparisons':metrics,
              'encoder_sha256':digest(Path(__file__)), 'partition_sha256':digest(BASE.parent/'furniture/layer_partition.py'),
              'comparison_sha256':digest(BASE.parent/'furniture/export_contributions.py')}
    if not pilot:
        assert len(manifest['frames']) == 48 and len(manifest['empty']) == 4
        write_json(output/'manifest.json', manifest)
        report['manifest_sha256'] = digest(output/'manifest.json')
    report['raw_proof_sha256'] = digest(directory/'raw-proof.json')
    write_json(directory/'export-comparison.json', report)
    print(f'PASS: {len(metrics)} independent composite comparisons; production_export={not pilot}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--pilot', action='store_true')
    args = parser.parse_args()
    export(args.input, args.output, args.pilot)
