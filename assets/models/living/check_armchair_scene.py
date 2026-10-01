"""Verify the saved chair against the unchanged Sit action without saving it."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from armchair_contact import measure, intersection


def open_scene(model):
    bpy.ops.wm.open_mainfile(filepath=str(model))
    root = bpy.data.objects['ARMCHAIR_MODEL_ROOT']
    body = bpy.data.collections['Preserved Sim reference - hidden']
    body.hide_render = False
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    rig.animation_data.action = bpy.data.actions['sit']
    rig.rotation_euler.z = -math.pi/2
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    return root, body, rig


def prove_surface_queries():
    def cube(center, scale):
        mesh = bmesh.new()
        try:
            bmesh.ops.create_cube(mesh, size=2)
            mesh.verts.ensure_lookup_table()
            mesh.verts.index_update()
            points = [Vector(tuple(center[i]+vertex.co[i]*scale[i] for i in range(3)))
                      for vertex in mesh.verts]
            polygons = [tuple(vertex.index for vertex in face.verts) for face in mesh.faces]
            return points, BVHTree.FromPolygons(points, polygons, epsilon=0)
        finally:
            mesh.free()

    unit = cube((0, 0, 0), (1, 1, 1))
    assert intersection(unit, cube((3, 0, 0), (1, 1, 1))) is None, 'Separated surfaces reported overlap'
    assert intersection(unit, cube((0, 0, 0), (.2, .2, .2)))['kind'] == 'chair_inside_body'
    assert intersection(cube((0, 0, 0), (.2, .2, .2)), unit)['kind'] == 'body_inside_chair'
    assert intersection(cube((0, 0, 0), (2, .1, .1)),
                        cube((0, 0, 0), (.1, 2, .1)))['kind'] == 'surface'
    return ['separated solids', 'body containment', 'chair containment', 'crossed thin surfaces']


def prove_rejections(model):
    cases = (
        ('raised seat', 'Seat cushion', 'location', (0, 0, .004), 'Body intersects chair:', 'Seat cushion'),
        ('floating hip', 'SIM_01_SHARED_RIG', 'location', (0, 0, .25),
         'Hip lost non-penetrating seat support', ''),
        ('lowered seat', 'Seat cushion', 'location', (0, 0, -.10),
         'Hip lost non-penetrating seat support', ''),
        ('raised arm', 'Arm left', 'location', (0, 0, .15), 'Body intersects chair:', 'Arm left'),
        ('raised foot', 'Foot -0.18 -0.3', 'location', (0, 0, .02),
         'Foot -0.18 -0.3 lost floor contact', ''),
        ('detached foot', 'Foot -0.18 -0.3', 'location', (0, -1, 0),
         'Upholstered base detached from Foot -0.18 -0.3', ''),
        ('hidden hip', 'Trouser hip bridge', 'hide_render', True, 'Visible Sim inventory changed', ''),
        ('wrong chair facing', 'ARMCHAIR_MODEL_ROOT', 'rotation_euler', (0, 0, math.pi/2),
         'Armchair authored basis changed', ''),
    )
    result = []
    for label, name, attribute, value, prefix, detail in cases:
        root, body, _ = open_scene(model)
        obj = bpy.data.objects[name]
        if attribute == 'location':
            obj.location += Vector(value)
        else:
            setattr(obj, attribute, value)
        try:
            measure(root, body, 1)
        except AssertionError as failure:
            message = str(failure)
            assert message.startswith(prefix) and detail in message, f'Unrelated rejection for {label}: {message}'
            result.append({'mutation': label, 'rejection': message})
        else:
            raise AssertionError(f'Damaged scene survived: {label}')
    return result


def run(model, output):
    if not bpy.app.background or not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use background Blender, an absolute model and a new result path')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    try:
        queries = prove_surface_queries()
        root, body, _ = open_scene(model)
        samples = []
        for frame in range(1, 5):
            bpy.context.scene.frame_set(frame)
            samples.append(measure(root, body, frame))
        mutations = prove_rejections(model)
        root, body, _ = open_scene(model)
        assert measure(root, body, 1) == samples[0], 'Reopened saved scene changed'
        assert hashlib.sha256(model.read_bytes()).hexdigest() == original, 'Saved model changed'
        result = {'state': 'passed', 'scope': 'Four occupied contact samples; visual review is separate',
                  'model_sha256': original, 'samples': samples,
                  'query_tests': queries, 'caught_mutations': mutations,
                  'blender_version': bpy.app.version_string,
                  'blender_build_hash': bpy.app.build_hash.decode()}
    except Exception:
        output.write_text(json.dumps({'state': 'failed', 'error': traceback.format_exc()}, indent=2)+'\n')
        raise
    output.write_text(json.dumps(result, indent=2)+'\n')


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2:
        raise ValueError('Pass the saved model and new result path')
    run(*map(Path, args))
