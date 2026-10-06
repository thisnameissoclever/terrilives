"""Verify the saved shower's tray, panel supports and connected fittings."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'kitchen')]
from check_stove_scene import bounds
from check_counter_scene import supported_by
from check_toilet_scene import overlap_witness


def contains(surface, point):
    local = surface.matrix_world.inverted() @ point
    found, closest, normal, _ = surface.closest_point_on_mesh(local)
    return found and (local-closest).dot(normal) <= 1e-6


def validate():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    objects = bpy.data.objects
    tray = objects['Shower recessed tray'].evaluated_get(deps)
    hit, floor, _, _ = tray.ray_cast(Vector((0, 0, 2.1)), Vector((0, 0, -1)))
    assert hit and abs(floor.z-.055) < 1e-5, 'Tray floor lost'
    assert supported_by(objects['Shower drain'], tray), 'Drain lost floor support'
    low, _ = bounds(tray)
    assert abs(low[2]) < 1e-5, 'Tray floats'
    contacts = {}
    pairs = (
        ('Shower rear panel', 'Shower recessed tray'),
        ('Shower side panel', 'Shower recessed tray'),
        ('Shower rear panel', 'Shower side panel'),
        ('Shower arm flange', 'Shower rear panel'),
        ('Shower head', 'Shower nozzle face'),
        ('Shower control plate', 'Shower rear panel'),
        ('Shower control dial', 'Shower control plate'),
        ('Shower control lever', 'Shower control dial'),
    )
    for first, second in pairs:
        witness = overlap_witness(objects[first], objects[second], deps)
        assert witness, f'{first} detached from {second}'
        contacts[first+' / '+second] = witness
    for label in ('corner', 'left edge', 'right edge'):
        trim = objects[f'Shower trim {label}']
        assert supported_by(trim, tray), 'Trim lost tray support'
    arm = objects['Shower curved arm']
    start, tip = [arm.matrix_world @ arm.data.splines[0].bezier_points[i].co for i in (0, -1)]
    assert contains(objects['Shower arm flange'].evaluated_get(deps), start), 'Arm detached from flange'
    assert contains(objects['Shower head'].evaluated_get(deps), tip), 'Head detached from arm'
    nozzle = objects['Shower nozzle face']
    hit, point, _, _ = tray.ray_cast(nozzle.matrix_world.translation, Vector((0, 0, -1)))
    assert hit and abs(point.z-.055) < 1e-5, 'Head misses tray floor'
    return {'state': 'passed', 'floor_height': floor.z, 'drain_supported': True,
            'arm_endpoints_connected': True, 'contact_witnesses': contacts}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with saved model and new JSON path')
    model, output = map(Path, args)
    if output.exists():
        raise ValueError('Result path must be new')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    mutations = []
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        for name, axis, amount, expected in (
            ('Shower drain', 'z', .1, 'Drain lost floor support'),
            ('Shower rear panel', 'z', .1, 'Shower rear panel detached from Shower recessed tray'),
            ('Shower curved arm', 'y', -.2, 'Arm detached from flange'),
            ('Shower control plate', 'y', -.1, 'Shower control plate detached from Shower rear panel'),
            ('Shower control dial', 'y', -.1, 'Shower control dial detached from Shower control plate'),
            ('Shower control lever', 'x', .2, 'Shower control lever detached from Shower control dial'),
            ('Shower trim left edge', 'z', .1, 'Trim lost tray support'),
        ):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            obj = bpy.data.objects[name]
            setattr(obj.location, axis, getattr(obj.location, axis)+amount)
            try:
                validate()
            except AssertionError as failure:
                assert str(failure) == expected, f'Unrelated failure: {failure}'
                mutations.append({'part': name, 'caught': expected})
            else:
                raise AssertionError(f'Corruption survived: {name}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original, 'Saved model changed'
        result.update(model_sha256=original, mutations=mutations)
        output.write_text(json.dumps(result, indent=2)+'\n')
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error),
                                     'completed': mutations}, indent=2)+'\n')
        raise
