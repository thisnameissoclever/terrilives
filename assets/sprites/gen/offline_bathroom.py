"""Import fitted bathroom scenes without changing released seating or bed tables."""
import base64
from dataclasses import dataclass
import hashlib
import itertools
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'assets/models/bathroom/actions'))
from bathroom_export_contract import (MODELS, FACINGS, PALETTES, OWNERS, read_loop, validate_render_rows,
    checked_file, read_png, digest)
from export_toilet_loop import ENCODING, read_ink
from seat_export_contract import check_exported_images, check_palettes
from double_bed_linear import reconstruct


@dataclass
class BathroomExport:
    manifest: dict
    layers: dict
    masks: dict


def load_bathroom(manifest_path):
    path = Path(manifest_path).resolve()
    manifest = json.loads(path.read_text())
    if (manifest.get('version') != 1 or manifest.get('encoding') != ENCODING
            or manifest.get('pixel_density') != 2 or manifest.get('action') != 15
            or manifest.get('halfCycleTicks') != 8
            or manifest.get('comparison_reference') != 'independent-beauty-float-linear-box-display-once'):
        raise ValueError('Unsupported bathroom export contract')
    source_copy = checked_file(path.parent, manifest['source_receipt'])
    ink_copy = checked_file(path.parent, manifest['ink_receipt'])
    from seat_export_contract import inside
    source_path, ink_path = [inside(MODELS, manifest[field]) for field in ('source_batch', 'ink_batch')]
    if digest(source_path) != digest(source_copy) or digest(ink_path) != digest(ink_copy):
        raise ValueError('Bathroom retained receipt differs from its original')
    source = read_loop(source_path, process_exited=True)
    _, ink_rows = read_ink(ink_path, source_path, source)
    dependencies = {'bathroom/actions/bathroom_export_contract.py', 'bathroom/actions/export_toilet_loop.py',
                    'bathroom/actions/contact_surface.py', 'seating/seat_export_contract.py',
                    'bedroom/double_bed_linear.py', 'bedroom/double_bed_layers.py',
                    'sims/sim-01/shirt-source-materials.json'}
    if set(manifest['dependencies']) != dependencies:
        raise ValueError('Incomplete bathroom export dependency inventory')
    for name, sha in manifest['dependencies'].items():
        checked_file(MODELS, dict(path=name, sha256=sha))
    objects = manifest['objects']
    if len(objects) != 1 or objects[0]['kind'] != 'toilet' or objects[0]['content'] != 'toilet':
        raise ValueError('Bathroom export fixture identity changed')
    obj = objects[0]
    accepted = json.loads((MODELS/source['accepted_source']['proof_path']).read_text())
    expected_identity = dict(source_sha256=accepted['inputs'][
        'bathroom/owner-review-pending/toilet/candidate-03/toilet-authoring.blend'],
        model_sha256=source['editable_model']['sha256'], canvas=[96, 120],
        anchor=[v/8 for v in source['origin_pixels']], camera_matrix=source['camera_matrix'], ortho_scale=source['ortho_scale'])
    if any(obj.get(key) != value for key, value in expected_identity.items()):
        raise ValueError('Bathroom exported model/camera/anchor identity differs from source')
    expected = set(itertools.product(FACINGS, PALETTES, range(4)))
    scenes, paths = {}, {}
    layers, masks = {}, {}
    for scene in obj['scenes']:
        key = (scene['facing'], scene['variant'], scene['frame'])
        if key not in expected or key in scenes or type(scene['frame']) is not int:
            raise ValueError('Duplicate or unexpected bathroom scene')
        scenes[key] = scene
        for field, mode, inventory in (('layers', 'RGBA', layers), ('coverage', 'L', masks)):
            if set(scene[field]) != ({'body', 'furniture', 'ink'} if field == 'layers' else {'body', 'furniture', 'ink', 'bodyInk'}):
                raise ValueError('Bathroom visible owner inventory is incomplete')
            decoded = {}
            for role, ref in scene[field].items():
                previous = paths.setdefault(ref['path'], ref)
                if previous != ref:
                    raise ValueError('Conflicting bathroom image reference')
                image = read_png(path.parent, ref, (192, 240), mode)
                image_key = '192x240-'+ref['pixels_sha256']
                inventory.setdefault(image_key, image)
                decoded[role] = image_key
            scene[field] = decoded
        retained = read_png(path.parent, scene['reconstruction'], (192, 240))
        actual = reconstruct([layers[scene['layers'][role]] for role in ('furniture', 'body', 'ink')])
        if retained.tobytes() != actual.tobytes():
            raise ValueError('Retained bathroom reconstruction differs from its decoded layers')
        if ImageChops.subtract(masks[scene['coverage']['bodyInk']], masks[scene['coverage']['ink']]).getbbox():
            raise ValueError('Body-owned ink exceeds full scene ink')
    if set(scenes) != expected or len(obj['scenes']) != 48:
        raise ValueError('Missing bathroom scene facing/palette/sample matrix')
    raw_rows = validate_render_rows(source['renders'])
    for facing, frame in itertools.product(FACINGS, range(4)):
        raw_palettes = [{owner:read_png(source_path.parent, raw_rows[facing, variant, frame, owner], (768, 960))
                         for owner in OWNERS} for variant in PALETTES]
        check_palettes(raw_palettes)
        body_ink = read_png(ink_path.parent, ink_rows[facing, 'green', frame, 'body_ink'], (768, 960))
        for variant, raw in zip(PALETTES, raw_palettes):
            scene = scenes[facing, variant, frame]
            measured = check_exported_images(raw, body_ink,
                {role:layers[key] for role, key in scene['layers'].items()},
                {role:masks[key] for role, key in scene['coverage'].items()})
            if measured != scene['comparison']:
                raise ValueError('Bathroom comparison receipt differs from actual original renders')
    return BathroomExport(manifest, layers, masks)


def scene_name(row):
    return f'bathroomToilet_{row["facing"]}_{row["variant"]}_{row["frame"]}'


def records(export):
    result = [('bathroomLayer_'+key, image, image.width, image.height)
              for key, image in sorted(export.layers.items())]
    for obj in export.manifest['objects']:
        for row in obj['scenes']:
            image = export.layers[row['layers']['furniture']]
            result.append((scene_name(row), image, image.width, image.height))
    return result


def tables(export, sprites):
    indices = {row[0]:index for index, row in enumerate(sprites)}
    if len(indices) != len(sprites):
        raise ValueError('Duplicate sprite name while importing bathroom scenes')
    result = {key:{} for key in ('anchors', 'tops', 'bounds', 'density', 'profiles', 'layers', 'coverage')}
    result['masks'] = []
    mask_ids = {}
    for key, mask in sorted(export.masks.items()):
        box = mask.getbbox()
        if box is None:
            raise ValueError('Bathroom visible owner has empty coverage')
        mask_ids[key] = len(result['masks'])
        result['masks'].append(dict(size=list(mask.size), box=list(box),
            values=base64.b64encode(mask.crop(box).tobytes()).decode('ascii')))
    for obj in export.manifest['objects']:
        if obj['kind'] != 'toilet' or obj['content'] != 'toilet':
            raise ValueError('Unsupported bathroom fixture identity')
        frames = {f:{v:[] for v in ('green', 'blue', 'red')} for f in ('SE', 'NW', 'SW', 'NE')}
        for row in sorted(obj['scenes'], key=lambda r:r['frame']):
            index = indices[scene_name(row)]
            refs = row['layers']
            layers = [indices['bathroomLayer_'+refs[role]] for role in ('furniture', 'body', 'ink')]
            result['layers'][index] = [layers[0], layers[1], -1, layers[2]]
            result['coverage'][index] = [mask_ids[row['coverage'][role]] for role in ('body', 'furniture', 'ink', 'bodyInk')]
            alpha = Image.new('L', export.layers[refs['body']].size)
            for role in ('body', 'furniture', 'ink'):
                alpha = ImageChops.lighter(alpha, export.layers[refs[role]].getchannel('A'))
            box = alpha.getbbox()
            body_alpha = ImageChops.lighter(export.masks[row['coverage']['body']], export.masks[row['coverage']['bodyInk']])
            body_box = body_alpha.getbbox()
            if box is None or body_box is None:
                raise ValueError('Bathroom scene or visible body is empty')
            for sprite_index in [index]+layers:
                result['anchors'][sprite_index] = obj['anchor']
                result['density'][sprite_index] = 2
            result['bounds'][index] = [v/2 for v in box]
            result['tops'][index] = body_box[1]/2
            frames[row['facing']][row['variant']].append(index)
        for facing in frames:
            name = 'offlineToilet'+('' if facing == 'SE' else facing)
            if name not in indices:
                raise ValueError('Missing exact empty toilet facing: '+name)
            result['profiles'][indices[name]] = dict(action=15, halfCycleTicks=export.manifest['halfCycleTicks'],
                                                    frames=frames[facing])
    return result
