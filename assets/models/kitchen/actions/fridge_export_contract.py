"""Validate complete fridge open-and-reach evidence without importing Blender.

The batch renders four facings by eight progress samples by three shirt
palettes by four owners, eight body-ink passes per facing, an empty fixture
reference per facing and a door-only reference per facing and sample.
Matching hashes prove only that files are unchanged, so every clause the
receipt claims is re-derived from its recorded measurements:

- the schedule equals the pinned geometry module, and the door is closed at
  both ends and fully open on every reach sample;
- every sample keeps all 54 body surfaces clear of all 35 fixture solids
  with no recorded collision and a recorded gap of at least six millimetres,
  stays inside the front tile's column, and every sweep between consecutive
  samples (door turning and feet stepping together) is clear of the body;
- the reaching palm's recorded centroid lies inside the cabinet volume;
- every non-door fixture part keeps one geometry fingerprint across all
  samples of a facing, and the door parts move only by the hinge angle;
- the legs and root keep their standing pose, the feet move only with the
  scheduled stance, and every bone keeps its length;
- the canvas is the accepted 96 by 120 canvas grown by whole logical pixels,
  with the fixture's origin moved by exactly that padding.

The contract cannot re-measure the surfaces: a fabricated but
self-consistent clearance record remains a limit of the receipt chain, which
the visual review and the pixel check in the exporter address.
"""
import itertools
import json
import math
import re
from pathlib import Path
import sys

from PIL import Image

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path[:0] = [str(MODELS/'seating'), str(MODELS/'bathroom/actions'), str(BASE)]
from seat_export_contract import BODY_NAMES, BONE_NAMES, inside, checked_file, digest, read_png
from bathroom_export_contract import finite_tree, number, validate_palettes
import fridge_reach_geometry as geo

# Presentation body-action code shared with `render_buffer::visual_action::FETCH`
# in crates/terri-sim/src/render_buffer.rs.
FETCH_ACTION = 22
FACINGS = ('SE', 'NW', 'SW', 'NE')
PALETTES = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
SOURCE = 'kitchen/owner-review-pending/refrigerator/candidate-03/refrigerator-authoring.blend'
SOURCE_SHA256 = '4bed8dfb3fb968725c99c8345ac5e17a4c75b45b5e487d867655ed17163a7b82'
RIG = 'sims/sim-01/sim-01-rigged.blend'
RIG_SHA256 = '919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce'
PRODUCERS = {'kitchen/actions/render_fridge_reach.py', 'kitchen/actions/fridge_reach_pose.py',
             'kitchen/actions/fridge_reach_geometry.py'}
DOOR_PARTS = {'Refrigerator door', 'Refrigerator door seal', 'Refrigerator handle',
              'Refrigerator handle mount -1', 'Refrigerator handle mount 1', 'Refrigerator inner liner'}
SOLID_NAMES = DOOR_PARTS | {
    'Case base', 'Case rear', 'Case side -1', 'Case side 1', 'Case top', 'Compartment divider',
    'Food shelf 0.19', 'Food shelf 0.48', 'Food shelf 0.8', 'Freezer door', 'Freezer door seal',
    'Freezer handle', 'Freezer handle mount -1', 'Freezer handle mount 1', 'Freezer inner liner',
    'Interior back liner', 'Levelling foot -0.285 -0.29', 'Levelling foot -0.285 0.28',
    'Levelling foot 0.285 -0.29', 'Levelling foot 0.285 0.28', 'Lower toe kick', 'Rear service panel',
    'Rear vent slot 0.21', 'Rear vent slot 0.26', 'Rear vent slot 0.31', 'Rear vent slot 0.36',
    'Shelf front lip 0.19', 'Shelf front lip 0.48', 'Shelf front lip 0.8'}
# The static refrigerator's accepted registration (its candidate proof and
# every one-tile fixture): the 768 by 960 canvas and its projected origin.
ACCEPTED_ORIGIN = [384.0000915527344, 760.0034952163696]
ACCEPTED_ORTHO = 2.6516504287719727
DENSITY = 8
EXPORT_DENSITY = 2
MIN_GAP = .006
MIN_MARGIN = 8*DENSITY
STATIC_BONES = ('root', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R', 'book')
# The body stays in the front tile's column.
TILE_COLUMN = .5
BONE_TOLERANCE = 1e-5
STATIC_TOLERANCE = 1e-7
HINGE_TOLERANCE = 1e-5
SHA = re.compile('[0-9a-f]{64}')


def canvas():
    left, top, right, bottom = geo.PADDING
    return [(96+left+right)*DENSITY, (120+top+bottom)*DENSITY]


def export_size():
    width, height = canvas()
    return (width*EXPORT_DENSITY//DENSITY, height*EXPORT_DENSITY//DENSITY)


FACING_DEGREES = dict(SE=90, NW=270, SW=0, NE=180)


def feet(facing):
    """Each sample's feet centre in game tiles relative to the fixture's tile, for one facing.

    The renders turn the scene by the facing about the fixture; game x is
    Blender X and game y is Blender -Y. Rounded to a millimetre."""
    turn = math.radians(FACING_DEGREES[facing])
    c, s = math.cos(turn), math.sin(turn)
    result = []
    for index in range(geo.SAMPLES):
        x, y = geo.stance(index)
        result.append([round(c*x-s*y, 3), round(-(s*x+c*y), 3)])
    return result


def validate_depths(rows, path):
    """One per-pixel depth array per facing and sample at export size, registered to its pixels."""
    import numpy as np
    expected = set(itertools.product(FACINGS, range(geo.SAMPLES)))
    seen = {}
    width, height = export_size()
    for row in rows:
        key = (row['facing'], row['frame'])
        if key not in expected or key in seen or not SHA.fullmatch(row['sha256']):
            raise ValueError('Duplicate, unexpected or unhashed fridge depth')
        if row['size'] != [width, height] or max(number(v) for v in row['ray_registration_error']) > .01:
            raise ValueError('Fridge depth is not registered to the export pixels')
        data = np.load(checked_file(path.parent, row))
        if data.shape != (height, width, 4) or not np.isfinite(data).all():
            raise ValueError('Fridge depth array has the wrong shape')
        if int((data[:, :, 3] > 0).sum()) < row['surface_pixels']:
            raise ValueError('Fridge depth surface count disagrees with its array')
        seen[key] = data
    if set(seen) != expected:
        raise ValueError('Fridge depth matrix is incomplete')
    return seen


def validate_action(action):
    expected = dict(name='fridge_reach_v1', samples=geo.SAMPLES, door_degrees=list(geo.DOOR_DEGREES),
                    reach_samples=list(geo.REACH_SAMPLES), left_hand=list(geo.LEFT_HAND),
                    right_hand=list(geo.RIGHT_HAND),
                    lean_degrees=list(geo.LEAN_DEGREES), twist_degrees=list(geo.TWIST_DEGREES), playback='progress')
    if action != expected:
        raise ValueError('Fridge reach schedule differs from the pinned geometry module')
    geo.validate_schedule()


def validate_registration(proof):
    finite_tree(proof)
    left, top = geo.PADDING[0], geo.PADDING[1]
    accepted = proof.get('accepted_registration', {})
    if (accepted.get('render_dimensions') != [768, 960] or accepted.get('origin_pixels') != ACCEPTED_ORIGIN
            or accepted.get('ortho_scale') != ACCEPTED_ORTHO or accepted.get('camera_shift') != [0.0, 0.0]):
        raise ValueError('Fridge scene did not start from the accepted fixture registration')
    width, height = canvas()
    expected_origin = [ACCEPTED_ORIGIN[0]+DENSITY*left, ACCEPTED_ORIGIN[1]+DENSITY*top]
    if (proof.get('canvas') != [width, height] or proof.get('render_dimensions') != [width, height]
            or proof.get('padding') != list(geo.PADDING) or proof.get('source_density') != DENSITY
            or proof.get('logical_canvas') != [width//DENSITY, height//DENSITY]
            or any(abs(number(a)-b) > 1e-3 for a, b in zip(proof.get('origin_pixels', []), expected_origin))
            or len(proof['origin_pixels']) != 2
            or proof.get('camera_matrix') != accepted.get('camera_matrix')
            or abs(number(proof['ortho_scale'])-ACCEPTED_ORTHO*max(width, height)/960) > 1e-6):
        raise ValueError('Padded fridge canvas moved the fixture or changed its scale')


def validate_inputs(proof, path):
    inputs = proof.get('inputs', {})
    if (inputs.get(SOURCE) != SOURCE_SHA256 or inputs.get(RIG) != RIG_SHA256
            or not PRODUCERS <= set(inputs)):
        raise ValueError('Fridge receipt does not pin the accepted sources and producers')
    for name, sha in inputs.items():
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise ValueError('Fridge input hash is malformed')
        checked_file(MODELS, dict(path=name, sha256=sha))
        if name.endswith('.py'):
            checked_file(path.parent/'source', dict(path=name, sha256=sha))


def validate_sample(row, index):
    if row.get('sample') != index or row.get('door_degrees') != geo.DOOR_DEGREES[index]:
        raise ValueError('Fridge sample order or door angle differs from the schedule')
    if row.get('left_hand') != geo.LEFT_HAND[index]:
        raise ValueError('Fridge sample left hand differs from the schedule')
    errors = row['bone_length_errors']
    if set(errors) != BONE_NAMES or any(not 0 <= number(e) <= BONE_TOLERANCE for e in errors.values()):
        raise ValueError('Fridge sample changed an anatomical bone length')
    targets = row['joint_targets']
    if set(targets) != BONE_NAMES or any(set(t) != {'head', 'tail'} or any(len(t[k]) != 3 for k in t)
                                         for t in targets.values()):
        raise ValueError('Fridge sample joint targets are incomplete')
    clearance = row['clearance']
    if (set(clearance['body_inventory']) != BODY_NAMES or len(clearance['body_inventory']) != len(BODY_NAMES)
            or set(clearance['fixture_solids']) != SOLID_NAMES or len(clearance['fixture_solids']) != len(SOLID_NAMES)
            or clearance['complete_body_solid_pairs'] != len(BODY_NAMES)*len(SOLID_NAMES)
            or type(clearance['complete_body_solid_pairs']) is not int or clearance['collisions']):
        raise ValueError('Fridge sample clearance inventory is incomplete or collides')
    gaps = [number(clearance[k]) for k in ('minimum_gap', 'minimum_door_gap', 'minimum_case_gap')]
    if min(gaps) < MIN_GAP or clearance['minimum_gap'] != min(gaps[1:]):
        raise ValueError('Fridge sample clearance is below six millimetres or inconsistent')
    for key, gap in clearance['near_pairs'].items():
        body, solid = key.split('|')
        if body not in BODY_NAMES or solid not in SOLID_NAMES or number(gap) < MIN_GAP:
            raise ValueError('Fridge near pair is unknown or too close')
    if row.get('stance') != list(geo.stance(index)):
        raise ValueError('Fridge sample stance differs from the schedule')
    extent = [number(v) for v in row['body_extent']]
    # The handle side keeps clear of a wall face; on the hinge side the open
    # door itself needs the tile, so the body only has to stay on it.
    if (len(extent) != 4 or extent[0] < -(geo.WALL_FACE-geo.WALL_CLEARANCE) or extent[2] > TILE_COLUMN
            or extent[0] > extent[2]):
        raise ValueError('Fridge body leaves the front tile or reaches a wall')
    if row.get('right_hand') != geo.RIGHT_HAND[index]:
        raise ValueError('Fridge sample right hand differs from the schedule')
    if geo.LEFT_HAND[index] == 'reach':
        palm = row['palm']
        x, y, z = (number(v) for v in palm['centroid'])
        cabinet = geo.CABINET
        inside_cabinet = (cabinet['x'][0] < x < cabinet['x'][1] and y > cabinet['y_front']
                          and cabinet['z'][0] < z < cabinet['z'][1])
        if palm['inside'] is not True or not inside_cabinet or number(palm['deepest_y']) < y:
            raise ValueError('Reaching palm is not inside the cabinet')
    elif 'palm' in row:
        raise ValueError('Only reach samples carry a cabinet palm check')
    return targets


def validate_samples(rows):
    if len(rows) != geo.SAMPLES:
        raise ValueError('Fridge receipt needs one measurement per sample')
    targets = [validate_sample(row, index) for index, row in enumerate(rows)]
    for name in STATIC_BONES:
        for other in targets[1:]:
            if any(abs(number(a)-number(b)) > STATIC_TOLERANCE for key in ('head', 'tail')
                   for a, b in zip(other[name][key], targets[0][name][key])):
                raise ValueError('Fridge reach moved a planted bone: '+name)
    if targets[0] != targets[-1]:
        raise ValueError('Fridge reach must end in the pose it starts from')


def validate_sweeps(rows):
    """One clear sweep per pair of consecutive samples, the door and feet moving together."""
    seen = set()
    for row in rows:
        first = row.get('first')
        if (type(first) is not int or not 0 <= first < geo.SAMPLES-1 or first in seen
                or row['start'] != geo.DOOR_DEGREES[first] or row['end'] != geo.DOOR_DEGREES[first+1]
                or row['collisions'] or number(row['minimum_gap']) <= 0):
            raise ValueError('Fridge door sweep is unexpected, duplicated or collides')
        if set(row['door_parts']) != DOOR_PARTS or not set(row['checked_body']) <= BODY_NAMES or len(row['checked_body']) < len(BODY_NAMES)-10:
            raise ValueError('Fridge door sweep inventory is incomplete')
        seen.add(first)
    if seen != set(range(geo.SAMPLES-1)):
        raise ValueError('Fridge door sweeps are incomplete')


def validate_fixture(rows, margins):
    expected = set(itertools.product(FACINGS, range(geo.SAMPLES)))
    seen, static = set(), {}
    for row in rows:
        key = (row['facing'], row['sample'])
        if key not in expected or key in seen:
            raise ValueError('Duplicate or unexpected fridge fixture check')
        seen.add(key)
        if set(row['fixture']) != SOLID_NAMES or any(not SHA.fullmatch(h) for h in row['fixture'].values()):
            raise ValueError('Fridge fixture fingerprints are incomplete')
        deviation = row['door_hinge_deviation']
        if set(deviation) != DOOR_PARTS or any(not 0 <= number(v) <= HINGE_TOLERANCE for v in deviation.values()):
            raise ValueError('Fridge door moved other than about its hinge')
        fixed = {n: h for n, h in row['fixture'].items() if n not in DOOR_PARTS}
        if row['static_identical'] is not True or static.setdefault(row['facing'], fixed) != fixed:
            raise ValueError('A fridge case part moved between samples')
        door = {n: row['fixture'][n] for n in DOOR_PARTS}
        degrees = geo.DOOR_DEGREES[row['sample']]
        reference = static.setdefault((row['facing'], degrees), door)
        if reference != door:
            raise ValueError('Equal door angles drew different door geometry')
    if seen != expected:
        raise ValueError('Fridge fixture checks are incomplete')
    width, height = canvas()
    if {(m['facing'], m['sample']) for m in margins} != expected or len(margins) != len(expected):
        raise ValueError('Fridge canvas margins are incomplete')
    for row in margins:
        left, top, right, bottom = (number(v) for v in row['bounds'])
        margin = min(left, top, width-right, height-bottom)
        if abs(margin-number(row['minimum_margin'])) > 1e-6 or margin < MIN_MARGIN:
            raise ValueError('Fridge scene lacks canvas margin')


def validate_geometry_palettes(rows):
    expected = set(itertools.product(FACINGS, PALETTES, range(geo.SAMPLES)))
    seen, baseline = set(), {}
    for row in rows:
        key = (row['facing'], row['variant'], row['frame'])
        if key not in expected or key in seen or row['complete_owner_consistency'] is not True:
            raise ValueError('Duplicate or unexpected fridge palette geometry check')
        seen.add(key)
        state = row['geometry']
        if set(state['body']) != BODY_NAMES or set(state['fixture']) != SOLID_NAMES or set(state['visible_body']) != BODY_NAMES:
            raise ValueError('Fridge palette geometry inventory is incomplete')
        if baseline.setdefault((row['facing'], row['frame']), state) != state:
            raise ValueError('Palette changed fridge scene geometry')
    if seen != expected:
        raise ValueError('Fridge palette geometry checks are incomplete')


def index(rows, expected, fields):
    result, paths = {}, set()
    for row in rows:
        key = tuple(row[f] for f in fields)
        if key not in expected or key in result or row['path'] in paths or not SHA.fullmatch(row['sha256']):
            raise ValueError('Duplicate, unexpected or unhashed fridge render')
        inside(BASE, row['path'])
        result[key] = row
        paths.add(row['path'])
    if set(result) != expected:
        raise ValueError('Fridge render matrix is incomplete')
    return result


def render_rows(proof):
    return index(proof['renders'], set(itertools.product(FACINGS, PALETTES, range(geo.SAMPLES), OWNERS)),
                 ('facing', 'variant', 'frame', 'owner'))


def reference_rows(proof):
    expected = {(f, None, 'empty') for f in FACINGS} | set(itertools.product(FACINGS, range(geo.SAMPLES), ('door',)))
    return index(proof['references'], expected, ('facing', 'frame', 'owner'))


def ink_rows(ink):
    return index(ink['renders'], set(itertools.product(FACINGS, ('green',), range(geo.SAMPLES), ('body_ink',))),
                 ('facing', 'variant', 'frame', 'owner'))


def read_batch(path, *, process_exited):
    if process_exited is not True:
        raise ValueError('Wait for the source writer to finish before importing')
    path = Path(path).resolve()
    if not path.is_relative_to((BASE/'review/fridge').resolve()):
        raise ValueError('Fridge source receipt must stay in its owned review directory')
    proof = json.loads(path.read_text())
    if (proof.get('schema') != 1 or proof.get('state') != 'complete' or proof.get('mode') != 'batch'
            or proof.get('immutable_inputs_preserved') is not True):
        raise ValueError('Missing complete immutable fridge batch receipt')
    validate_inputs(proof, path)
    validate_action(proof['action'])
    validate_registration(proof)
    if (proof.get('stances') != {k: list(v) for k, v in geo.STANCES.items()}
            or proof.get('stance_by_sample') != list(geo.STANCE_BY_SAMPLE)
            or set(proof.get('door_parts', [])) != DOOR_PARTS):
        raise ValueError('Fridge stance or door assembly differs from the pinned geometry')
    validate_samples(proof['samples'])
    validate_sweeps(proof['sweeps'])
    validate_fixture(proof['fixture_checks'], proof['margins'])
    validate_geometry_palettes(proof['geometry_palette_checks'])
    validate_palettes(proof['palettes'])
    validate_depths(proof.get('depths', []), path)
    size = tuple(canvas())
    for row in render_rows(proof).values():
        read_png(path.parent, row, size, 'RGBA')
    for row in reference_rows(proof).values():
        read_png(path.parent, row, size, 'RGBA')
    return proof


def read_ink(path, source_path, source):
    path = Path(path).resolve()
    if not path.is_relative_to((BASE/'review/fridge').resolve()):
        raise ValueError('Fridge body ink must stay in its owned review directory')
    ink = json.loads(path.read_text())
    finite_tree(ink)
    if (ink.get('schema') != 1 or ink.get('state') != 'complete' or ink.get('immutable_inputs_preserved') is not True
            or ink.get('source_proof_sha256') != digest(source_path) or ink.get('inputs') != source['inputs']
            or ink.get('producer_sha256') != digest(MODELS/'bathroom/actions/render_toilet_ink.py')
            or any(ink.get(k) != source.get(k) for k in ('render_dimensions', 'origin_pixels', 'camera_matrix', 'ortho_scale'))):
        raise ValueError('Fridge body ink does not bind the exact completed source and camera')
    expected = set(itertools.product(FACINGS, range(geo.SAMPLES)))
    seen = set()
    for row in ink['stroke_ownership']:
        key = (row['facing'], row['frame'])
        if (key not in expected or key in seen or set(row['body_owned_stroke_inventory']) != BODY_NAMES
                or row['full_scene_occlusion'] is not True or row['fixture_geometry_hidden'] is not False
                or row['body_and_fixture_holdout'] is not False):
            raise ValueError('Fridge body ink ownership is incomplete')
        seen.add(key)
    if seen != expected:
        raise ValueError('Fridge body ink ownership is incomplete')
    rows = ink_rows(ink)
    for row in rows.values():
        read_png(path.parent, row, tuple(canvas()), 'RGBA')
    return ink, rows


def case_preservation(furniture, body, empty, door_now, door_closed):
    """Compare a sample's furniture layer with the empty fixture where nothing covers the case.

    Pixels covered by the body or by the door (at this sample or closed) are
    excluded. The alpha difference there measures the case's silhouette: any
    move, turn or resize of the case changes it. The colour difference, in
    premultiplied levels, is reported separately because the Sim and the open
    door cast shadows on the case; in the facings where the Sim stands behind
    the fridge it stays within two levels."""
    import numpy as np
    covered = np.maximum.reduce([np.asarray(image.getchannel('A')) for image in (body, door_now, door_closed)]) > 0
    keep = ~covered
    actual = np.asarray(furniture, dtype=np.int32)
    expected = np.asarray(empty, dtype=np.int32)
    alpha = np.abs(actual[..., 3]-expected[..., 3])[keep]
    shade = np.abs(actual[..., :3]*actual[..., 3:]-expected[..., :3]*expected[..., 3:]).max(-1)[keep]/255
    return dict(compared_pixels=int(keep.sum()), max_alpha_difference=int(alpha.max(initial=0)),
                max_shading_difference=round(float(shade.max(initial=0)), 3),
                shaded_pixels=int((shade > 2).sum()))
