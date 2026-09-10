"""Measure the bike candidate without changing or rendering the saved rig."""
import json
import hashlib
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from render_job import apply_render_job

assert bpy.app.background
bpy.ops.wm.open_mainfile(filepath=str(BASE / 'sim-01-exercise.blend'))
scene = bpy.context.scene
rig = bpy.data.objects['SIM_01_SHARED_RIG']
saved_hash = hashlib.sha256((BASE / 'sim-01-exercise.blend').read_bytes()).hexdigest()
proofs = [json.loads(path.read_text()) for path in
          (BASE / 'exercise-batch-proof.json', BASE / 'exercise-preview-proof.json') if path.exists()]
proof = next(item for item in proofs if item['additive_rig_sha256'] == saved_hash)
clip = proof['clip']
apply_render_job(scene, rig, {'exercise': clip}, 'exercise', 'SE', 0)
graph = bpy.context.evaluated_depsgraph_get()


def pixel(point):
    value = world_to_camera_view(scene, scene.camera, point)
    return [value.x * clip['width'] - clip['world_origin'][0],
            (1 - value.y) * clip['height'] - clip['world_origin'][1]]


result = {'additive_rig_sha256': saved_hash,
          'coordinate_origin': 'tile centre, after the registered body anchor cancels the renderer tile-front offset',
          'saddle_top': [-10, -13, 7, -7], 'grips': {'L': [-4, -17], 'R': [12, -18]},
          'pedals': [[-5, 8], [-14, -9]], 'parts': {},
          'hips': pixel(rig.matrix_world @ rig.pose.bones['hips'].head)}
result['grip_depth'] = {}
toward_camera = scene.camera.matrix_world.to_quaternion() @ Vector((0, 0, 1))
for side in ('L', 'R'):
    bone = rig.data.bones['hand.' + side]
    grip_rest = bone.head_local + (bone.tail_local - bone.head_local).normalized() * .073
    grip = rig.matrix_world @ rig.pose.bones[bone.name].matrix @ bone.matrix_local.inverted() @ grip_rest
    hits = []
    distances = {}
    for name in ('Overshirt body', 'Trouser hip bridge', 'Sculpted head'):
        obj = bpy.data.objects[name].evaluated_get(graph)
        inverse = obj.matrix_world.inverted()
        local = inverse @ grip
        found, closest, normal, _ = obj.closest_point_on_mesh(local)
        if found:
            distances[name] = {'distance': (local - closest).length,
                               'outside_nearest_surface': (local - closest).dot(normal) >= 0}
        hit, location, _, _ = obj.ray_cast(inverse @ (grip + toward_camera * .001),
                                          (inverse.to_3x3() @ toward_camera).normalized(), distance=20)
        if hit:
            hits.append(name)
    result['grip_depth'][side] = {'world': list(grip), 'projected': pixel(grip),
                                  'torso_head_occluders': hits, 'surface_distances': distances}
result['console_depth'] = {'state': 'not_geometrically_defined',
                           'reason': 'The console exists only in the 2D bike sprite. Its occupied occlusion follows bike-before-body draw order, not a measured 3D console surface.'}
for obj in bpy.data.objects:
    if obj.type != 'MESH' or obj.hide_render:
        continue
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    points = [pixel(evaluated.matrix_world @ vertex.co) for vertex in mesh.vertices]
    result['parts'][obj.name] = [min(point[0] for point in points), min(point[1] for point in points),
                               max(point[0] for point in points), max(point[1] for point in points)]
    evaluated.to_mesh_clear()
(BASE / 'exercise-contact-measurements.json').write_text(json.dumps(result, indent=2) + '\n')
