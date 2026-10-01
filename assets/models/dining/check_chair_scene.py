"""Check saved evaluated geometry and deliberately broken copies without saving."""
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
    root = bpy.data.objects['DINING-CHAIR_MODEL_ROOT']
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
    assert len(grounded) == 4, 'Four floor contacts required'
    seat_height = bounds(actual['Seat'])[1][2]
    assert abs(seat_height-.535) < 1e-5, 'Seat height changed'
    rail_sizes = [tuple(high[i]-low[i] for i in range(3))
                  for low, high in (bounds(actual[f'Back rail {i}']) for i in range(3))]
    assert all(math.dist(size, rail_sizes[0]) < 1e-5 for size in rail_sizes), 'Unequal back rails'
    fronts = {}
    directions = {'SE': (0, 1), 'NW': (0, -1), 'SW': (-1, 0), 'NE': (1, 0)}
    rotation = root.rotation_euler.z
    try:
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            front = actual['Seat'].matrix_world.translation-actual['Back rail 1'].matrix_world.translation
            length = math.hypot(front.x, front.y)
            direction = (front.x/length, -front.y/length)
            assert math.dist(direction, directions[facing]) < 1e-5, f'Physical front mismatch: {facing}'
            fronts[facing] = direction
    finally:
        root.rotation_euler.z = rotation
        bpy.context.view_layer.update()
    return {'state': 'passed', 'parts': len(actual), 'contacts': contacts,
            'grounded': grounded, 'seat_height': seat_height, 'runtime_fronts': fronts}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with an absolute model and new absolute result path')
    model, output = map(Path, args)
    if not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use absolute paths and a new result file')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        mutations = []
        for name, axis, distance, message in (
            ('Front leg left', 'z', .01, 'Front leg left lost floor contact'),
            ('Side stretcher left', 'z', .42, 'Side stretcher left detached from Front leg left'),
            ('Seat', 'z', .20, 'Seat detached from Front apron'),
            ('Back rail 1', 'x', -.15, 'Back rail 1 detached from Rear post left'),
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
        bpy.data.objects.remove(bpy.data.objects['Rear post right'], do_unlink=True)
        try:
            validate()
        except AssertionError as error:
            assert str(error) == 'Chair inventory changed'
            mutations.append(str(error))
        else:
            raise AssertionError('Missing rear post survived')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original
        result.update(model_sha256=original, caught_mutations=mutations)
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
