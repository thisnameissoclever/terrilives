"""Trace visible surface witnesses independently of rendered owner labels."""
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

from double_bed_sleep import surface


def measure(state):
    scene = state['scene']
    saved_objects = [(obj, obj.hide_viewport) for obj in scene.objects]
    saved_collections = [(collection, collection.hide_viewport) for collection in state['bodies']]
    try:
        for obj, _ in saved_objects:
            if obj.hide_render:
                obj.hide_viewport = True
        for collection, _ in saved_collections:
            collection.hide_viewport = collection.hide_render
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        rotation = scene.camera.matrix_world.to_quaternion()
        toward_camera = rotation @ Vector((0, 0, 1))
        right, up = rotation @ Vector((1, 0, 0)), rotation @ Vector((0, 1, 0))
        frame = scene.camera.data.view_frame(scene=scene)
        width = max(v.x for v in frame)-min(v.x for v in frame)
        height = max(v.y for v in frame)-min(v.y for v in frame)
        result = {}
        for owner, collection in [('furniture', state['furniture'])] + [
                (f'sim{i}', collection) for i, collection in enumerate(state['bodies'])
                if state['occupancy'] & (1 << i)]:
            witnesses = []
            objects = [obj for obj in collection.all_objects if obj.type == 'MESH' and not obj.hide_render]
            for obj in objects:
                points, triangles = surface(obj, deps)
                for triangle in triangles:
                    a, b, c = [points[index] for index in triangle]
                    if (b-a).cross(c-a).length < .00015:
                        continue
                    point = (a+b+c)/3
                    projected = world_to_camera_view(scene, scene.camera, point)
                    if not (0 < projected.x < 1 and 0 < projected.y < 1):
                        continue
                    x, y = int(projected.x*1280), int((1-projected.y)*1408)
                    # A projected triangle centroid can lie beside a duvet edge.
                    # Trace the actual pixel footprint, not only that world point.
                    interior = True
                    for dx, dy in ((0, 0), (-1, -1), (-1, 1), (1, -1), (1, 1)):
                        probe = (point+right*((x+.5+dx)/1280-projected.x)*width
                                 +up*((1-(y+.5+dy)/1408)-projected.y)*height)
                        hit, _, _, _, hit_obj, _ = scene.ray_cast(
                            deps, probe+toward_camera*10, -toward_camera, distance=10.01)
                        if not hit or hit_obj.original != obj:
                            interior = False
                            break
                    if interior:
                        witnesses.append({'object': obj.name, 'world': list(point),
                                          'pixel': [x, y]})
                        break
                if len(witnesses) == 3:
                    break
            if not witnesses:
                raise ValueError('No visible surface witness for '+owner)
            result[owner] = witnesses
        return result
    finally:
        for obj, hidden in saved_objects:
            obj.hide_viewport = hidden
        for collection, hidden in saved_collections:
            collection.hide_viewport = hidden
        bpy.context.view_layer.update()
