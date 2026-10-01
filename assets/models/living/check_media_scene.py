"""Validate saved media solids and reject independently damaged scene copies."""
import ast
import hashlib
import inspect
import json
import math
from pathlib import Path
import sys

import bpy

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen'),
               str(BASE.parent/'furniture')]
from media_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness
from geometry import FACINGS


def validate(kind):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects[kind.upper()+'_MODEL_ROOT']
    actual = {obj.name: obj for obj in root.children}
    expected = parts(kind)
    assert set(actual) == {p['name'] for p in expected}, 'Part inventory changed'
    assert root.location.length < 1e-5, 'Root moved'
    assert math.sqrt(sum(v*v for v in root.rotation_euler)) < 1e-5, 'Physical front changed'
    expected_by_name = {p['name']: p for p in expected}
    feet = {p['name'] for p in expected if p['grounded']}
    assert len(feet) == 4 and set(expected_by_name['Cabinet']['supports']) == feet, 'Cabinet must rest on four feet'

    def reaches_floor(name, seen):
        assert name not in seen, f'Support cycle at {name}'
        part = expected_by_name[name]
        assert part['grounded'] or part['supports'], f'{name} unsupported'
        return part['grounded'] or all(reaches_floor(other, seen | {name}) for other in part['supports'])

    assert all(reaches_floor(p['name'], set()) for p in expected)
    contacts, grounded = {}, []
    for part in expected:
        obj = actual[part['name']]
        assert obj.type == 'MESH', 'Unexpected geometry'
        low, high = bounds(obj)
        assert math.dist(tuple(high[i]-low[i] for i in range(3)), part['size']) < 1e-5, f'{obj.name} size changed'
        assert low[2] >= -1e-5, 'Below floor'
        if part['grounded']:
            assert abs(low[2]) < 1e-5, 'Foot lost ground contact'
            grounded.append(obj.name)
        for support in part['supports']:
            witness = overlap_witness(obj, actual[support], deps)
            assert witness, f'{obj.name} detached from {support}'
            contacts[f'{obj.name} / {support}'] = witness
    for part in expected:
        assert math.dist(actual[part['name']].location, part['center']) < 1e-5, f'{part["name"]} center changed'
    assert len(grounded) == 4
    assert len(contacts) == (13 if kind == 'television' else 14)
    face = actual['Glass screen' if kind == 'television' else 'Speaker grille']
    assert face.location.y < actual['Cabinet'].location.y, 'Front on rear face'
    extents = {}
    try:
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            boxes = [bounds(obj) for obj in actual.values()]
            low = [min(box[0][i] for box in boxes) for i in range(3)]
            high = [max(box[1][i] for box in boxes) for i in range(3)]
            assert all(-.48 <= low[i] < high[i] <= .48 for i in (0, 1)), 'Footprint escaped'
            extents[facing] = {'low': low, 'high': high}
    finally:
        root.rotation_euler.z = 0
        bpy.context.view_layer.update()
    return {'state': 'passed', 'kind': kind, 'grounded': grounded, 'contacts': contacts,
            'runtime_extents': extents}


def prove_rejections(model, kind):
    first_foot = parts(kind)[0]['name']
    front = 'Glass screen' if kind == 'television' else 'Speaker grille'
    detail = 'Tuning control' if kind == 'television' else 'Antenna'
    cases = [('missing foot', first_foot, None, None, 'Part inventory changed'),
             ('floating foot', first_foot, 'location', (0, 0, .03), 'Foot lost ground contact'),
             ('detached front', front, 'location', (0, -.3, 0), f'{front} detached from'),
             ('detached detail', detail, 'location', (0, 0, .3), f'{detail} detached from'),
             ('oversized cabinet', 'Cabinet', 'scale', (1.5, 1, 1), 'Cabinet size changed'),
             ('wrong front', kind.upper()+'_MODEL_ROOT', 'rotation_euler', (0, 0, math.pi), 'Physical front changed'),
             ('shifted root', kind.upper()+'_MODEL_ROOT', 'location', (.2, 0, 0), 'Root moved')]
    caught = []
    for label, name, attribute, value, expected_rejection in cases:
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
            validate(kind)
        except AssertionError as error:
            assert expected_rejection in str(error), f'{label} failed for the wrong reason: {error}'
            caught.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged scene passed: {label}')
    return caught


def prove_guard_deletions(model, kind):
    """The mutation proof must notice a disabled ground or contact guard."""
    original = validate
    caught = []
    for message in ('Foot lost ground contact', 'detached from'):
        tree = ast.parse(inspect.getsource(original))
        removed = []

        class RemoveGuard(ast.NodeTransformer):
            def visit_Assert(self, node):
                if node.msg is not None and message in ast.unparse(node.msg):
                    removed.append(node)
                    return ast.copy_location(ast.Pass(), node)
                return node

        tree = ast.fix_missing_locations(RemoveGuard().visit(tree))
        assert len(removed) == 1, 'Guard deletion did not target exactly one assertion'
        namespace = dict(globals())
        exec(compile(tree, '<deleted media guard>', 'exec'), namespace)
        globals()['validate'] = namespace['validate']
        try:
            prove_rejections(model, kind)
        except AssertionError as error:
            assert 'failed for the wrong reason' in str(error), str(error)
            caught.append({'deleted_guard': message, 'rejection': str(error)})
        else:
            raise AssertionError(f'Mutation proof accepted deleted guard: {message}')
        finally:
            globals()['validate'] = original
    return caught


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 3 or not bpy.app.background:
        raise ValueError('Use background Blender with kind, absolute model and new result path')
    kind, model_name, output_name = args
    model, output = Path(model_name), Path(output_name)
    if not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use absolute paths and a new result file')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate(kind)
        result['caught_mutations'] = prove_rejections(model, kind)
        result['caught_guard_deletions'] = prove_guard_deletions(model, kind)
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate(kind)
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original
        result['model_sha256'] = original
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
