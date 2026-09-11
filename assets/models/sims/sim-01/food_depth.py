"""Measure whether the gripping point lies behind the evaluated body surface."""
import bpy
import json
import math
import traceback
from pathlib import Path
from mathutils import Vector

BASE=Path(__file__).resolve().parent
FACINGS={'SE':90,'SW':0,'NW':270,'NE':180}
GRIPPING_PARTS=('Relaxed palm','Resting thumb','Forearm with elbow and wrist sections')


def gripping_depth(scene,rig,parts,grip_world):
    # Orthographic rays are parallel. Exclude the gripping limb so the palm's
    # own thickness does not count as a body occluder of its held object.
    toward_camera=scene.camera.matrix_world.to_quaternion() @ Vector((0,0,1))
    start=grip_world+toward_camera*.001
    hits=[]
    graph=bpy.context.evaluated_depsgraph_get()
    for obj in parts:
        if obj.name.startswith(GRIPPING_PARTS) and any(group.name.endswith('.R') for group in obj.vertex_groups):
            continue
        evaluated=obj.evaluated_get(graph)
        inverse=evaluated.matrix_world.inverted()
        local_start=inverse @ start
        local_direction=(inverse.to_3x3() @ toward_camera).normalized()
        hit,location,_,_=evaluated.ray_cast(local_start,local_direction,distance=20)
        if hit:
            distance=(evaluated.matrix_world @ location-start).dot(toward_camera)
            if distance>0:
                hits.append({'object':obj.name,'distance_toward_camera':distance})
    hits.sort(key=lambda value:value['distance_toward_camera'])
    return {'hand_in_front':not hits,'grip_world':list(grip_world),
            'camera_ray_toward_viewer':list(toward_camera),'occluders':hits}


def main():
    assert bpy.app.background
    status=BASE/'food-depth-proof.json'
    status.write_text(json.dumps({'state':'running'}))
    bpy.ops.wm.open_mainfile(filepath=str(BASE/'sim-01-rigged.blend'))
    scene=bpy.context.scene
    rig=bpy.data.objects['SIM_01_SHARED_RIG']
    names=json.loads((BASE/'neutral-comparison.json').read_text())
    parts=[bpy.data.objects[name] for name in names]
    projected=json.loads((BASE/'projected-bounds.json').read_text())
    proof={}
    for facing,angle in FACINGS.items():
        rig.rotation_euler.z=math.radians(angle)
        rig.animation_data.action=bpy.data.actions['eat']
        for index in range(4):
            scene.frame_set(index+1)
            bpy.context.view_layer.update()
            local=rig.data.bones['hand.R'].matrix_local.inverted() @ Vector((.303,-.075,.737))
            grip=rig.matrix_world @ rig.pose.bones['hand.R'].matrix @ local
            key=f'eat-{facing}-{index}'
            proof[key]=gripping_depth(scene,rig,parts,grip)
            projected[key]['hand_in_front']=proof[key]['hand_in_front']
    (BASE/'projected-bounds.json').write_text(json.dumps(projected,indent=2)+'\n')
    status.write_text(json.dumps({'state':'complete','frames':proof},indent=2)+'\n')


if __name__=='__main__':
    try:
        main()
    except Exception:
        (BASE/'food-depth-proof.json').write_text(json.dumps({'state':'failed','traceback':traceback.format_exc()},indent=2))
        raise
