"""Import neutral seat scenes into a separate action-specific catalogue."""
import base64
from dataclasses import dataclass
import hashlib
import itertools
import json
from pathlib import Path
import sys
import tomllib

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'assets/models/seating'))
from seat_export_contract import (MODELS, KINDS, FACINGS, PALETTES, OWNERS, ENCODING, checked_file,
    check_body_ink, check_exported_images, check_identity, check_palettes, digest, index_rows,
    inside, read_batch, read_png)
from export_neutral_seats import check_ink


@dataclass
class NeutralSeatExport:
    manifest: dict
    layers: dict
    masks: dict


def load_neutral_seats(manifest_path):
    path = Path(manifest_path).resolve()
    manifest = json.loads(path.read_text())
    if (manifest.get('version') != 1 or manifest.get('encoding') != ENCODING
            or manifest.get('pixel_density') != 2 or manifest.get('action') != 8
            or manifest.get('halfCycleTicks') != 16
            or manifest.get('comparison_reference') != 'independent-beauty-float-linear-box-display-once'):
        raise ValueError('Unsupported neutral seating export contract')
    source_copy = checked_file(path.parent, manifest['source_receipt'])
    ink_copy = checked_file(path.parent, manifest['ink_receipt'])
    source_path = inside(MODELS, manifest['source_batch'])
    ink_path = inside(MODELS, manifest['ink_batch'])
    if digest(source_path) != digest(source_copy) or digest(ink_path) != digest(ink_copy):
        raise ValueError('Neutral seating retained receipt differs from source')
    proof = read_batch(source_path, process_exited=True)
    _, ink_objects = check_ink(source_path, proof, ink_path)
    dependencies = {'seating/seat_export_contract.py', 'seating/export_neutral_seats.py',
                    'seating/render_neutral_ink.py', 'bedroom/double_bed_linear.py', 'bedroom/double_bed_layers.py'}
    if set(manifest['dependencies']) != dependencies:
        raise ValueError('Missing neutral seating exporter dependencies')
    for name, sha in manifest['dependencies'].items():
        checked_file(MODELS, dict(path=name, sha256=sha))
    objects = manifest['objects']
    if len(objects) != 5 or {obj['kind'] for obj in objects} != set(KINDS):
        raise ValueError('Incomplete or duplicate neutral seating objects')
    sources = {obj['kind']: obj for obj in proof['objects']}
    layers, masks, references = {}, {}, {}
    expected = set(itertools.product(FACINGS, PALETTES, range(4)))
    # Validate every scene identity and reference before decoding any exported image.
    for obj in objects:
        source = sources[obj['kind']]
        check_identity(source, obj)
        if obj['content'] != source['content']:
            raise ValueError('Neutral seat content identity differs')
        index_rows(obj['scenes'], expected, ('facing', 'variant', 'frame'))
        if obj['kind'] == 'ottoman' and obj.get('quarter_turn_symmetry') != ink_objects['ottoman']['quarter_turn_symmetry']:
            raise ValueError('Ottoman quarter-turn proof differs')
        for scene in obj['scenes']:
            metrics = scene['comparison']['scene']
            if not (0 <= metrics['max_error'] <= 6 and 0 <= metrics['p95_error'] <= 2 and metrics['active_pixels'] > 0):
                raise ValueError('Neutral seating comparison exceeds six/two limits')
            if set(scene['layers']) != {'body', 'furniture', 'ink'} or set(scene['coverage']) != {'body', 'furniture', 'ink', 'bodyInk'}:
                raise ValueError('Missing neutral seating body-line ownership')
            for refs in (scene['layers'], scene['coverage']):
                for ref in refs.values():
                    checked_file(path.parent, ref)
                    previous = references.setdefault(ref['path'], ref)
                    if previous != ref:
                        raise ValueError('Conflicting duplicate neutral seating reference')
    decoded_paths = {}
    for obj in objects:
        size = tuple(v * 2 for v in obj['canvas'])
        for scene in obj['scenes']:
            for field, mode, inventory in (('layers', 'RGBA', layers), ('coverage', 'L', masks)):
                decoded = {}
                for role, ref in scene[field].items():
                    key = f'{size[0]}x{size[1]}-{ref["pixels_sha256"]}'
                    path_key = (ref['path'], size, mode)
                    if path_key not in decoded_paths:
                        decoded_paths[path_key] = read_png(path.parent, ref, size, mode)
                    inventory.setdefault(key, decoded_paths[path_key])
                    decoded[role] = key
                scene[field] = decoded
            owner = masks[scene['coverage']['bodyInk']]
            shared = masks[scene['coverage']['ink']]
            if not owner.getbbox() or ImageChops.subtract(owner, shared).getbbox():
                raise ValueError('Invalid body-owned ink coverage')
        for facing, frame in itertools.product(FACINGS, range(4)):
            rows = [row for row in obj['scenes'] if row['facing'] == facing and row['frame'] == frame]
            for field, roles in (('layers', ('furniture', 'ink')), ('coverage', ('body', 'furniture', 'ink', 'bodyInk'))):
                if any(len({row[field][role] for row in rows}) != 1 for role in roles):
                    raise ValueError('Neutral seating palette changes visible ownership')
        source_rows = index_rows(sources[obj['kind']]['renders'], set(itertools.product(FACINGS, PALETTES, range(4), OWNERS)))
        ink_rows = index_rows(ink_objects[obj['kind']]['renders'], set(itertools.product(FACINGS, range(4))), ('facing', 'frame'))
        raw_size = tuple(v * 8 for v in obj['canvas'])
        for facing, frame in itertools.product(FACINGS, range(4)):
            raw_palettes = [{owner: read_png(source_path.parent, source_rows[facing, palette, frame, owner], raw_size)
                            for owner in OWNERS} for palette in PALETTES]
            check_palettes(raw_palettes)
            body_ink = read_png(ink_path.parent, ink_rows[facing, frame], raw_size)
            check_body_ink(raw_palettes[0]['lines'], body_ink)
            for palette, raw in zip(PALETTES, raw_palettes):
                scene = next(row for row in obj['scenes'] if (row['facing'], row['variant'], row['frame']) == (facing, palette, frame))
                measured = check_exported_images(raw, body_ink,
                    {role: layers[key] for role, key in scene['layers'].items()},
                    {role: masks[key] for role, key in scene['coverage'].items()})
                if measured != scene['comparison']:
                    raise ValueError('Neutral seating comparison receipt differs from actual sources')
    return NeutralSeatExport(manifest, layers, masks)


def scene_name(obj, row):
    return f'neutralSeat_{obj["kind"]}_{row["facing"]}_{row["variant"]}_{row["frame"]}'


def records(export):
    result = [('neutralSeatLayer_' + key, image, image.width, image.height)
              for key, image in sorted(export.layers.items())]
    for obj in export.manifest['objects']:
        for row in obj['scenes']:
            image = export.layers[row['layers']['furniture']]
            result.append((scene_name(obj, row), image, image.width, image.height))
    return result


def tables(export, sprites):
    indices = {record[0]: index for index, record in enumerate(sprites)}
    if len(indices) != len(sprites):
        raise ValueError('Duplicate sprite name while importing neutral seats')
    content = {obj['id']: obj['sprite'] for obj in tomllib.loads((ROOT / 'content/objects.toml').read_text())['object']}
    result = {key: {} for key in ('anchors', 'tops', 'bounds', 'density', 'profiles', 'layers', 'coverage')}
    result['masks'] = []
    mask_ids = {}
    for key, mask in sorted(export.masks.items()):
        box = mask.getbbox()
        if box is None:
            raise ValueError('Neutral seating visible owner has empty coverage')
        mask_ids[key] = len(result['masks'])
        result['masks'].append(dict(size=list(mask.size), box=list(box),
                                   values=base64.b64encode(mask.crop(box).tobytes()).decode('ascii')))
    for obj in export.manifest['objects']:
        frames = {f: {v: [] for v in PALETTES} for f in FACINGS}
        for row in sorted(obj['scenes'], key=lambda row: row['frame']):
            name = scene_name(obj, row)
            index = indices[name]
            refs = row['layers']
            layers = [indices['neutralSeatLayer_' + refs[role]] for role in ('furniture', 'body', 'ink')]
            result['layers'][index] = [layers[0], layers[1], -1, layers[2]]
            result['coverage'][index] = [mask_ids[row['coverage'][role]] for role in ('body', 'furniture', 'ink', 'bodyInk')]
            alpha = Image.new('L', export.layers[refs['body']].size)
            for role in ('body', 'furniture', 'ink'):
                alpha = ImageChops.lighter(alpha, export.layers[refs[role]].getchannel('A'))
            box = alpha.getbbox()
            if box is None:
                raise ValueError('Neutral seating scene is empty')
            for sprite_index in [index] + layers:
                result['anchors'][sprite_index] = obj['anchor']
                result['density'][sprite_index] = 2
            result['bounds'][index] = [v / 2 for v in box]
            result['tops'][index] = box[1] / 2
            frames[row['facing']][row['variant']].append(index)
        for facing in FACINGS:
            empty = content[obj['content']] + ('' if facing == 'SE' else facing)
            if empty not in indices:
                raise ValueError('Missing exact empty neutral seat facing: ' + empty)
            profile = dict(action=8, halfCycleTicks=export.manifest['halfCycleTicks'], frames=frames[facing])
            if obj['kind'] == 'ottoman':
                if not 0 <= obj.get('quarter_turn_symmetry', {}).get('max_vertex_distance', float('inf')) <= .00001:
                    raise ValueError('Missing ottoman physical symmetry proof')
                profile['facingFrames'] = {native: frames[label] for label, native in (('SE', 3), ('NW', 4), ('SW', 2), ('NE', 1))}
            result['profiles'][indices[empty]] = profile
    return result
