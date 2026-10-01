"""Validate every raw scene and export registered static sleeping contributions."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

from PIL import Image

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent/'furniture'))
from layer_partition import encode_contribution
from double_bed_batch import SCRIPTS, expected_keys, row_key
from double_bed_layers import comparison
from double_bed_linear import encode as encode_linear, reconstruct as reconstruct_linear
from double_bed_receipt import create_json, read_terminal

SIZE = (320, 352)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_batch(directory, *, process_exited):
    proof = read_terminal(directory, process_exited=process_exited)
    if proof['state'] != 'complete' or type(proof.get('pilot')) is not bool:
        raise ValueError('Expected a complete render batch')
    signature = proof['signature']
    if (set(signature['scripts']) != set(SCRIPTS)
            or signature['physical_canvas'] != [1280, 1408]
            or signature['logical_canvas'] != [160, 176] or signature['pixel_density'] != 8
            or signature['static'] is not True or signature['blender_version'] != '4.5.14 LTS'
            or signature['blender_build'] != '62c1db4208e8'):
        raise ValueError('Render signature changed')
    for name, expected in signature['scripts'].items():
        if digest(BASE/name) != expected:
            raise ValueError('Render dependency changed: '+name)
    config = json.loads((BASE/'double-bed-sleep-pose.json').read_text())
    if digest(BASE/config['source_model']) != signature['source_sha256']:
        raise ValueError('Source model changed')
    for field, expected in [('projected_origin', (80, 123.00044)), ('anchor', (80, 144.00044))]:
        values = proof.get(field)
        if (not isinstance(values, list) or len(values) != 2
                or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v-e) > .002
                       for v, e in zip(values, expected))):
            raise ValueError('Registration changed: '+field)
    expected = expected_keys(proof['pilot'])
    expected_scenes = {f'{key[0]}|{key[1]}' for key in expected}
    if (set(proof.get('surface_witnesses', {})) != expected_scenes
            or proof.get('color_management') != {'view': 'Standard', 'look': 'None',
                                                 'exposure': 0, 'gamma': 1, 'display': 'sRGB'}):
        raise ValueError('Missing surface ownership or approved display-transfer evidence')
    records, paths = {}, set()
    for row in proof['renders']:
        if (type(row['occupancy']) is not int or type(row['sample']) is not int
                or not isinstance(row['palettes'], list)):
            raise ValueError('Render key has incorrect field types')
        key = row_key(row)
        name = row['path']
        if key in records or key not in expected or name in paths:
            raise ValueError('Duplicate or unexpected render key/path')
        if not isinstance(name, str) or '/' in name or '\\' in name or ':' in name or name in ('', '.', '..'):
            raise ValueError('Render path leaves the source directory')
        path = directory/name
        if digest(path) != row['sha256']:
            raise ValueError('Raw render bytes changed')
        with Image.open(path) as image:
            image.load()
            if image.mode != 'RGBA' or image.size != (1280, 1408):
                raise ValueError('Raw render format changed')
        records[key], paths = path, paths | {name}
    if set(records) != expected:
        raise ValueError('Incomplete render inventory')
    journal_rows = [json.loads((directory/entry['file']).read_text())
                    for entry in proof['evidence_files'] if entry['file'].endswith('-image-result.json')]
    if journal_rows != proof['renders']:
        raise ValueError('Terminal renders differ from the immutable image journal')
    witness_rows = [json.loads((directory/entry['file']).read_text())
                    for entry in proof['evidence_files'] if entry['file'].endswith('-owner-witnesses.json')]
    witness_map = {row['scene']: row['witnesses'] for row in witness_rows}
    if len(witness_map) != len(witness_rows) or witness_map != proof['surface_witnesses']:
        raise ValueError('Terminal ownership witnesses differ from the immutable journal')
    return proof, records


def check_witnesses(images, witnesses):
    expected = set(images)-{'beauty', 'lines'}
    if not isinstance(witnesses, dict) or set(witnesses) != expected:
        raise ValueError('Missing or unexpected visible owner evidence')
    for owner, rows in witnesses.items():
        if not isinstance(rows, list) or not rows:
            raise ValueError('Missing visible owner evidence')
        for row in rows:
            x, y = row['pixel']
            if not (0 <= x < 1280 and 0 <= y < 1408):
                raise ValueError('Owner witness outside registered canvas')
            own = images[owner].getpixel((x, y))[3]
            others = max((image.getpixel((x, y))[3] for name, image in images.items()
                          if name not in (owner, 'beauty', 'lines')), default=0)
            if own < 200 or others > 30:
                raise ValueError('Rendered owner does not match the visible surface witness: '+owner)


def check_exported_coverage(raw_directory, output, manifest, records):
    for scene in manifest['scenes']:
        group = (scene['occupancy'], scene['facing'], *scene['palettes'], scene['sample'])
        for body in scene['bodies']:
            reference = records[(*group, f"sim{body['place']}")]
            with Image.open(reference) as raw:
                expected = raw.getchannel('A').resize(SIZE, Image.Resampling.BOX).crop(manifest['crop'])
            path = output/body['coverage']['path']
            with Image.open(path) as actual:
                actual.load()
                if (actual.mode != 'L' or actual.size != expected.size
                        or actual.tobytes() != expected.tobytes()
                        or digest(path) != body['coverage']['sha256']):
                    raise ValueError('Exported picking coverage does not match its original visible owner')


def export(directory, output, *, process_exited):
    proof, records = load_batch(directory, process_exited=process_exited)
    output.mkdir(parents=True, exist_ok=False)
    encoded_groups, coverage_groups, metrics, crop = {}, {}, [], None
    for group in sorted({key[:-1] for key in records}):
        images = {}
        for key, path in records.items():
            if key[:-1] == group:
                with Image.open(path) as image:
                    images[key[-1]] = image.copy()
        check_witnesses(images, proof['surface_witnesses']['|'.join(map(str, group[:2]))])
        encoded = {owner: encode_linear(image, SIZE, images['lines'] if owner not in ('beauty', 'lines') else None)
                   for owner, image in images.items()}
        owners = [encoded[name] for name in ('furniture', 'sim0', 'sim1') if name in encoded]
        result = reconstruct_linear(owners+[encoded['lines']])
        reference = reconstruct_linear([encoded['beauty']])
        measured = comparison(encode_contribution(reference, SIZE), encode_contribution(result, SIZE), owners)
        if measured['scene']['max_error'] > 6 or measured['scene']['p95_error'] > 2:
            raise ValueError('Scene-linear quantization exceeds the bounded control result')
        metrics.append({'group': group, **measured})
        result.save(output/('reconstruction-'+'-'.join(map(str, group))+'.png'))
        for name, image in encoded.items():
            if name == 'beauty':
                continue
            bounds = image.getchannel('A').getbbox()
            if bounds:
                crop = bounds if crop is None else (min(crop[0], bounds[0]), min(crop[1], bounds[1]),
                                                    max(crop[2], bounds[2]), max(crop[3], bounds[3]))
        encoded_groups[group] = encoded
        coverage_groups[group] = {name: image.getchannel('A').resize(SIZE, Image.Resampling.BOX)
                                  for name, image in images.items() if name.startswith('sim')}
    crop = [crop[0]//2*2, crop[1]//2*2, (crop[2]+1)//2*2, (crop[3]+1)//2*2]
    manifest = {'version': 1, 'pilot': proof['pilot'], 'static': True, 'pixel_density': 2,
                'encoding': 'scene-linear-premultiplied-visible-additive',
                'source_receipt_sha256': digest(directory/'status.json'),
                'export_signature': {name: digest(BASE/name) for name in
                                     ('export_double_bed_sleep.py', 'double_bed_linear.py', 'double_bed_layers.py')},
                'width': (crop[2]-crop[0])//2, 'height': (crop[3]-crop[1])//2,
                'anchor': [proof['anchor'][0]-crop[0]/2, proof['anchor'][1]-crop[1]/2],
                'crop': crop, 'picking': 'visible-owner-fill-alpha', 'scenes': []}
    hashes, coverage_hashes = set(), set()
    for group, layers in encoded_groups.items():
        refs = {}
        for owner, image in layers.items():
            if owner == 'beauty':
                continue
            cropped = image.crop(crop)
            pixel_hash = hashlib.sha256(cropped.tobytes()).hexdigest()
            filename = pixel_hash+'.png'
            path = output/filename
            if pixel_hash not in hashes:
                cropped.save(path)
                hashes.add(pixel_hash)
            refs[owner] = {'path': filename, 'sha256': digest(path), 'pixels_sha256': pixel_hash}
        mask, facing, first, second, sample = group
        coverage_refs = {}
        for owner, image in coverage_groups[group].items():
            cropped = image.crop(crop)
            pixel_hash = hashlib.sha256(cropped.tobytes()).hexdigest()
            path = output/'coverage'/(pixel_hash+'.png')
            if pixel_hash not in coverage_hashes:
                path.parent.mkdir(exist_ok=True)
                cropped.save(path)
                coverage_hashes.add(pixel_hash)
            coverage_refs[owner] = {'path': path.relative_to(output).as_posix(),
                                    'sha256': digest(path), 'pixels_sha256': pixel_hash}
        manifest['scenes'].append({'occupancy': mask, 'facing': facing, 'palettes': [first, second],
                                   'sample': sample, 'furniture': refs['furniture'], 'outline': refs['lines'],
                                   'bodies': [{'place': i, **refs[f'sim{i}'], 'coverage': coverage_refs[f'sim{i}']}
                                              for i in (0, 1) if mask & (1 << i)]})
    report = {'comparisons': metrics, 'unique_layers': len(hashes),
              'layer_texels': len(hashes)*(crop[2]-crop[0])*(crop[3]-crop[1])}
    check_exported_coverage(directory, output, manifest, records)
    create_json(output/'manifest.json', manifest)
    create_json(output/'comparison.json', report)
    print(json.dumps({'groups': len(metrics), 'crop': crop, 'anchor': manifest['anchor'],
                      'unique_layers': len(hashes), 'layer_texels': report['layer_texels']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--writer-exited', action='store_true')
    args = parser.parse_args()
    export(args.input, args.output, process_exited=args.writer_exited)
