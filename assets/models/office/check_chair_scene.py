"""Inspect saved evaluated solids; prove detached parts are rejected without saving."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen'),
               str(BASE.parent/'furniture')]
from chair_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness
from geometry import FACINGS


def validate():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects['OFFICE-CHAIR_MODEL_ROOT']
    actual = {obj.name: obj for obj in root.children}
    expected = parts()
    assert set(actual) == {part['name'] for part in expected}, 'Chair inventory changed'
    contacts, grounded = {}, []
    for part in expected:
        obj = actual[part['name']]
        low, high = bounds(obj)
        assert obj.type == 'MESH', 'Unhandled chair geometry'
        for axis in (0, 1):
            assert low[axis] >= -.49 and high[axis] <= .49, f'{obj.name} exceeds tile'
        assert low[2] >= -1e-5, f'{obj.name} below floor'
        if part['grounded']:
            assert abs(low[2]) < .0002, f'{obj.name} lost floor contact'
            grounded.append(obj.name)
        for other in part['supports']:
            witness = overlap_witness(obj, actual[other], deps)
            assert witness, f'{obj.name} detached from {other}'
            contacts[f'{obj.name} / {other}'] = witness
    assert len(grounded) == 10, 'Caster floor contacts incomplete'
    spine_back = bounds(actual['Back spine'])[1][0]
    shell_back = bounds(actual['Back shell'])[1][0]
    assert shell_back-spine_back >= .009, 'Back spine breaks through rear shell'
    seat_height = bounds(actual['Seat cushion'])[1][2]
    assert abs(seat_height-.5675) < 1e-5, 'Seat height changed'
    fronts = {}
    expected = {'SE': (0, 1), 'NW': (0, -1), 'SW': (-1, 0), 'NE': (1, 0)}
    original_rotation = root.rotation_euler.z
    try:
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            front = (actual['Seat cushion'].matrix_world.translation
                     - actual['Back cushion'].matrix_world.translation)
            length = math.hypot(front.x, front.y)
            direction = (front.x/length, -front.y/length)
            assert math.dist(direction, expected[facing]) < 1e-5, f'Physical front mismatch: {facing}'
            fronts[facing] = direction
    finally:
        root.rotation_euler.z = original_rotation
        bpy.context.view_layer.update()
    return {'state': 'passed', 'parts': len(actual), 'contacts': contacts,
            'grounded': grounded, 'seat_height': seat_height,
            'rear_shell_clearance': shell_back-spine_back, 'runtime_fronts': fronts}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with a saved model and new result path')
    model, output = map(Path, args)
    if output.exists():
        raise ValueError('Result path must be new')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        mutations = []
        for name, axis, distance, message in (
            ('Caster wheel 0 -1', 'z', .015, 'Caster wheel 0 -1 lost floor contact'),
            ('Gas lift', 'x', .16, 'Gas lift detached from Base hub'),
            ('Seat cushion', 'z', .2, 'Seat cushion detached from Seat pan'),
            ('Back cushion', 'x', -.15, 'Back cushion detached from Back shell'),
            ('Back spine', 'x', .02, 'Back spine breaks through rear shell'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location, axis, getattr(obj.location, axis)+distance)
            try:
                validate()
            except AssertionError as error:
                assert str(error) == message, f'Unexpected mutation failure: {error}'
                mutations.append(message)
            else:
                raise AssertionError(f'Displacement survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        bpy.data.objects.remove(bpy.data.objects['Base spoke 0'], do_unlink=True)
        try:
            validate()
        except AssertionError as error:
            assert str(error) == 'Chair inventory changed'
            mutations.append(str(error))
        else:
            raise AssertionError('Missing spoke survived')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original
        result.update(model_sha256=original, caught_mutations=mutations)
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
