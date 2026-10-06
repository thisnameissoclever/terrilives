"""Validate complete fitted toilet animation evidence without importing Blender."""
import ast
from fractions import Fraction
from functools import lru_cache
import itertools
import json
import math
import re
from pathlib import Path
import sys
from PIL import Image

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path.insert(0, str(MODELS/'seating'))
from seat_export_contract import (BODY_NAMES, BONE_NAMES, inside, checked_file, read_png, digest,
                                  encode_scene, compare_scene, check_body_ink)
from contact_surface import connected_regions, signed_area, clip_polygon

FACINGS = ('SE', 'NW', 'SW', 'NE')
PALETTES = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
SOLID_NAMES = {'Toilet recessed bowl', 'Toilet open seat ring', 'Toilet pedestal',
    'Toilet rear ceramic neck', 'Toilet upper tank support', 'Toilet cistern',
    'Toilet cistern cap', 'Toilet flush button', 'Toilet seat bumper -1', 'Toilet seat bumper 1',
    'Toilet hinge mount -1', 'Toilet hinge mount 1', 'Toilet hinge axle', 'Toilet upright lid'}
ACTION = dict(name='toilet_idle_v1', samples=4, closure_frame=4, half_cycle_ticks=8, loop_ticks=16)
# Presentation body-action code shared with `render_buffer::visual_action::USE_TOILET`
# in crates/terri-sim/src/render_buffer.rs. Codes 14 to 17 belong to the cleaning chores.
USE_TOILET_ACTION = 18
ACCEPTED_BASE = 'bathroom/actions/review/toilet/prototype-08-curved-support'
LOOP_EXTRA_INPUTS = {'bathroom/actions/render_toilet_loop.py', 'bathroom/actions/render_toilet_ink.py',
    'bathroom/actions/toilet_loop_v1.py', 'bathroom/actions/test_toilet_loop.py',
    'sims/sim-01/render_shirt_variants.py', 'sims/sim-01/shirt_colors.py',
    ACCEPTED_BASE+'/proof.json', ACCEPTED_BASE+'/toilet-pose-authoring.blend'}


def validate_render_rows(rows, ink=False):
    expected = (set(itertools.product(FACINGS, ('green',), range(4), ('body_ink',))) if ink
                else set(itertools.product(FACINGS, PALETTES, range(4), OWNERS)))
    result, paths = {}, set()
    for row in rows:
        key = (row['facing'], row['variant'], row['frame'], row['owner'])
        if key not in expected or key in result or type(row['frame']) is not int or row['path'] in paths:
            raise ValueError('Duplicate or unexpected bathroom render sample/path')
        inside(BASE, row['path'])
        if not isinstance(row['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', row['sha256']):
            raise ValueError('Missing exact bathroom render hash')
        result[key] = row
        paths.add(row['path'])
    if set(result) != expected or len(rows) != len(expected):
        raise ValueError('Missing complete bathroom facing/palette/sample/owner renders')
    return result


def finite_tree(value):
    if isinstance(value, dict):
        for child in value.values():
            finite_tree(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            finite_tree(child)
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Bathroom evidence contains a non-finite number')


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('Bathroom measurement must be a finite number')
    return value


def validate_action(action):
    if ({key:action.get(key) for key in ACTION} != ACTION or set(action)-set(ACTION) not in (set(), {'sample_fps'})
            or ('sample_fps' in action and number(action['sample_fps']) != 2.5)
            or any(type(action.get(field)) is not int for field in
                   ('samples', 'closure_frame', 'half_cycle_ticks', 'loop_ticks'))):
        raise ValueError('Unsupported bathroom animation action')


def validate_registration(record, accepted):
    finite_tree(record)
    if (record.get('original_render_dimensions') != [768, 960]
            or record.get('logical_canvas') != [96, 120] or type(record.get('source_density')) is not int
            or record['source_density'] != 8
            or any(record.get(key) != accepted.get(key) for key in
                   ('original_render_dimensions', 'origin_pixels', 'camera_matrix', 'ortho_scale'))):
        raise ValueError('Bathroom camera or physical-origin registration differs from accepted source')


def validate_closure(closure, accepted_targets=None):
    finite_tree(closure)
    flags = ('manual_exact_phase0', 'manual_exact_endpoint', 'saved_exact_phase0', 'saved_exact_endpoint', 'all54_evaluated')
    if (any(closure.get(key) is not True for key in flags) or closure.get('foot_movement') is not False
            or set(closure.get('complete_body_inventory', [])) != BODY_NAMES
            or len(closure['complete_body_inventory']) != len(BODY_NAMES)
            or set(closure.get('named_bones', {})) != BONE_NAMES):
        raise ValueError('Missing exact complete-body bathroom loop closure')
    for target in closure['named_bones'].values():
        if set(target) != {'head', 'tail'} or any(len(target[key]) != 3 for key in ('head', 'tail')):
            raise ValueError('Incomplete named anatomical closure targets')
        for key in ('head', 'tail'):
            for value in target[key]:
                number(value)
    if accepted_targets is not None and closure['named_bones'] != accepted_targets:
        raise ValueError('Loop closure differs from the accepted anatomical targets')


def validate_geometry(rows):
    expected = set(itertools.product(FACINGS, PALETTES, range(4)))
    seen, baseline = set(), {}
    for row in rows:
        key = (row['facing'], row['variant'], row['frame'])
        if key not in expected or key in seen or type(row['frame']) is not int:
            raise ValueError('Duplicate or unexpected geometry sample')
        seen.add(key)
        geometry = row['geometry']
        if (row['complete_owner_consistency'] is not True or number(row['minimum_canvas_margin']) < 8
                or set(geometry['body']) != BODY_NAMES or set(geometry['fixture']) != SOLID_NAMES | {'Toilet bowl water'}
                or set(geometry['visible_body']) != BODY_NAMES or len(geometry['visible_body']) != len(BODY_NAMES)):
            raise ValueError('Geometry owner inventory or canvas margin is incomplete')
        hashes = [*geometry['body'].values(), *geometry['fixture'].values(), geometry['topology']]
        if any(not isinstance(sha, str) or not re.fullmatch('[0-9a-f]{64}', sha) for sha in hashes):
            raise ValueError('Geometry fingerprints are incomplete')
        sample = (row['facing'], row['frame'])
        if sample in baseline and geometry != baseline[sample]:
            raise ValueError('Palette changed geometry or visible ownership')
        baseline[sample] = geometry
    if seen != expected or len(rows) != len(expected):
        raise ValueError('Missing complete geometry palette matrix')


def validate_strokes(rows):
    expected, seen = set(itertools.product(FACINGS, range(4))), set()
    for row in rows:
        key = (row['facing'], row['frame'])
        if (key not in expected or key in seen or type(row['frame']) is not int
                or set(row['body_owned_stroke_inventory']) != BODY_NAMES
                or len(row['body_owned_stroke_inventory']) != len(BODY_NAMES)
                or row['full_scene_occlusion'] is not True or row['fixture_geometry_hidden'] is not False
                or row['body_and_fixture_holdout'] is not False):
            raise ValueError('Body ink ownership or scene occlusion is incomplete')
        seen.add(key)
    if seen != expected or len(rows) != len(expected):
        raise ValueError('Missing complete body ink ownership matrix')


def validate_palettes(palettes):
    if set(palettes) != set(PALETTES):
        raise ValueError('Missing exact palette inventory')
    source = ast.parse((MODELS/'sims/sim-01/render_shirt_variants.py').read_text())
    colors = next(ast.literal_eval(node.value) for node in source.body
                  if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'SHIRT_COLORS' for t in node.targets))
    material_path = checked_file(MODELS, dict(path='sims/sim-01/shirt-source-materials.json',
        sha256='a81ebf697ff680b9b8f0fa26435ebdd9758c927bd726dd03c8e798ada615c41d'))
    materials = json.loads(material_path.read_text())
    for variant in PALETTES:
        palette = palettes[variant]
        if palette['geometry_consistent'] is not True or palette['setter'] != 'immutable render_shirt_variants.set_shirt_colors':
            raise ValueError('Palette changed its frozen setter or geometry')
        changes = palette['material_changes']
        if variant == 'green':
            if changes:
                raise ValueError('Green palette changed source materials')
            continue
        if len(changes) != 3 or {c['material'] for c in changes} != set(colors[variant]):
            raise ValueError('Palette must change exactly the three approved shirt ramps')
        for change in changes:
            name = change['material']
            before, after = change['before'], change['after']
            if change['field'] != 'Color Ramp/ramp' or len(before) != 4 or len(after) != 4:
                raise ValueError('Palette changed non-ramp state or shade count')
            if before != materials[name]['Color Ramp/ramp']:
                raise ValueError('Palette baseline differs from frozen source materials')
            for old, new in zip(before, after):
                if (number(old['position']) != number(new['position']) or len(old['color']) != 4
                        or len(new['color']) != 4 or number(old['color'][3]) != number(new['color'][3])):
                    raise ValueError('Palette changed shade positions or opacity')
                for channel in range(3):
                    old_value, new_value = number(old['color'][channel]), number(new['color'][channel])
                    if old_value <= 0 or new_value <= 0:
                        raise ValueError('Palette shading ratio must remain positive')
                    expected = old_value * colors[variant][name][channel] / materials[name]['diffuse_color'][channel]
                    if abs(new_value-expected) > 1e-7:
                        raise ValueError('Palette does not preserve frozen setter shading ratios')


def exact_convex(polygon):
    """Return the polygon as exact rationals when it is strictly convex, counterclockwise and winds once.

    Python floats convert to Fraction exactly, so these predicates need no arithmetic tolerance.
    A locally convex closed polygon that winds k times changes the sign of its edge x-direction
    2k times, so a second circuit is rejected however small its displacement."""
    points = [(Fraction(x), Fraction(y)) for x, y in polygon]
    edges = [(b[0]-a[0], b[1]-a[1]) for a, b in zip(points, points[1:]+points[:1])]
    if len(points) < 3 or any(e[0]*f[1]-e[1]*f[0] <= 0 for e, f in zip(edges, edges[1:]+edges[:1])):
        raise ValueError('Contact partition must turn strictly left at every vertex')
    signs = [dx > 0 for dx, _ in edges if dx != 0]
    if sum(a != b for a, b in zip(signs, signs[1:]+signs[:1])) != 2:
        raise ValueError('Contact partition must wind exactly once')
    return points


@lru_cache(maxsize=None)
def uncertified_cell_area(bounds, polygons):
    """Exact upper bound on the cell area that no partition covers.

    The union of the partitions clipped to the cell covers at least the sum of their areas minus
    the sum of their pairwise overlaps, so the returned shortfall never understates a hole. Summed
    partition areas alone cannot prove coverage: many thin pieces overlapping by less than the
    pairwise tolerance would otherwise hide a hole as large as all those overlaps together."""
    left, bottom, right, top = (Fraction(v) for v in bounds)
    cell = [(left, bottom), (right, bottom), (right, top), (left, top)]
    pieces = [piece for piece in (clip_polygon(exact_convex(p), cell) for p in polygons) if len(piece) >= 3]
    boxes = [(min(x for x, _ in p), min(y for _, y in p), max(x for x, _ in p), max(y for _, y in p)) for p in pieces]
    lower = sum(signed_area(piece) for piece in pieces)
    for i, (piece, a) in enumerate(zip(pieces, boxes)):
        for other, b in zip(pieces[:i], boxes[:i]):
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                overlap = clip_polygon(piece, other)
                if len(overlap) >= 3:
                    lower -= signed_area(overlap)
    return (right-left)*(top-bottom)-lower


def validate_curved(support):
    if support['state'] != 'passed' or support['certificate_shape'] != 'mirrored edge-connected actual-surface cell union':
        raise ValueError('Missing actual curved contact certificate')
    areas = {}
    for cell in support['continuous_cells']:
        key = tuple(cell['cell'])
        if len(key) != 2 or any(type(i) is not int for i in key) or key in areas or len(cell['mirrored_pair']) != 2:
            raise ValueError('Duplicate or incomplete mirrored contact cell')
        pair_areas = []
        for side, certificate in enumerate(cell['mirrored_pair']):
            cell_x = key[0] if side == 0 else -key[0]-1
            bounds = (cell_x*.003, -.1+key[1]*.003, (cell_x+1)*.003, -.1+(key[1]+1)*.003)
            low, high = number(certificate['min_gap']), number(certificate['max_gap'])
            area = number(certificate['area'])
            if not 0 <= low <= high <= .01 or not 0 < area <= .003*.003+1e-12:
                raise ValueError('Continuous contact gap or physical area is invalid')
            total, gaps, polygons = 0., [], []
            for partition in certificate['partitions']:
                polygon, values = partition['polygon_xy'], partition['gaps']
                if len(polygon) < 3 or len(values) != len(polygon) or any(len(p) != 2 for p in polygon):
                    raise ValueError('Incomplete contact partition')
                for p in polygon:
                    for v in p:
                        number(v)
                    if not bounds[0]-1e-12 <= p[0] <= bounds[2]+1e-12 or not bounds[1]-1e-12 <= p[1] <= bounds[3]+1e-12:
                        raise ValueError('Contact partition lies outside its declared physical cell')
                gaps.extend(number(v) for v in values)
                partition_area = signed_area(polygon)
                if partition_area <= 0:
                    raise ValueError('Contact partition has no positive physical area')
                if len({tuple(point) for point in polygon}) != len(polygon):
                    raise ValueError('Contact partition repeats a physical vertex')
                exact_convex(polygon)
                for previous in polygons:
                    overlap = clip_polygon(polygon, previous)
                    if len(overlap) >= 3 and signed_area(overlap) > 1e-12:
                        raise ValueError('Contact partitions overlap and leave ambiguous coverage')
                polygons.append(polygon)
                total += partition_area
            if (not gaps or min(gaps) != low or max(gaps) != high or abs(total-area) > 1e-12
                    or abs(area-.003*.003) > 1e-12):
                raise ValueError('Contact extrema or area disagree with full partition evidence')
            shortfall = uncertified_cell_area(bounds, tuple(tuple(tuple(p) for p in poly) for poly in polygons))
            if shortfall > Fraction(1e-12):
                raise ValueError('Contact partitions leave uncertified area inside the physical cell')
            pair_areas.append(area)
        areas[key] = min(pair_areas)
    if not areas or not support['eligible_regions']:
        raise ValueError('Missing supported curved region')
    for region in support['eligible_regions']:
        keys = [tuple(key) for key in region['cells']]
        if len(keys) != len(set(keys)) or any(key not in areas for key in keys):
            raise ValueError('Region claims uncertified or duplicate cells')
        recomputed = connected_regions({key:areas[key] for key in keys}, .003)
        if len(recomputed) != 1:
            raise ValueError('Supported region is not full-edge connected')
        expected = recomputed[0]
        if (abs(number(region['area'])-expected['area']) > 1e-12
                or number(region['width']) != expected['width'] or number(region['depth']) != expected['depth']
                or region['area'] < .0007 or region['width'] < .015 or region['depth'] < .035):
            raise ValueError('Finite curved contact area or span is incomplete')


def validate_contacts(rows):
    expected, seen = set(itertools.product(PALETTES, range(5))), set()
    for row in rows:
        finite_tree(row)
        key = (row['variant'], row['frame'])
        if key not in expected or key in seen or type(row['frame']) is not int or number(row['phase']) != row['frame']/4:
            raise ValueError('Duplicate, unexpected or incomplete bathroom contact sample')
        seen.add(key)
        metrics = row['physical_metrics']
        expected_hands = set(itertools.product(
            ('Relaxed palm', 'Resting thumb', 'Relaxed palm.001', 'Resting thumb.001'),
            ('Trouser hip bridge', 'Tailored trouser leg', 'Tailored trouser leg.001')))
        hands = metrics['hand_clothing_proximity']
        if len(hands) != 12 or {(p['hand'], p['clothing']) for p in hands} != expected_hands:
            raise ValueError('Missing complete hand/clothing proximity evidence')
        for hand in hands:
            expected_side = 'R' if hand['hand'].endswith('.001') else 'L'
            if (hand['side'] != expected_side or not 0 <= number(hand['min_surface_distance'])
                    <= number(hand['max_surface_distance'])):
                raise ValueError('Hand distance or anatomical side is invalid')
        if (type(metrics['ring_ray_hits']) is not int or metrics['ring_ray_hits'] <= 0
                or not number(metrics['ring_min_gap']) <= number(metrics['ring_max_gap'])):
            raise ValueError('Ring ray count or ordered gap interval is invalid')
        for sole in metrics['soles'].values():
            if (type(sole['evaluated_vertex_count']) is not int or sole['evaluated_vertex_count'] <= 0
                    or not number(sole['min_z']) <= number(sole['max_z'])):
                raise ValueError('Sole geometry evidence is invalid')
        if (set(metrics['body_inventory']) != BODY_NAMES or len(metrics['body_inventory']) != len(BODY_NAMES)
                or set(metrics['fixture_solids']) != SOLID_NAMES or len(metrics['fixture_solids']) != len(SOLID_NAMES)
                or metrics['complete_body_solid_pairs'] != 756 or type(metrics['complete_body_solid_pairs']) is not int
                or set(metrics['bone_length_errors']) != BONE_NAMES or metrics['collisions']
                or any(p['intersection'] for p in metrics['hand_clothing_proximity'])):
            raise ValueError('Bathroom named body, fixture, bone or clearance evidence is incomplete')
        if (not 0 <= number(metrics['ring_min_gap']) <= .003
                or any(not 0 <= number(error) <= 1e-5 for error in metrics['bone_length_errors'].values())
                or set(metrics['soles']) != {'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'}
                or any(not .018 <= number(sole['min_z']) <= .020 for sole in metrics['soles'].values())):
            raise ValueError('Bathroom support, sole or anatomical lengths failed')
        validate_curved(row['curved_support'])
    if seen != expected or len(rows) != len(expected):
        raise ValueError('Missing complete palette/sample/closure contact matrix')


def read_loop(path, *, process_exited):
    if process_exited is not True:
        raise ValueError('Wait for the source writer to finish before importing')
    path = Path(path).resolve()
    proof = json.loads(path.read_text())
    if proof.get('schema') != 1 or proof.get('state') != 'complete' or proof.get('immutable_inputs_preserved') is not True:
        raise ValueError('Missing complete immutable bathroom source receipt')
    if not path.is_relative_to((BASE/'review/toilet').resolve()):
        raise ValueError('Bathroom source receipt must stay in its owned review directory')
    finite_tree(proof)
    source = proof['accepted_source']
    if source.get('proof_path') != ACCEPTED_BASE+'/proof.json' or source.get('model_path') != ACCEPTED_BASE+'/toilet-pose-authoring.blend':
        raise ValueError('Bathroom loop changed its accepted baseline identity')
    accepted_path = checked_file(MODELS, dict(path=source['proof_path'], sha256=source['proof_sha256']))
    checked_file(MODELS, dict(path=source['model_path'], sha256=source['model_sha256']))
    accepted = json.loads(accepted_path.read_text())
    if accepted.get('state') != 'complete' or accepted['editable_model']['sha256'] != source['model_sha256']:
        raise ValueError('Bathroom accepted source/model binding changed')
    if set(proof['inputs']) != set(accepted['inputs']) | LOOP_EXTRA_INPUTS:
        raise ValueError('Bathroom transitive input inventory is incomplete')
    for name, sha in proof['inputs'].items():
        checked_file(MODELS, dict(path=name, sha256=sha))
        if name.endswith('.py'):
            checked_file(path.parent/'source', dict(path=name, sha256=sha))
    if any(proof['inputs'][name] != sha for name, sha in accepted['inputs'].items()):
        raise ValueError('Bathroom loop changed an immutable baseline dependency')
    checked_file(path.parent, proof['editable_model'])
    validate_action(proof['action'])
    validate_registration(proof, accepted)
    validate_closure(proof['closure'], accepted['physical_metrics']['joint_targets'])
    validate_geometry(proof['geometry_palette_checks'])
    validate_palettes(proof['palettes'])
    validate_contacts(proof['contacts'])
    for field in ('manual_contacts', 'reopened_contacts'):
        rows = proof[field]
        if len(rows) != 5 or {row['frame'] for row in rows} != set(range(5)):
            raise ValueError('Missing manual or saved-scene bathroom contact samples')
        expanded = [dict(row, variant=variant) for variant in PALETTES for row in rows]
        validate_contacts(expanded)
    if set(proof['palettes']) != set(PALETTES) or any(row.get('geometry_consistent') is not True for row in proof['palettes'].values()):
        raise ValueError('Bathroom palette geometry evidence is incomplete')
    indexed = validate_render_rows(proof['renders'])
    for row in indexed.values():
        read_png(path.parent, row, (768, 960), 'RGBA')
    return proof


def validate_ink_binding(ink, loop, source_sha256):
    finite_tree(ink)
    if (ink.get('schema') != 1 or ink.get('state') != 'complete' or ink.get('immutable_inputs_preserved') is not True
            or ink.get('source_proof_sha256') != source_sha256
            or ink.get('source_model_sha256') != loop['editable_model']['sha256']
            or ink.get('inputs') != loop['inputs']
            or any(ink.get(key) != loop.get(key) for key in
                   ('original_render_dimensions', 'origin_pixels', 'camera_matrix', 'ortho_scale'))):
        raise ValueError('Body-owned ink does not bind the exact completed source/model/camera')


def encode_raw_scene(raw, body_ink, size):
    if set(raw) != set(OWNERS) or any(image.mode != 'RGBA' for image in raw.values()):
        raise ValueError('Missing complete raw scene owner images')
    if len({image.size for image in raw.values()} | {body_ink.size}) != 1:
        raise ValueError('Raw body ink and scene registration differ')
    check_body_ink(raw['lines'], body_ink)
    encoded = encode_scene(raw, size)
    metrics, reconstruction = compare_scene(encoded, raw['beauty'])
    layers = {role:encoded[owner] for role, owner in (('body', 'sim'), ('furniture', 'furniture'), ('ink', 'lines'))}
    coverage = {role:raw[owner].getchannel('A').resize(size, Image.Resampling.BOX)
                for role, owner in (('body', 'sim'), ('furniture', 'furniture'), ('ink', 'lines'))}
    coverage['bodyInk'] = body_ink.getchannel('A').resize(size, Image.Resampling.BOX)
    return layers, coverage, metrics, reconstruction
