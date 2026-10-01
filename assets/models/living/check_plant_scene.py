"""Inspect saved plant surfaces and reject deliberately damaged copies."""
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
from plant_layout import leaves
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    root = bpy.data.objects['POTTED-PLANT_MODEL_ROOT']
    objects = {obj.name: obj for obj in root.children}
    names = {'Planter', 'Soil', 'Trunk'}
    names.update(leaf['name'] for leaf in leaves())
    names.update(f'Branch {index+1:02}' for index in range(len(leaves())))
    assert set(objects) == names, 'Part inventory changed'
    assert root.location.length < 1e-6, 'Root moved'
    assert sum(abs(v) for v in root.rotation_euler) < 1e-6, 'Root rotated'
    deps = bpy.context.evaluated_depsgraph_get()
    trees = {}
    for name, obj in objects.items():
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
    low, _ = bounds(objects['Planter'])
    assert abs(low[2]) < 1e-5, 'Planter floats'
    down = Vector((0, 0, -1))
    floor = trees['Planter'].ray_cast(Vector((0, 0, 1)), down)[0]
    assert floor is not None and abs(floor.z-.055) < 1e-5, 'Planter cavity blocked'
    soil_low, soil_high = bounds(objects['Soil'])
    assert soil_low[2] <= floor.z+1e-6, 'Soil floats above planter floor'
    assert .27 < soil_high[2] < .29, 'Soil height changed'
    # The planter's outer profile is convex. Its evaluated hull encloses the
    # cavity as well as the clay, so soil may fill either but cannot protrude.
    planter = objects['Planter'].evaluated_get(deps)
    data = planter.to_mesh()
    hull = bmesh.new()
    for vertex in data.vertices:
        hull.verts.new(planter.matrix_world @ vertex.co)
    planter.to_mesh_clear()
    bmesh.ops.convex_hull(hull, input=list(hull.verts))
    hull.normal_update()
    soil = objects['Soil'].evaluated_get(deps)
    data = soil.to_mesh()
    maximum_escape = max((soil.matrix_world @ vertex.co - face.calc_center_median()).dot(face.normal)
                         for vertex in data.vertices for face in hull.faces)
    soil.to_mesh_clear()
    hull.free()
    assert maximum_escape <= 1e-6, 'Soil protrudes through planter'
    contacts = {}
    pairs = [('Soil', 'Planter'), ('Trunk', 'Soil')]
    for index, leaf in enumerate(leaves()):
        branch = f'Branch {index+1:02}'
        pairs += [(branch, 'Trunk'), (leaf['name'], branch)]
    for first, second in pairs:
        crossings = trees[first].overlap(trees[second])
        witness = None if crossings else overlap_witness(objects[first], objects[second], deps)
        assert crossings or witness, f'{first} detached from {second}'
        contacts[f'{first} / {second}'] = {'crossing_faces': len(crossings), 'contained_point': witness}
    for obj in objects.values():
        low, high = bounds(obj)
        assert low[2] >= -1e-5 and high[2] < .96, 'Height escaped'
        assert all(-.36 < low[i] <= high[i] < .36 for i in (0, 1)), 'Footprint escaped'
    return {'state': 'passed', 'closed_connected_parts': len(objects), 'contacts': contacts,
            'open_planter_floor': floor.z, 'soil_bottom': soil_low[2], 'soil_top': soil_high[2],
            'soil_outer_shell_margin': -maximum_escape}


def prove_rejections(model):
    results = []
    for label, name, axis, amount, expected in (
        ('raised planter', 'Planter', 2, .02, 'Planter floats'),
        ('floating soil', 'Soil', 2, .02, 'Soil floats above planter floor'),
        ('sideways soil', 'Soil', 0, .04, 'Soil protrudes through planter'),
        ('detached trunk', 'Trunk', 0, .5, 'Trunk detached from Soil'),
        ('detached branch', 'Branch 01', 0, .5, 'Branch 01 detached from Trunk'),
        ('detached leaf', 'Leaf 01', 2, .1, 'Leaf 01 detached from Branch 01'),
        ('shifted root', 'POTTED-PLANT_MODEL_ROOT', 0, .1, 'Root moved'),
    ):
        bpy.ops.wm.open_mainfile(filepath=str(model))
        bpy.data.objects[name].location[axis] += amount
        try:
            validate()
        except AssertionError as error:
            assert expected == str(error), f'{label} failed for wrong reason: {error}'
            results.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged plant passed: {label}')
    return results


def prove_guard_deletions(model):
    original = validate
    results = []
    for message in ('Planter floats', 'Soil floats above planter floor',
                    'Soil protrudes through planter', 'detached from', 'Root moved'):
        tree = ast.parse(inspect.getsource(original))
        removed = []

        class RemoveGuard(ast.NodeTransformer):
            def visit_Assert(self, node):
                if node.msg is not None and message in ast.unparse(node.msg):
                    removed.append(node)
                    return ast.copy_location(ast.Pass(), node)
                return node

        tree = ast.fix_missing_locations(RemoveGuard().visit(tree))
        assert len(removed) == 1
        namespace = dict(globals())
        exec(compile(tree, '<deleted plant guard>', 'exec'), namespace)
        globals()['validate'] = namespace['validate']
        try:
            prove_rejections(model)
        except AssertionError as error:
            assert 'failed for wrong reason' in str(error) or 'Damaged plant passed' in str(error), str(error)
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
