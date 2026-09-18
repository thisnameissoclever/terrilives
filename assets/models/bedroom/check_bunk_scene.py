"""Verify the saved bunk's supports, including both ends of ladder rungs."""
import hashlib
import json
from pathlib import Path
import sys

import bpy

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen')]
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    objects = bpy.data.objects
    root = objects['BUNK_MODEL_ROOT']
    contacts = {}
    for obj in root.children:
        low, high = bounds(obj.evaluated_get(deps))
        assert low[0] >= -.49001 and high[0] <= .49001, 'Part leaves bunk width'
        assert low[1] >= -.98001 and high[1] <= .98001, 'Part leaves bunk length'
        if obj.name.startswith(('Post ', 'Ladder upright ')):
            assert abs(low[2]) < 1e-5, 'Support lost floor contact'
        if 'support' in obj:
            witness = overlap_witness(obj, objects[obj['support']], deps)
            assert witness, f'{obj.name} detached from {obj["support"]}'
            contacts[obj.name] = witness
        if obj.name.startswith('Ladder rung '):
            for name in ('Ladder upright -0.82', 'Ladder upright -0.43'):
                assert overlap_witness(obj, objects[name], deps), 'Ladder rung lost an end'
    guard = objects['Upper access guard']
    upright = objects['Upper access upright']
    assert overlap_witness(guard, upright, deps), 'Access guard detached from upright'
    guard_end = bounds(guard)[0][1]
    low, high = bounds(upright)
    assert low[1] <= guard_end <= high[1], 'Access guard free end unsupported'
    lower = bounds(objects['Lower mattress'])
    assert abs(lower[1][2]-.46739448) < 1e-5, 'Lower sleep support height changed'
    assert 'Lower duvet' not in objects and 'Lower duvet fold' not in objects, 'Raised lower bedding intersects sleeper'
    return {'state':'passed', 'contacts':contacts, 'lower_mattress_bounds':lower}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with model and a new result path')
    model, output = map(Path, args)
    assert not output.exists(), 'Use a new result path'
    before = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        caught = []
        for name, axis, amount, expected in (
            ('Post -0.43 -0.925', 'z', .08, 'Support lost floor contact'),
            ('Lower mattress', 'z', .15, 'Lower mattress detached from Lower platform'),
            ('Ladder rung 0.54', 'y', .3, 'Ladder rung 0.54 detached from Ladder upright -0.82'),
            ('Upper access upright', 'y', .3, 'Access guard free end unsupported'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location, axis, getattr(obj.location, axis)+amount)
            try:
                validate()
            except AssertionError as error:
                assert str(error) == expected, f'Unexpected failure: {error}'
                caught.append(expected)
            else:
                raise AssertionError(f'Displacement survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == before
        result.update(model_sha256=before, caught_displacements=caught)
    except Exception as error:
        output.write_text(json.dumps({'state':'failed', 'error':str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
