"""Measure the saved refrigerator against the counter and verify scaled hinges."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from check_stove_scene import bounds
from fridge_geometry import door_point


def validate():
    bpy.context.view_layer.update()
    objects = bpy.data.objects
    root = objects['Case rear'].parent
    low, high = bounds(objects['Case top'])
    width = high[0]-low[0]
    assert .90 < width < .94, 'Fridge too narrow beside the counter'
    points = [obj.matrix_world @ Vector(point) for obj in root.children_recursive
              if obj.type == 'MESH' for point in obj.bound_box]
    minimum = [min(p[axis] for p in points) for axis in range(3)]
    maximum = [max(p[axis] for p in points) for axis in range(3)]
    assert abs(minimum[2]) < 1e-5, 'Fridge lost floor contact'
    assert 1.90 < maximum[2] < 2.0, 'Fridge height does not fit the kitchen'
    assert all(abs(value-root.scale.x) < 1e-6 for value in root.scale), 'Fridge scale must be uniform'
    assert maximum[1] < .5, 'Fridge rear crosses its tile boundary'
    assert 1-.5-maximum[0] > .025, 'Fridge intersects adjacent counter'
    for label in ('Refrigerator', 'Freezer'):
        hinge = objects[label+' right hinge']
        for angle in (0, 45, 90):
            hinge.rotation_euler.z = math.radians(angle)
            bpy.context.view_layer.update()
            actual = hinge.matrix_world @ Vector((-.60, -.07, .70))
            expected = root.matrix_world @ Vector(door_point((-.60, -.07, .70), angle))
            assert (actual-expected).length < 1e-6, 'Scaled hinge transform changed'
        hinge.rotation_euler.z = 0
    bpy.context.view_layer.update()
    return {'state': 'passed', 'case_width_m': width, 'bounds_min_m': minimum,
            'bounds_max_m': maximum, 'counter_height_m': .86,
            'height_ratio_to_counter': maximum[2]/.86,
            'adjacent_counter_gap_m': .5-maximum[0],
            'front_overhang_m': max(0, -minimum[1]-.5),
            'hinge_angles_degrees': [0, 45, 90]}


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with saved model and new result JSON')
    model, output = map(Path, args)
    if output.exists():
        raise ValueError('Result path must be new')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        mutations = []
        for change, expected in (('scale', 'Fridge too narrow beside the counter'),
                                  ('floor', 'Fridge lost floor contact')):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            root = bpy.data.objects['Case rear'].parent
            if change == 'scale':
                root.scale = (1, 1, 1)
            else:
                root.location.z += .1
            try:
                validate()
            except AssertionError as error:
                assert str(error) == expected, f'Unexpected failure: {error}'
                mutations.append({'change': change, 'caught': expected})
            else:
                raise AssertionError(f'Corruption survived: {change}')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original
        result.update(model_sha256=original, mutations=mutations)
        output.write_text(json.dumps(result, indent=2)+'\n')
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
