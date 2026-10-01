"""Bounded render coverage for the unchanged Sit action and one new chair."""
import hashlib
import json
from pathlib import Path

MODELS = Path(__file__).resolve().parent.parent
FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}
VARIANTS = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2)+'\n')
    temporary.replace(path)


def validate_environment(proof, version, build_hash):
    if proof.get('blender_version') != version or proof.get('blender_build_hash') != build_hash:
        raise ValueError('Blender build differs from the render checkpoint')


def signature(model):
    names = ('living/armchair_batch.py', 'living/armchair_contact.py', 'living/armchair_support.py',
             'living/render_armchair_contributions.py', 'living/armchair_layout.py',
             'living/armchair_model.py', 'living/render_armchair.py',
             'bedroom/bunk_contact.py', 'bathroom/check_toilet_scene.py',
             'kitchen/check_stove_scene.py', 'kitchen/render_static.py',
             'furniture/animation_export.py', 'furniture/build_parts.py',
             'furniture/geometry.py', 'furniture/preview.py',
             'sims/sim-01/sim-01-rigged.blend', 'sims/sim-01/registered-canvas-proof.json',
             'sims/sim-01/render_shirt_variants.py', 'sims/sim-01/shirt_colors.py',
             'sims/sim-01/render_job.py', 'sims/sim-01/build_rig.py',
             'sims/sim-01/rig_math.py', 'sims/sim-01/food_depth.py')
    paths = [MODELS/name for name in names] + [model, model.parent/'proof.json']
    inputs = {path.resolve().relative_to(MODELS.resolve()).as_posix(): digest(path) for path in paths}
    return {'inputs': inputs, 'source_density': 8, 'logical_canvas': [96, 120],
            'body_action': 'sit', 'body_offset': [0, 0, 0], 'body_degrees_offset': -90}


def body_degrees(facing):
    return FACINGS[facing]-90


def expected_keys():
    return {(facing, frame, variant, owner) for facing in FACINGS for frame in range(4)
            for variant in VARIANTS for owner in OWNERS} | {
                (facing, 0, 'green', 'empty') for facing in FACINGS}


def validate_rows(rows, complete=False):
    expected = expected_keys()
    found, paths = set(), set()
    for row in rows:
        key = tuple(row.get(name) for name in ('facing', 'frame', 'variant', 'owner'))
        if type(key[1]) is not int or key not in expected:
            raise ValueError('Invalid armchair render sample')
        if key in found:
            raise ValueError('Duplicate armchair render sample')
        path = row.get('path')
        if not isinstance(path, str) or not path or '/' in path or '\\' in path or ':' in path:
            raise ValueError('Armchair render must use a direct filename')
        if path in paths:
            raise ValueError('Duplicate armchair render path')
        if path != f'armchair-{key[2]}-{key[0]}-{key[1]}-{key[3]}.png':
            raise ValueError('Armchair render filename does not match its sample')
        found.add(key)
        paths.add(path)
    if complete and found != expected:
        raise ValueError('Incomplete armchair render coverage')
    return found
