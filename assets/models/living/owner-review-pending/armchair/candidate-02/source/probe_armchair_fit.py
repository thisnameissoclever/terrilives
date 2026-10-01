"""Measure a candidate's occupied geometry before setting acceptance limits."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parent/'bedroom'), str(BASE.parent/'bathroom')]
from bunk_contact import mesh_points, point_bounds
from check_toilet_scene import overlap_witness


def run(model, output):
    if not bpy.app.background or not model.is_absolute() or not output.is_absolute() or output.exists():
        raise ValueError('Use background Blender, an absolute model and a new absolute result path')
    original = hashlib.sha256(model.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(model))
    root = bpy.data.objects['ARMCHAIR_MODEL_ROOT']
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    body = bpy.data.collections['Preserved Sim reference - hidden']
    body.hide_render = False
    rig.animation_data.action = bpy.data.actions['sit']
    rig.rotation_euler.z = -math.pi/2
    samples = []
    for frame in range(1, 5):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        visible = [obj for obj in body.all_objects if obj.type == 'MESH' and not obj.hide_render]
        geometry = {obj.name: mesh_points(obj, deps) for obj in visible}
        solids = {obj.name: obj for obj in root.children}
        bounds = {name: point_bounds(points) for name, points in geometry.items()}
        intersections = []
        for obj in visible:
            for name, solid in solids.items():
                witness = overlap_witness(obj, solid, deps)
                if witness:
                    intersections.append({'body': obj.name, 'chair': name, 'witness': witness})
        seat = solids['Seat cushion'].evaluated_get(deps)
        inverse = seat.matrix_world.inverted()
        support = {}
        for name, points in geometry.items():
            gaps = []
            for point in points:
                if point.z > .65:
                    continue
                hit, location, _, _ = seat.ray_cast(inverse @ Vector((point.x, point.y, 2)),
                                                   inverse.to_3x3() @ Vector((0, 0, -1)))
                if hit:
                    gaps.append(point.z-(seat.matrix_world @ location).z)
            if gaps:
                support[name] = {'min_gap': min(gaps), 'ray_hits': len(gaps),
                                 'near_points': sum(-.025 <= gap <= .01 for gap in gaps)}
        samples.append({'frame': frame, 'parts': bounds, 'intersections': intersections,
                        'seat_rays': support})
    assert hashlib.sha256(model.read_bytes()).hexdigest() == original, 'Saved candidate changed'
    output.write_text(json.dumps({'state': 'observed', 'not_acceptance': True,
                                  'model_sha256': original, 'samples': samples}, indent=2)+'\n')


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2:
        raise ValueError('Pass absolute model and result paths')
    run(Path(args[0]), Path(args[1]))
