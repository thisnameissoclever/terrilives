"""Check floor contact and attachments in the saved, bevelled cabinet."""
import hashlib
import json
from pathlib import Path
import sys

import bpy

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen')]
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate(kind):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects[kind.upper()+'_MODEL_ROOT']
    contacts = {}
    feet = [obj for obj in root.children if obj.name.startswith('Foot ')]
    assert len(feet) == 4, 'Four feet required'
    for foot in feet:
        assert abs(bounds(foot)[0][2]) < 1e-5, 'Foot lost floor contact'
        witness = overlap_witness(foot, bpy.data.objects['Case'], deps)
        assert witness, 'Foot detached from case'
        contacts[foot.name] = witness
    for obj in root.children:
        low, high = bounds(obj)
        assert all(low[axis] >= -.45 and high[axis] <= .45 for axis in (0, 1)), 'Part leaves tile'
        if 'support' in obj:
            witness = overlap_witness(obj, bpy.data.objects[obj['support']], deps)
            assert witness, f'{obj.name} detached from {obj["support"]}'
            contacts[obj.name] = witness
    top = bounds(bpy.data.objects['Top'])[1][2]
    expected = .52 if kind == 'nightstand' else .95
    assert abs(top-expected) < 1e-5, 'Cabinet height changed'
    return {'state': 'passed', 'top_height': top, 'contacts': contacts}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 3 or not bpy.app.background:
        raise ValueError('Use background Blender with kind, saved model and new result path')
    kind, model_arg, output_arg = args
    model, output = Path(model_arg), Path(output_arg)
    if output.exists():
        raise ValueError('Result path must be new')
    before = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate(kind)
        mutations = []
        feet = [obj.name for obj in bpy.data.objects if obj.name.startswith('Foot ')]
        for name, axis, amount, expected in (
            (feet[0], 'z', .05, 'Foot lost floor contact'),
            ('Drawer 1 handle', 'y', -.10, 'Drawer 1 handle detached from Drawer 1 handle mount -1'),
            ('Drawer 1', 'y', -.07, 'Drawer 1 detached from Case'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location, axis, getattr(obj.location, axis)+amount)
            try:
                validate(kind)
            except AssertionError as error:
                assert str(error) == expected, f'Unexpected failure: {error}'
                mutations.append(expected)
            else:
                raise AssertionError(f'Displacement survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate(kind)
        assert hashlib.sha256(model.read_bytes()).hexdigest() == before
        result.update(model_sha256=before, caught_displacements=mutations)
    except Exception as error:
        result = {'state': 'failed', 'error': str(error)}
        output.write_text(json.dumps(result, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
