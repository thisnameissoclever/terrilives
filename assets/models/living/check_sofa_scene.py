"""Check saved evaluated solids, real support contacts and damaged copies."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen'),
               str(BASE.parent/'furniture')]
from sofa_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness
from geometry import FACINGS


def validate():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects['LONG-SOFA_MODEL_ROOT']
    actual = {obj.name: obj for obj in root.children}
    expected = parts()
    assert set(actual) == {p['name'] for p in expected}, 'Sofa inventory changed'
    assert math.sqrt(sum(value*value for value in root.rotation_euler)) < 1e-5, 'Authored sofa basis changed'
    assert root.location.length < 1e-5, 'Sofa root moved'
    contacts, grounded = {}, []
    for part in expected:
        obj = actual[part['name']]
        assert obj.type == 'MESH', 'Unhandled sofa geometry'
        low, high = bounds(obj)
        assert low[2] >= -1e-5, f'{obj.name} below floor'
        span = tuple(high[i]-low[i] for i in range(3))
        assert math.dist(span, part['size']) < 1e-5, f'{obj.name} dimensions changed'
        if part['grounded']:
            assert abs(low[2]) < .0002, f'{obj.name} lost floor contact'
            grounded.append(obj.name)
        for other in part['supports']:
            witness = overlap_witness(obj, actual[other], deps)
            assert witness, f'{obj.name} detached from {other}'
            contacts[f'{obj.name} / {other}'] = witness
    assert len(grounded) == 4 and len(contacts) == 18
    for part in expected:
        assert math.dist(actual[part['name']].location, part['center']) < 1e-5, f'{part["name"]} center changed'
    assert abs(bounds(actual['Seat cushion 1'])[1][2]-.56) < 1e-5, 'Seat height changed'
    assert actual['Upholstered back'].location.x > .3, 'Back no longer opposite front'
    spans = {}
    try:
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            boxes = [bounds(obj) for obj in actual.values()]
            low = [min(box[0][i] for box in boxes) for i in range(3)]
            high = [max(box[1][i] for box in boxes) for i in range(3)]
            span = [high[i]-low[i] for i in (0, 1)]
            expected_span = (1.86, .865) if facing in ('SE', 'NW') else (.865, 1.86)
            assert math.dist(span, expected_span) < 1e-5, f'Wrong footprint: {facing}'
            assert abs(high[2]-1.05) < 1e-5, 'Sofa height changed'
            assert abs(low[0]) < 1 and abs(high[0]) < 1
            assert abs(low[1]) < 1 and abs(high[1]) < 1
            spans[facing] = span
    finally:
        root.rotation_euler.z = 0
        bpy.context.view_layer.update()
    return {'state': 'passed', 'parts': len(actual), 'contacts': contacts,
            'grounded': grounded, 'runtime_spans': spans}


def prove_rejections(model):
    cases = [
        ('lift foot', 'Foot front left', 'location', (0, 0, .02)),
        ('detach arm', 'Arm left', 'location', (0, -.5, 0)),
        ('float seat', 'Seat cushion 1', 'location', (0, 0, .2)),
        ('detach back pad', 'Back cushion 1', 'location', (-.5, 0, 0)),
        ('oversized foot', 'Foot rear right', 'scale', (2, 1, 1)),
        ('unequal cushion', 'Seat cushion 0', 'scale', (1, .8, 1)),
        ('overlapping cushions', 'Seat cushion 1', 'location', (0, .15, 0)),
        ('wrong source rotation', 'LONG-SOFA_MODEL_ROOT', 'rotation_euler', (0, 0, math.pi/2)),
        ('shift root', 'LONG-SOFA_MODEL_ROOT', 'location', (.5, 0, 0)),
        ('missing foot', 'Foot rear left', None, None),
    ]
    caught = []
    for label, name, attribute, value in cases:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        obj = bpy.data.objects[name]
        if attribute is None:
            bpy.data.objects.remove(obj, do_unlink=True)
        elif attribute == 'location':
            for axis in range(3):
                obj.location[axis] += value[axis]
        else:
            setattr(obj, attribute, value)
        try:
            validate()
        except AssertionError as error:
            caught.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged copy passed: {label}')
    return caught


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with an absolute model and new result path')
    model, output = map(Path, args)
    if not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use absolute paths and a new result file')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        result['caught_mutations'] = prove_rejections(model)
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original
        result['model_sha256'] = original
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
