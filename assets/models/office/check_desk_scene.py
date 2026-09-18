"""Check saved, bevelled desk supports and deliberate broken-join cases."""
import hashlib
import json
from pathlib import Path
import sys

import bpy

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen')]
from desk_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects['DESK_MODEL_ROOT']
    expected = parts()
    actual = {obj.name: obj for obj in root.children}
    assert set(actual) == {part['name'] for part in expected}, 'Desk inventory changed'
    contacts = {}
    grounded = []
    for part in expected:
        obj = actual[part['name']]
        assert obj.type == 'MESH', 'Unhandled desk geometry'
        low, high = bounds(obj)
        if part['grounded']:
            assert abs(low[2]) < 1e-5, f'{obj.name} lost floor contact'
            grounded.append(obj.name)
        for name in part['supports']:
            witness = overlap_witness(obj, actual[name], deps)
            assert witness, f'{obj.name} detached from {name}'
            contacts[f'{obj.name} / {name}'] = witness
        assert low[0] >= -.98 and high[0] <= .98, 'Desk exceeds two-tile width'
        assert low[1] >= -.49 and high[1] <= .49, 'Desk exceeds one-tile depth'
    assert len(grounded) == 6, 'Desk floor contacts incomplete'
    assert abs(bounds(actual['Desktop'])[1][2]-.78) < 1e-5, 'Desktop height changed'
    front_planes = [bounds(actual[f'Drawer {i}'])[0][1] for i in (1, 2, 3)]
    assert max(front_planes)-min(front_planes) < 1e-5, 'Drawer fronts misaligned'
    return {'state': 'passed', 'parts': len(actual), 'grounded': grounded,
            'contacts': contacts, 'top_height': .78, 'drawer_fronts': front_planes}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with saved model and new JSON path')
    model, output = map(Path, args)
    if output.exists():
        raise ValueError('Result path must be new')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        mutations = []
        for name, axis, amount, message in (
            ('Left front leg', 'z', .10, 'Left front leg lost floor contact'),
            ('Front knee rail', 'y', -.12, 'Front knee rail detached from Left front leg'),
            ('Drawer 1 mount -1', 'y', -.15, 'Drawer 1 mount -1 detached from Drawer 1'),
            ('Drawer 3', 'y', -.12, 'Drawer 3 detached from Pedestal'),
            ('Desktop', 'z', .12, 'Desktop detached from Front knee rail'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location, axis, getattr(obj.location, axis)+amount)
            try:
                validate()
            except AssertionError as error:
                assert str(error) == message, f'Unexpected failure: {error}'
                mutations.append(message)
            else:
                raise AssertionError(f'Displacement survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original
        result.update(model_sha256=original, caught_displacements=mutations)
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
