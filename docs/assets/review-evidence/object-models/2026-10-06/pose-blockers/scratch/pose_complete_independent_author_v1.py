"""Transfer the retained complete reading frames to existing supported profiles once."""
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import sys
import time
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path[:0]=[str(HERE),str(ROOT/'assets/models/seating'),str(ROOT/'assets/models/sims/sim-01')]
from pose_profiles import PROFILES
from neutral_pose import apply as neutral
from build_rig import pose
from probe_sofa_resting_clearance import apply_frames
from book_grip_original_replay import owned, frame_state
from pose_complete_cached_native_v2 import CompleteKernel
from book_grip_reading_geometry import Mesh
from classify_sofa_lap_contacts import functions_from
from seated_pose_chain_geometry_v1 import finite_grasp
from neutral_contact import support


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def snapshot(objects):
    deps=bpy.context.evaluated_depsgraph_get();result={}
    for obj in objects:
        if obj.type!='MESH' or obj.hide_render:
            continue
        evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            points=np.asarray([list(evaluated.matrix_world@v.co) for v in mesh.vertices])
            triangles=np.asarray([tuple(t.vertices) for t in mesh.loop_triangles],np.int32)
            error=float(np.abs(points-points.astype(np.float32)).max())
            tree=BVHTree.FromPolygons(points.tolist(),triangles.tolist(),all_triangles=True,epsilon=2*error+2e-6)
            result[obj.get('probe_source_name',obj.name)]=Mesh(points,triangles,tree)
        finally:
            evaluated.to_mesh_clear()
    return result


def run(manifest_path,output):
    manifest=json.loads(manifest_path.read_text());inputs=dict(manifest['inputs'])
    inputs[str(manifest_path)]=digest(manifest_path)
    if not bpy.app.background or output.exists() or any(digest(p)!=s for p,s in inputs.items()):
        raise ValueError('Require a new hidden source and frozen inputs')
    output.mkdir();began=time.monotonic()
    report=dict(state='running',pid=os.getpid(),inputs=inputs,profiles=[],acceptance=False)
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    save();arrays={}
    try:
        seed=json.loads(Path(manifest['seed_receipt']).read_text())['full_states'][1]
        rest=json.loads(Path(manifest['seed_prepared']).read_text())['rest']
        binding=json.loads(Path(manifest['binding_receipt']).read_text())
        rig_names=binding['rest_contexts']['original']['restoration']['after_visibility']['rigs']
        kernel=CompleteKernel(functions_from(HERE/'audit_sofa_binding.py'),began+180)
        for kind in manifest['profiles']:
            if time.monotonic()-began>170:
                raise TimeoutError('Independent source ceiling exhausted')
            profile=PROFILES.get(kind)
            profile_source=ROOT/'assets/models'/profile['source'] if profile else ROOT/'assets/models/sims/sim-01/sim-01-rigged.blend'
            bpy.ops.wm.open_mainfile(filepath=str(profile_source))
            target_rig=bpy.data.objects['SIM_01_SHARED_RIG']
            target_rig.animation_data.action=None
            root=None;furniture_names=[]
            if profile:
                root=next(o for o in bpy.data.objects if o.type=='EMPTY' and o.name.endswith('_MODEL_ROOT'))
                root.rotation_euler.z=0
                neutral(target_rig,kind,0)
                furniture_names=[root.name]+[o.name for o in root.children_recursive]
            else:
                pose(target_rig,'idle',0)
            target={b.name:np.asarray(b.matrix).copy() for b in target_rig.pose.bones}
            target_rotation=math.radians(profile['body_turn']) if profile else -math.pi/2
            bpy.ops.wm.open_mainfile(filepath=manifest['seed_scene'])
            rigs=[bpy.data.objects[n] for n in rig_names]
            rig=rigs[1];objects=owned(rig)
            body=next(c for c in bpy.data.collections if any(o in c.objects.values() for o in objects))
            for collection in bpy.data.collections:
                if any(o.type=='MESH' and any(m.type=='ARMATURE' and m.object in (rigs[0],rigs[2]) for m in o.modifiers) for o in collection.all_objects):
                    collection.hide_render=True
            furniture=bpy.data.collections['Witness furniture']
            for obj in list(furniture.all_objects):
                if obj.type in ('MESH','CURVE'):
                    bpy.data.objects.remove(obj,do_unlink=True)
            if furniture_names:
                with bpy.data.libraries.load(str(profile_source),link=False) as (available,imported):
                    imported.objects=furniture_names
                for obj in imported.objects:
                    if obj is not None:
                        furniture.objects.link(obj)
            rig.animation_data.action=None
            source_frames={n:np.asarray(m) for n,m in seed['bone_matrices'].items()}
            shift=target['hips'][:3,3]-source_frames['hips'][:3,3]
            frames={}
            for name,value in source_frames.items():
                matrix=value.copy()
                if name.startswith(('thigh.','shin.','foot.')) or name in ('root','hips'):
                    matrix=target[name]
                else:
                    matrix[:3,3]+=shift
                frames[name]=matrix
            residual=apply_frames(rig,frames)
            rig.matrix_world=Matrix.Rotation(target_rotation,4,'Z')
            bpy.context.view_layer.update()
            groups=snapshot(objects);solids=snapshot(furniture.all_objects)
            row=dict(profile=kind,content=profile['content'] if profile else 'sim',stage='reading' if profile else 'standingRead',
                source=str(profile_source),frame_error=residual,contacts=[],folds=[],support=None,valid=True,
                canvas=profile['canvas'] if profile else [96,120],anchor=[48.0000114440918,116.0004369020462],
                ortho_scale=2.6516504287719727,body_collection=body.name,rig=rig.name)
            report['profiles'].append(row)
            for name,mesh in groups.items():
                if name.startswith(('Relaxed shirt sleeve','Turned sleeve cuff','Forearm','Relaxed palm','Resting thumb')):
                    pairs,unresolved=kernel.pairs(mesh,mesh,self_test=True)
                    row['folds'].append(dict(part=name,pairs=len(pairs),unresolved=unresolved))
                    if len(pairs) or unresolved:
                        row['valid']=False
                for other,solid in solids.items():
                    contact=kernel.contact(mesh,solid,arrays,kind+'/furniture/'+name+'|'+other)
                    if contact:
                        if isinstance(contact.get('pairs'),np.ndarray):
                            contact['pairs']=len(contact['pairs'])
                        row['contacts'].append(dict(parts=[name,other],**contact));row['valid']=False
            distal=('Forearm','Relaxed palm','Resting thumb','Turned sleeve cuff')
            torso=('Overshirt','One sewn','Shirt lower','Trouser hip','Shirt placket','Small horn')
            for name,mesh in groups.items():
                if not name.startswith(distal):
                    continue
                for other,other_mesh in groups.items():
                    if other.startswith(torso):
                        pairs,unresolved=kernel.pairs(mesh,other_mesh)
                        if len(pairs) or unresolved:
                            row['contacts'].append(dict(parts=[name,other],kind='distal_body',pairs=len(pairs),unresolved=unresolved));row['valid']=False
            rotation=(np.asarray(rig.matrix_world)@frames['book']@np.linalg.inv(np.asarray(rest['book'])))[:3,:3]
            row['grasp']=finite_grasp(groups,rotation,arrays)
            if any(not c['valid'] for c in row['grasp']):
                row['valid']=False
            if profile:
                try:
                    seat=next(o for o in furniture.all_objects if o.name==profile['seat'])
                    row['support']=support([Vector(p) for p in groups['Trouser hip bridge'].points],seat,kind,bpy.context.evaluated_depsgraph_get())
                except BaseException as error:
                    row['valid']=False;row['support_error']=repr(error)
            row['sole_heights']={n:float(m.points[:,2].min()) for n,m in groups.items() if n.startswith('Fitted rounded shoe sole')}
            if any(z<0 for z in row['sole_heights'].values()):
                row['valid']=False
            for name,mesh in groups.items():
                arrays[kind+'/'+name+'/points']=mesh.points
                arrays[kind+'/'+name+'/triangles']=mesh.triangles
            row['frames']=frame_state(rig,objects)
            directory=output/kind;directory.mkdir()
            scene_path=directory/'source.blend'
            bpy.context.preferences.filepaths.save_version=0
            bpy.ops.wm.save_as_mainfile(filepath=str(scene_path))
            row['scene']=dict(path=str(scene_path),sha256=digest(scene_path))
            save()
        report['state']='complete'
    except BaseException as error:
        report.update(state='failed',error=repr(error));raise
    finally:
        np.savez(output/'geometry-witnesses.npz',**arrays)
        report['inputs_unchanged']=all(digest(p)==s for p,s in inputs.items())
        save()


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]))
