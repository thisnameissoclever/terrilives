"""Load fitted production sources without changing their saved authoring files."""
from pathlib import Path
import json
import sys
import ast
import gzip
import hashlib
import bpy
from mathutils import Matrix

MODELS=Path(__file__).resolve().parents[2]
SHOWER_SAMPLES=16

def fridge():
    sys.path.insert(0,str(MODELS/'kitchen/actions'))
    import fridge_reach_pose
    contract=ast.parse((MODELS/'kitchen/actions/fridge_export_contract.py').read_text())
    constants={node.targets[0].id:ast.literal_eval(node.value) for node in contract.body
        if isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name) and node.targets[0].id in ['SOURCE','SOURCE_SHA256']}
    import hashlib
    source=MODELS/constants['SOURCE']
    if hashlib.sha256(source.read_bytes()).hexdigest()!=constants['SOURCE_SHA256']:
        raise ValueError('Fridge source does not match the accepted production scene')
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    root,rig,pivot,_,_=fridge_reach_pose.prepare(bpy.context.scene)
    fridge_reach_pose.set_facing(root,pivot,0)
    receipt_path=MODELS/'kitchen/actions/review/fridge/batch-04/proof.json'
    receipt=json.loads(receipt_path.read_text())
    def sample(index,action=None):
        arms={side:(record['offset'],record['pole']) for side,record in receipt['hand_settle'][index]['arms'].items()}
        fridge_reach_pose.apply_sample(rig,index,arms)
    return source,rig,root,sample,receipt_path


def bed(bunk=False):
    sys.path.insert(0,str(MODELS/'bedroom'))
    from double_bed_sleep import apply_approved_pose,digest
    recipe=MODELS/'bedroom/double-bed-sleep-pose.json'
    config=json.loads(recipe.read_text())
    if bunk:
        source=MODELS/'bedroom/owner-review-pending/bunk/candidate-03/bunk-authoring.blend'
        expected='10b507a6dfcbbec05457cf7c9c857ee1f3fc08b80915967b743cace15b9fa9fa'
        config['rig_location'][0]=0;config['world_offset'][0]=0;config['world_offset'][2]-=.00960552
    else:
        source=MODELS/'bedroom'/config['source_model'];expected=config['source_sha256']
    if digest(source)!=expected:raise ValueError('Sleeping fixture source has changed')
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    rig=bpy.data.objects['SIM_01_SHARED_RIG'];root=bpy.data.objects['BUNK_MODEL_ROOT' if bunk else 'DOUBLE-BED_MODEL_ROOT']
    root.rotation_euler.z=0
    config['sleeping_scale']=1
    apply_approved_pose(rig,config)
    origin=rig.matrix_world.copy()
    for name in ['Sage duvet','Folded duvet edge']:
        if name in bpy.data.objects:bpy.data.objects[name].hide_render=True
    def sample(index,action=None):
        rig.matrix_world=origin.copy()
    return source,rig,root,sample,recipe


def books():
    sys.path.insert(0,str(MODELS/'sims/sim-01'))
    from build_rig import pose
    source=MODELS/'sims/sim-01/sim-01-rigged.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    rig=bpy.data.objects['SIM_01_SHARED_RIG'];rig.animation_data.action=None;rig.matrix_world=Matrix.Identity(4)
    receipt=MODELS/'reading/carryIdle/physical-proof.json'
    carry=json.loads(receipt.read_text())['frames']['bone_matrices']
    standing=json.loads((MODELS/'reading/standingRead/physical-proof.json').read_text())['frames']['bone_matrices']
    def sample(index,action):
        preferred=standing if action=='owned_stand_read' else carry
        if action=='book_walk':
            pose(rig,'walk',index/8)
            delta=rig.pose.bones['spine'].matrix@Matrix(preferred['spine']).inverted()
            for bone in rig.pose.bones:
                if bone.name in ['spine','head','book'] or any(word in bone.name for word in ['arm','hand']):
                    bone.matrix=delta@Matrix(preferred[bone.name]);bpy.context.view_layer.update()
        else:
            for bone in rig.pose.bones:
                bone.matrix=Matrix(preferred[bone.name]);bpy.context.view_layer.update()
        rig['book_visible']=1.;rig['eyes_closed']=0.
    return source,rig,None,sample,receipt


def shower():
    sys.path.insert(0,str(MODELS/'bathroom/actions'))
    from shower_washing_pose import apply
    source=MODELS/'bathroom/owner-review-pending/shower/candidate-01/shower-authoring.blend'
    import hashlib
    if hashlib.sha256(source.read_bytes()).hexdigest()!='c57a911a5e3964e4d23278e1a48150e2fcf3e940ad91183b9480db8a78e60865':
        raise ValueError('Shower fixture differs from its source receipt')
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    rig=bpy.data.objects['SIM_01_SHARED_RIG'];root=bpy.data.objects['SHOWER_MODEL_ROOT']
    root.rotation_euler.z=0;rig.rotation_euler.z=0;rig.animation_data.action=None
    receipt=MODELS/'bathroom/actions/review/shower/prototype-09/proof.json'
    ankle=json.loads(receipt.read_text())['fitted_ankle_z']
    def sample(index,action):apply(rig,index/SHOWER_SAMPLES,ankle_z=ankle)
    return source,rig,root,sample,receipt


SEAT_ROOTS={'armchair':'ARMCHAIR_MODEL_ROOT','reading':'CHAIR_MODEL_ROOT','dining':'DINING-CHAIR_MODEL_ROOT',
    'office':'OFFICE-CHAIR_MODEL_ROOT','ottoman':'OTTOMAN_MODEL_ROOT','sofa':'LONG-SOFA_MODEL_ROOT'}

def seat(kind):
    sys.path.insert(0,str(MODELS/'seating'))
    from neutral_pose import apply
    from pose_profiles import PROFILES
    if kind=='armchair':source=MODELS/PROFILES[kind]['source']
    else:source=MODELS/'seating/review/batch-01'/kind/'neutral-authoring.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    rig=bpy.data.objects['SIM_01_SHARED_RIG'];root=bpy.data.objects[SEAT_ROOTS[kind]]
    root.rotation_euler.z=0
    if kind=='sofa':
        receipt=MODELS/'reading/sofa/producer/pose-receipt.json';reading=json.loads(receipt.read_text())['full_states'][1]
    else:
        receipt=MODELS/'reading'/kind/'physical-proof.json';reading=json.loads(receipt.read_text())['frames']
    def sample(index,action):
        rig.animation_data.action=None;rig.matrix_world=Matrix(reading['rig_matrix_world'])
        if action.endswith('_read'):
            for bone in rig.pose.bones:
                bone.matrix=Matrix(reading['bone_matrices'][bone.name]);bpy.context.view_layer.update()
            rig['book_visible']=1.;rig['eyes_closed']=0.
        else:apply(rig,kind,0 if kind=='sofa' else index/4)
    return source,rig,root,sample,receipt


def bookcase():
    package=MODELS/'reading/fetch/producer'
    raw=gzip.decompress((package/'seed.blend.gz').read_bytes())
    if hashlib.sha256(raw).hexdigest()!='9f2327cf7971658121faa049ac7c74977caecb2f3f1b2fc70df7294e87113a74':
        raise ValueError('Bookcase pose seed differs from its source receipt')
    cache=Path(__file__).resolve().parent/'source-cache';cache.mkdir(exist_ok=True)
    source=cache/'bookcase-seed.blend'
    if not source.exists() or hashlib.sha256(source.read_bytes()).digest()!=hashlib.sha256(raw).digest():source.write_bytes(raw)
    bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
    rig=bpy.data.objects['Place 1 SIM_01_SHARED_RIG'];root=bpy.data.objects['BOOKCASE_MODEL_ROOT']
    rig.animation_data.action=None;root.rotation_euler.z=0
    receipt=package/'poses.json';plan=json.loads(receipt.read_text())
    originals={slot['source_book']:bpy.data.objects[slot['source_book']].matrix_world.copy() for slot in plan['slots']}
    for slot,definition in enumerate(plan['slots']):bpy.data.objects[definition['source_book']]['creator_stock_slot']=slot
    def sample(index,action):
        slot=int(action.rsplit('_',1)[1]);definition=plan['slots'][slot]
        source_phase=([3,2,0,0] if action.startswith('shelve') else [0,0,2,3])[index]
        phase=definition['phases'][source_phase]
        rig.matrix_world=Matrix(phase['world'])
        for bone in rig.pose.bones:
            bone.matrix=Matrix(phase['frames'][bone.name]);bpy.context.view_layer.update()
        for name,original in originals.items():
            obj=bpy.data.objects[name];obj.matrix_world=original.copy();obj.hide_render=False;obj['creator_owner']='fixture'
        moving=bpy.data.objects[definition['source_book']]
        canonical=phase.get('canonical_carry',False)
        rig['book_visible']=float(canonical);rig['eyes_closed']=0.
        moving.hide_render=canonical
        if not canonical:moving.matrix_world=Matrix.Translation(phase['book_translation'])@originals[moving.name]
        if source_phase==2:moving['creator_owner']='actor'
    return source,rig,root,sample,receipt
