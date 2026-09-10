"""Render four real model rotations without opening an interactive window."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

BASE = Path(__file__).resolve().parent
SIM = BASE.parent / 'sims/sim-01'
sys.path[:0] = [str(BASE), str(SIM)]
from geometry import FACINGS, GRIPS, HIP, pedal
from build_parts import bike, chair, set_crank_phase
from build_rig import direct_bone, arm_elbow

STATUS = BASE / 'review/status.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def status(state, **fields):
    STATUS.write_text(json.dumps({'state':state,**fields},indent=2))


def rider_pose(rig, phase):
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    rig['book_visible'] = 0.0
    rig['eyes_closed'] = 0.0
    bpy.context.view_layer.update()
    hip = Vector(HIP)
    delta = hip - Vector((0,0,.86))
    for name in ('hips','spine','head'):
        rest = rig.data.bones[name]
        direct_bone(rig,name,rest.head_local+delta,rest.tail_local+delta)
    for side,sign in (('L',-1),('R',1)):
        contact = Vector(pedal(side,phase))
        ankle = contact + Vector((0,.04,.10))
        thigh = hip + Vector((sign*.124,0,0))
        knee = arm_elbow(thigh,ankle,.37,.36,thigh+Vector((sign*.06,-.8,-.18)))
        direct_bone(rig,'thigh.'+side,thigh,knee)
        direct_bone(rig,'shin.'+side,knee,ankle)
        direct_bone(rig,'foot.'+side,ankle,ankle+Vector((0,-.14,0)))
        upper = rig.data.bones['upper_arm.'+side]
        lower = rig.data.bones['forearm.'+side]
        shoulder = upper.head_local + delta
        wrist = Vector(GRIPS[side]) + Vector((0,.073,0))
        elbow = arm_elbow(shoulder,wrist,upper.length,lower.length,
                          shoulder+Vector((sign*.35,.12,-.4)))
        direct_bone(rig,'upper_arm.'+side,shoulder,elbow)
        direct_bone(rig,'forearm.'+side,elbow,wrist)
        direct_bone(rig,'hand.'+side,wrist,wrist+Vector((0,-.11,0)))


def project(scene, point):
    p = world_to_camera_view(scene,scene.camera,Vector(point))
    return [p.x*scene.render.resolution_x,(1-p.y)*scene.render.resolution_y]


def run():
    assert bpy.app.background
    directory = BASE / 'review/candidate-02'
    directory.mkdir(parents=True,exist_ok=True)
    status('running',completed=0)
    source = SIM / 'sim-01-rigged.blend'
    source_hash = digest(source)
    proof = {'source_sha256':source_hash,'state':'running','renders':[],
             'note':'Offline source candidates, not runtime acceptance.',
             'density':8,'logical_canvas':[96,120],'objects':{}}
    for kind,builder in (('bike',bike),('chair',chair)):
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene = bpy.context.scene
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        sim_parts = [obj for obj in bpy.data.objects if obj.type in ('MESH','CURVE')]
        sim_collection = bpy.data.collections.new('Sim contact reference')
        scene.collection.children.link(sim_collection)
        for obj in sim_parts:
            for collection in list(obj.users_collection):
                collection.objects.unlink(obj)
            sim_collection.objects.link(obj)
        root = bpy.data.objects.new(kind.upper()+'_MODEL_ROOT',None)
        scene.collection.objects.link(root)
        movable = builder(root)
        objects = list(root.children)
        registration = json.loads((SIM/'registered-canvas-proof.json').read_text())
        scene.render.resolution_x = 96*8
        scene.render.resolution_y = 120*8
        scene.render.resolution_percentage = 100
        scene.camera.data.ortho_scale = registration['idle']['camera_ortho_scale'] * 120/88
        scene.camera.location = registration['idle']['camera_location']
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.film_transparent = True
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        bpy.context.preferences.filepaths.save_version = 0
        rig.rotation_euler = (0,0,0)
        if kind == 'bike':
            rider_pose(rig,0)
        else:
            rig.animation_data.action = bpy.data.actions['read']
            scene.frame_set(1)
        bpy.context.view_layer.update()
        occupied_visibility = {obj.name: bool(obj.hide_render) for obj in sim_parts}
        origin = project(scene,(0,0,0))
        proof['objects'][kind] = {'parts':[obj.name for obj in objects],
                                 'world_origin':origin,'camera_matrix':[list(row) for row in scene.camera.matrix_world],
                                 'ortho_scale':scene.camera.data.ortho_scale}
        # Save the full inspection scene, including the immutable source rig as
        # a fit reference. Never overwrite the accepted model file.
        model = directory / f'{kind}-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['objects'][kind]['model_sha256'] = digest(model)
        for facing,degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            rig.rotation_euler.z = math.radians(degrees)
            for occupied in (False,True):
                sim_collection.hide_render = not occupied
                for obj in sim_parts:
                    # Object visibility drivers handle the book and eyelids;
                    # a view-layer holdout is not used for an empty furniture view.
                    obj.hide_render = occupied_visibility[obj.name]
                if occupied:
                    if kind == 'bike':
                        rider_pose(rig,0)
                    else:
                        rig.animation_data.action = bpy.data.actions['read']
                        scene.frame_set(1)
                    bpy.context.view_layer.update()
                path = directory / f'{kind}-{facing}-{"occupied" if occupied else "empty"}.png'
                scene.render.filepath = str(path)
                bpy.ops.render.render(write_still=True)
                proof['renders'].append({'path':path.name,'object':kind,'facing':facing,
                                         'occupied':occupied,'sha256':digest(path)})
                status('running',completed=len(proof['renders']),last=path.name)
    assert digest(source) == source_hash, 'Accepted rig changed'
    proof['state'] = 'complete'
    (directory/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
    status('complete',completed=len(proof['renders']))


if __name__ == '__main__':
    try:
        run()
    except Exception:
        STATUS.parent.mkdir(parents=True,exist_ok=True)
        status('failed',traceback=traceback.format_exc())
        raise
