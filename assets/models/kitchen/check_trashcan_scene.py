"""Verify saved bin surfaces and reject detached hardware without changing the model."""
import ast
import hashlib
import inspect
import json
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom')]
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    root = bpy.data.objects['TRASHCAN_MODEL_ROOT']
    objects = {obj.name: obj for obj in root.children}
    assert set(objects) == {'Base', 'Body', 'Lid', 'Rear hinge', 'Pedal'}, 'Part inventory changed'
    assert root.location.length < 1e-6, 'Root moved'
    assert sum(abs(value) for value in root.rotation_euler) < 1e-6, 'Root rotated'
    deps = bpy.context.evaluated_depsgraph_get()
    trees = {}
    for name, obj in objects.items():
        assert obj.type == 'MESH', 'Unexpected geometry'
        evaluated = obj.evaluated_get(deps)
        data = evaluated.to_mesh()
        topology = bmesh.new()
        topology.from_mesh(data)
        topology.verts.ensure_lookup_table()
        assert all(edge.is_manifold for edge in topology.edges), f'{name} is not closed'
        assert all(face.calc_area() > 1e-12 for face in topology.faces), f'{name} has collapsed faces'
        reached, queue = set(), [topology.verts[0]]
        while queue:
            vertex = queue.pop()
            if vertex in reached:
                continue
            reached.add(vertex)
            queue.extend(edge.other_vert(vertex) for edge in vertex.link_edges)
        assert len(reached) == len(topology.verts), f'{name} has disconnected geometry'
        topology.free()
        trees[name] = BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in data.vertices],
                                         [tuple(face.vertices) for face in data.polygons])
        evaluated.to_mesh_clear()
    assert abs(bounds(objects['Base'])[0][2]) < 1e-5, 'Base lost ground contact'
    contacts = {}
    pairs = [('Body', 'Base'), ('Lid', 'Body'), ('Rear hinge', 'Body'),
             ('Rear hinge', 'Lid'), ('Pedal', 'Base')]
    for first, second in pairs:
        crossings = trees[first].overlap(trees[second])
        witness = None if crossings else overlap_witness(objects[first], objects[second], deps)
        assert crossings or witness, f'{first} detached from {second}'
        contacts[f'{first} / {second}'] = {'crossing_faces': len(crossings), 'contained_point': witness}
    assert objects['Pedal'].location.y < -.2, 'Pedal left the front'
    assert objects['Rear hinge'].location.y > .18, 'Hinge left the rear'
    expected_bounds = {
        'Base': ((-.225, -.225, 0), (.225, .225, .055)),
        'Body': ((-.21, -.21, .04), (.21, .21, .61)),
        'Lid': ((-.223, -.223, .598), (.223, .223, .64)),
        'Rear hinge': ((-.065, .17, .5725), (.065, .24, .6375)),
        'Pedal': ((-.08, -.307, .022), (.08, -.177, .054)),
    }
    for name, expected in expected_bounds.items():
        actual = bounds(objects[name])
        assert all(abs(a-b) < 1e-5 for edge, want in zip(actual, expected)
                   for a, b in zip(edge, want)), f'{name} dimensions changed'
    return {'state': 'passed', 'closed_connected_parts': len(objects),
            'grounded': ['Base'], 'contacts': contacts, 'maximum_height': .64,
            'proof_boundary': 'Closed exterior only; no opening or internal mechanism is claimed.'}


def prove_rejections(model):
    results = []
    cases = [
        ('missing pedal', 'Pedal', 'remove', None, 'Part inventory changed'),
        ('floating base', 'Base', 'move', (0, 0, .02), 'Base lost ground contact'),
        ('floating body', 'Body', 'move', (0, 0, .1), 'Body detached from Base'),
        ('floating lid', 'Lid', 'move', (0, 0, .1), 'Lid detached from Body'),
        ('detached hinge', 'Rear hinge', 'move', (0, .2, 0), 'Rear hinge detached from Body'),
        ('detached pedal', 'Pedal', 'move', (0, -.1, 0), 'Pedal detached from Base'),
        ('oversized body', 'Body', 'scale', (1.5, 1.5, 1), 'Body dimensions changed'),
        ('shifted root', 'TRASHCAN_MODEL_ROOT', 'move', (.1, 0, 0), 'Root moved'),
    ]
    for label, name, operation, value, expected in cases:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        obj = bpy.data.objects[name]
        if operation == 'remove':
            bpy.data.objects.remove(obj, do_unlink=True)
        elif operation == 'move':
            obj.location += Vector(value)
        else:
            obj.scale = value
        try:
            validate()
        except AssertionError as error:
            assert expected in str(error), f'{label} failed for wrong reason: {error}'
            results.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged bin passed: {label}')
    return results


def prove_guard_deletions(model):
    original, results = validate, []
    for message in ('Base lost ground contact', 'first} detached from', 'Root moved'):
        tree = ast.parse(inspect.getsource(original))
        removed = []

        class RemoveGuard(ast.NodeTransformer):
            def visit_Assert(self, node):
                if node.msg is not None and message in ast.unparse(node.msg):
                    removed.append(node)
                    return ast.copy_location(ast.Pass(), node)
                return node

        tree = ast.fix_missing_locations(RemoveGuard().visit(tree))
        assert len(removed) == 1, f'Expected exactly one guard for {message}'
        namespace = dict(globals())
        exec(compile(tree, '<deleted bin guard>', 'exec'), namespace)
        globals()['validate'] = namespace['validate']
        try:
            prove_rejections(model)
        except AssertionError as error:
            assert 'failed for wrong reason' in str(error) or 'Damaged bin passed' in str(error), str(error)
            results.append({'deleted_guard': message, 'rejection': str(error)})
        else:
            raise AssertionError(f'Mutation proof accepted deleted guard: {message}')
        finally:
            globals()['validate'] = original
    return results


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with absolute model and new result paths')
    model, output = map(Path, args)
    if not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use absolute paths and a new result file')
    digest = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        result['caught_mutations'] = prove_rejections(model)
        result['caught_guard_deletions'] = prove_guard_deletions(model)
        bpy.ops.wm.open_mainfile(filepath=str(model))
        validate()
        assert hashlib.sha256(model.read_bytes()).hexdigest() == digest, 'Saved model changed'
        result['model_sha256'] = digest
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
