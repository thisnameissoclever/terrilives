"""Probe the saved toilet, including lid-to-cistern clearance."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent/'kitchen'))
from check_stove_scene import bounds


def overlap_witness(first, second, deps):
    """Find a point inside both evaluated solids, not just both bounds."""
    surfaces = [obj.evaluated_get(deps) for obj in (first, second)]
    boxes = [bounds(obj) for obj in surfaces]
    low = [max(box[0][axis] for box in boxes) for axis in range(3)]
    high = [min(box[1][axis] for box in boxes) for axis in range(3)]
    if any(a > b for a, b in zip(low, high)):
        return None
    for x in range(1, 10):
        for y in range(1, 10):
            for z in range(1, 10):
                point = Vector([a+(b-a)*step/10 for a, b, step in zip(low, high, (x, y, z))])
                inside = True
                for surface in surfaces:
                    local = surface.matrix_world.inverted() @ point
                    found, closest, normal, _ = surface.closest_point_on_mesh(local)
                    if not found or (local-closest).dot(normal) > 1e-6:
                        inside = False
                        break
                if inside:
                    return list(point)
    return None


def validate():
    bpy.context.view_layer.update()
    objects = bpy.data.objects
    deps = bpy.context.evaluated_depsgraph_get()
    lid_low, lid_high = bounds(objects['Toilet upright lid'])
    tank_low, _ = bounds(objects['Toilet cistern'])
    cap_low, _ = bounds(objects['Toilet cistern cap'])
    assert lid_high[1] < min(tank_low[1], cap_low[1]), 'Lid intersects cistern'
    for name in ('Toilet rear ceramic neck', 'Toilet upper tank support'):
        neck_low, neck_high = bounds(objects[name])
        assert any(lid_high[axis] < neck_low[axis] or neck_high[axis] < lid_low[axis]
                   for axis in range(3)), f'Lid intersects {name}'
    down = Vector((0, 0, -1))
    def hit_height(name, x, y):
        surface = objects[name].evaluated_get(deps)
        inverse = surface.matrix_world.inverted()
        hit, point, _, _ = surface.ray_cast(inverse @ Vector((x, y, 1.5)),
                                           inverse.to_3x3() @ down)
        return (surface.matrix_world @ point).z if hit else None
    floor = hit_height('Toilet recessed bowl', 0, -.10)
    assert floor is not None and abs(floor-.245) < 1e-5, 'Bowl cavity lost'
    assert hit_height('Toilet open seat ring', 0, -.10) is None, 'Seat opening blocked'
    seat_top = hit_height('Toilet open seat ring', .193, -.10)
    assert seat_top is not None and abs(seat_top-.45) < 1e-5, 'Seat height changed'
    for side in (-1, 1):
        low, high = bounds(objects[f'Toilet seat bumper {side}'])
        height = hit_height('Toilet recessed bowl', (low[0]+high[0])/2,
                            (low[1]+high[1])/2)
        assert height is not None and abs(low[2]-height) < .002, 'Seat bumper lost support'
    cap_top = hit_height('Toilet cistern cap', 0, .34)
    button_low, _ = bounds(objects['Toilet flush button'])
    assert cap_top is not None and abs(button_low[2]-cap_top) < .004, 'Flush button detached'
    base_low, _ = bounds(objects['Toilet pedestal'])
    assert abs(base_low[2]) < 1e-5, 'Pedestal floats'
    support_top = hit_height('Toilet upper tank support', 0, .335)
    assert support_top is not None and abs(support_top-tank_low[2]) < .01, 'Cistern lost support'
    contacts = {}
    axle = objects['Toilet hinge axle']
    contacts['lid_to_axle'] = overlap_witness(objects['Toilet upright lid'], axle, deps)
    assert contacts['lid_to_axle'], 'Hinge detached from lid'
    for side in (-1, 1):
        mount = objects[f'Toilet hinge mount {side}']
        contacts[f'mount_to_axle_{side}'] = overlap_witness(mount, axle, deps)
        assert contacts[f'mount_to_axle_{side}'], 'Hinge mount detached from axle'
        contacts[f'mount_to_bowl_{side}'] = overlap_witness(mount, objects['Toilet recessed bowl'], deps)
        assert contacts[f'mount_to_bowl_{side}'], 'Hinge mount lost ceramic support'
    return {'state': 'passed', 'lid_cistern_clearance': min(tank_low[1], cap_low[1])-lid_high[1],
            'bowl_floor': floor, 'seat_open': True, 'seat_top': seat_top,
            'seat_bumpers_supported': True, 'flush_button_supported': True,
            'contact_witnesses': contacts}


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
        for name, axis, amount, expected in (
            ('Toilet upright lid', 'y', .12, 'Lid intersects cistern'),
            ('Toilet open seat ring', 'z', .1, 'Seat height changed'),
            ('Toilet seat bumper 1', 'z', .1, 'Seat bumper lost support'),
            ('Toilet flush button', 'z', .1, 'Flush button detached'),
            ('Toilet pedestal', 'z', .1, 'Pedestal floats'),
            ('Toilet upper tank support', 'y', -.1, 'Lid intersects Toilet upper tank support'),
            ('Toilet hinge axle', 'x', .5, 'Hinge detached from lid'),
            ('Toilet hinge mount 1', 'z', .1, 'Hinge mount detached from axle'),
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
        result['model_sha256'] = original
        result['mutations'] = mutations
        output.write_text(json.dumps(result, indent=2)+'\n')
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
