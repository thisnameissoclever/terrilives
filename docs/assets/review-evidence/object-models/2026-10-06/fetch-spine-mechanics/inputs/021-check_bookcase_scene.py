"""Verify evaluated shelf and book contacts in the saved wall-aligned model."""
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
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen')]
from bookcase_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    root = bpy.data.objects['BOOKCASE_MODEL_ROOT']
    objects = {obj.name: obj for obj in root.children}
    expected = parts()
    assert set(objects) == {part['name'] for part in expected}, 'Part inventory changed'
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
    grounded = [part['name'] for part in expected if part['grounded']]
    for name in grounded:
        assert abs(bounds(objects[name])[0][2]) < 1e-5, 'Frame lost ground contact'
    contacts = {}
    pairs = [(part['name'], support) for part in expected for support in part['supports']]
    for first, second in pairs:
        crossings = trees[first].overlap(trees[second])
        witness = None if crossings else overlap_witness(objects[first], objects[second], deps)
        assert crossings or witness, f'{first} detached from {second}'
        contacts[f'{first} / {second}'] = {'crossing_faces': len(crossings), 'contained_point': witness}
    clearances = []
    for shelf in range(4):
        above = objects['Crown' if shelf == 3 else f'Shelf {shelf+1}']
        ceiling = bounds(above)[0][2]
        for index in range(6):
            name = f'Book {shelf} {index}'
            gap = ceiling-bounds(objects[name])[1][2]
            assert gap > .0001, f'{name} penetrates shelf above'
            clearances.append(gap)
    for part in expected:
        low = tuple(c-s/2 for c, s in zip(part['center'], part['size']))
        high = tuple(c+s/2 for c, s in zip(part['center'], part['size']))
        actual = bounds(objects[part['name']])
        assert all(abs(a-b) < 1e-5 for edge, want in zip(actual, (low, high))
                   for a, b in zip(edge, want)), f'{part["name"]} dimensions changed'
    return {'state': 'passed', 'closed_connected_parts': len(objects),
            'grounded': grounded, 'contacts': contacts, 'maximum_height': 1.54,
            'wall_back_y': .5, 'books': 24, 'minimum_overhead_clearance': min(clearances)}



def prove_rejections(model):
    results = []
    cases = [
        ('missing book', 'Book 0 0', 'remove', None, 'Part inventory changed'),
        ('floating base', 'Base', 'move', (0, 0, .02), 'Frame lost ground contact'),
        ('detached shelf', 'Shelf 1', 'move', (0, -.5, 0), 'Shelf 1 detached from Back panel'),
        ('floating book', 'Book 2 4', 'move', (0, 0, .03), 'Book 2 4 detached from Shelf 2'),
        ('floating crown', 'Crown', 'move', (0, 0, .1), 'Crown detached from Back panel'),
        ('oversized book', 'Book 3 1', 'scale', (1.5, 1, 1), 'Book 3 1 dimensions changed'),
        ('book through shelf', 'Book 0 2', 'taller', None, 'Book 0 2 penetrates shelf above'),
        ('shifted root', 'BOOKCASE_MODEL_ROOT', 'move', (.1, 0, 0), 'Root moved'),
        ('rotated root', 'BOOKCASE_MODEL_ROOT', 'rotation', (0, 0, .5), 'Root rotated'),
    ]
    for label, name, operation, value, expected in cases:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        obj = bpy.data.objects[name]
        if operation == 'remove':
            bpy.data.objects.remove(obj, do_unlink=True)
        elif operation == 'move':
            obj.location += Vector(value)
        elif operation == 'rotation':
            obj.rotation_euler = value
        elif operation == 'taller':
            obj.scale.z *= 1+.01/obj.dimensions.z
            obj.location.z += .005
        else:
            obj.scale = value
        try:
            validate()
        except AssertionError as error:
            assert expected in str(error), f'{label} failed for wrong reason: {error}'
            results.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged bookcase passed: {label}')
    return results


def prove_guard_deletions(model):
    original, results = validate, []
    for message in ('Frame lost ground contact', 'first} detached from', 'Root moved', 'Root rotated',
                    'penetrates shelf above'):
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
        exec(compile(tree, '<deleted bookcase guard>', 'exec'), namespace)
        globals()['validate'] = namespace['validate']
        try:
            prove_rejections(model)
        except AssertionError as error:
            assert 'failed for wrong reason' in str(error) or 'Damaged bookcase passed' in str(error), str(error)
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
