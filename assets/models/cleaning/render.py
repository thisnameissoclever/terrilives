"""Bake chore poses from the unchanged Sim rig in background Blender."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE=Path(__file__).resolve().parent
MODELS=BASE.parent
SIM=MODELS/'sims/sim-01'
sys.path[:0]=[str(BASE),str(SIM),str(MODELS/'furniture'),str(MODELS/'kitchen')]
from poses import CLIPS, tools, set_pose
from render_shirt_variants import material_snapshot,set_shirt_colors,SHIRT_COLORS
from render_job import apply_render_job
from trashcan_model import build as build_bin

FACINGS={'SE':90,'NW':270,'SW':0,'NE':180}
BIN_ANGLES=[0,55,100,100,100,100,45,0]


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def move_collection(obj, collection):
    for old in list(obj.users_collection):old.objects.unlink(obj)
    collection.objects.link(obj)


def main():
    assert bpy.app.background
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    mop_preview='--mop-preview' in args
    preview='--preview' in args or mop_preview
    output=BASE/(args[0] if args and not args[0].startswith('--') else 'raw')
    assert not (output/'proof.json').exists(),'Use a fresh output directory for each render candidate'
    output.mkdir(parents=True,exist_ok=True)
    inputs=[Path(__file__),BASE/'poses.py',BASE/'mop_model.py',SIM/'sim-01-rigged.blend',SIM/'build_rig.py',
            SIM/'render_job.py',SIM/'registered-canvas-proof.json',MODELS/'kitchen/trashcan_model.py',
            MODELS/'kitchen/trashcan_layout.py',MODELS/'furniture/build_parts.py']
    hashes={p.relative_to(MODELS).as_posix():digest(p) for p in inputs}
    proof={'state':'running','preview':preview,'inputs':hashes,'renders':[],'contacts':[],
           'expected':16 if mop_preview else sum(count for _,count in CLIPS.values())*(1 if preview else 12)+(0 if preview else 32)}
    receipt=output/'proof.json'
    def save():receipt.write_text(json.dumps(proof,indent=2)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SIM/'sim-01-rigged.blend'))
        scene=bpy.context.scene
        rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
        body=bpy.data.collections.new('Cleaning body');scene.collection.children.link(body)
        line_sets=bpy.context.view_layer.freestyle_settings.linesets
        outline_groups={line.collection:list(line.collection.objects) for line in line_sets if line.collection}
        proof['appearance']={'reference_density':16,'render_density':4,
            'outline_styles':[{ 'name':style.name,'reference_thickness':style.thickness,'render_thickness':style.thickness/4 }
                              for style in sorted({line.linestyle for line in line_sets},key=lambda style:style.name)],
            'outline_groups':{group.name:sorted(obj.name for obj in members) for group,members in outline_groups.items()}}
        for style in {line.linestyle for line in line_sets}:style.thickness/=4
        for obj in list(bpy.data.objects):
            if obj.type in ('MESH','CURVE'):move_collection(obj,body)
        # Preserve source outline membership inside the body holdout hierarchy.
        for group,members in outline_groups.items():
            for obj in members:
                if obj.name not in group.objects:group.objects.link(obj)
            if group.name in scene.collection.children:scene.collection.children.unlink(group)
            body.children.link(group)
        rig['cleaning_mode']=1.0;rig['bag_visible']=0.0
        before=set(bpy.data.objects)
        props=tools(rig)
        proof['grip_contracts']={side:definition['contract'] for side,definition in props['hands'].items()}
        tool_collection=bpy.data.collections.new('Cleaning tools');scene.collection.children.link(tool_collection)
        for obj in set(bpy.data.objects)-before:move_collection(obj,tool_collection)
        before=set(bpy.data.objects)
        bin_root=bpy.data.objects.new('Cleaning bin',None);scene.collection.objects.link(bin_root)
        build_bin(bin_root)
        # The stationary model is closed. Recess its cap into a dark liner
        # so the animated lid reveals an open mouth with an enamel rim.
        shell=next(o for o in bin_root.children if o.name=='Body')
        liner=bpy.data.materials.new('Bin interior');liner.diffuse_color=(.025,.032,.029,1)
        shell.data.materials.append(liner)
        vertices=[(radius*math.cos(i*math.tau/64),radius*math.sin(i*math.tau/64),z)
                  for radius,z in [(.21,-.285),(.21,.285),(.192,.285),(.192,.105)] for i in range(64)]
        faces=[tuple(reversed(range(64)))]
        for ring in range(3):
            faces.extend((ring*64+i,ring*64+(i+1)%64,(ring+1)*64+(i+1)%64,(ring+1)*64+i) for i in range(64))
        faces.append(tuple(range(192,256)))
        hollow=bpy.data.meshes.new('Open bin with recessed liner')
        hollow.from_pydata(vertices,[],faces);hollow.update()
        for mat in shell.data.materials:hollow.materials.append(mat)
        shell.data=hollow
        for face in hollow.polygons:
            face.material_index=1 if face.index>=129 else 0
            face.use_smooth=65<=face.index<=128 or 129<=face.index<=192
        lid=next(o for o in bin_root.children if o.name=='Lid')
        pivot=bpy.data.objects.new('Bin lid hinge',None);scene.collection.objects.link(pivot)
        pivot.parent=bin_root;pivot.location=(0,.205,.605)
        bpy.context.view_layer.update();transform=lid.matrix_world.copy()
        lid.parent=pivot;lid.matrix_world=transform
        bin_collection=bpy.data.collections.new('Cleaning bin scene');scene.collection.children.link(bin_collection)
        for obj in set(bpy.data.objects)-before:move_collection(obj,bin_collection)
        bin_collection.hide_render=True
        base=json.loads((SIM/'registered-canvas-proof.json').read_text())['idle']
        registration={}
        for action in CLIPS:
            scene.render.resolution_x=96*4;scene.render.resolution_y=128*4
            scene.render.resolution_percentage=100
            scene.camera.data.ortho_scale=base['camera_ortho_scale']*128/88
            scene.camera.location=base['camera_location'];bpy.context.view_layer.update()
            origin=world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
            registration[action]={'width':96,'height':128,'anchor':[origin.x*96,(1-origin.y)*128+21],
                'world_origin':[origin.x*96,(1-origin.y)*128],
                'camera_ortho_scale':scene.camera.data.ortho_scale,'camera_location':list(scene.camera.location)}
        rig.animation_data_create()
        for action,(_,count) in CLIPS.items():
            clip=bpy.data.actions.new(action);clip.use_fake_user=True;rig.animation_data.action=clip
            animated=([props['head'],props['shaft'],props['grip']] if action=='mop' else
                      [props['cloths'][action]] if action.startswith('wipe') else [props['bag']])
            for index in range(count+1):
                phase=min(index/(count-1),1) if action=='empty_bin' else (index%count)/count
                witnesses=set_pose(rig,props,action,phase)
                if index<count:proof['contacts'].append({'action':action,'frame':index,**witnesses})
                for bone in rig.pose.bones:
                    bone.rotation_mode='QUATERNION'
                    for field in ('location','rotation_quaternion','scale'):bone.keyframe_insert(field,frame=index+1)
                for field in ('eyes_closed','book_visible','cleaning_mode','bag_visible'):
                    rig.keyframe_insert(data_path=f'["{field}"]',frame=index+1)
                for obj in animated:
                    for field in ('location','rotation_quaternion','scale'):obj.keyframe_insert(field,frame=index+1)
            clip['loop_samples']=count
        scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
        scene.render.film_transparent=True
        scene.render.threads_mode='FIXED';scene.render.threads=2
        bpy.context.preferences.filepaths.save_version=0
        model=output/'cleaning.blend';bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['model_sha256']=digest(model)
        # Render the serialized scene so newly created drivers and action slots
        # are evaluated through the same path as a later independent replay.
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene=bpy.context.scene
        rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
        body=bpy.data.collections['Cleaning body'];tool_collection=bpy.data.collections['Cleaning tools']
        bin_collection=bpy.data.collections['Cleaning bin scene'];bin_root=bpy.data.objects['Cleaning bin']
        pivot=bpy.data.objects['Bin lid hinge']
        materials=material_snapshot()
        for variant in (['green'] if preview else ['green','blue','red']):
            if variant!='green':set_shirt_colors(SHIRT_COLORS[variant],materials)
            folder=output/variant;folder.mkdir(exist_ok=True)
            frames=[]
            for action,(stem,count) in CLIPS.items():
                if mop_preview and action!='mop':continue
                for facing in (FACINGS if mop_preview else ['SE'] if preview else FACINGS):
                    for index in (range(0,count,2) if mop_preview else range(count)):
                        job=apply_render_job(scene,rig,registration,action,facing,index)
                        scene.render.resolution_x=96*4;scene.render.resolution_y=128*4
                        assert rig['cleaning_mode']==float(list(CLIPS).index(action)+1)
                        witness=next(w for w in proof['contacts'] if w['action']==action and w['frame']==index)
                        for side,sign,label in [('L',-1,'left_hand'),('R',1,'right_hand')]:
                            bone=rig.data.bones['hand.'+side]
                            if action=='mop':
                                actual=rig.pose.bones['hand.'+side].head
                                expected=Vector(witness[label.replace('_hand','_wrist')])
                            else:
                                actual=rig.pose.bones['hand.'+side].matrix @ bone.matrix_local.inverted() @ Vector((sign*.303,-.075,.737))
                                expected=Vector(witness[label])
                            assert (actual-expected).length<.0001,('saved hand detached',action,index,side)
                        path=folder/f'{action}-{facing}-{index}.png';scene.render.filepath=str(path)
                        bpy.ops.render.render(write_still=True)
                        name='rigSim'+('' if variant=='green' else variant.title())+stem+facing+str(index)
                        row={'name':name,'action':action,'facing':facing,'frame':index,'path':path.name,'sha256':digest(path)}
                        if action=='mop' and facing in ('SE','SW'):
                            graph=bpy.context.evaluated_depsgraph_get();boxes=[]
                            for eye in (bpy.data.objects['Eye white'],bpy.data.objects['Eye white.001']):
                                evaluated=eye.evaluated_get(graph);mesh=evaluated.to_mesh()
                                points=[world_to_camera_view(scene,scene.camera,evaluated.matrix_world@v.co) for v in mesh.vertices]
                                boxes.append([min(p.x for p in points)*96,min(1-p.y for p in points)*128,
                                              max(p.x for p in points)*96,max(1-p.y for p in points)*128])
                                evaluated.to_mesh_clear()
                            row['eye_boxes']=boxes
                        frames.append(row);proof['renders'].append({'variant':variant,**row,'geometry_sha256':job['geometry_sha256']});save()
            clips={action:{**reg,'frame_count':CLIPS[action][1],'sample_fps':4,'loop':action!='empty_bin','source_action':action}
                   for action,reg in registration.items()}
            manifest={'schema_version':1,'width':38,'height':88,'anchor':base['anchor'],
                      'source_sha256':hashes['sims/sim-01/sim-01-rigged.blend'],'variant':variant,'pixel_density':4,'clips':clips,'frames':frames}
            (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        if not preview:
            body.hide_render=True;tool_collection.hide_render=True;bin_collection.hide_render=False
            scene.render.resolution_x=96*4;scene.render.resolution_y=120*4
            scene.camera.data.ortho_scale=base['camera_ortho_scale']*120/88
            scene.camera.location=base['camera_location'];bpy.context.view_layer.update()
            origin=world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
            proof['bin_anchor']=[origin.x*96,(1-origin.y)*120+21]
            folder=output/'bin';folder.mkdir(exist_ok=True)
            for facing,degrees in FACINGS.items():
                bin_root.rotation_euler.z=math.radians(degrees)
                for index,angle in enumerate(BIN_ANGLES):
                    pivot.rotation_euler.x=-math.radians(angle);bpy.context.view_layer.update()
                    path=folder/f'bin-{facing}-{index}.png';scene.render.filepath=str(path)
                    bpy.ops.render.render(write_still=True)
                    proof['renders'].append({'variant':'bin','facing':facing,'frame':index,'path':path.name,'sha256':digest(path)});save()
        assert hashes=={p.relative_to(MODELS).as_posix():digest(p) for p in inputs},'A source changed during rendering'
        assert len(proof['renders'])==proof['expected']
        proof['state']='complete';save()
    except Exception:
        proof['state']='failed';proof['error']=traceback.format_exc();save();raise


if __name__=='__main__':main()
