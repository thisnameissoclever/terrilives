"""Append the reviewed bunk composite without changing earlier signed imports."""
import hashlib
import json
import math
from pathlib import Path
import re

from PIL import Image, ImageChops
from offline_furniture import FurnitureExport
from offline_props import inside

FACINGS = ('SE','NW','SW','NE')
VARIANTS = ('green','blue','red')
RENDER_INPUTS = {
    'bedroom/bunk_batch.py', 'bedroom/render_bunk_contributions.py', 'bedroom/bunk_contact.py',
    'furniture/animation_export.py', 'furniture/build_parts.py', 'furniture/geometry.py', 'furniture/preview.py',
    'sims/sim-01/sim-01-rigged.blend', 'sims/sim-01/registered-canvas-proof.json',
    'sims/sim-01/render_shirt_variants.py', 'sims/sim-01/shirt_colors.py', 'sims/sim-01/render_job.py',
    'sims/sim-01/build_rig.py', 'sims/sim-01/rig_math.py', 'sims/sim-01/food_depth.py',
}


def contact_bounds(value):
    if (not isinstance(value, list) or len(value) != 2
            or any(not isinstance(row, list) or len(row) != 3 for row in value)
            or any(type(v) not in (int, float) or not math.isfinite(v) for row in value for v in row)
            or any(value[0][axis] > value[1][axis] for axis in range(3))):
        raise ValueError('invalid bunk contact bounds')
    return value


def validate_contacts(samples):
    structure = {f'Post {x} {y}' for x in (-.43, .43) for y in (-.925, .925)}
    for level in ('Lower', 'Upper'):
        structure.update(f'{level} side rail {x}' for x in (-.425, .425))
        structure.update(f'{level} end rail {y}' for y in (-.925, .925))
        structure.add(f'{level} platform')
    structure.update(('Upper rear guard', 'Upper access guard', 'Upper access upright'))
    structure.update(f'Upper end guard {y}' for y in (-.925, .925))
    structure.update(f'Ladder upright {y}' for y in (-.82, -.43))
    structure.update(f'Ladder rung {z}' for z in (.24, .54, .84, 1.14, 1.44))
    obstacles = structure | {'Upper mattress', 'Upper pillow', 'Upper duvet', 'Upper duvet fold'}
    supports = {'Overshirt body', 'Fitted rounded shoe sole',
                'Fitted rounded shoe sole.001', 'head_to_pillow'}
    if not isinstance(samples, list) or len(samples) != 4:
        raise ValueError('incomplete bunk contact samples')
    frames = set()
    for row in samples:
        if (not isinstance(row, dict) or type(row.get('frame')) is not int
                or row['frame'] in frames):
            raise ValueError('duplicate or invalid bunk contact frame')
        frames.add(row['frame'])
        for field, expected in (('structural_inventory', structure), ('obstacles', obstacles)):
            values = row.get(field)
            if (not isinstance(values, list) or len(values) != len(expected)
                    or any(not isinstance(v, str) for v in values) or set(values) != expected):
                raise ValueError('bunk contact inventory changed')
        if (row.get('excluded_visible_geometry') != []
                or row.get('body_obstacle_overlap_candidates') != []):
            raise ValueError('bunk contact excludes geometry or intersects an obstacle')
        low, high = contact_bounds(row.get('bounds'))
        if low[1] < -.90 or high[1] > .90:
            raise ValueError('bunk contact leaves mattress length')
        measurements = row.get('support_samples')
        if not isinstance(measurements, dict) or set(measurements) != supports:
            raise ValueError('incomplete bunk contact supports')
        for support in measurements.values():
            if not isinstance(support, dict):
                raise ValueError('invalid bunk contact support')
            counts = [support.get(key) for key in ('query_count', 'ray_hits', 'contact_count')]
            gap = support.get('min_gap')
            if (any(type(n) is not int for n in counts)
                    or not counts[0] >= counts[1] >= counts[2] >= 3
                    or type(gap) not in (int, float) or not math.isfinite(gap)
                    or not -.025 <= gap <= .01):
                raise ValueError('invalid bunk contact support measurement')
            low, high = contact_bounds(support.get('contact_bounds'))
            if high[0]-low[0] < .03 or high[1]-low[1] < .003:
                raise ValueError('bunk contact collapses to a point or line')
    if frames != {1, 2, 3, 4}:
        raise ValueError('incomplete bunk contact frame coverage')


def validate_comparison(report):
    if report.get('production_export') is not True or report.get('checked_groups') != 48:
        raise ValueError('bunk recombination gate is incomplete')
    rows = report.get('comparisons',[])
    keys = set()
    for row in rows:
        key = (row.get('facing'),row.get('variant'),row.get('frame'))
        if type(key[2]) is not int or key in keys:
            raise ValueError('duplicate or invalid comparison sample')
        keys.add(key)
        for field in ('max_error','p95_error','active_pixels','pixels_above_8'):
            if type(row.get(field)) is not int or row[field] < 0:
                raise ValueError('invalid comparison metric')
        if (row['max_error'] > 64 or row['p95_error'] > 12 or row['active_pixels'] == 0
                or row['p95_error'] > row['max_error'] or row['pixels_above_8'] > row['active_pixels']):
            raise ValueError('bunk recombination exceeds acceptance limits')
    if keys != {(f,v,i) for f in FACINGS for v in VARIANTS for i in range(4)}:
        raise ValueError('incomplete comparison coverage')


def load_reviewed_bunk(catalog_path, *, existing_names=()):
    catalog_path = Path(catalog_path).resolve()
    catalog = json.loads(catalog_path.read_text())
    if catalog.get('review_status') != 'accepted-independent-review':
        raise ValueError('bunk export needs independent review')
    paths, values = {}, {}
    for field in ('manifest','raw_proof','comparison'):
        ref = catalog.get(field,{})
        path = inside(catalog_path.parent,ref.get('path'))
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if sha != ref.get('sha256'):
            raise ValueError(f'reviewed bunk {field} hash changed')
        paths[field] = path
        values[field] = json.loads(path.read_text())
    raw, comparison, manifest = (values[key] for key in ('raw_proof','comparison','manifest'))
    validate_comparison(comparison)
    validate_contacts(raw.get('contact_samples'))
    if (raw.get('state') != 'complete' or raw.get('signature',{}).get('mode') != 'complete'
            or not raw.get('blender_version') or not raw.get('blender_build_hash')):
        raise ValueError('bunk raw render proof is incomplete')
    for item in (comparison,manifest):
        if item.get('raw_proof_sha256') != catalog['raw_proof']['sha256']:
            raise ValueError('bunk raw proof binding changed')
    if comparison.get('manifest_sha256') != catalog['manifest']['sha256']:
        raise ValueError('bunk comparison does not bind this manifest')
    models = catalog_path.parent.parent
    signature = raw['signature']
    inputs = signature.get('inputs',{})
    models_in_signature = {name for name in inputs if name.endswith('/bunk-authoring.blend')}
    if (len(models_in_signature) != 1 or set(inputs) != RENDER_INPUTS | models_in_signature
            or signature.get('source_density') != 8 or signature.get('logical_canvas') != [160,176]
            or signature.get('translation') != [0,-.50151527,0]):
        raise ValueError('bunk render dependency inventory or registration changed')
    for name, sha in inputs.items():
        if hashlib.sha256(inside(models,name).read_bytes()).hexdigest() != sha:
            raise ValueError(f'bunk render dependency changed: {name}')
    for field, name in (('encoder_sha256','bedroom/export_bunk.py'),
                        ('partition_sha256','furniture/layer_partition.py'),
                        ('comparison_sha256','furniture/export_contributions.py')):
        if hashlib.sha256((models/name).read_bytes()).hexdigest() != comparison.get(field):
            raise ValueError('bunk comparison implementation changed')
    found, raw_paths = set(), set()
    for row in raw.get('renders',[]):
        key = (row.get('facing'),row.get('frame'),row.get('variant'),row.get('owner'))
        if type(key[1]) is not int or key in found:
            raise ValueError('duplicate or invalid raw render sample')
        found.add(key)
        raw_path = inside(paths['raw_proof'].parent,row.get('path'))
        if raw_path in raw_paths:
            raise ValueError('duplicate bunk raw path')
        raw_paths.add(raw_path)
        if not isinstance(row.get('sha256'),str) or not re.fullmatch(r'[0-9a-f]{64}',row['sha256']):
            raise ValueError('invalid raw render hash')
    expected = {(f,i,v,o) for f in FACINGS for i in range(4) for v in VARIANTS
                for o in ('beauty','sim','furniture','lines')}
    expected.update((f,0,'green','empty') for f in FACINGS)
    if found != expected:
        raise ValueError('incomplete raw render coverage')
    return load_bunk(paths['manifest'],existing_names=existing_names)


def verify_bunk_generation(catalog_path):
    """Full local acceptance requires originals; atlas import never rerenders them."""
    catalog_path = Path(catalog_path).resolve()
    result = load_reviewed_bunk(catalog_path)
    catalog = json.loads(catalog_path.read_text())
    proof_path = inside(catalog_path.parent,catalog['raw_proof']['path'])
    proof = json.loads(proof_path.read_text())
    for row in proof['renders']:
        path = inside(proof_path.parent,row['path'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('bunk raw image changed after comparison')
        with Image.open(path) as image:
            if image.format != 'PNG' or image.mode != 'RGBA' or image.size != (1280,1408):
                raise ValueError('expected bunk raw RGBA PNG at 1280x1408')
            image.load()
    return result


def empty_name(facing):
    return f"offlineBunk{'' if facing == 'SE' else facing}"


def load_bunk(manifest_path, *, existing_names=()):
    path = Path(manifest_path).resolve()
    data = json.loads(path.read_text(encoding='utf-8'))
    expected = {'version':1, 'width':100, 'height':136, 'pixel_density':2}
    if any(type(data.get(key)) is not int or data[key] != value for key,value in expected.items()):
        raise ValueError('unsupported bunk version or registration')
    if data.get('crop_texels') != [60,40,260,312] or data.get('source_canvas') != [160,176]:
        raise ValueError('bunk crop registration changed')
    anchor = data.get('anchor')
    if not isinstance(anchor,list) or len(anchor) != 2 or any(
        type(value) not in (int,float) or not math.isfinite(value) or abs(value-want) > .002
        for value,want in zip(anchor, (50,124.00044))
    ):
        raise ValueError('bunk anchor registration changed')
    sprites, pairs, profiles, bounds = [], {}, {}, {}
    names, cache, shared = set(existing_names), {}, {}

    def read(ref, contribution):
        if not isinstance(ref,dict):
            raise ValueError('missing bunk image reference')
        for key in ('width','height','pixel_density','anchor'):
            if key in ref and ref[key] != data[key]:
                raise ValueError('image registration differs from manifest')
        image_path = inside(path.parent, ref.get('path'))
        sha = ref.get('sha256')
        if not isinstance(sha,str) or not re.fullmatch(r'[0-9a-f]{64}',sha):
            raise ValueError('invalid bunk image hash')
        if hashlib.sha256(image_path.read_bytes()).hexdigest() != sha:
            raise ValueError('bunk image hash mismatch')
        if sha not in cache:
            with Image.open(image_path) as image:
                if image.format != 'PNG' or image.mode != 'RGBA' or image.size != (200,272):
                    raise ValueError('expected bunk RGBA PNG at 200x272')
                cache[sha] = image.copy()
        image = cache[sha]
        if contribution:
            alpha = image.getchannel('A')
            if any(ImageChops.subtract(image.getchannel(c),alpha).getbbox() for c in ('R','G','B')):
                raise ValueError('bunk contribution must contain premultiplied RGB')
        return image, sha

    def add(name, image):
        if name in names:
            raise ValueError(f'duplicate bunk sprite name: {name}')
        names.add(name)
        sprites.append((name,image,200,272))
        return name

    empty = {}
    for row in data.get('empty',[]):
        facing = row.get('facing')
        if facing in empty:
            raise ValueError('duplicate empty bunk coverage')
        empty[facing] = row
    if set(empty) != set(FACINGS):
        raise ValueError('missing or invalid empty bunk coverage')
    for facing in FACINGS:
        image, _ = read(empty[facing], False)
        if not image.getchannel('A').getbbox():
            raise ValueError('empty bunk must be visible')
        name = add(empty_name(facing),image)
        bounds[name] = [value/2 for value in image.getchannel('A').getbbox()]
        profiles[name] = {'action':9, 'halfCycleTicks':32,
                          'frames':{variant:[] for variant in VARIANTS}}
    frames = {}
    for row in data.get('frames',[]):
        if type(row.get('frame')) is not int:
            raise ValueError('bunk frame sample must be an integer')
        key = (row.get('facing'),row.get('variant'),row['frame'])
        if key in frames:
            raise ValueError('duplicate occupied bunk coverage')
        frames[key] = row
    expected_frames = [(f,v,i) for f in FACINGS for v in VARIANTS for i in range(4)]
    if set(frames) != set(expected_frames):
        raise ValueError('missing or invalid occupied bunk coverage')
    for facing,variant,index in expected_frames:
        row = frames[facing,variant,index]
        image, _ = read(row.get('body'), True)
        box = image.getchannel('A').getbbox()
        if not box:
            raise ValueError('occupied bunk body must be visible')
        name = add(f'offlineBunk{facing}{variant.title()}{index}',image)
        bounds[name] = [value/2 for value in box]
        layers = {}
        for role in ('furniture','outline'):
            image, sha = read(row.get(role), True)
            key = (role,sha)
            if key not in shared:
                shared[key] = add(f'offlineBunk{role.title()}{len(shared)}',image)
            layers[role] = shared[key]
        pairs[name] = layers
        profiles[empty_name(facing)]['frames'][variant].append(name)
    return FurnitureExport(sprites,anchor,pairs,profiles,bounds)
