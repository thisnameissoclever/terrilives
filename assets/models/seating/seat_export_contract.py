"""Validate immutable seating receipts and registered visible contributions."""
import hashlib
import itertools
import json
import math
from pathlib import Path, PurePosixPath
import sys

from PIL import Image, ImageChops, ImageMath

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent
sys.path.insert(0, str(MODELS / 'bedroom'))
from double_bed_linear import ALPHA, LINEAR, display, encode, reconstruct
from double_bed_layers import comparison

FACINGS = ('SE', 'NW', 'SW', 'NE')
PALETTES = ('green', 'blue', 'red')
KINDS = ('dining', 'office', 'sofa', 'ottoman', 'reading')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
ENCODING = 'scene-linear-premultiplied-visible-additive'
IDENTITY = ('source_sha256', 'model_sha256', 'canvas', 'anchor', 'camera_matrix', 'ortho_scale')
SOURCE_DEPENDENCIES = frozenset((
    'bathroom/check_toilet_scene.py', 'bedroom/bunk_contact.py',
    'furniture/animation_export.py', 'furniture/build_parts.py', 'furniture/geometry.py',
    'furniture/preview.py', 'kitchen/check_stove_scene.py', 'living/armchair_contact.py',
    'living/armchair_layout.py', 'living/armchair_support.py', 'seating/neutral_contact.py',
    'seating/neutral_pose.py', 'seating/pose_profiles.py', 'seating/render_neutral_seats.py',
    'sims/sim-01/build_rig.py', 'sims/sim-01/food_depth.py', 'sims/sim-01/render_job.py',
    'sims/sim-01/render_shirt_variants.py', 'sims/sim-01/rig_math.py', 'sims/sim-01/shirt_colors.py',
    'dining/owner-review-pending/dining-chair/candidate-01/dining-chair-authoring.blend',
    'office/owner-review-pending/office-chair/candidate-03/office-chair-authoring.blend',
    'living/owner-review-pending/long-sofa/candidate-01/long-sofa-authoring.blend',
    'living/owner-review-pending/ottoman/candidate-01/ottoman-authoring.blend',
    'furniture/review/candidate-02/chair-authoring.blend',
))
BODY_SINGLES = ('Collar stand', 'HAIR_01_TRIPO_CURL', 'Natural neck', 'One sewn breast pocket',
                'Overshirt body', 'Pocket top seam', 'Quiet closed smile', 'Sculpted head',
                'Shirt lower hem', 'Shirt placket', 'Small rounded nose', 'Trouser hip bridge')
BODY_PAIRS = ('Dark pupil', 'Ear', 'Eye white', 'Fitted rounded shoe sole', 'Folded fabric collar leaf',
              'Forearm with elbow and wrist sections', 'Hazel iris', 'Inner ear', 'Relaxed palm',
              'Relaxed shirt sleeve', 'Resting thumb', 'Shaped shoe', 'Shoe apron stitch',
              'Small eye catchlight', 'Soft eyebrow', 'Tailored trouser leg', 'Trouser hem',
              'Turned sleeve cuff', 'Upper lid outline')
BODY_NAMES = set(BODY_SINGLES) | {name + suffix for name in BODY_PAIRS for suffix in ('', '.001')} | {
    'Small horn button' + suffix for suffix in ('', '.001', '.002', '.003')}
BONE_NAMES = {'root', 'hips', 'spine', 'head', 'book'} | {
    name + side for name in ('upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot') for side in ('.L', '.R')}
CAMERA_MATRIX = [[.7071067094802856, -.4640388786792755, .5335429310798645, 5.335428714752197],
                 [.70710688829422, .4640386700630188, -.5335428714752197, -5.335428714752197],
                 [8.285385888484598e-08, .7545436024665833, .6562499403953552, 7.587500095367432],
                 [0., 0., 0., 1.]]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def inside(root, name):
    if (not isinstance(name, str) or not name or '\\' in name or ':' in name
            or PurePosixPath(name).is_absolute() or any(p in ('', '.', '..') for p in name.split('/'))):
        raise ValueError('Unsafe seating reference path')
    path = (Path(root) / name).resolve()
    if not path.is_relative_to(Path(root).resolve()):
        raise ValueError('Seating reference escapes its directory')
    return path


def checked_file(root, ref):
    path = inside(root, ref['path'])
    if digest(path) != ref['sha256']:
        raise ValueError('Seating file hash changed: ' + ref['path'])
    return path


def read_png(root, ref, size, mode='RGBA'):
    path = checked_file(root, ref)
    with Image.open(path) as image:
        image.load()
        if image.format != 'PNG' or image.mode != mode or image.size != tuple(size):
            raise ValueError('Seating PNG format or registration changed')
        result = image.copy()
    if 'pixels_sha256' in ref and hashlib.sha256(result.tobytes()).hexdigest() != ref['pixels_sha256']:
        raise ValueError('Seating decoded pixel hash changed')
    alpha = result.getchannel('A') if mode == 'RGBA' else result
    w, h = alpha.size
    if any(alpha.crop(box).getbbox() for box in ((0, 0, w, 1), (0, h-1, w, h), (0, 0, 1, h), (w-1, 0, w, h))):
        raise ValueError('Seating image clips the alpha border')
    return result


def index_rows(rows, expected, fields=('facing', 'variant', 'frame', 'owner')):
    result, paths = {}, set()
    for row in rows:
        key = tuple(row[field] for field in fields)
        path = row['path']
        if key in result or path in paths:
            raise ValueError('Duplicate seating sample or path')
        if key not in expected or type(row.get('frame', 0)) is not int:
            raise ValueError('Unexpected seating sample')
        inside(BASE, path)
        result[key] = row
        paths.add(path)
    if set(result) != expected:
        raise ValueError('Incomplete seating sample or palette inventory')
    return result


def check_identity(source, ink):
    if any(source.get(field) != ink.get(field) for field in IDENTITY):
        raise ValueError('Seating ink source identity or camera registration differs')


def check_registration(record):
    sofa = record['kind'] == 'sofa'
    expected = [80.00000953674316, 144.00043869018555] if sofa else [48.0000114440918, 116.0004369020462]
    scale = 3.889087200164795 if sofa else 2.6516504287719727
    if record['camera_matrix'] != CAMERA_MATRIX or record['anchor'] != expected or record['ortho_scale'] != scale:
        raise ValueError('Seating camera registration differs from accepted inputs')


def check_body_ink(shared, body):
    if shared.size != body.size or not body.getchannel('A').getbbox():
        raise ValueError('Missing visible body-owned ink')
    if ImageChops.subtract(body.getchannel('A'), shared.getchannel('A')).getbbox():
        raise ValueError('Visible body-owned ink exceeds shared ink')


def check_palettes(images):
    baseline = images[0]
    for image in images[1:]:
        if (image['sim'].getchannel('A').tobytes() != baseline['sim'].getchannel('A').tobytes()
                or any(image[owner].tobytes() != baseline[owner].tobytes() for owner in ('furniture', 'lines'))):
            raise ValueError('Seating palette changes geometry, furniture or ink')


def encode_scene(images, size):
    return {name: encode(image, size, images['lines'] if name in ('sim', 'furniture') else None)
            for name, image in images.items()}


def premultiplied_display(image):
    alpha = image.getchannel('A')
    return Image.merge('RGBA', [ImageChops.multiply(c, alpha) for c in image.split()[:3]] + [alpha])


def reference_beauty(image, size):
    """Filter independent beauty in float linear light, without layer-byte rounding."""
    if image.mode != 'RGBA':
        raise ValueError('Beauty reference must be RGBA')
    alpha = image.getchannel('A').point(ALPHA, mode='F')
    bands = [ImageMath.lambda_eval(lambda values: values['rgb'] * values['alpha'],
                                  rgb=channel.point(LINEAR, mode='F'), alpha=alpha)
             for channel in image.split()[:3]] + [alpha]
    filtered = [band.resize(size, Image.Resampling.BOX) for band in bands]
    pixels = []
    for red, green, blue, coverage in zip(*(band.getdata() for band in filtered)):
        if not coverage:
            pixels.append((0, 0, 0, 0))
        else:
            pixels.append(tuple(min(255, max(0, round(display(value / coverage) * 255)))
                                for value in (red, green, blue)) + (min(255, round(coverage * 255)),))
    result = Image.new('RGBA', size)
    result.putdata(pixels)
    return result


def compare_scene(encoded, beauty):
    owners = [encoded[name] for name in ('furniture', 'sim')]
    actual = reconstruct(owners + [encoded['lines']])
    reference = reference_beauty(beauty, actual.size)
    metrics = comparison(premultiplied_display(reference), premultiplied_display(actual), owners)
    if metrics['scene']['max_error'] > 6 or metrics['scene']['p95_error'] > 2:
        raise ValueError('Seating comparison exceeds six/two limits: ' + str(metrics))
    return metrics, actual


def check_exported_images(raw, body_ink, layers, masks):
    size = layers['body'].size
    encoded = encode_scene(raw, size)
    for role, source in (('body', 'sim'), ('furniture', 'furniture'), ('ink', 'lines')):
        expected_mask = raw[source].getchannel('A').resize(size, Image.Resampling.BOX)
        if layers[role].tobytes() != encoded[source].tobytes() or masks[role].tobytes() != expected_mask.tobytes():
            raise ValueError('Exported seating image differs from its original source owner')
    if masks['bodyInk'].tobytes() != body_ink.getchannel('A').resize(size, Image.Resampling.BOX).tobytes():
        raise ValueError('Exported body ink differs from its original source owner')
    return compare_scene(encoded, raw['beauty'])[0]


def check_support(hip):
    counts = [hip.get(name) for name in ('contact_count', 'ray_hits')]
    if any(type(value) is not int or value < 0 for value in counts):
        raise ValueError('Seating contact counts must be nonnegative integers')
    bounds = hip.get('contact_bounds')
    if (not isinstance(bounds, list) or len(bounds) != 2
            or any(not isinstance(point, list) or len(point) != 3 for point in bounds)):
        raise ValueError('Seating contact geometry requires two three-coordinate bounds')
    numbers = [value for point in bounds for value in point] + [hip.get('min_gap'), hip.get('xy_hull_area')]
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in numbers):
        raise ValueError('Seating contact geometry must contain finite numbers')
    low, high = bounds
    spans = [end - start for start, end in zip(low, high)]
    if any(not math.isfinite(span) or span < 0 for span in spans):
        raise ValueError('Seating contact geometry bounds must be finite and ordered')
    if (not 0 <= hip['min_gap'] <= .003 or counts[0] < 3 or counts[1] < counts[0]
            or hip['xy_hull_area'] < .0024 or spans[0] < .08 or spans[1] < .12):
        raise ValueError('Seating hip support is incomplete')


def check_contacts(record):
    expected = set(itertools.product(PALETTES, range(4)))
    seen = set()
    body, solids, bones = None, None, None
    for row in record['contacts']:
        key = (row['variant'], row['frame'])
        if key in seen or key not in expected:
            raise ValueError('Duplicate or unexpected contact sample')
        seen.add(key)
        current = (row['body_parts'], row['furniture_solids'], sorted(row['bone_length_errors']))
        if body is None:
            body, solids, bones = current
        if (current != (body, solids, bones) or set(body) != BODY_NAMES or len(body) != len(BODY_NAMES)
                or set(bones) != BONE_NAMES
                or not solids or len(solids) != len(set(solids)) or row['collisions']):
            raise ValueError('Incomplete named body or solid contact inventory')
        errors = row['bone_length_errors'].values()
        if any(not math.isfinite(v) or not 0 <= v <= .00001 for v in errors):
            raise ValueError('Seating anatomical bone lengths differ')
        check_support(row['hip_support'])
        soles = row['sole_clearance']
        if (set(soles) != {'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'}
                or any(not .0185 <= v <= .0198 for v in soles.values())):
            raise ValueError('Seating sole clearance differs')
    if seen != expected:
        raise ValueError('Incomplete contact samples')


def read_batch(path, *, process_exited):
    if not process_exited:
        raise ValueError('Source writer must exit before export')
    path = Path(path).resolve()
    proof = json.loads(path.read_text())
    if proof.get('state') != 'complete' or proof.get('probe') is not False:
        raise ValueError('Expected a complete non-probe seating batch')
    if len(proof['objects']) != 5 or {o['kind'] for o in proof['objects']} != set(KINDS):
        raise ValueError('Incomplete seating object inventory')
    if not isinstance(proof.get('inputs'), dict) or set(proof['inputs']) != SOURCE_DEPENDENCIES:
        raise ValueError('Seating source dependency inventory differs from accepted inputs')
    for name, sha in proof['inputs'].items():
        checked_file(MODELS, dict(path=name, sha256=sha))
    expected = set(itertools.product(FACINGS, PALETTES, range(4), OWNERS))
    for obj in proof['objects']:
        canvas = [160, 176] if obj['kind'] == 'sofa' else [96, 120]
        if obj['canvas'] != canvas or obj['source_density'] != 8:
            raise ValueError('Seating source density or logical canvas differs')
        if proof['inputs'].get(obj['source']) != obj['source_sha256']:
            raise ValueError('Seating source identity differs from producer inputs')
        checked_file(path.parent, dict(path=obj['model_path'], sha256=obj['model_sha256']))
        check_registration(obj)
        check_contacts(obj)
        index_rows(obj['renders'], expected)
    return proof
