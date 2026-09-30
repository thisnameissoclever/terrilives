"""Validate saved table geometry and reject detached or misoriented copies."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen'),
               str(BASE.parent/'furniture')]
from table_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness
from geometry import FACINGS


def validate():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects['DINING-TABLE_MODEL_ROOT']
    actual = {obj.name: obj for obj in root.children}
    expected = parts()
    assert set(actual) == {p['name'] for p in expected}, 'Table inventory changed'
    assert abs(root.rotation_euler.z) < 1e-5, 'Authored table basis changed'
    contacts, grounded = {}, []
    for part in expected:
        obj = actual[part['name']]
        assert obj.type == 'MESH', 'Unhandled table geometry'
        low, high = bounds(obj)
        assert low[2] >= -1e-5, f'{obj.name} below floor'
        if part['grounded']:
            assert abs(low[2]) < .0002, f'{obj.name} lost floor contact'
            grounded.append(obj.name)
            span = tuple(high[i]-low[i] for i in range(3))
            assert math.dist(span, (.09, .09, .735)) < 1e-5, 'Leg dimensions changed'
        for other in part['supports']:
            witness = overlap_witness(obj, actual[other], deps)
            assert witness, f'{obj.name} detached from {other}'
            contacts[f'{obj.name} / {other}'] = witness
    assert len(grounded) == 4 and len(contacts) == 16
    top_height = bounds(actual['Tabletop'])[1][2]
    assert abs(top_height-.79) < 1e-5, 'Table height changed'
    spans = {}
    try:
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            boxes = [bounds(obj) for obj in actual.values()]
            low = [min(box[0][i] for box in boxes) for i in range(3)]
            high = [max(box[1][i] for box in boxes) for i in range(3)]
            span = [high[i]-low[i] for i in (0, 1)]
            expected_span = (1.86, .88) if facing in ('SE', 'NW') else (.88, 1.86)
            assert math.dist(span, expected_span) < 1e-5, f'Wrong physical footprint: {facing}'
            assert abs(low[0]+high[0]) < 1e-5 and abs(low[1]+high[1]) < 1e-5, 'Table origin shifted'
            spans[facing] = span
    finally:
        root.rotation_euler.z = 0
        bpy.context.view_layer.update()
    return {'state': 'passed', 'parts': len(actual), 'contacts': contacts,
            'grounded': grounded, 'top_height': top_height, 'runtime_spans': spans}


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
            ('Leg left near', 'z', .01, 'Leg left near lost floor contact'),
            ('Long apron left', 'x', .25, 'Long apron left detached from Leg left near'),
            ('End apron far', 'y', .25, 'End apron far detached from Leg left far'),
            ('Tabletop', 'z', .20, 'Tabletop detached from Leg left near'),
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
        for missing in (False, True):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            message = 'Table inventory changed' if missing else 'Authored table basis changed'
            if missing:
                bpy.data.objects.remove(bpy.data.objects['Leg right far'], do_unlink=True)
            else:
                bpy.data.objects['DINING-TABLE_MODEL_ROOT'].rotation_euler.z = math.pi/2
            try:
                validate()
            except AssertionError as error:
                assert str(error) == message
                mutations.append(message)
            else:
                raise AssertionError(f'Mutation survived: {message}')
        for scale in ((.16/.09, 1, 1), (1, 1, .83/.735)):
            bpy.ops.wm.open_mainfile(filepath=str(model))
            leg = bpy.data.objects['Leg left near']
            leg.scale = scale
            if scale[2] != 1:
                leg.location.z = .415
            try:
                validate()
            except AssertionError as error:
                assert str(error) == 'Leg dimensions changed', str(error)
                mutations.append(f'{error}: {scale}')
            else:
                raise AssertionError('Unequal or protruding leg survived')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original
        result.update(model_sha256=original, caught_mutations=mutations)
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
