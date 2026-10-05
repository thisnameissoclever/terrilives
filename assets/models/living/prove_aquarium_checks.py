"""Reject damaged copies and verify the geometry guards themselves matter."""
import ast
import hashlib
import inspect
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
import check_aquarium_scene as checker


def damaged_cases(model):
    cases = [
        ('shifted root', 'root', (.02, 0, 0), 'Root registration changed'),
        ('floating plinth', 'Cabinet plinth', (0, 0, .02), 'Cabinet floats'),
        ('detached handle', 'left door handle', (-.06, 0, 0), 'detached from left cabinet door'),
        ('floating plant', 'Plant 0 blade 0', (0, 0, .06), 'detached from Substrate'),
        ('fish outside water', 'fish', (.38, 0, 0), 'Fish escapes glass'),
        ('fish under lid', 'fish', (0, 0, .30), 'Lid blocks fish'),
    ]
    rows = []
    for label, name, offset, expected in cases:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        if name == 'root':
            objects = [o for o in bpy.data.objects if o.name.startswith('AQUARIUM') and o.name.endswith('_MODEL_ROOT')]
        elif name == 'fish':
            objects = [o for o in bpy.data.objects if o.name.startswith('Coral fish')]
        else:
            objects = [bpy.data.objects[name]]
        for obj in objects:
            obj.location += Vector(offset)
        try:
            checker.validate()
        except AssertionError as error:
            assert expected in str(error), f'{label} failed for wrong reason: {error}'
            rows.append({'case': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged scene passed: {label}')
    return rows


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use hidden Blender with an absolute model and new result file')
    model, output = map(Path, args)
    if not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use absolute paths and a new result file')
    digest = hashlib.sha256(model.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(model))
    checker.validate()
    rejected = damaged_cases(model)
    original, guards = checker.validate, []
    for message in ('Root registration changed', 'Cabinet floats', 'detached from', 'Fish escapes glass', 'Lid blocks fish'):
        tree, removed = ast.parse(inspect.getsource(original)), []

        class Remove(ast.NodeTransformer):
            def visit_Assert(self, node):
                if node.msg is not None and message in ast.unparse(node.msg):
                    removed.append(node)
                    return ast.copy_location(ast.Pass(), node)
                return node

        tree = ast.fix_missing_locations(Remove().visit(tree))
        assert len(removed) == 1
        namespace = dict(checker.__dict__)
        exec(compile(tree, '<deleted aquarium guard>', 'exec'), namespace)
        checker.validate = namespace['validate']
        try:
            damaged_cases(model)
        except AssertionError as error:
            assert 'Damaged scene passed' in str(error) or 'failed for wrong reason' in str(error), str(error)
            guards.append({'deleted_guard': message, 'rejection': str(error)})
        else:
            raise AssertionError(f'Deleted guard went undetected: {message}')
        finally:
            checker.validate = original
    bpy.ops.wm.open_mainfile(filepath=str(model))
    checker.validate()
    assert hashlib.sha256(model.read_bytes()).hexdigest() == digest
    output.write_text(json.dumps({'state': 'passed', 'model_sha256': digest,
                                 'damaged_scenes': rejected, 'deleted_guards': guards}, indent=2)+'\n')
