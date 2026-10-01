"""Check actual lamp solids, open shade, support and damaged-scene rejection."""
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
from lamp_layout import parts
from check_stove_scene import bounds
from check_toilet_scene import overlap_witness


def validate():
    bpy.context.view_layer.update()
    root = bpy.data.objects['FLOOR-LAMP_MODEL_ROOT']
    actual = {obj.name: obj for obj in root.children}
    expected = parts()
    assert set(actual) == {part['name'] for part in expected}, 'Part inventory changed'
    assert root.location.length < 1e-6, 'Root moved'
    assert sum(abs(v) for v in root.rotation_euler) < 1e-6, 'Root rotated'
    deps = bpy.context.evaluated_depsgraph_get()
    for name, obj in actual.items():
        assert obj.type == 'MESH', 'Unexpected geometry'
        topology = bmesh.new()
        topology.from_mesh(obj.data)
        assert all(edge.is_manifold for edge in topology.edges), f'{name} is not a closed solid'
        assert len(topology.faces) > 10, f'{name} is empty'
        topology.free()
    base_low, _ = bounds(actual['Base'])
    assert abs(base_low[2]) < 1e-5, 'Base lost ground contact'
    contacts = {}
    for part in expected:
        for support in part['supports']:
            first, second = actual[part['name']], actual[support]
            # BVH vertices are local; put both meshes in world coordinates.
            meshes = []
            for obj in (first, second):
                evaluated = obj.evaluated_get(deps)
                data = evaluated.to_mesh()
                meshes.append(BVHTree.FromPolygons(
                    [evaluated.matrix_world @ v.co for v in data.vertices],
                    [tuple(p.vertices) for p in data.polygons]))
                evaluated.to_mesh_clear()
            crossing = meshes[0].overlap(meshes[1])
            witness = overlap_witness(first, second, deps) if not crossing else None
            assert crossing or witness, f'{part["name"]} detached from {support}'
            contacts[f'{part["name"]} / {support}'] = {
                'intersecting_face_pairs': len(crossing), 'contained_point': witness}
    bulb_low, bulb_high = bounds(actual['Bulb'])
    _, stem_high = bounds(actual['Stem'])
    assert stem_high[2] < bulb_low[2], 'Stem pierces bulb'
    for side in ('L', 'R'):
        harp_low, harp_high = bounds(actual[f'Harp upright {side}'])
        assert harp_high[0] < bulb_low[0] or harp_low[0] > bulb_high[0], 'Harp pierces bulb'
    shade = actual['Shade'].evaluated_get(deps)
    inverse = shade.matrix_world.inverted()
    ray_results = []
    for x, y in ((0, 0), (.08, 0), (0, .08), (-.08, 0), (0, -.08)):
        hit, _, _, _ = shade.ray_cast(inverse @ Vector((x, y, 2)),
                                      inverse.to_3x3() @ Vector((0, 0, -1)))
        assert not hit, 'Shade opening blocked'
        ray_results.append([x, y])
    for name, obj in actual.items():
        low, high = bounds(obj)
        assert low[2] >= -1e-5 and high[2] <= 1.38001, 'Height escaped'
        assert all(-.28001 <= low[i] <= high[i] <= .28001 for i in (0, 1)), 'Footprint escaped'
    low, high = bounds(actual['Shade'])
    assert abs(low[2]-.95) < 1e-5 and abs(high[2]-1.34) < 1e-5, 'Shade height changed'
    assert abs(high[0]-.28) < 1e-5 and abs(low[0]+.28) < 1e-5, 'Shade diameter changed'
    return {'state': 'passed', 'parts': len(actual), 'contacts': contacts,
            'open_shade_rays': ray_results, 'grounded_base': True}


def prove_rejections(model):
    caught = []
    for label, name, axis, amount, expected in (
        ('lifted base', 'Base', 2, .01, 'Base lost ground contact'),
        ('detached stem', 'Stem', 0, .40, 'Stem detached from Base'),
        ('detached shade', 'Shade', 2, .15, 'Shade detached from'),
        ('detached support', 'Shade support X', 1, .30, 'Shade support X detached from Harp upright L'),
        ('detached bulb', 'Bulb', 0, .20, 'Bulb detached from Socket'),
        ('shifted root', 'FLOOR-LAMP_MODEL_ROOT', 0, .1, 'Root moved'),
    ):
        bpy.ops.wm.open_mainfile(filepath=str(model))
        bpy.data.objects[name].location[axis] += amount
        try:
            validate()
        except AssertionError as error:
            assert expected in str(error), f'{label} failed for the wrong reason: {error}'
            caught.append({'mutation': label, 'rejection': str(error)})
        else:
            raise AssertionError(f'Damaged scene passed: {label}')
    bpy.ops.wm.open_mainfile(filepath=str(model))
    root = bpy.data.objects['FLOOR-LAMP_MODEL_ROOT']
    bpy.data.objects.remove(bpy.data.objects['Shade'], do_unlink=True)
    bpy.ops.mesh.primitive_cone_add(vertices=96, radius1=.28, radius2=.15,
                                    depth=.39, location=(0, 0, 1.145))
    bpy.context.object.name = 'Shade'
    bpy.context.object.parent = root
    try:
        validate()
    except AssertionError as error:
        assert 'Shade opening blocked' in str(error), f'capped shade failed for the wrong reason: {error}'
        caught.append({'mutation': 'capped shade', 'rejection': str(error)})
    else:
        raise AssertionError('Damaged scene passed: capped shade')
    return caught


def prove_guard_deletions(model):
    original = validate
    caught = []
    for message in ('Base lost ground contact', 'detached from', 'Shade opening blocked'):
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
        exec(compile(tree, '<deleted lamp guard>', 'exec'), namespace)
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
