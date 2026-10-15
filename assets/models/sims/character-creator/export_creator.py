"""Export the creator's real parts and original rig without touching production assets."""
from pathlib import Path
import hashlib
import json
import sys
import traceback

import bpy

BASE=Path(__file__).resolve().parent
SOURCE=BASE.parent/'sim-01'/'sim-01-rigged.blend'
OUT=BASE/'export'
sys.dont_write_bytecode=True
sys.path[:0]=[str(BASE),str(BASE.parent/'appearance-proof')]
import export_bundle as exporter
from author_parts import author, rules
from author_surface_policy import annotate, policy_sha256

original_region=exporter.region
original_group=exporter.group
exporter.OUT=OUT
exporter.region=lambda obj:int(obj['creator_region']) if 'creator_region' in obj else original_region(obj)
extra_groups={'Hazel iris':6,'Creator facial hair':7,'Creator warm freckles':0,'Creator soft scar':0}
exporter.group=lambda name:extra_groups.get(name,original_group(name))


def run():
    assert bpy.app.background
    producer_hashes={str(path.relative_to(BASE.parent)):hashlib.sha256(path.read_bytes()).hexdigest()
        for path in [Path(__file__),BASE/'author_parts.py',BASE/'author_long_sleeves.py',BASE/'author_surface_policy.py',BASE/'surface-policy.json',BASE.parent/'appearance-proof'/'export_bundle.py',BASE.parent/'appearance-proof'/'bob.py']}
    before=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
    rig=bpy.data.objects['SIM_01_SHARED_RIG'];bones=list(rig.data.bones)
    actions,basis_actions={},{}
    for action in bpy.data.actions:
        rig.animation_data.action=action
        frames,local_frames=[],[]
        for frame in range(int(action.frame_range[0]),int(action.frame_range[1])):
            bpy.context.scene.frame_set(frame)
            frames.append([exporter.matrix(rig.pose.bones[bone.name].matrix) for bone in bones])
            local=[]
            for bone in bones:
                posed=rig.pose.bones[bone.name].matrix;rest=bone.matrix_local
                if bone.parent:
                    posed=rig.pose.bones[bone.parent.name].matrix.inverted()@posed
                    rest=bone.parent.matrix_local.inverted()@rest
                local.append(exporter.matrix(rest.inverted()@posed))
            local_frames.append(local)
        actions[action.name]=frames;basis_actions[action.name]=local_frames
    rig.animation_data.action=bpy.data.actions['idle'];bpy.context.scene.frame_set(1)
    # Author against rest surfaces, including the head and shoe ray targets.
    rig.data.pose_position='REST'
    bpy.context.view_layer.update()
    from bob import create
    bob=create(bpy.data.materials['Chestnut hair planes'])
    bob.modifiers.new('Creator shared rig','ARMATURE').object=rig
    author(rig)
    model_root=BASE.parents[1]
    sys.path[:0]=[str(model_root/'living'),str(model_root/'kitchen'),str(model_root/'furniture')]
    from armchair_model import build
    chair=bpy.data.objects.new('CREATOR_ARMCHAIR_ROOT',None);bpy.context.collection.objects.link(chair)
    build(chair);chair.rotation_euler.z=1.5707963267948966
    for obj in chair.children_recursive:
        if obj.type=='MESH':
            obj['proof_fixture']=True
            obj.vertex_groups.new(name='root').add(list(range(len(obj.data.vertices))),1.,'REPLACE')
            rules(obj,{'fixture':['armchair']})
    bpy.context.view_layer.update()
    objects=sorted((obj for obj in bpy.data.objects if obj.type=='MESH' and not obj.name.endswith('_source_curve')),key=lambda obj:obj.name)
    for obj in objects:
        for modifier in obj.modifiers:
            if modifier.type=='ARMATURE':modifier.show_viewport=False
        for property in ['hide_viewport','hide_render']:
            if obj.animation_data and any(driver.data_path==property for driver in obj.animation_data.drivers):obj.driver_remove(property)
            setattr(obj,property,False)
    rig.data.pose_position='POSE';bpy.context.view_layer.update()
    materials=sorted({material for obj in objects for material in obj.data.materials if material},key=lambda material:material.name)
    original=exporter.export_meshes(objects,bones,materials,'original')
    hair=bpy.data.objects['HAIR_01_TRIPO_CURL'];hair.modifiers.new('Creator runtime curl simplification','DECIMATE').ratio=.12
    bpy.context.view_layer.update()
    runtime=exporter.export_meshes(objects,bones,materials,'runtime')
    for description in [original,runtime]:
        for part in description['parts']:
            obj=bpy.data.objects[part['name']]
            part['conditions']=json.loads(obj.get('creator_conditions','[]'))
            if 'creator_density' in obj:part['densityThreshold']=int(obj['creator_density'])
        annotate(description['parts'])
    result=dict(version=3,sourceSha256=before,producerHashes=producer_hashes,surfacePolicySha256=policy_sha256(),blender=bpy.app.version_string,
        animationSpace='evaluated-parent-local-delta',fixtureBasis=exporter.matrix(chair.matrix_world),fixtureModel='armchair',
        bones=[dict(name=bone.name,parent=bones.index(bone.parent) if bone.parent else -1,head=list(bone.head_local),tail=list(bone.tail_local),
                    rest=exporter.matrix(bone.matrix_local),inverseRest=exporter.matrix(bone.matrix_local.inverted())) for bone in bones],
        materials=[exporter.material_data(material) for material in materials],actions=actions,basisActions=basis_actions,original=original,runtime=runtime)
    (OUT/'manifest.json').write_text(json.dumps(result,separators=(',',':')))
    (OUT/'subdivision-parity.json').write_text(json.dumps(dict(state='complete',rows=exporter.PARITY),indent=2))
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest()!=before:raise ValueError('Accepted source changed')
    # Save only the new authoring scene, never the accepted source file.
    for obj in objects:
        for modifier in obj.modifiers:
            if modifier.type=='ARMATURE':modifier.show_viewport=True
        obj.hide_render=True
    default={'hairstyle':'curl','bald':False,'facial_hair':'none','freckles':False,'scar':'none','wear':'clothed','top':'overshirt',
        'sleeves':'rolled','bottoms':'trousers','footwear':'loafers','glasses':False,'glasses_style':'round','earrings':'none','eyes_closed':False,'prop':'none','fixture':'none'}
    for obj in objects:
        conditions=json.loads(obj.get('creator_conditions','[]'))
        visible=not conditions or any(all(default.get(key) in values for key,values in condition.items()) for condition in conditions)
        obj.hide_render=obj.hide_viewport=not visible
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'character-creator.blend'))
    (OUT/'status.json').write_text(json.dumps(dict(state='complete',sourceUnchanged=True,parts=len(objects),
        originalTriangles=original['indexCount']//3,runtimeTriangles=runtime['indexCount']//3)))


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    try:
        (OUT/'status.json').write_text(json.dumps({'state':'running'}))
        run()
    except Exception:
        (OUT/'status.json').write_text(json.dumps({'state':'failed','error':traceback.format_exc()}))
        raise
