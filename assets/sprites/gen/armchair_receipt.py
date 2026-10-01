"""Validate retained generation evidence without requiring Blender in atlas builds."""
import hashlib
import json
import math
from pathlib import Path
import re

from offline_props import inside

FACINGS = ('SE', 'NW', 'SW', 'NE')
VARIANTS = ('green', 'blue', 'red')
RENDER_INPUTS = {
    'living/armchair_batch.py', 'living/armchair_contact.py', 'living/armchair_support.py',
    'living/render_armchair_contributions.py', 'living/armchair_layout.py',
    'living/armchair_model.py', 'living/render_armchair.py', 'bedroom/bunk_contact.py',
    'bathroom/check_toilet_scene.py', 'kitchen/check_stove_scene.py', 'kitchen/render_static.py',
    'furniture/animation_export.py', 'furniture/build_parts.py', 'furniture/geometry.py',
    'furniture/preview.py', 'sims/sim-01/sim-01-rigged.blend',
    'sims/sim-01/registered-canvas-proof.json', 'sims/sim-01/render_shirt_variants.py',
    'sims/sim-01/shirt_colors.py', 'sims/sim-01/render_job.py', 'sims/sim-01/build_rig.py',
    'sims/sim-01/rig_math.py', 'sims/sim-01/food_depth.py',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def vector(value):
    return isinstance(value, list) and len(value) == 3 and all(number(v) for v in value)


def exact_inventory(value, expected):
    return (isinstance(value, list) and len(value) == len(expected)
            and all(isinstance(v, str) for v in value) and set(value) == expected)


def validate_contacts(samples):
    singles = ('Collar stand', 'HAIR_01_TRIPO_CURL', 'Natural neck', 'One sewn breast pocket',
               'Overshirt body', 'Pocket top seam', 'Quiet closed smile', 'Sculpted head',
               'Shirt lower hem', 'Shirt placket', 'Small rounded nose', 'Trouser hip bridge')
    pairs = ('Dark pupil', 'Ear', 'Eye white', 'Fitted rounded shoe sole',
             'Folded fabric collar leaf', 'Forearm with elbow and wrist sections', 'Hazel iris',
             'Inner ear', 'Relaxed palm', 'Relaxed shirt sleeve', 'Resting thumb', 'Shaped shoe',
             'Shoe apron stitch', 'Small eye catchlight', 'Soft eyebrow', 'Tailored trouser leg',
             'Trouser hem', 'Turned sleeve cuff', 'Upper lid outline')
    body = set(singles) | {name+suffix for name in pairs for suffix in ('', '.001')} | {
        'Small horn button'+suffix for suffix in ('', '.001', '.002', '.003')}
    feet = {f'Foot {x} {y}' for x in (-.18, .28) for y in (-.3, .3)}
    chair = feet | {'Upholstered base', 'Upholstered back', 'Arm left', 'Arm right',
                    'Seat cushion', 'Back cushion'}
    support_names = {f'Upholstered base / {foot}' for foot in feet} | {
        'Upholstered back / Upholstered base', 'Seat cushion / Upholstered base',
        'Back cushion / Upholstered back', 'Back cushion / Seat cushion'} | {
        f'Arm {side} / {support}' for side in ('left', 'right')
        for support in ('Upholstered base', 'Upholstered back')}
    if not isinstance(samples, list) or len(samples) != 4:
        raise ValueError('Incomplete armchair contact samples')
    frames = set()
    for row in samples:
        if not isinstance(row, dict) or type(row.get('frame')) is not int or row['frame'] in frames:
            raise ValueError('Invalid or duplicate armchair contact frame')
        frames.add(row['frame'])
        for field, expected in (('body_inventory', body), ('chair_inventory', chair),
                                ('grounded_chair_feet', feet)):
            if not exact_inventory(row.get(field), expected):
                raise ValueError('Armchair contact inventory changed')
        if row.get('excluded_visible_geometry') != [] or row.get('body_chair_intersections') != []:
            raise ValueError('Armchair contact excludes geometry or reports penetration')
        support = row.get('hip_support', {})
        gap, area = support.get('min_gap'), support.get('xy_hull_area')
        counts = [support.get(name) for name in ('ray_hits', 'contact_count')]
        if (not number(gap) or not 0 <= gap <= .003 or not number(area) or area < .0024
                or support.get('near_gap_limit') != .01
                or any(type(n) is not int for n in counts) or not counts[0] >= counts[1] >= 3):
            raise ValueError('Invalid armchair hip support measurement')
        bounds = support.get('contact_bounds')
        if (not isinstance(bounds, list) or len(bounds) != 2 or not all(vector(v) for v in bounds)
                or any(bounds[0][i] > bounds[1][i] for i in range(3))
                or bounds[1][0]-bounds[0][0] < .08 or bounds[1][1]-bounds[0][1] < .12
                or area > (bounds[1][0]-bounds[0][0])*(bounds[1][1]-bounds[0][1])+1e-9):
            raise ValueError('Invalid armchair support footprint')
        contacts = row.get('structural_contacts')
        if (not isinstance(contacts, dict) or set(contacts) != support_names
                or not all(vector(value) for value in contacts.values())):
            raise ValueError('Incomplete armchair structural contacts')
        soles = row.get('shoe_floor_clearance')
        if (not isinstance(soles, dict) or set(soles) != {'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'}
                or any(not number(v) or not .018 <= v <= .020 for v in soles.values())):
            raise ValueError('Inherited shoe clearance changed')
    if frames != {1, 2, 3, 4}:
        raise ValueError('Incomplete armchair contact frame coverage')


def validate_comparison(report):
    if report.get('production_export') is not True or report.get('checked_groups') != 48:
        raise ValueError('Armchair reconstruction evidence is incomplete')
    found = set()
    for row in report.get('comparisons', []):
        key = (row.get('facing'), row.get('variant'), row.get('frame'))
        if type(key[2]) is not int or key in found:
            raise ValueError('Invalid or duplicate armchair comparison sample')
        found.add(key)
        for field in ('max_error', 'p95_error', 'active_pixels', 'pixels_above_8'):
            if type(row.get(field)) is not int or row[field] < 0:
                raise ValueError('Invalid armchair comparison metric')
        if (row['max_error'] > 64 or row['p95_error'] > 12 or row['active_pixels'] == 0
                or row['p95_error'] > row['max_error'] or row['pixels_above_8'] > row['active_pixels']):
            raise ValueError('Armchair reconstruction exceeds acceptance limits')
    if found != {(f, v, i) for f in FACINGS for v in VARIANTS for i in range(4)}:
        raise ValueError('Incomplete armchair comparison coverage')


def load_receipt(catalog_path):
    catalog_path = Path(catalog_path).resolve()
    catalog = json.loads(catalog_path.read_text())
    if catalog.get('review_status') != 'accepted-independent-review':
        raise ValueError('Armchair export needs independent review')
    paths, values = {}, {}
    for field in ('manifest', 'raw_proof', 'comparison', 'contact_check'):
        ref = catalog.get(field, {})
        path = inside(catalog_path.parent, ref.get('path'))
        if digest(path) != ref.get('sha256'):
            raise ValueError(f'Reviewed armchair {field} hash changed')
        paths[field] = path
        values[field] = json.loads(path.read_text())
    raw, comparison, manifest, contact = (values[key] for key in ('raw_proof', 'comparison', 'manifest', 'contact_check'))
    validate_comparison(comparison)
    validate_contacts(raw.get('contact_samples'))
    if (raw.get('state') != 'complete' or not raw.get('blender_version') or not raw.get('blender_build_hash')
            or contact.get('state') != 'passed' or contact.get('samples') != raw['contact_samples']
            or any(contact.get(key) != raw[key] for key in ('blender_version', 'blender_build_hash'))):
        raise ValueError('Armchair raw/contact proof is incomplete or inconsistent')
    queries = {'separated solids', 'body containment', 'chair containment', 'crossed thin surfaces'}
    if not exact_inventory(contact.get('query_tests'), queries):
        raise ValueError('Incomplete armchair collision-query tests')
    mutations = contact.get('caught_mutations', [])
    expected_mutations = {
        'raised seat': ('Body intersects chair:', 'Seat cushion'),
        'floating hip': ('Hip lost non-penetrating seat support', ''),
        'lowered seat': ('Hip lost non-penetrating seat support', ''),
        'raised arm': ('Body intersects chair:', 'Arm left'),
        'raised foot': ('Foot -0.18 -0.3 lost floor contact', ''),
        'detached foot': ('Upholstered base detached from Foot -0.18 -0.3', ''),
        'hidden hip': ('Visible Sim inventory changed', ''),
        'wrong chair facing': ('Armchair authored basis changed', ''),
    }
    if (not isinstance(mutations, list) or len(mutations) != len(expected_mutations)
            or any(not isinstance(row, dict) or not isinstance(row.get('rejection'), str)
                   or not row['rejection'] for row in mutations)
            or {row.get('mutation') for row in mutations} != set(expected_mutations)):
        raise ValueError('Incomplete armchair damaged-scene tests')
    for row in mutations:
        prefix, detail = expected_mutations[row['mutation']]
        if not row['rejection'].startswith(prefix) or detail not in row['rejection']:
            raise ValueError('Armchair damaged scene failed for the wrong reason')
    for item in (comparison, manifest):
        if item.get('raw_proof_sha256') != catalog['raw_proof']['sha256']:
            raise ValueError('Armchair raw proof binding changed')
    if comparison.get('manifest_sha256') != catalog['manifest']['sha256'] or manifest.get('anchor') != raw.get('anchor'):
        raise ValueError('Armchair manifest binding or registration changed')
    models = catalog_path.parent.parent
    signature = raw.get('signature', {})
    inputs = signature.get('inputs', {})
    models_in_inputs = {name for name in inputs if name.endswith('/armchair-authoring.blend')}
    if len(models_in_inputs) != 1:
        raise ValueError('Missing or ambiguous armchair model')
    model_name = next(iter(models_in_inputs))
    proof_name = (Path(model_name).parent/'proof.json').as_posix()
    if (set(inputs) != RENDER_INPUTS | {model_name, proof_name}
            or signature.get('source_density') != 8 or signature.get('logical_canvas') != [96, 120]
            or signature.get('body_action') != 'sit' or signature.get('body_offset') != [0, 0, 0]
            or signature.get('body_degrees_offset') != -90):
        raise ValueError('Armchair render dependency inventory or body registration changed')
    if contact.get('model_sha256') != inputs[model_name]:
        raise ValueError('Armchair contact binds a different model')
    for name, sha in inputs.items():
        if digest(inside(models, name)) != sha:
            raise ValueError(f'Armchair render dependency changed: {name}')
    for field, name in (('encoder_sha256', 'living/export_armchair.py'),
                        ('partition_sha256', 'furniture/layer_partition.py'),
                        ('comparison_sha256', 'furniture/export_contributions.py')):
        if digest(models/name) != comparison.get(field):
            raise ValueError('Armchair comparison implementation changed')
    if digest(models/'living/check_armchair_scene.py') != catalog.get('contact_checker_sha256'):
        raise ValueError('Armchair contact checker changed')
    found, raw_paths = set(), set()
    for row in raw.get('renders', []):
        key = (row.get('facing'), row.get('frame'), row.get('variant'), row.get('owner'))
        if type(key[1]) is not int or key in found:
            raise ValueError('Invalid or duplicate armchair raw sample')
        found.add(key)
        name = row.get('path')
        if name != f'armchair-{key[2]}-{key[0]}-{key[1]}-{key[3]}.png':
            raise ValueError('Armchair raw filename does not match its sample')
        raw_path = inside(paths['raw_proof'].parent, name)
        if raw_path in raw_paths:
            raise ValueError('Duplicate armchair raw path')
        raw_paths.add(raw_path)
        if not isinstance(row.get('sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', row['sha256']):
            raise ValueError('Invalid armchair raw image hash')
    expected = {(f, i, v, o) for f in FACINGS for i in range(4) for v in VARIANTS
                for o in ('beauty', 'sim', 'furniture', 'lines')} | {(f, 0, 'green', 'empty') for f in FACINGS}
    if found != expected:
        raise ValueError('Incomplete armchair raw coverage')
    return paths
