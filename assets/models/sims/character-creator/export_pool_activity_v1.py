"""Export pool motion and garments without rewriting other accepted families."""
from pathlib import Path
import hashlib
import json
import sys
import traceback
import bpy
from mathutils import Matrix

BASE=Path(__file__).resolve().parent
MODELS=BASE.parents[1]
OUT=BASE/'clips/pool'
sys.dont_write_bytecode=True
sys.path[:0]=[str(BASE),str(MODELS/'sims/sim-01'),str(MODELS/'sims/appearance-proof'),str(MODELS/'outdoor'),str(MODELS/'furniture')]
import pool_activity_pose_v1 as poses
import pool_swimwear_v1 as wardrobe
from author_parts import clothing
from contact_metadata import landmarks,matrix
import export_bundle as exporter

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run():
    assert bpy.app.background
    source=MODELS/'sims/sim-01/sim-01-rigged.blend'
    before=digest(source)
    assert before==json.loads((BASE/'export/manifest.json').read_text())['sourceSha256'], 'Pool rig must match the accepted base mesh'
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    rig=bpy.data.objects['SIM_01_SHARED_RIG'];rig.animation_data.action=None
    rig.data.pose_position='REST';rig.matrix_world=Matrix.Identity(4)
    bpy.context.view_layer.update()
    clothing(rig)
    garments=wardrobe.author(rig)
    from pool_activity_model_v1 import build
    fixture=bpy.data.objects.new('POOL_MODEL_ROOT',None);bpy.context.collection.objects.link(fixture)
    fixture_geometry=build(fixture)
    bpy.context.view_layer.update()
    bones=list(rig.data.bones)
    rest_landmarks=landmarks(rig)
    rig.data.pose_position='POSE'
    clips={}
    errors=[]
    specs=[('pool_enter',poses.ENTRY_SAMPLES,'progress'),('pool_paddle',poses.PADDLE_SAMPLES,'loop')]
    specs += [('pool_exit_'+str(i),poses.EXIT_SAMPLES,'progress') for i in range(poses.PADDLE_SAMPLES)]
    for name,count,playback in specs:
        samples=[]
        for index in range(count):
            try:contacts=poses.sample(rig,name,index)
            except Exception as error:
                errors.append({'clip':name,'sample':index,'error':repr(error)})
                continue
            basis=[]
            for bone in bones:
                posed=rig.pose.bones[bone.name].matrix;rest=bone.matrix_local
                if bone.parent:
                    posed=rig.pose.bones[bone.parent.name].matrix.inverted()@posed
                    rest=bone.parent.matrix_local.inverted()@rest
                basis.append(matrix(rest.inverted()@posed))
            samples.append({'basis':basis,'bones':[matrix(rig.pose.bones[b.name].matrix) for b in bones],
                'rig':matrix(Matrix.Identity(4)),'props':{},'eyesClosed':False,'bookVisible':False,'contacts':contacts})
        clips[name]={'family':'pool','sourceAction':None,'playback':playback,'samples':samples,
            'contacts':{'version':1,'space':'rig','policy':'pool','landmarks':rest_landmarks,'assemblies':{}}}
    if errors:
        (OUT/'pose-errors.json').write_text(json.dumps(errors,indent=2))
        raise ValueError(f'{len(errors)} unreachable authored samples; see pose-errors.json')
    rig.data.pose_position='REST'
    for obj in garments:
        for modifier in obj.modifiers:
            if modifier.type=='ARMATURE':modifier.show_viewport=False
    bpy.context.view_layer.update()
    materials=sorted({m for o in garments for m in o.data.materials if m},key=lambda m:m.name)
    exporter.OUT=OUT;exporter.region=lambda obj:int(obj['creator_region'])
    description=exporter.export_meshes(garments,bones,materials,'runtime')
    policy={'version':1,'owners':{'pool-swimwear':{'outline':True,'parts':[o.name for o in garments]}}}
    policy_path=BASE/'pool-surface-policy-v1.json'
    policy_path.write_text(json.dumps(policy,indent=2)+'\n')
    for part in description['parts']:
        part.update(outlineOwner='pool-swimwear',outline=True)
    parts={'version':1,'surfacePolicySha256':digest(policy_path),'geometry':description,
        'materials':[exporter.material_data(m) for m in materials],'virtualBones':[],
        'parts':[{'name':o.name,'source':o.name,'owner':'body','clips':list(clips),'weighted':True,
            'conditions':json.loads(o['creator_conditions'])} for o in garments]}
    (OUT/'parts.json').write_text(json.dumps(parts,separators=(',',':')))
    producers=[Path(__file__),BASE/'pool_activity_pose_v1.py',BASE/'pool_swimwear_v1.py',BASE/'author_parts.py',
        BASE/'author_long_sleeves.py',BASE/'contact_metadata.py',MODELS/'sims/sim-01/build_rig.py',
        MODELS/'sims/appearance-proof/export_bundle.py',MODELS/'outdoor/pool_activity_layout_v1.py',
        MODELS/'outdoor/pool_activity_model_v1.py',MODELS/'furniture/build_parts.py']
    receipt={'state':'complete','source':source.relative_to(MODELS).as_posix(),'sourceSha256':before,
        'producerHashes':{p.relative_to(MODELS).as_posix():digest(p) for p in producers},
        'fixtureGeometry':fixture_geometry,'clips':len(clips),'samples':sum(len(c['samples']) for c in clips.values()),
        'parts':[o.name for o in garments],'partsSha256':digest(OUT/'parts.json')}
    library_path=BASE/'clips/clips.json';library=json.loads(library_path.read_text())
    library['sources']['pool']={'path':source.relative_to(MODELS).as_posix(),'sha256':before,
        'parts':'./pool/parts.json','virtualBones':[],'producerHashes':receipt['producerHashes']}
    library['clips'].update(clips)
    library_path.write_text(json.dumps(library,separators=(',',':')))
    assert digest(source)==before
    (OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt

if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'status.json').write_text(json.dumps({'state':'running'}))
    try:
        run();(OUT/'status.json').write_text(json.dumps({'state':'complete'}))
    except Exception:
        (OUT/'status.json').write_text(json.dumps({'state':'failed','error':traceback.format_exc()}));raise
