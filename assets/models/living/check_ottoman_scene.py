"""Inspect saved ottoman surfaces, including contact around the entire sewn welt."""
import ast
import hashlib
import inspect
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen')]
from ottoman_layout import parts, welt_path
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    root = bpy.data.objects['OTTOMAN_MODEL_ROOT']
    objects = {obj.name: obj for obj in root.children}
    expected = parts()
    assert set(objects) == {p['name'] for p in expected} | {'Covered button', 'Cushion welt'}, 'Part inventory changed'
    assert not objects['Cushion welt'].modifiers, 'Welt modifiers unsupported'
    assert root.location.length < 1e-6, 'Root moved'
    assert sum(abs(v) for v in root.rotation_euler) < 1e-6, 'Root rotated'
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
                                          [tuple(p.vertices) for p in data.polygons])
        evaluated.to_mesh_clear()
    grounded = []
    for part in expected:
        low, high = bounds(objects[part['name']])
        if part['grounded']:
            assert abs(low[2]) < 1e-5, 'Foot lost ground contact'
            grounded.append(part['name'])
        assert math.dist(tuple(high[i]-low[i] for i in range(3)), part['size']) < 1e-5, f'{part["name"]} size changed'
    assert len(grounded) == 4
    pairs = [(p['name'], support) for p in expected for support in p['supports']]
    pairs += [('Covered button', 'Cushion'), ('Cushion welt', 'Cushion')]
    contacts = {}
    for first, second in pairs:
        crossings = trees[first].overlap(trees[second])
        witness = None if crossings else overlap_witness(objects[first], objects[second], deps)
        assert crossings or witness, f'{first} detached from {second}'
        contacts[f'{first} / {second}'] = {'crossing_faces': len(crossings), 'contained_point': witness}
    assert len(contacts) == 7
    # A single crossing does not prove a whole seam is sewn to the cushion.
    # Check each actual cross-section against the evaluated cushion surface.
    welt = objects['Cushion welt']
    assert len(welt.data.vertices) == len(welt_path())*12, 'Welt topology changed'
    distances = []
    for index in range(len(welt_path())):
        ring = [welt.matrix_world @ welt.data.vertices[index*12+side].co for side in range(12)]
        center = sum(ring, Vector())/12
        assert all(abs((point-center).length-.003) < 1e-6 for point in ring), 'Welt thickness changed'
        nearest = trees['Cushion'].find_nearest(center)
        distance = nearest[3]
        assert distance is not None and distance <= .00301, f'Welt section {index} detached from cushion'
        distances.append(distance)
    for part in expected:
        assert math.dist(objects[part['name']].location, part['center']) < 1e-5, f'{part["name"]} center changed'
    for obj in objects.values():
        low, high = bounds(obj)
        assert low[2] >= -1e-5 and high[2] <= .39001, 'Height escaped'
        assert all(-.40 < low[i] <= high[i] < .40 for i in (0, 1)), 'Footprint escaped'
    return {'state': 'passed', 'closed_connected_parts': len(objects), 'grounded': grounded,
            'contacts': contacts, 'welt_sections': len(distances),
            'maximum_welt_surface_distance': max(distances)}


def prove_rejections(model):
    results = []
    foot = parts()[0]['name']
    cases = [
        ('missing foot', foot, 'remove', None, 'Part inventory changed'),
        ('modified welt', 'Cushion welt', 'modifier', None, 'Welt modifiers unsupported'),
        ('floating foot', foot, 'location', (0, 0, .02), 'Foot lost ground contact'),
        ('detached frame', 'Upholstered frame', 'location', (0, 0, .4), 'Upholstered frame detached from'),
        ('detached cushion', 'Cushion', 'location', (0, 0, .4), 'Cushion detached from'),
        ('detached button', 'Covered button', 'location', (0, 0, .1), 'Covered button detached from'),
        ('partly floating welt', 'Cushion welt', 'partial', None, 'Welt section 0 detached from cushion'),
        ('oversized cushion', 'Cushion', 'scale', (1.5, 1, 1), 'Cushion size changed'),
        ('shifted root', 'OTTOMAN_MODEL_ROOT', 'location', (.1, 0, 0), 'Root moved'),
    ]
    for label, name, attribute, value, expected in cases:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        obj = bpy.data.objects[name]
        if attribute == 'remove':
            bpy.data.objects.remove(obj, do_unlink=True)
        elif attribute == 'modifier':
            obj.modifiers.new('Unexpected deformation', 'SIMPLE_DEFORM').angle = 0
        elif attribute == 'partial':
            for vertex in list(obj.data.vertices)[:12]:
                vertex.co.x += .02
            obj.data.update()
        elif attribute == 'location':
            obj.location += Vector(value)
        else:
            setattr(obj, attribute, value)
        try:
            validate()
        except AssertionError as error:
            assert expected in str(error), f'{label} failed for wrong reason: {error}'
            results.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged ottoman passed: {label}')
    return results


def prove_guard_deletions(model):
    original = validate
    results = []
    for message in ('Foot lost ground contact', 'first} detached from', 'Welt section',
                    'Welt modifiers unsupported', 'Root moved'):
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
        exec(compile(tree, '<deleted ottoman guard>', 'exec'), namespace)
        globals()['validate'] = namespace['validate']
        try:
            prove_rejections(model)
        except AssertionError as error:
            assert 'failed for wrong reason' in str(error) or 'Damaged ottoman passed' in str(error), str(error)
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
