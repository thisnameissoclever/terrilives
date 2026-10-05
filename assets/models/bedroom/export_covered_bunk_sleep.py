"""Export one-place visible contributions from a complete immutable raw batch."""
import hashlib
import json
import math
from pathlib import Path
import sys

from PIL import Image

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent/'furniture'))
from covered_bunk_batch import SCRIPTS, expected_keys
from double_bed_batch import row_key
from double_bed_receipt import read_terminal, create_json
from double_bed_linear import encode, reconstruct
from double_bed_layers import comparison
from export_double_bed_sleep import check_witnesses, check_exported_coverage
from layer_partition import encode_contribution

SIZE = (320, 352)
FIT = BASE/'owner-review-pending/bunk/covered-sleep/source-probe-02/000002-canonical-fit.json'
FIT_SHA256 = '73817fdea1a50b623d1edaf45ad8ccc1233a85f789233413c5a3fbcd93e3920a'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_batch(directory, *, process_exited):
    proof = read_terminal(directory, process_exited=process_exited)
    if proof.get('state') != 'complete' or proof.get('pilot') is not False:
        raise ValueError('Expected a complete covered-bunk batch')
    signature = proof['signature']
    if (set(signature['scripts']) != set(SCRIPTS) or signature['physical_canvas'] != [1280, 1408]
            or signature['logical_canvas'] != [160, 176] or signature['pixel_density'] != 8
            or signature['static'] is not True or signature['blender_version'] != '4.5.14 LTS'
            or signature['blender_build'] != '62c1db4208e8'):
        raise ValueError('Covered-bunk render signature changed')
    for name, expected in signature['scripts'].items():
        if digest(BASE/name) != expected:
            raise ValueError('Frozen render dependency changed: '+name)
    source = BASE/'owner-review-pending/bunk/candidate-03/bunk-authoring.blend'
    if digest(source) != signature['source_sha256']:
        raise ValueError('Covered-bunk source model changed')
    if digest(FIT) != FIT_SHA256:
        raise ValueError('Accepted physical-fit evidence changed')
    expected_fit = json.loads(FIT.read_text())
    if proof.get('contact_samples') != [expected_fit]:
        raise ValueError('Covered-bunk physical fit differs from the accepted source probe')
    for field, expected in (('projected_origin', (80, 123.00044)), ('anchor', (80, 144.00044))):
        values = proof.get(field)
        if (not isinstance(values, list) or len(values) != 2
                or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v-e) > .002
                       for v, e in zip(values, expected))):
            raise ValueError('Covered-bunk registration changed')
    if proof.get('color_management') != {'view': 'Standard', 'look': 'None', 'exposure': 0,
                                        'gamma': 1, 'display': 'sRGB'}:
        raise ValueError('Covered-bunk display transfer changed')
    expected = expected_keys()
    records, paths = {}, set()
    for row in proof['renders']:
        if type(row.get('occupancy')) is not int or type(row.get('sample')) is not int:
            raise ValueError('Invalid covered-bunk key types')
        key, name = row_key(row), row['path']
        if key not in expected or key in records or name in paths:
            raise ValueError('Duplicate or unexpected covered-bunk key/path')
        if not isinstance(name, str) or '/' in name or '\\' in name or ':' in name or name in ('', '.', '..'):
            raise ValueError('Raw path leaves its batch')
        path = directory/name
        if digest(path) != row['sha256']:
            raise ValueError('Covered-bunk raw bytes changed')
        with Image.open(path) as image:
            image.load()
            if image.mode != 'RGBA' or image.size != (1280, 1408):
                raise ValueError('Covered-bunk raw registration or mode changed')
        records[key] = path
        paths.add(name)
    if set(records) != expected:
        raise ValueError('Covered-bunk raw inventory is incomplete')
    rows = [json.loads((directory/entry['file']).read_text()) for entry in proof['evidence_files']
            if entry['file'].endswith('-image-result.json')]
    if rows != proof['renders']:
        raise ValueError('Covered-bunk terminal rows differ from their immutable journal')
    witnesses = [json.loads((directory/entry['file']).read_text()) for entry in proof['evidence_files']
                 if entry['file'].endswith('-owner-witnesses.json')]
    mapping = {row['scene']: row['witnesses'] for row in witnesses}
    if (len(mapping) != len(witnesses) or mapping != proof['surface_witnesses']
            or set(mapping) != {f'{key[0]}|{key[1]}' for key in expected}):
        raise ValueError('Covered-bunk ownership witnesses are incomplete or unbound')
    return proof, records


def trim_body(image):
    """Retain every nonzero texel and two transparent filter-border texels."""
    box = image.getbbox()
    if image.mode != 'RGBA' or box is None:
        raise ValueError('Expected a nonempty registered body layer')
    left, top, right, bottom = box
    if left < 2 or top < 2 or right > image.width-2 or bottom > image.height-2:
        raise ValueError('Body layer lacks its transparent sampling border')
    trim = [left-2, top-2, right+2, bottom+2]
    return image.crop(trim), trim


def export(directory, output, *, process_exited):
    proof, records = load_batch(directory, process_exited=process_exited)
    output.mkdir(parents=True, exist_ok=False)
    layers, coverages, metrics, crop = {}, {}, [], None
    for group in sorted({key[:-1] for key in records}):
        images = {}
        for key, path in records.items():
            if key[:-1] == group:
                with Image.open(path) as image:
                    images[key[-1]] = image.copy()
        check_witnesses(images, proof['surface_witnesses'][f'{group[0]}|{group[1]}'])
        encoded = {owner: encode(image, SIZE, images['lines'] if owner not in ('beauty', 'lines') else None)
                   for owner, image in images.items()}
        owners = [encoded[name] for name in ('furniture', 'sim0') if name in encoded]
        actual = reconstruct(owners+[encoded['lines']])
        reference = reconstruct([encoded['beauty']])
        measured = comparison(encode_contribution(reference, SIZE), encode_contribution(actual, SIZE), owners)
        if measured['scene']['max_error'] > 6 or measured['scene']['p95_error'] > 2:
            raise ValueError('Covered-bunk reconstruction exceeds accepted quantization')
        metrics.append({'group': group, **measured})
        actual.save(output/('reconstruction-'+'-'.join(map(str, group))+'.png'))
        layers[group] = {name: image for name, image in encoded.items() if name != 'beauty'}
        coverages[group] = {name: image.getchannel('A').resize(SIZE, Image.Resampling.BOX)
                            for name, image in images.items() if name.startswith('sim')}
        for image in layers[group].values():
            bounds = image.getchannel('A').getbbox()
            if bounds:
                crop = bounds if crop is None else (min(crop[0], bounds[0]), min(crop[1], bounds[1]),
                                                    max(crop[2], bounds[2]), max(crop[3], bounds[3]))
    crop = [crop[0]//2*2, crop[1]//2*2, (crop[2]+1)//2*2, (crop[3]+1)//2*2]
    manifest = {'version': 1, 'pilot': False, 'static': True, 'pixel_density': 2,
                'encoding': 'scene-linear-premultiplied-visible-additive', 'picking': 'visible-owner-fill-alpha',
                'source_receipt_sha256': digest(directory/'status.json'), 'crop': crop,
                'source_fit_sha256': digest(FIT),
                'export_signature': {name: digest(BASE/name) for name in
                                     ('export_covered_bunk_sleep.py', 'double_bed_linear.py', 'double_bed_layers.py')},
                'width': (crop[2]-crop[0])//2, 'height': (crop[3]-crop[1])//2,
                'anchor': [proof['anchor'][0]-crop[0]/2, proof['anchor'][1]-crop[1]/2], 'scenes': []}
    unique, masks = set(), set()

    def write(image, coverage=False, body=False):
        image = image.crop(crop)
        trim = None
        if body:
            image, trim = trim_body(image)
        pixels = hashlib.sha256(image.tobytes()).hexdigest()
        identity = (pixels, image.width, image.height)
        path = output/('coverage' if coverage else 'layers')/(f'{image.width}x{image.height}-'+pixels+'.png')
        seen = masks if coverage else unique
        if identity not in seen:
            path.parent.mkdir(exist_ok=True)
            image.save(path)
            seen.add(identity)
        ref = {'path': path.relative_to(output).as_posix(), 'sha256': digest(path), 'pixels_sha256': pixels}
        if trim is not None:
            ref['trim'] = trim
        return ref

    for group, images in layers.items():
        mask, facing, first, second, sample = group
        refs = {owner: write(image, body=owner == 'sim0') for owner, image in images.items()}
        bodies = [] if not mask else [{'place': 0, **refs['sim0'], 'coverage': write(coverages[group]['sim0'], True)}]
        manifest['scenes'].append({'occupancy': mask, 'facing': facing, 'palettes': [first, second], 'sample': sample,
                                   'furniture': refs['furniture'], 'outline': refs['lines'], 'bodies': bodies})
    check_exported_coverage(directory, output, manifest, records)
    create_json(output/'manifest.json', manifest)
    create_json(output/'comparison.json', {'comparisons': metrics, 'unique_layers': len(unique),
                                          'unique_masks': len(masks),
                                          'layer_texels': sum(width*height for _, width, height in unique)})
    print(json.dumps({'scenes': len(metrics), 'unique_layers': len(unique), 'crop': crop,
                      'layer_texels': sum(width*height for _, width, height in unique)}))


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[3] != '--writer-exited':
        raise ValueError('Pass raw directory, new export directory and observed --writer-exited')
    export(Path(sys.argv[1]), Path(sys.argv[2]), process_exited=True)
