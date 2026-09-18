"""Check saved bed supports and the actual centered four-tile envelope."""
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
    root = bpy.data.objects['DOUBLE-BED_MODEL_ROOT']
    contacts = {}
    feet = [obj for obj in root.children if obj.name.startswith('Foot ') and obj.name != 'Foot rail']
    assert len(feet) == 4, 'Four supporting feet required'
    for foot in feet:
        assert abs(bounds(foot)[0][2]) < 1e-5, 'Foot lost floor contact'
        rail = bpy.data.objects['Side rail -0.765' if foot.location.x < 0 else 'Side rail 0.765']
        witness = overlap_witness(foot, rail, deps)
        assert witness, 'Foot detached from side rail'
        contacts[foot.name] = witness
    for obj in root.children:
        low, high = bounds(obj)
        assert all(low[axis] >= -.98001 and high[axis] <= .98001 for axis in (0, 1)), 'Part leaves four-tile footprint'
        if 'support' in obj:
            witness = overlap_witness(obj, bpy.data.objects[obj['support']], deps)
            assert witness, f'{obj.name} detached from {obj["support"]}'
            contacts[obj.name] = witness
    low, high = bounds(bpy.data.objects['Mattress'])
    assert high[0]-low[0] >= 1.5, 'Mattress is single-width'
    assert high[1]-low[1] >= 1.84, 'Mattress is too short'
    assert (high[1]-low[1])/(high[0]-low[0]) >= 1.20, 'Mattress is too square'
    left = bounds(bpy.data.objects['Pillow -0.385'])
    right = bounds(bpy.data.objects['Pillow 0.385'])
    assert left[1][0] < right[0][0], 'Pillows overlap'
    return {'state': 'passed', 'contacts': contacts, 'mattress_bounds': [low, high],
            'footprint': [2, 2], 'runtime_center': [.5, 6.5], 'sleep_pose_added': False}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with saved model and new result path')
    model, output = map(Path, args)
    if output.exists():
        raise ValueError('Result path must be new')
    before = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        mutations = []
        for name, axis, amount, expected in (
            ('Foot -0.74 -0.88', 'z', .08, 'Foot lost floor contact'),
            ('Pillow -0.385', 'z', .15, 'Pillow -0.385 detached from Mattress'),
            ('Folded duvet edge', 'z', .10, 'Folded duvet edge detached from Sage duvet'),
            ('Headboard inset', 'y', -.08, 'Headboard inset detached from Headboard'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location, axis, getattr(obj.location, axis)+amount)
            try:
                validate()
            except AssertionError as error:
                assert str(error) == expected, f'Unexpected failure: {error}'
                mutations.append(expected)
            else:
                raise AssertionError(f'Displacement survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == before
        result.update(model_sha256=before, caught_displacements=mutations)
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
