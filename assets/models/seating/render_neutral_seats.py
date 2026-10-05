"""Bake verified neutral seating from immutable furniture and character sources."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent
sys.path[:0] = [str(BASE),str(MODELS/'furniture'),str(MODELS/'sims/sim-01')]
from pose_profiles import PROFILES
from neutral_pose import apply
from neutral_contact import measure
from animation_export import render_pass
from render_shirt_variants import material_snapshot,set_shirt_colors,SHIRT_COLORS

FACINGS = {'SE':90,'NW':270,'SW':0,'NE':180}


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def run(output,only=None,probe=False):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use hidden background Blender and a new absolute output directory')
    output.mkdir(parents=True,exist_ok=False)
    scripts = sorted({Path(module.__file__).resolve() for module in sys.modules.values()
                      if getattr(module,'__file__',None) and str(module.__file__).endswith('.py')
                      and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())})
    inputs = {path.relative_to(MODELS).as_posix():digest(path) for path in scripts}
    journal = output/'proof.json'
    proof = dict(state='running',probe=probe,inputs=inputs,blender_version=bpy.app.version_string,
                 blender_build_hash=bpy.app.build_hash.decode(),objects=[])
    def save(): journal.write_text(json.dumps(proof,indent=2)+'\n')
    save()
    try:
        for kind,profile in PROFILES.items():
            if kind=='armchair' or (only and kind not in only): continue
            source = MODELS/profile['source']
            before = digest(source)
            inputs[profile['source']] = before
            bpy.ops.wm.open_mainfile(filepath=str(source))
            scene = bpy.context.scene
            root = next(obj for obj in bpy.data.objects if obj.type=='EMPTY' and obj.name.endswith('_MODEL_ROOT'))
            rig = bpy.data.objects['SIM_01_SHARED_RIG']
            for collection in bpy.data.collections: collection.hide_render=False
            root.rotation_euler.z=0
            rig.rotation_euler.z=math.radians(profile['body_turn'])
            scene.frame_set(1)
            rig.animation_data.action=None
            furniture_objects=set(root.children_recursive)
            body = bpy.data.collections.new('Neutral seated body')
            furniture = bpy.data.collections.new('Neutral seat furniture')
            scene.collection.children.link(body)
            scene.collection.children.link(furniture)
            for obj in list(bpy.data.objects):
                if obj.type not in ('MESH','CURVE'): continue
                for collection in list(obj.users_collection): collection.objects.unlink(obj)
                (furniture if obj in furniture_objects else body).objects.link(obj)
            width,height=profile['canvas']
            if (scene.render.resolution_x,scene.render.resolution_y)!=(width*8,height*8):
                raise ValueError('Accepted source camera dimensions changed')
            scene.render.resolution_percentage=100
            scene.render.threads_mode='FIXED';scene.render.threads=2
            scene.render.image_settings.file_format='PNG'
            scene.render.image_settings.color_mode='RGBA'
            scene.render.film_transparent=True
            origin=world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
            record=dict(kind=kind,content=profile['content'],source=profile['source'],source_sha256=before,
                        canvas=[width,height],source_density=8,
                        anchor=[origin.x*width,(1-origin.y)*height+21],
                        camera_matrix=[list(row) for row in scene.camera.matrix_world],
                        ortho_scale=scene.camera.data.ortho_scale,contacts=[],renders=[])
            proof['objects'].append(record)
            directory=output/kind;directory.mkdir()
            if not probe:
                action=bpy.data.actions.new('neutral_media_'+kind)
                rig.animation_data.action=action
                for sample in range(5):
                    apply(rig,kind,(sample%4)/4)
                    for bone in rig.pose.bones:
                        bone.rotation_mode='QUATERNION'
                        for field in ('location','rotation_quaternion','scale'):
                            bone.keyframe_insert(field,frame=sample+1)
                    for field in ('book_visible','eyes_closed'):
                        rig.keyframe_insert(data_path=f'["{field}"]',frame=sample+1)
                scene.frame_set(1)
                bpy.context.preferences.filepaths.save_version=0
                model=directory/'neutral-authoring.blend'
                bpy.ops.wm.save_as_mainfile(filepath=str(model))
                record['model_path']=model.relative_to(output).as_posix()
                record['model_sha256']=digest(model)
            materials=material_snapshot()
            for variant in (('green',) if probe else ('green','blue','red')):
                if variant!='green': set_shirt_colors(SHIRT_COLORS[variant],materials)
                for frame in range(1 if probe else 4):
                    root.rotation_euler.z=0
                    rig.rotation_euler.z=math.radians(profile['body_turn'])
                    if probe: apply(rig,kind,frame/4)
                    else: scene.frame_set(frame+1)
                    contact=measure(root,rig,kind)
                    record['contacts'].append(dict(variant=variant,frame=frame,**contact))
                    for facing,degrees in FACINGS.items():
                        root.rotation_euler.z=math.radians(degrees)
                        rig.rotation_euler.z=math.radians(degrees+profile['body_turn'])
                        bpy.context.view_layer.update()
                        for owner in (('beauty',) if probe else ('beauty','sim','furniture','lines')):
                            path=directory/f'{facing}-{variant}-{frame}-{owner}.png'
                            render_pass(scene,body,furniture,owner,path,separate_lines=True)
                            record['renders'].append(dict(facing=facing,variant=variant,frame=frame,
                                owner=owner,path=path.relative_to(output).as_posix(),sha256=digest(path)))
                            save()
            if digest(source)!=before: raise ValueError('Seating changed an accepted source model')
        for name,sha in inputs.items():
            if digest(MODELS/name)!=sha: raise ValueError('Producer changed during seating batch')
        proof['state']='complete';save()
    except BaseException:
        proof['state']='failed';proof['error']=traceback.format_exc();save();raise


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    path=Path(args[0])
    only=next((arg.split('=',1)[1].split(',') for arg in args[1:] if arg.startswith('--only=')),None)
    run(path,only,'--probe' in args)
