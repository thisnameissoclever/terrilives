"""Measure lid occlusion of every fish in each registered camera direction."""
import json
import math
from pathlib import Path
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def check():
    roots = [o for o in bpy.data.objects if o.name.endswith('_MODEL_ROOT') and o.name.startswith('AQUARIUM')]
    assert len(roots) == 1, 'Expected one aquarium root'
    root = roots[0]
    camera_direction = bpy.context.scene.camera.matrix_world.to_quaternion() @ Vector((0, 0, 1))
    rows = []
    for facing, degrees in {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}.items():
        root.rotation_euler.z = math.radians(degrees)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        roof = bpy.data.objects['Tank lid'].evaluated_get(deps)
        data = roof.to_mesh()
        tree = BVHTree.FromPolygons([roof.matrix_world @ v.co for v in data.vertices],
                                   [tuple(p.vertices) for p in data.polygons])
        roof.to_mesh_clear()
        for name in ('Amber fish', 'Blue fish', 'Coral fish'):
            blocked, total, projected = 0, 0, []
            for suffix in (' body', ' tail', ' eye -1', ' eye 1'):
                obj = bpy.data.objects[name+suffix].evaluated_get(deps)
                data = obj.to_mesh()
                for vertex in data.vertices:
                    point = obj.matrix_world @ vertex.co
                    blocked += int(tree.ray_cast(point, camera_direction, 10)[0] is not None)
                    total += 1
                    uv = world_to_camera_view(bpy.context.scene, bpy.context.scene.camera, point)
                    projected.append((uv.x*768, (1-uv.y)*960))
                obj.to_mesh_clear()
            rows.append({'facing': facing, 'fish': name, 'lid_blocked_vertices': blocked,
                         'total_vertices': total,
                         'pixel_bounds': [min(p[0] for p in projected), min(p[1] for p in projected),
                                          max(p[0] for p in projected), max(p[1] for p in projected)]})
    return rows


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2 or not bpy.app.background:
        raise ValueError('Use background Blender with an absolute model and a new output path')
    model, output = map(Path, args)
    if not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use absolute paths and a new output file')
    bpy.ops.wm.open_mainfile(filepath=str(model))
    rows = check()
    passed = all(row['lid_blocked_vertices'] == 0 for row in rows)
    output.write_text(json.dumps({'state': 'passed' if passed else 'failed', 'rows': rows}, indent=2)+'\n')
    assert passed, 'Lid blocks fish in at least one facing'
