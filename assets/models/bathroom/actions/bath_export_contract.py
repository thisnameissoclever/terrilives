"""Validate complete bathing loop evidence without importing Blender.

The bathing loop has one appearance for every shirt variant (the declared bathing appearance
replaces the shirt with skin), so its source matrix is four facings by four frames by four
owners plus sixteen body-ink passes. Support is the measured seat patch on the basin floor and
the back patch against the head-end wall; clearance is every one of the 54 body objects against
all twelve fixture solids. Matching hashes prove nothing about the evidence inside a receipt, so
every certificate is re-derived here from its own witnesses and compared with what the receipt
claims: support patches are recomputed from their witness cells, which must be cells of the
recorded grid on its lattice and on the basin floor or the accepted wall plane; containment
excusals must equal the accepted source's reviewed hits with even ray parity on all six axes and,
when the upward ray meets a surface, more than five millimetres of clear air above the hit;
every static bone must equal the accepted pose exactly and the head may only nod about its side
axis by the loop's declared angle; the appearance must omit exactly the declared garment details;
and the fixture geometry must be identical on every frame of a facing. The contract checks the
recorded measurements for self-consistency and geometric plausibility; it cannot re-measure the
surfaces, so a fully fabricated but self-consistent grid remains a limit of the receipt chain.
"""
import itertools
import json
import math
import re
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path.insert(0, str(MODELS/'seating'))
sys.path.insert(0, str(BASE))
from seat_export_contract import BODY_NAMES, BONE_NAMES, inside, checked_file, digest, read_png
from bathroom_export_contract import finite_tree, number, validate_ink_binding
from bath_pose_geometry import basin_contains, validate_support_patch
from bath_loop_v1 import MAX_NOD_DEGREES, STATIC_BONES, head_nod
from shower_pose_geometry import OMITTED_GARMENT_DETAILS

# Presentation body-action code shared with `render_buffer::visual_action::BATHE`.
BATHE_ACTION = 19
FACINGS = ('SE', 'NW', 'SW', 'NE')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
SOLID_NAMES = {'Bathtub continuous shell', 'Bathtub curved spout', 'Bathtub drain', 'Bathtub inset plinth',
               'Bathtub overflow', 'Bathtub tap foot', 'Bathtub tap base -0.135', 'Bathtub tap base 0.135',
               'Bathtub tap stem -0.135', 'Bathtub tap stem 0.135', 'Bathtub tap handle -0.135',
               'Bathtub tap handle 0.135'}
WATER_NAME = 'Bath opaque water surface'
ACTION = dict(name='bath_idle_v1', samples=4, closure_frame=4, half_cycle_ticks=8, loop_ticks=16)
ACCEPTED_BASE = 'bathroom/actions/review/bath/prototype-12-wall-backed-water'
ACCEPTED_MODEL = ACCEPTED_BASE+'/bath-pose-authoring.blend'
TUB_SOURCE = 'bathroom/owner-review-pending/bathtub/candidate-02/bathtub-authoring.blend'
LOOP_EXTRA_INPUTS = {'bathroom/actions/render_bath_loop.py', 'bathroom/actions/bath_loop_v1.py',
                     'bathroom/actions/test_bath_loop.py', ACCEPTED_BASE+'/proof.json', ACCEPTED_MODEL}
ORIGINAL_DIMENSIONS = [1280, 1408]
LOGICAL_CANVAS = [160, 176]
RENDERED_BODY_COUNT = 41
SKIN_BODIES = {'Overshirt body', 'Relaxed shirt sleeve', 'Relaxed shirt sleeve.001'}
SKIN_MATERIAL = 'Warm ochre skin'
TARGET_TOLERANCE = 1e-7
NOD_TAIL_TOLERANCE = 1e-6
MIN_CANVAS_MARGIN = 8
REVIEW_CLEAR_ABOVE = .005
REVIEW_BODIES = {'Tailored trouser leg', 'Tailored trouser leg.001'}
REVIEW_FIXTURE = 'Bathtub continuous shell'
CONTACT_MAX_GAP = .003
PATCH_MAX_GAP = .01
WITNESS_FIELDS = ('x', 'y', 'body_z', 'basin_z', 'gap')
FLOOR_Z = .15
RIM_Z = .57
LATTICE_TOLERANCE = 1e-6
FRAME_TOLERANCE = 1e-6
WALL_PLANE_TOLERANCE = .01


def validate_render_rows(rows, ink=False):
    expected = (set(itertools.product(FACINGS, ('green',), range(4), ('body_ink',))) if ink
                else set(itertools.product(FACINGS, ('green',), range(4), OWNERS)))
    result, paths = {}, set()
    for row in rows:
        key = (row['facing'], row['variant'], row['frame'], row['owner'])
        if key not in expected or key in result or type(row['frame']) is not int or row['path'] in paths:
            raise ValueError('Duplicate or unexpected bath render sample/path')
        inside(BASE, row['path'])
        if not isinstance(row['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', row['sha256']):
            raise ValueError('Missing exact bath render hash')
        result[key] = row
        paths.add(row['path'])
    if set(result) != expected:
        raise ValueError('Missing complete bath render matrix')
    return result


def validate_action(action):
    if ({key:action.get(key) for key in ACTION} != ACTION or set(action)-set(ACTION) not in (set(), {'sample_fps'})
            or ('sample_fps' in action and number(action['sample_fps']) != 2.5)
            or any(type(action.get(field)) is not int for field in ('samples', 'closure_frame', 'half_cycle_ticks', 'loop_ticks'))):
        raise ValueError('Unsupported bath animation action')


def validate_registration(record, accepted):
    finite_tree(record)
    if (record.get('original_render_dimensions') != ORIGINAL_DIMENSIONS or record.get('logical_canvas') != LOGICAL_CANVAS
            or type(record.get('source_density')) is not int or record['source_density'] != 8
            or any(record.get(key) != accepted.get(key) for key in
                   ('original_render_dimensions', 'origin_pixels', 'camera_matrix', 'ortho_scale'))):
        raise ValueError('Bath camera or physical-origin registration differs from accepted source')


def same_point(a, b):
    return len(a) == 3 and len(b) == 3 and all(abs(number(x)-number(y)) <= TARGET_TOLERANCE for x, y in zip(a, b))


def angle_degrees(a, b):
    dot = sum(x*y for x, y in zip(a, b))
    norms = math.sqrt(sum(x*x for x in a))*math.sqrt(sum(x*x for x in b))
    if norms <= 0:
        raise ValueError('Degenerate bone direction')
    return math.degrees(math.acos(max(-1., min(1., dot/norms))))


def nodded_tail(accepted_head, nod_degrees):
    """The accepted head bone turned forward about the world side axis through its joint."""
    joint = [number(v) for v in accepted_head['head']]
    direction = [number(t)-j for t, j in zip(accepted_head['tail'], joint)]
    radians = math.radians(-number(nod_degrees))
    cosine, sine = math.cos(radians), math.sin(radians)
    turned = [direction[0], cosine*direction[1]-sine*direction[2], sine*direction[1]+cosine*direction[2]]
    return [j+d for j, d in zip(joint, turned)]


def validate_targets(targets, accepted_targets, nod_degrees):
    """Every static bone equals the accepted pose; the head keeps its joint and length and nods by the declared angle."""
    if set(targets) != BONE_NAMES or set(accepted_targets) != BONE_NAMES or set(STATIC_BONES) | {'head'} != BONE_NAMES:
        raise ValueError('Bath joint targets are incomplete')
    for name in STATIC_BONES:
        for field in ('head', 'tail'):
            if not same_point(targets[name][field], accepted_targets[name][field]):
                raise ValueError('Bath sample moved a static accepted bone: '+name)
    head, accepted_head = targets['head'], accepted_targets['head']
    if not same_point(head['head'], accepted_head['head']):
        raise ValueError('Bath sample moved the head joint')
    if not 0 <= number(nod_degrees) <= MAX_NOD_DEGREES:
        raise ValueError('Bath sample declares a head nod outside the loop')
    expected = nodded_tail(accepted_head, nod_degrees)
    if len(head['tail']) != 3 or any(abs(number(a)-b) > NOD_TAIL_TOLERANCE for a, b in zip(head['tail'], expected)):
        raise ValueError('Bath sample head tail is not the accepted head nodded forward by the declared angle')
    return angle_degrees([number(a)-number(b) for a, b in zip(head['tail'], head['head'])],
                         [number(a)-number(b) for a, b in zip(accepted_head['tail'], accepted_head['head'])])


def validate_closure(closure, accepted_targets):
    finite_tree(closure)
    flags = ('manual_exact_phase0', 'manual_exact_endpoint', 'saved_exact_phase0', 'saved_exact_endpoint',
             'all54_evaluated', 'head_nod_only')
    if (any(closure.get(key) is not True for key in flags) or closure.get('limb_movement') is not False
            or set(closure.get('complete_body_inventory', [])) != BODY_NAMES
            or len(closure['complete_body_inventory']) != len(BODY_NAMES)):
        raise ValueError('Missing exact complete-body bath loop closure')
    named = closure.get('named_bones', {})
    if set(named) != BONE_NAMES:
        raise ValueError('Bath loop closure names an incomplete bone set')
    for name, target in named.items():
        for field in ('head', 'tail'):
            if not same_point(target[field], accepted_targets[name][field]):
                raise ValueError('Bath loop closure left the accepted joint targets')


def witness_key(cell):
    return tuple(number(cell[field]) for field in WITNESS_FIELDS)


def on_lattice(value, step):
    ratio = number(value)/step
    return abs(ratio-round(ratio)) <= LATTICE_TOLERANCE


def dot(a, b):
    return sum(number(x)*number(y) for x, y in zip(a, b))


def wall_frame(plane):
    """The accepted wall plane's inward normal and the tangent that runs up the wall."""
    normal, point = [number(v) for v in plane['normal']], [number(v) for v in plane['point']]
    if len(normal) != 3 or len(point) != 3 or abs(math.sqrt(dot(normal, normal))-1) > 1e-6:
        raise ValueError('Accepted wall plane is not a unit normal with a point')
    up = [0, -normal[2], normal[1]]
    return normal, up, point


def validate_hip_cell(cell, witness):
    """A seat cell is a vertical ray pair on the basin floor profile; a witness touches the actual floor."""
    basin_z = number(cell['basin_z'])
    if not FLOOR_Z-1e-5 <= basin_z <= RIM_Z or not basin_contains(number(cell['x']), number(cell['y']), min(RIM_Z, max(FLOOR_Z, basin_z))):
        raise ValueError('Bath seat cell is not on the basin floor profile')
    if witness and abs(basin_z-FLOOR_Z) > 1e-5:
        raise ValueError('Bath seat witness is not on the actual basin floor')


def validate_back_cell(cell, witness, plane):
    """A wall cell is a ray pair along the wall normal in the wall tangent frame; a witness lies on the accepted plane."""
    normal, up, point = wall_frame(plane)
    wall, body = cell.get('wall_point', []), cell.get('body_point', [])
    if len(wall) != 3 or len(body) != 3:
        raise ValueError('Bath wall cell lacks its wall and body points')
    offset = [number(w)-p for w, p in zip(wall, point)]
    # The body point must sit exactly `gap` along the normal from the wall point, with no tangential drift.
    residual = [number(b)-number(w)-number(cell['gap'])*n for b, w, n in zip(body, wall, normal)]
    if (abs(number(cell['x'])-number(wall[0])) > FRAME_TOLERANCE or abs(number(cell['y'])-dot(offset, up)) > FRAME_TOLERANCE
            or math.sqrt(dot(residual, residual)) > FRAME_TOLERANCE):
        raise ValueError('Bath wall cell is not a normal-directed pair in the wall tangent frame')
    if witness and abs(dot(offset, normal)) > WALL_PLANE_TOLERANCE:
        raise ValueError('Bath wall witness is not on the accepted wall plane')


CELL_CHECKS = dict(hip=lambda cell, witness, plane:validate_hip_cell(cell, witness),
                   back=validate_back_cell)


def validate_patch(patch, grid, step):
    """Recompute the finite patch from its witnesses: every grid cell inside its bounds, on the grid lattice."""
    if patch is None:
        raise ValueError('Bath support lacks a finite patch')
    witnesses = patch.get('actual_witnesses')
    if not isinstance(witnesses, list) or type(patch.get('samples')) is not int or len(witnesses) != patch['samples']:
        raise ValueError('Bath support patch witnesses do not match its sample count')
    cells = {witness_key(cell):cell for cell in grid}
    keys = [witness_key(w) for w in witnesses]
    if any(cells.get(key) != w for key, w in zip(keys, witnesses)) or len(set(keys)) != len(keys):
        raise ValueError('Bath support patch witness is not a distinct cell of the measured grid')
    recomputed = validate_support_patch([{field:number(w[field]) for field in WITNESS_FIELDS} for w in witnesses])
    for key in ('area', 'width', 'depth', 'min_gap', 'max_gap', 'samples', 'xy_bounds'):
        if patch.get(key) != recomputed[key]:
            raise ValueError('Bath support patch claim differs from its recomputed witnesses: '+key)
    (x0, y0), (x1, y1) = recomputed['xy_bounds']
    inside_bounds = {key for key in cells if x0-LATTICE_TOLERANCE <= key[0] <= x1+LATTICE_TOLERANCE
                     and y0-LATTICE_TOLERANCE <= key[1] <= y1+LATTICE_TOLERANCE}
    xs, ys = sorted({key[0] for key in keys}), sorted({key[1] for key in keys})
    if (inside_bounds != set(keys)
            or any(abs(b-a-step) > LATTICE_TOLERANCE for a, b in zip(xs, xs[1:]))
            or any(abs(b-a-step) > LATTICE_TOLERANCE for a, b in zip(ys, ys[1:]))):
        raise ValueError('Bath support patch omits measured cells inside its bounds or leaves the grid lattice')
    if patch.get('complete_cartesian_surface_grid') is not True or recomputed['max_gap'] > PATCH_MAX_GAP:
        raise ValueError('Bath support patch is not a complete grid within the contact interval')
    return recomputed


def validate_certificate(record, kind, plane):
    grid, step = record.get('complete_actual_grid'), record.get('grid_step')
    if (record.get('state') != 'passed' or not isinstance(grid, list) or not grid
            or type(record.get('actual_surface_ray_hits')) is not int or record['actual_surface_ray_hits'] != len(grid)
            or not 0 < number(step) <= .01):
        raise ValueError('Bath support certificate is not a passed actual-surface measurement')
    step = number(step)
    witnesses = {witness_key(w) for w in (record.get('finite_patch') or {}).get('actual_witnesses', [])}
    positions = set()
    for cell in grid:
        position = (number(cell['x']), number(cell['y']))
        if position in positions or not on_lattice(position[0], step) or not on_lattice(position[1], step):
            raise ValueError('Bath support grid cell is a duplicate or off the grid lattice')
        positions.add(position)
        if abs(number(cell['body_z'])-number(cell['basin_z'])-number(cell['gap'])) > 1e-7:
            raise ValueError('Bath support grid cell is not an actual surface pair')
        CELL_CHECKS[kind](cell, witness_key(cell) in witnesses, plane)
    gaps = [number(cell['gap']) for cell in grid]
    if record.get('min_gap') != min(gaps) or record.get('max_gap') != max(gaps) or min(gaps) < 0:
        raise ValueError('Bath support certificate extrema differ from its grid')
    patch = validate_patch(record.get('finite_patch'), grid, step)
    # Contact is decided inside the complete patch, so a stray cell elsewhere on the grid cannot supply it.
    if not 0 <= patch['min_gap'] <= CONTACT_MAX_GAP:
        raise ValueError('Bath support patch leaves the contact interval')
    return patch


def validate_reviewed_hit(hit):
    review = hit.get('review', {})
    crossings = review.get('crossings', {})
    point = hit.get('point', [])
    if (hit.get('kind') != 'chair_inside_body' or hit.get('body') not in REVIEW_BODIES or hit.get('fixture') != REVIEW_FIXTURE
            or review.get('parity_inside') is not False
            or set(crossings) != {'+z', '-z', '+x', '-x', '+y', '-y'}
            or any(type(c) is not int or c < 0 or c % 2 for c in crossings.values())):
        raise ValueError('Reviewed containment hit is not an even-parity open trouser tube artifact on the shell')
    above = review.get('first_surface_above')
    if above is not None and not number(above) > REVIEW_CLEAR_ABOVE:
        raise ValueError('Reviewed containment hit has a surface within five millimetres above it')
    if len(point) != 3 or not FLOOR_Z-1e-5 <= number(point[2]) <= RIM_Z+1e-5:
        raise ValueError('Reviewed containment hit is not on the shell between floor and rim')


def validate_measurement(measurement, accepted, nod_degrees):
    """Check one sample against the accepted source's joint targets, wall plane and reviewed hits."""
    finite_tree(measurement)
    if (measurement.get('support_state') != 'passed' or not isinstance(measurement.get('collisions'), list)
            or measurement['collisions']):
        raise ValueError('Bath sample lost support or gained a collision')
    support = measurement['support']
    if set(support) != {'hip', 'back'}:
        raise ValueError('Bath support needs seat and wall certificates')
    for key in ('hip', 'back'):
        validate_certificate(support[key], key, accepted['plane'])
    errors = measurement['bone_length_errors']
    if set(errors) != BONE_NAMES or any(not 0 <= number(e) <= 1e-5 for e in errors.values()):
        raise ValueError('Bath sample changed anatomical lengths')
    if measurement.get('complete_body_fixture_pairs') != len(BODY_NAMES)*len(SOLID_NAMES):
        raise ValueError('Bath clearance did not test every body against every fixture solid')
    hits = measurement.get('reviewed_open_mesh_containment_hits')
    if not isinstance(hits, list) or hits != accepted['measurement']['reviewed_open_mesh_containment_hits']:
        raise ValueError('Bath sample reviewed containment hits differ from the accepted static trouser tubes')
    for hit in hits:
        validate_reviewed_hit(hit)
    return validate_targets(measurement['joint_targets'], accepted['measurement']['joint_targets'], nod_degrees)


def validate_contacts(rows, accepted, expected_frames=range(5)):
    expected, seen = set(expected_frames), set()
    for row in rows:
        frame = row['frame']
        if type(frame) is not int or frame not in expected or frame in seen or number(row['phase']) != frame/4:
            raise ValueError('Duplicate, unexpected or incomplete bath contact sample')
        seen.add(frame)
        if row.get('support_state') != 'passed':
            raise ValueError('Bath contact sample is not passed')
        validate_measurement(row['measurement'], accepted, head_nod(frame/4))
    if seen != expected or len(rows) != len(expected):
        raise ValueError('Missing complete bath sample/closure contact matrix')


def validate_geometry(rows, rendered_inventory):
    expected, seen, fixtures = set(itertools.product(FACINGS, range(4))), set(), {}
    for row in rows:
        key = (row['facing'], row['frame'])
        if key in seen or key not in expected or type(row['frame']) is not int:
            raise ValueError('Duplicate or unexpected bath geometry check')
        seen.add(key)
        if number(row['minimum_canvas_margin']) < MIN_CANVAS_MARGIN:
            raise ValueError('Bath render reaches its canvas border')
        if set(row.get('body', {})) != set(rendered_inventory) or set(row.get('fixture', {})) != SOLID_NAMES | {WATER_NAME}:
            raise ValueError('Bath geometry check does not digest every rendered body and fixture object')
        if fixtures.setdefault(row['facing'], row['fixture']) != row['fixture']:
            raise ValueError('Bath loop moved fixture or water geometry between frames')
    if seen != expected:
        raise ValueError('Missing complete bath geometry check matrix')


def validate_strokes(rows, rendered_inventory):
    expected, seen = set(itertools.product(FACINGS, range(4))), set()
    for row in rows:
        key = (row['facing'], row['frame'])
        if (key not in expected or key in seen or type(row['frame']) is not int
                or row['body_owned_stroke_inventory'] != sorted(rendered_inventory)
                or row['full_scene_occlusion'] is not True or row['fixture_geometry_hidden'] is not False
                or row['body_and_fixture_holdout'] is not False):
            raise ValueError('Bath body-ink stroke ownership is incomplete')
        seen.add(key)
    if seen != expected:
        raise ValueError('Missing complete bath body-ink stroke matrix')


def validate_appearance(appearance, inventory):
    finite_tree(appearance)
    omitted = appearance.get('omitted_render_details', [])
    assignments = appearance.get('material_assignments', {})
    if (appearance.get('explicit_anatomy_added') is not False or appearance.get('preserved_geometry_weights') is not True
            or set(omitted) != OMITTED_GARMENT_DETAILS or len(omitted) != len(OMITTED_GARMENT_DETAILS)
            or set(inventory) != BODY_NAMES-OMITTED_GARMENT_DETAILS or len(inventory) != RENDERED_BODY_COUNT
            or set(assignments) != SKIN_BODIES
            or any(record.get('shower_material') != SKIN_MATERIAL for record in assignments.values())):
        raise ValueError('Bath appearance is not the declared bathing appearance over the complete body')


def read_loop(path, *, process_exited):
    if process_exited is not True:
        raise ValueError('Wait for the source writer to finish before importing')
    path = Path(path).resolve()
    proof = json.loads(path.read_text())
    if proof.get('schema') != 1 or proof.get('state') != 'complete' or proof.get('immutable_inputs_preserved') is not True:
        raise ValueError('Missing complete immutable bath source receipt')
    if not path.is_relative_to((BASE/'review/bath').resolve()):
        raise ValueError('Bath source receipt must stay in its owned review directory')
    finite_tree(proof)
    source = proof['accepted_source']
    if source.get('proof_path') != ACCEPTED_BASE+'/proof.json' or source.get('model_path') != ACCEPTED_MODEL:
        raise ValueError('Bath loop changed its accepted baseline identity')
    accepted_path = checked_file(MODELS, dict(path=source['proof_path'], sha256=source['proof_sha256']))
    checked_file(MODELS, dict(path=source['model_path'], sha256=source['model_sha256']))
    accepted = json.loads(accepted_path.read_text())
    if (accepted.get('state') != 'complete' or accepted['editable_model']['sha256'] != source['model_sha256']
            or accepted['measurement']['support_state'] != 'passed'):
        raise ValueError('Bath accepted source/model binding changed')
    if not set(proof['inputs']) >= set(accepted['inputs']) | LOOP_EXTRA_INPUTS:
        raise ValueError('Bath transitive input inventory is incomplete')
    for name, sha in proof['inputs'].items():
        checked_file(MODELS, dict(path=name, sha256=sha))
        if name.endswith('.py'):
            checked_file(path.parent/'source', dict(path=name, sha256=sha))
    if any(proof['inputs'][name] != sha for name, sha in accepted['inputs'].items()):
        raise ValueError('Bath loop changed an immutable baseline dependency')
    checked_file(path.parent, proof['editable_model'])
    validate_action(proof['action'])
    validate_registration(proof, accepted)
    validate_measurement(accepted['measurement'], accepted, 0)
    validate_closure(proof['closure'], accepted['measurement']['joint_targets'])
    if proof.get('palette_independent') is not True:
        raise ValueError('Bath loop must declare its single bathing appearance')
    validate_appearance(proof['bathing_appearance'], proof['rendered_body_inventory'])
    if proof['water'] != accepted['water'] or proof['plane'] != accepted['plane']:
        raise ValueError('Bath loop changed the accepted water or wall plane')
    for field in ('manual_contacts', 'contacts', 'reopened_contacts'):
        validate_contacts(proof[field], accepted)
    validate_geometry(proof['geometry_checks'], proof['rendered_body_inventory'])
    rows = validate_render_rows(proof['renders'])
    checks = {row['path']:row for row in proof['raster_checks']}
    if set(checks) != {row['path'] for row in rows.values()} or any(
            check['width'] != ORIGINAL_DIMENSIONS[0] or check['height'] != ORIGINAL_DIMENSIONS[1] or check['border_alpha_max'] != 0
            for check in checks.values()):
        raise ValueError('Bath raster checks do not cover every original render inside its canvas')
    for row in rows.values():
        read_png(path.parent, row, ORIGINAL_DIMENSIONS)
    return proof


def read_ink(path, source_path, source):
    path = Path(path).resolve()
    if not path.is_relative_to((BASE/'review/bath').resolve()):
        raise ValueError('Body ink must stay in the owned bath review directory')
    ink = json.loads(path.read_text())
    validate_ink_binding(ink, source, digest(source_path))
    validate_strokes(ink['stroke_ownership'], source['rendered_body_inventory'])
    if ink.get('producer_sha256') != digest(BASE/'render_bath_loop.py'):
        raise ValueError('Body-ink producer differs from its pinned implementation')
    rows = validate_render_rows(ink['renders'], ink=True)
    for row in rows.values():
        read_png(path.parent, row, ORIGINAL_DIMENSIONS)
    return ink, rows
