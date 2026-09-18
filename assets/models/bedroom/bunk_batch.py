"""Bounded coverage and source signature for the registered bunk export."""
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent
FACINGS = {'SE':90, 'NW':270, 'SW':0, 'NE':180}
VARIANTS = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
TRANSLATION = (0, -.50151527, 0)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_environment(proof, version, build_hash):
    if proof.get('blender_version') != version or proof.get('blender_build_hash') != build_hash:
        raise ValueError('Blender build differs from the render checkpoint')


def expected_keys(pilot=False):
    facings, frames = (('SE',), (0,)) if pilot else (FACINGS, range(4))
    keys = {(f, i, v, o) for f in facings for i in frames for v in VARIANTS for o in OWNERS}
    return keys | {(f, 0, 'green', 'empty') for f in facings}


def validate_rows(rows, pilot=False, complete=False):
    expected = expected_keys(pilot)
    found = set()
    for row in rows:
        key = tuple(row[name] for name in ('facing', 'frame', 'variant', 'owner'))
        if key in found:
            raise ValueError('Duplicate render sample')
        if key not in expected:
            raise ValueError('Unexpected render sample')
        found.add(key)
    if complete and found != expected:
        raise ValueError('Incomplete render coverage')
    return found


def signature(model, pilot=False):
    names = ('bedroom/bunk_batch.py', 'bedroom/render_bunk_contributions.py',
             'bedroom/bunk_contact.py', 'furniture/animation_export.py',
             'furniture/build_parts.py', 'furniture/geometry.py', 'furniture/preview.py',
             'sims/sim-01/sim-01-rigged.blend', 'sims/sim-01/registered-canvas-proof.json',
             'sims/sim-01/render_shirt_variants.py', 'sims/sim-01/shirt_colors.py',
             'sims/sim-01/render_job.py', 'sims/sim-01/build_rig.py',
             'sims/sim-01/rig_math.py', 'sims/sim-01/food_depth.py')
    inputs = {name:digest(MODELS/name) for name in names}
    inputs[model.resolve().relative_to(MODELS.resolve()).as_posix()] = digest(model)
    return {'inputs':inputs, 'mode':'pilot' if pilot else 'complete',
            'source_density':8, 'logical_canvas':[160,176], 'translation':list(TRANSLATION)}


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2)+'\n')
    temporary.replace(path)
