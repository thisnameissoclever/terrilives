"""Check saved solids, rail clearance and actual fabric support, including damaged copies."""
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

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen')]
from coat_rack_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    root = bpy.data.objects['COAT-RACK_MODEL_ROOT']
    objects = {obj.name: obj for obj in root.children}
    assert set(objects) == {p['name'] for p in parts()} | {'Hanging fabric'}, 'Part inventory changed'
    assert root.location.length < 1e-6 and sum(abs(v) for v in root.rotation_euler) < 1e-6, 'Root changed'
    deps = bpy.context.evaluated_depsgraph_get()
    for name, obj in objects.items():
        evaluated = obj.evaluated_get(deps)
        data = evaluated.to_mesh()
        topology = bmesh.new()
        topology.from_mesh(data)
        assert all(edge.is_manifold for edge in topology.edges), f'{name} is not closed'
        assert len(topology.faces) > 10, f'{name} is empty'
        topology.free()
        evaluated.to_mesh_clear()
    low, _ = bounds(objects['Base'])
    assert abs(low[2]) < 1e-5, 'Base lost ground contact'
    contacts = {}
    for part in parts():
        for support in part['supports']:
            first, second = objects[part['name']], objects[support]
            witness = overlap_witness(first, second, deps)
            if witness is None:
                # Exact butt joints have contact but no interior intersection volume.
                surface = second.evaluated_get(deps)
                inverse = surface.matrix_world.inverted()
                evaluated = first.evaluated_get(deps)
                data = evaluated.to_mesh()
                for vertex in data.vertices:
                    point = evaluated.matrix_world @ vertex.co
                    found, nearest, _, _ = surface.closest_point_on_mesh(inverse @ point)
                    if found and (surface.matrix_world @ nearest-point).length <= 1e-6:
                        witness = list(point)
                        break
                evaluated.to_mesh_clear()
            assert witness, f'{part["name"]} detached from {support}'
            contacts[f'{part["name"]} / {support}'] = witness
    cloth = objects['Hanging fabric'].evaluated_get(deps)
    rail = objects['Rail'].evaluated_get(deps)
    cloth_inverse, rail_inverse = cloth.matrix_world.inverted(), rail.matrix_world.inverted()
    low, high = bounds(objects['Rail'])
    assert high[1]-low[1] > .52 and high[0]-low[0] < .041, 'Rail physical orientation changed'
    assert math.dist(low, (-.02, -.30, 1.25)) < 1e-5 and math.dist(high, (.02, .23, 1.29)) < 1e-5, 'Rail dimensions changed'
    support_gaps = []
    for x in (.10, .13, .16, .19, .22, .25):
        hit, upper, _, _ = rail.ray_cast(rail_inverse @ Vector((0, -x, 1.6)),
                                        rail_inverse.to_3x3() @ Vector((0, 0, -1)))
        found, lower, _, _ = cloth.ray_cast(cloth_inverse @ Vector((0, -x, 1.27)),
                                           cloth_inverse.to_3x3() @ Vector((0, 0, 1)))
        assert hit and found, 'Fabric missing above rail'
        gap = (cloth.matrix_world @ lower).z-(rail.matrix_world @ upper).z
        assert -.0001 <= gap <= .0002, 'Fabric lost rail support'
        support_gaps.append(gap)
    data = cloth.to_mesh()
    neighbors = {v.index: set() for v in data.vertices}
    for edge in data.edges:
        a, b = edge.vertices
        neighbors[a].add(b)
        neighbors[b].add(a)
    visited, pending = set(), [0]
    while pending:
        vertex = pending.pop()
        if vertex not in visited:
            visited.add(vertex)
            pending.extend(neighbors[vertex]-visited)
    assert len(visited) == len(data.vertices), 'Fabric has disconnected pieces'
    world_points = [cloth.matrix_world @ v.co for v in data.vertices]
    points = [Vector((-p.y, p.x, p.z)) for p in world_points]
    fold = [p for p in points if p.z >= 1.269]
    assert min(p.x for p in fold) >= -.227 and max(p.x for p in fold) <= .297, 'Fabric fold overhangs rail'
    cloth.to_mesh_clear()
    clearance = min(math.hypot(p.y, p.z-1.27) for p in points)
    assert clearance >= .0199, 'Fabric penetrates rail'
    assert min(p.x for p in points) > .033, 'Fabric intersects upright'
    low, high = bounds(objects['Hanging fabric'])
    assert abs(low[2]-.494) < .002 and 1.290 < high[2] < 1.293, 'Fabric dimensions changed'
    for name, obj in objects.items():
        low, high = bounds(obj)
        assert low[2] >= -.00001 and high[2] <= 1.415, 'Height escaped'
        assert all(-.32 < low[i] <= high[i] < .32 for i in (0, 1)), 'Footprint escaped'
    return {'state': 'passed', 'parts': len(objects), 'contacts': contacts,
            'fabric_support_gaps': support_gaps, 'minimum_rail_radius': clearance,
            'fabric_clear_of_upright': True, 'grounded_base': True}


def prove_rejections(model):
    cases = [
        ('floating base', 'Base', 2, .02, 'Base lost ground contact'),
        ('detached upright', 'Upright', 0, .4, 'Upright detached'),
        ('detached rail', 'Rail', 2, .3, 'Rail detached'),
        ('floating cloth', 'Hanging fabric', 2, .02, 'Fabric lost rail support'),
        ('missing fold', 'Hanging fabric', 0, .15, 'Fabric missing above rail'),
        ('cloth into rail', 'Hanging fabric', 2, -.01, 'Fabric lost rail support'),
        ('shifted root', 'COAT-RACK_MODEL_ROOT', 0, .1, 'Root changed'),
    ]
    caught = []
    for label, name, axis, amount, reason in cases:
        bpy.ops.wm.open_mainfile(filepath=str(model))
        bpy.data.objects[name].location[axis] += amount
        try:
            validate()
        except AssertionError as error:
            assert reason in str(error), f'{label} failed for the wrong reason: {error}'
            caught.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged scene passed: {label}')
    for label, reason in (('overhanging fold', 'Fabric fold overhangs rail'),
                          ('disconnected scrap', 'Fabric has disconnected pieces')):
        bpy.ops.wm.open_mainfile(filepath=str(model))
        fabric = bpy.data.objects['Hanging fabric']
        if label == 'overhanging fold':
            for vertex in fabric.data.vertices:
                if vertex.co.x > .252 and vertex.co.z >= 1.269:
                    vertex.co.x += .055
        else:
            topology = bmesh.new()
            topology.from_mesh(fabric.data)
            extra = bmesh.ops.create_cube(topology, size=.004)['verts']
            bmesh.ops.translate(topology, vec=Vector((.172, -.05, .75)), verts=extra)
            topology.to_mesh(fabric.data)
            topology.free()
        try:
            validate()
        except AssertionError as error:
            assert reason in str(error), f'{label} failed for the wrong reason: {error}'
            caught.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged scene passed: {label}')
    return caught


def prove_guard_deletions(model):
    original, caught = validate, []
    for message in ('Base lost ground contact', 'detached from', 'Fabric lost rail support',
                    'Fabric has disconnected pieces', 'Fabric fold overhangs rail'):
        tree, removed = ast.parse(inspect.getsource(original)), []

        class RemoveGuard(ast.NodeTransformer):
            def visit_Assert(self, node):
                if node.msg is not None and message in ast.unparse(node.msg):
                    removed.append(node)
                    return ast.copy_location(ast.Pass(), node)
                return node

        tree = ast.fix_missing_locations(RemoveGuard().visit(tree))
        assert len(removed) == 1
        namespace = dict(globals())
        exec(compile(tree, '<deleted coat rack guard>', 'exec'), namespace)
        globals()['validate'] = namespace['validate']
        try:
            prove_rejections(model)
        except AssertionError as error:
            assert 'failed for the wrong reason' in str(error) or 'Damaged scene passed' in str(error), str(error)
            caught.append({'deleted_guard': message, 'rejection': str(error)})
        else:
            raise AssertionError(f'Mutation proof accepted deleted guard: {message}')
        finally:
            globals()['validate'] = original
    return caught


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
        assert hashlib.sha256(model.read_bytes()).hexdigest() == digest, 'Source changed'
        result['model_sha256'] = digest
    except Exception as error:
        output.write_text(json.dumps({'state': 'failed', 'error': str(error)}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')
