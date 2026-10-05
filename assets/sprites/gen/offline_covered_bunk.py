"""Import signed one-place scenes without replacing any released sprite."""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image
from offline_double_bed import _coverage_record

BASE = Path(__file__).resolve().parents[2]/'models/bedroom'
sys.path.insert(0, str(BASE))
from export_covered_bunk_sleep import load_batch

MANIFEST_SHA256 = '0d0e567ff39f8dcb1f85e04161ff536778e74d77e5b9a6f96cc552cc7ba024c4'


def load_covered_bunk(catalog):
    catalog = Path(catalog).resolve()
    config = json.loads(catalog.read_text())
    if config.get('review_status') != 'accepted-independent-review':
        raise ValueError('Covered bunk requires independent review')

    def bound(field):
        ref = config[field]
        path = (catalog.parent/ref['path']).resolve()
        if not path.is_relative_to(catalog.parent) or hashlib.sha256(path.read_bytes()).hexdigest() != ref['sha256']:
            raise ValueError('Covered-bunk bound evidence changed: '+field)
        return path

    path, receipt, report = (bound(name) for name in ('manifest', 'source_receipt', 'comparison'))
    if hashlib.sha256(path.read_bytes()).hexdigest() != MANIFEST_SHA256:
        raise ValueError('Covered-bunk manifest differs from the reviewed export')
    proof, _ = load_batch(receipt.parent, process_exited=True)
    manifest = json.loads(path.read_text())
    if (manifest['source_receipt_sha256'] != hashlib.sha256(receipt.read_bytes()).hexdigest()
            or manifest['pilot'] is not False or manifest['static'] is not True
            or manifest['encoding'] != 'scene-linear-premultiplied-visible-additive'
            or manifest['picking'] != 'visible-owner-fill-alpha' or manifest['pixel_density'] != 2):
        raise ValueError('Covered-bunk export protocol changed')
    for name, expected in manifest['export_signature'].items():
        if hashlib.sha256((BASE/name).read_bytes()).hexdigest() != expected:
            raise ValueError('Covered-bunk export dependency changed: '+name)
    comparisons = json.loads(report.read_text())['comparisons']
    expected = {(mask, facing, color, 'green', 0)
                for facing in ('SE', 'NW', 'SW', 'NE') for mask in (0, 1)
                for color in (('green', 'blue', 'red') if mask else ('green',))}
    if len(comparisons) != 16 or {tuple(row['group']) for row in comparisons} != expected:
        raise ValueError('Covered-bunk comparison coverage is incomplete')
    if any(row['scene']['active_pixels'] <= 0 or row['scene']['max_error'] > 6
           or row['scene']['p95_error'] > 2 for row in comparisons):
        raise ValueError('Covered-bunk reconstruction failed')
    layers, masks, scenes = {}, {}, {}
    size = (manifest['width']*2, manifest['height']*2)

    def decode(ref, mode):
        target = (path.parent/ref['path']).resolve()
        if not target.is_relative_to(path.parent) or hashlib.sha256(target.read_bytes()).hexdigest() != ref['sha256']:
            raise ValueError('Covered-bunk image reference changed')
        with Image.open(target) as source:
            source.load()
            image = source.copy()
        trim = ref.get('trim')
        want = size if trim is None else (trim[2]-trim[0], trim[3]-trim[1])
        if image.mode != mode or image.size != want or hashlib.sha256(image.tobytes()).hexdigest() != ref['pixels_sha256']:
            raise ValueError('Covered-bunk decoded image differs')
        if trim is not None:
            if (len(trim) != 4 or any(type(v) is not int for v in trim)
                    or not 0 <= trim[0] < trim[2] <= size[0] or not 0 <= trim[1] < trim[3] <= size[1]):
                raise ValueError('Covered-bunk trim is outside its scene')
            alpha_box = image.getchannel('A').getbbox()
            if alpha_box is None or alpha_box[0] < 2 or alpha_box[1] < 2 or alpha_box[2] > image.width-2 or alpha_box[3] > image.height-2:
                raise ValueError('Covered-bunk body has no filter border')
        key = (ref['pixels_sha256'], image.width, image.height, tuple(trim or ()))
        return key, image

    for row in manifest['scenes']:
        mask, facing, color, second, sample = row['occupancy'], row['facing'], *row['palettes'], row['sample']
        key = (mask, facing, color, second, sample)
        if key not in expected or key in scenes or len(row['bodies']) != mask:
            raise ValueError('Duplicate or incomplete covered-bunk scene')
        refs = []
        for owner in ('furniture', 'outline'):
            identity, image = decode(row[owner], 'RGBA')
            if mask:
                layers[identity] = image
            refs.append(identity)
        body_key, coverage_key = None, None
        if mask:
            body = row['bodies'][0]
            if body['place'] != 0 or 'trim' not in body:
                raise ValueError('Covered-bunk owner or trim is missing')
            body_key, body_image = decode(body, 'RGBA')
            coverage_key, coverage = decode(body['coverage'], 'L')
            layers[body_key], masks[coverage_key] = body_image, coverage
        scenes[key] = ([refs[0], body_key, None, refs[1]], coverage_key)
    if set(scenes) != expected:
        raise ValueError('Covered-bunk scene inventory is incomplete')
    return manifest, layers, masks, scenes


def records(imported):
    return [(layer_name(key), image, image.width, image.height)
            for key, image in sorted(imported[1].items())] + [
                (f'coveredBunkScene_{key[1]}_{9+3*("green", "blue", "red").index(key[2])}',
                 imported[1][refs[0]], imported[1][refs[0]].width, imported[1][refs[0]].height)
                for key, (refs, _) in sorted(imported[3].items()) if key[0]]


def layer_name(key):
    pixels, width, height, trim = key
    return f'coveredBunkLayer_{pixels}_{width}_{height}_'+('_'.join(map(str, trim)) if trim else 'full')


def append(imported, sprites, anchors, densities, bounds, bed_catalog, bed_layers, bed_coverage):
    manifest, layers, masks, scenes = imported
    indices, trims = {}, {}
    for key, image in sorted(layers.items()):
        index = len(sprites)
        indices[key] = index
        sprites.append((layer_name(key), image, image.width, image.height))
        offset = key[3][:2] if key[3] else (0, 0)
        anchors[index] = [manifest['anchor'][i]-offset[i]/2 for i in range(2)]
        densities[index] = 2
        if key[3]:
            trims[index] = [value/2 for value in offset]
    names = {row[0]: index for index, row in enumerate(sprites)}
    mask_ids = {}
    for key, image in sorted(masks.items()):
        mask_ids[key] = len(bed_coverage)
        bed_coverage.append(_coverage_record(image))
    for key, (refs, owner_key) in sorted(scenes.items()):
        mask, facing, color, _, _ = key
        empty = names['offlineBunk'+('' if facing == 'SE' else facing)]
        if not mask:
            alpha = sprites[empty][1].getchannel('A')
            alpha_id = len(bed_coverage)
            bed_coverage.append(_coverage_record(alpha))
            bed_catalog.setdefault(empty, {})[0] = {'sprite': empty, 'alpha': alpha_id, 'owners': [None, None]}
            continue
        primary = indices[refs[0]]
        image = sprites[primary][1]
        alias = len(sprites)
        scene_key = 9+3*('green', 'blue', 'red').index(color)
        sprites.append((f'coveredBunkScene_{facing}_{scene_key}', image, image.width, image.height))
        anchors[alias], densities[alias] = manifest['anchor'], 2
        terms = [layers[ref].getchannel('A') for ref in refs if ref is not None and not ref[3]]
        body = Image.new('RGBA', image.size)
        trimmed = layers[refs[1]]
        body.paste(trimmed, refs[1][3][:2])
        terms.append(body.getchannel('A'))
        alpha = Image.new('I', image.size)
        alpha.putdata([sum(values) for values in zip(*(term.tobytes() for term in terms))])
        alpha_id = len(bed_coverage)
        bed_coverage.append(_coverage_record(alpha))
        bounds[alias] = [value/2 for value in alpha.getbbox()]
        box = masks[owner_key].getbbox()
        owner = {'coverage': mask_ids[owner_key], 'marker': [(box[0]+box[2])/4-manifest['anchor'][0],
                                                           (box[1]+box[3])/4-manifest['anchor'][1]]}
        bed_catalog.setdefault(empty, {})[scene_key] = {'sprite': alias, 'alpha': alpha_id, 'owners': [owner, None]}
        bed_layers[alias] = [indices[ref] if ref is not None else -1 for ref in refs]
    return trims
