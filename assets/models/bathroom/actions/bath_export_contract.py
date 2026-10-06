"""Validate complete bathing loop evidence without importing Blender.

The bathing loop has one appearance for every shirt variant (the declared bathing appearance
replaces the shirt with skin), so its source matrix is four facings by four frames by four
owners plus sixteen body-ink passes. Support is the measured seat patch on the basin floor and
the back patch against the head-end wall, each a complete finite grid; clearance is every one of
the 54 body objects against all twelve fixture solids.
"""
import itertools
import json
import re
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path.insert(0, str(MODELS/'seating'))
sys.path.insert(0, str(BASE))
from seat_export_contract import BODY_NAMES, BONE_NAMES, inside, checked_file, digest
from bathroom_export_contract import finite_tree, number, validate_ink_binding

# Presentation body-action code shared with `render_buffer::visual_action::BATHE`.
BATHE_ACTION = 19
FACINGS = ('SE', 'NW', 'SW', 'NE')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
SOLID_NAMES = {'Bathtub continuous shell', 'Bathtub curved spout', 'Bathtub drain', 'Bathtub inset plinth',
               'Bathtub overflow', 'Bathtub tap foot', 'Bathtub tap base -0.135', 'Bathtub tap base 0.135',
               'Bathtub tap stem -0.135', 'Bathtub tap stem 0.135', 'Bathtub tap handle -0.135',
               'Bathtub tap handle 0.135'}
ACTION = dict(name='bath_idle_v1', samples=4, closure_frame=4, half_cycle_ticks=8, loop_ticks=16)
ACCEPTED_BASE = 'bathroom/actions/review/bath/prototype-12-wall-backed-water'
ACCEPTED_MODEL = ACCEPTED_BASE+'/bath-pose-authoring.blend'
TUB_SOURCE = 'bathroom/owner-review-pending/bathtub/candidate-02/bathtub-authoring.blend'
LOOP_EXTRA_INPUTS = {'bathroom/actions/render_bath_loop.py', 'bathroom/actions/bath_loop_v1.py',
                     'bathroom/actions/test_bath_loop.py', ACCEPTED_BASE+'/proof.json', ACCEPTED_MODEL}
ORIGINAL_DIMENSIONS = [1280, 1408]
LOGICAL_CANVAS = [160, 176]
RENDERED_BODY_COUNT = 41
MIN_PATCH = dict(width=.025, depth=.03, area=.001)


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


def validate_closure(closure, accepted_targets):
    finite_tree(closure)
    flags = ('manual_exact_phase0', 'manual_exact_endpoint', 'saved_exact_phase0', 'saved_exact_endpoint',
             'all54_evaluated', 'head_nod_only')
    if (any(closure.get(key) is not True for key in flags) or closure.get('limb_movement') is not False
            or set(closure.get('complete_body_inventory', [])) != BODY_NAMES
            or len(closure['complete_body_inventory']) != len(BODY_NAMES)
            or set(closure.get('named_bones', {})) != BONE_NAMES):
        raise ValueError('Missing exact complete-body bath loop closure')
    for name, target in closure['named_bones'].items():
        for field in ('head', 'tail'):
            if len(target[field]) != 3 or any(abs(number(a)-number(b)) > 1e-7 for a, b in zip(target[field], accepted_targets[name][field])):
                raise ValueError('Bath loop closure left the accepted joint targets')


def validate_patch(patch):
    if patch is None:
        raise ValueError('Bath support lacks a finite patch')
    width, depth, area = number(patch['width']), number(patch['depth']), number(patch['area'])
    if (width < MIN_PATCH['width'] or depth < MIN_PATCH['depth'] or area < MIN_PATCH['area']
            or patch.get('complete_cartesian_surface_grid') is not True or type(patch['samples']) is not int
            or patch['samples'] < 9 or not 0 <= number(patch['min_gap']) <= number(patch['max_gap']) <= .01
            or len(patch['actual_witnesses']) != patch['samples']):
        raise ValueError('Bath support patch is not a complete finite neighborhood')


def validate_measurement(measurement):
    finite_tree(measurement)
    if measurement.get('support_state') != 'passed' or measurement.get('collisions'):
        raise ValueError('Bath sample lost support or gained a collision')
    support = measurement['support']
    if set(support) != {'hip', 'back'}:
        raise ValueError('Bath support needs seat and wall certificates')
    for key in ('hip', 'back'):
        record = support[key]
        if record.get('state') != 'passed' or type(record['actual_surface_ray_hits']) is not int or record['actual_surface_ray_hits'] <= 0:
            raise ValueError('Bath support certificate is not a passed actual-surface measurement')
        if not 0 <= number(record['min_gap']) <= .003:
            raise ValueError('Bath support minimum gap leaves the contact interval')
        validate_patch(record['finite_patch'])
    errors = measurement['bone_length_errors']
    if set(errors) != BONE_NAMES or any(not 0 <= number(e) <= 1e-5 for e in errors.values()):
        raise ValueError('Bath sample changed anatomical lengths')
    if measurement.get('complete_body_fixture_pairs') != len(BODY_NAMES)*len(SOLID_NAMES):
        raise ValueError('Bath clearance did not test every body against every fixture solid')
    for hit in measurement.get('reviewed_open_mesh_containment_hits', []):
        review = hit['review']
        if review.get('parity_inside') is not False or any(type(c) is not int or c % 2 for c in review['crossings'].values()):
            raise ValueError('Reviewed containment hit is not an even-parity open-mesh artifact')
    if set(measurement['joint_targets']) != BONE_NAMES:
        raise ValueError('Bath sample joint targets are incomplete')


def validate_contacts(rows, expected_frames=range(5)):
    expected, seen = set(expected_frames), set()
    for row in rows:
        frame = row['frame']
        if type(frame) is not int or frame not in expected or frame in seen or number(row['phase']) != frame/4:
            raise ValueError('Duplicate, unexpected or incomplete bath contact sample')
        seen.add(frame)
        if row.get('support_state') != 'passed':
            raise ValueError('Bath contact sample is not passed')
        validate_measurement(row['measurement'])
    if seen != expected or len(rows) != len(expected):
        raise ValueError('Missing complete bath sample/closure contact matrix')


def validate_strokes(rows):
    expected, seen = set(itertools.product(FACINGS, range(4))), set()
    for row in rows:
        key = (row['facing'], row['frame'])
        inventory = set(row['body_owned_stroke_inventory'])
        if (key not in expected or key in seen or type(row['frame']) is not int
                or len(row['body_owned_stroke_inventory']) != RENDERED_BODY_COUNT or not inventory <= BODY_NAMES
                or row['full_scene_occlusion'] is not True or row['fixture_geometry_hidden'] is not False
                or row['body_and_fixture_holdout'] is not False):
            raise ValueError('Bath body-ink stroke ownership is incomplete')
        seen.add(key)
    if seen != expected:
        raise ValueError('Missing complete bath body-ink stroke matrix')


def validate_appearance(appearance, inventory):
    finite_tree(appearance)
    if (appearance.get('explicit_anatomy_added') is not False or appearance.get('preserved_geometry_weights') is not True
            or len(appearance.get('omitted_render_details', [])) != 13
            or set(inventory) | set(appearance['omitted_render_details']) != BODY_NAMES
            or len(inventory) != RENDERED_BODY_COUNT):
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
    validate_closure(proof['closure'], accepted['measurement']['joint_targets'])
    validate_measurement(accepted['measurement'])
    if proof.get('palette_independent') is not True:
        raise ValueError('Bath loop must declare its single bathing appearance')
    validate_appearance(proof['bathing_appearance'], proof['rendered_body_inventory'])
    if proof['water'] != accepted['water'] or proof['plane'] != accepted['plane']:
        raise ValueError('Bath loop changed the accepted water or wall plane')
    for field in ('manual_contacts', 'contacts', 'reopened_contacts'):
        validate_contacts(proof[field])
    rows = validate_render_rows(proof['renders'])
    checks = {row['path']:row for row in proof['raster_checks']}
    if set(checks) != {row['path'] for row in rows.values()} or any(
            check['width'] != ORIGINAL_DIMENSIONS[0] or check['height'] != ORIGINAL_DIMENSIONS[1] or check['border_alpha_max'] != 0
            for check in checks.values()):
        raise ValueError('Bath raster checks do not cover every original render inside its canvas')
    for row in rows.values():
        checked_file(path.parent, row)
    return proof


def read_ink(path, source_path, source):
    path = Path(path).resolve()
    if not path.is_relative_to((BASE/'review/bath').resolve()):
        raise ValueError('Body ink must stay in the owned bath review directory')
    ink = json.loads(path.read_text())
    validate_ink_binding(ink, source, digest(source_path))
    validate_strokes(ink['stroke_ownership'])
    if ink.get('producer_sha256') != digest(BASE/'render_bath_loop.py'):
        raise ValueError('Body-ink producer differs from its pinned implementation')
    rows = validate_render_rows(ink['renders'], ink=True)
    for row in rows.values():
        checked_file(path.parent, row)
    return ink, rows
