"""Sample declared production clips and independently owned prop transforms."""
from pathlib import Path
import hashlib
import json
import sys
import traceback
import math
from types import SimpleNamespace
import bpy
from mathutils import Matrix

BASE=Path(__file__).resolve().parent
MODELS=BASE.parents[1]
OUT=BASE/'clips'
sys.dont_write_bytecode=True
sys.path.insert(0,str(BASE))
from inspect_clips import SOURCES, matrix
sys.path.insert(0,str(BASE.parent/'appearance-proof'))
import export_bundle as mesh_exporter
import contact_metadata
from author_surface_policy import annotate, policy_sha256

def export_parts(family, props, rig, bones, used):
    folder=OUT/family;folder.mkdir(exist_ok=True)
    copies=[];virtual=[];descriptors=[]
    rig.data.pose_position='REST'
    for obj in props:
        for modifier in obj.modifiers:
            if modifier.type=='ARMATURE':modifier.show_viewport=False
    bpy.context.view_layer.update()
    for obj in props:
        active=[name for name,objects in used.items() if obj.name in objects]
        if not active:continue
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
        copy=obj.copy() if obj.type=='MESH' else bpy.data.objects.new('Creator clip '+family+' '+obj.name,mesh)
        copy.data=mesh;copy.name='Creator clip '+family+' '+obj.name
        bpy.context.collection.objects.link(copy)
        copy.animation_data_clear();copy.modifiers.clear();copy.parent=None;copy.matrix_world=Matrix.Identity(4)
        weighted=any(group.name in {bone.name for bone in bones} for group in obj.vertex_groups)
        if weighted:
            mesh.transform(rig.matrix_world.inverted()@obj.matrix_world)
            owner='body';region=4
        else:
            copy.vertex_groups.clear()
            name='prop:'+family+':'+obj.name
            copy.vertex_groups.new(name=name).add(list(range(len(mesh.vertices))),1.,'REPLACE')
            virtual.append(SimpleNamespace(name=name))
            owner='fixture' if family in FIXTURES and owned_by(obj,bpy.data.objects[FIXTURES[family]]) else 'prop'
            region=13 if 'creator_stock_slot' in obj else 12 if owner=='fixture' else 7
        copy['creator_region']=region
        descriptors.append({'name':copy.name,'source':obj.name,'owner':owner,'clips':active,'weighted':weighted,
            'stockSlot':obj.get('creator_stock_slot'),
            'assembly':contact_metadata.assembly_root(obj,rig,bpy.data.objects.get(FIXTURES.get(family,''))).name})
        copies.append(copy)
    materials=sorted({material for obj in copies for material in obj.data.materials if material},key=lambda material:material.name)
    mesh_exporter.OUT=folder
    mesh_exporter.region=lambda obj:int(obj['creator_region'])
    description=mesh_exporter.export_meshes(copies,list(bones)+virtual,materials,'runtime') if copies else None
    if description:annotate(description['parts'])
    payload={'version':1,'surfacePolicySha256':policy_sha256(),'geometry':description,'materials':[mesh_exporter.material_data(material) for material in materials],
        'virtualBones':[bone.name for bone in virtual],'parts':descriptors}
    (folder/'parts.json').write_text(json.dumps(payload,separators=(',',':')))
    return payload

# Each tuple names the runtime clip, source armature action, sample count, playback.
CLIPS={
    'exercise':[('exercise',None,8,'loop')],
    'prepare':[('prepare','prepare',4,'loop')],
    'cooking':[('cook_v2','cook_v2',8,'loop'),('food_idle','food_idle',4,'loop'),('food_walk','food_walk',8,'loop')],
    'dining':[('seated_eat','fitted_seated_dining',8,'loop')],
    'dishes':[('carry_idle','carry_idle',4,'loop'),('carry_walk','carry_walk',8,'loop'),('wash','wash',4,'loop')],
    'cleaning':[('mop','mop',8,'loop'),('wipe_counter','wipe_counter',6,'loop'),('wipe_table','wipe_table',6,'loop'),('empty_bin','empty_bin',8,'progress')],
    'toilet':[('toilet','toilet_idle_v1',4,'loop')],
    'bath':[('bath','bath_idle_v1',4,'loop')],
    'recline':[('sofa_recline',None,1,'static')],
    'fridge':[('fridge',None,8,'progress')],
    'bed':[('bed_sleep',None,1,'static')],
    'bunk':[('bunk_sleep',None,1,'static')],
    'books':[('book_idle',None,4,'loop'),('book_walk',None,8,'loop'),('owned_stand_read',None,4,'loop')],
    'shower':[('shower',None,4,'loop')],
}
for seat_kind in ['armchair','reading','dining','office','ottoman','sofa']:
    CLIPS['seat_'+seat_kind]=[('seat_'+seat_kind+'_'+action,None,4,'static' if action=='read' or seat_kind=='sofa' else 'loop') for action in ['sit','read']]
CLIPS['bookcase']=[(action+'_'+str(slot),None,4,'progress') for action in ['fetch','shelve'] for slot in range(24)]
FIXTURES={'exercise':'BIKE_MODEL_ROOT','dining':'Seated dining chair','toilet':'TOILET_MODEL_ROOT','bath':'BATHTUB_MODEL_ROOT','recline':'LONG-SOFA_MODEL_ROOT','fridge':'REFRIGERATOR_MODEL_ROOT','bed':'DOUBLE-BED_MODEL_ROOT','bunk':'BUNK_MODEL_ROOT','shower':'SHOWER_MODEL_ROOT'}
RIGS={'recline':'Place 1 SIM_01_SHARED_RIG'}
RIGS['bookcase']='Place 1 SIM_01_SHARED_RIG'

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def owned_by(obj,parent):
    while obj:
        if obj==parent:return True
        obj=obj.parent
    return False

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    baseline=json.loads((BASE/'clip-inventory.json').read_text())['base']
    expected=baseline['rigs'][0]['bones']
    body_names={obj['name'] for obj in baseline['objects']}
    result={'version':1,'sources':{},'clips':{},'producerSha256':digest(Path(__file__)),
        'producerHashes':{name:digest(BASE/name) for name in ['export_clips.py','contact_metadata.py','source_adapters.py']}}
    for family,clips in CLIPS.items():
        sample_adapter=None;receipt_path=None
        if family in ['fridge','bed','bunk','books','shower','bookcase'] or family.startswith('seat_'):
            from source_adapters import fridge,bed,books,shower,seat,bookcase
            adapter=(lambda:seat(family[5:])) if family.startswith('seat_') else bookcase if family=='bookcase' else fridge if family=='fridge' else books if family=='books' else shower if family=='shower' else lambda:bed(family=='bunk')
            source,_,adapter_fixture,sample_adapter,receipt_path=adapter()
            if adapter_fixture:FIXTURES[family]=adapter_fixture.name
            relative=source.relative_to(MODELS).as_posix()
        else:relative=SOURCES['base'] if family=='exercise' else SOURCES[family]
        source=MODELS/relative;before=digest(source)
        if family=='exercise':
            sys.path[:0]=[str(MODELS/'furniture'),str(MODELS/'sims/sim-01')]
            from animation_export import scene_for
            from preview import rider_pose
            from build_parts import set_crank_phase
            _,_,_,movable,_,_=scene_for('bike')
        elif not sample_adapter:bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
        rig=bpy.data.objects[RIGS.get(family,'SIM_01_SHARED_RIG')];bones=list(rig.data.bones)
        if family=='recline' and rig.name not in bpy.data.collections['Double bed sleeper 1'].all_objects:
            raise ValueError('The recline rig does not belong to the accepted body collection')
        if family=='dining':rig.rotation_euler.z=-math.pi/2
        bpy.context.view_layer.update()
        if [bone.name for bone in bones]!=[row['name'] for row in expected]:raise ValueError('Skeleton names differ: '+family)
        error=max(abs(a-b) for bone,row in zip(bones,expected) for a,b in zip(matrix(bone.matrix_local),row['rest']))
        if error>1e-7:raise ValueError('Skeleton rest transforms differ: '+family)
        fixture=bpy.data.objects[FIXTURES[family]] if family in FIXTURES else None
        # Coordinates retain physical source units, including a scaled fixture.
        fixture_frame=Matrix.LocRotScale(fixture.matrix_world.translation,fixture.matrix_world.to_quaternion(),None) if fixture else Matrix.Identity(4)
        fixture_inverse=fixture_frame.inverted()
        def source_body(obj):
            skinned=any(modifier.type=='ARMATURE' and modifier.object==rig for modifier in obj.modifiers)
            return skinned and not (family=='cleaning' and obj.name.startswith('Mop '))
        props=[obj for obj in bpy.data.objects if obj.type in ['MESH','CURVE'] and not obj.name.endswith('_source_curve')
            and obj.name not in body_names and not source_body(obj) and (owned_by(obj,rig) or fixture and owned_by(obj,fixture))]
        if family=='recline':props=[obj for obj in props if owned_by(obj,fixture)]
        rest_landmarks=contact_metadata.landmarks(rig)
        owners={obj.name:contact_metadata.assembly_root(obj,rig,fixture).name for obj in props}
        result['sources'][family]={'path':relative,'sha256':before,'restError':error,
            'rig':rig.name,'fixture':fixture.name if fixture else None,'props':[obj.name for obj in props]}
        if receipt_path:result['sources'][family]['receipt']={'path':receipt_path.relative_to(MODELS).as_posix(),'sha256':digest(receipt_path)}
        if family.startswith('seat_'):
            result['sources'][family]['places']=[{'id':'seat_'+str(place+1),'offset':[0,(place-1)*.58,0]} for place in range(3)] if family=='seat_sofa' else [{'id':'seat_1','offset':[0,0,0]}]
        used={}
        for name,action,count,playback in clips:
            rig.animation_data.action=bpy.data.actions[action] if action else None
            samples=[]
            for index in range(count):
                if sample_adapter:sample_adapter(index,name)
                if family=='exercise':
                    phase=((-index)%count)/count
                    rider_pose(rig,phase);set_crank_phase(movable,phase)
                if action:bpy.context.scene.frame_set(index+1)
                bpy.context.view_layer.update()
                basis=[]
                for bone in bones:
                    posed=rig.pose.bones[bone.name].matrix;rest=bone.matrix_local
                    if bone.parent:
                        posed=rig.pose.bones[bone.parent.name].matrix.inverted()@posed
                        rest=bone.parent.matrix_local.inverted()@rest
                    basis.append(matrix(rest.inverted()@posed))
                samples.append({'basis':basis,'bones':[matrix(rig.pose.bones[bone.name].matrix) for bone in bones],
                    'rig':matrix(fixture_inverse@rig.matrix_world),
                    'props':{obj.name:{'matrix':matrix(fixture_inverse@obj.matrix_world),'visible':not obj.hide_render,'owner':obj.get('creator_owner','fixture' if fixture and owned_by(obj,fixture) else 'actor')} for obj in props},
                    'eyesClosed':bool(rig.get('eyes_closed',0)>=.5),'bookVisible':bool(rig.get('book_visible',0)>=.5),
                    'contacts':contact_metadata.frame(name,index/(count-1) if playback=='progress' else index/count,rig,props,fixture)})
            result['clips'][name]={'family':family,'sourceAction':action,'playback':playback,'samples':samples,
                'contacts':contact_metadata.definition(name,rest_landmarks,owners)}
            if family=='bookcase':result['clips'][name]['stepSamples']=True
            used[name]={obj.name for obj in props if any(sample['props'][obj.name]['visible'] for sample in samples)}
        parts=export_parts(family,props,rig,bones,used)
        result['sources'][family]['parts']='./'+family+'/parts.json'
        result['sources'][family]['virtualBones']=parts['virtualBones']
        if digest(source)!=before:raise ValueError('Source scene changed: '+str(source))
        (OUT/'clips.json').write_text(json.dumps(result,separators=(',',':')))
    (OUT/'status.json').write_text(json.dumps({'state':'complete','clips':len(result['clips'])}))

if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    try:
        (OUT/'status.json').write_text(json.dumps({'state':'running'}))
        run()
    except Exception:
        (OUT/'status.json').write_text(json.dumps({'state':'failed','error':traceback.format_exc()}))
        raise
