"""Author four source row contacts, then verify every real shelf-slot solid."""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import traceback
import bpy
import numpy as np
from mathutils import Matrix

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path[:0]=[str(HERE),str(ROOT/'assets/models/sims/sim-01')]
from pose_complete_independent_author_v1 import snapshot
from pose_complete_cached_native_v2 import CompleteKernel
from book_grip_reading_geometry import Mesh
from classify_sofa_lap_contacts import functions_from
from sofa_arm_frame_math import rotation_between,apply_swing
from sofa_contact_solver_frames import rotation
from seated_pose_chain_math_v1 import solve_upper
from pose_complete_supported_transfer_v1 import transform
from probe_sofa_resting_clearance import apply_frames
from continuous_support_patch import measure
from rig_math import knee_point
from book_grip_original_replay import owned,frame_state


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def translation(value):
    result=np.eye(4);result[:3,3]=value;return result


def run(manifest_path,output):
    manifest=json.loads(manifest_path.read_text());inputs=dict(manifest['inputs'])
    if not bpy.app.background or output.exists() or any(digest(p)!=s for p,s in inputs.items()):
        raise ValueError('Require new reaching sources and unchanged inputs')
    output.mkdir();began=time.monotonic();report=dict(state='running',pid=os.getpid(),inputs=inputs,profiles=[],acceptance=False)
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    save();arrays={}
    try:
        prepared=json.loads(Path(manifest['seed_prepared']).read_text());rest={n:np.asarray(v) for n,v in prepared['rest'].items()}
        canonical=json.loads(Path(manifest['carry_receipt']).read_text())['profiles'][0]['frames']['bone_matrices']
        with bpy.data.libraries.load(manifest['shelf_scene'],link=False) as (available,unused):
            furniture_names=[n for n in available.objects if n.startswith(('BOOKCASE_MODEL_ROOT','Back panel','Left side','Right side','Base','Shelf ','Crown','Book '))]
        kernel=CompleteKernel(functions_from(HERE/'audit_sofa_binding.py'),began+180)
        with np.load(HERE/'sofa-derived-binding-03/normalized-rest.npz') as source:
            for row_index,(hip_height,lean,root_y,ankle_y) in enumerate(((.16,30.,-.25,-.25),(.45,50.,-.40,-.20),(.65,30.,-.30,-.06),(.86,10.,-.20,0.))):
                if time.monotonic()-began>160:
                    raise TimeoutError('Reaching source ceiling exhausted')
                report['current_step']='open row '+str(row_index);save()
                bpy.ops.wm.open_mainfile(filepath=manifest['seed_scene'])
                names=json.loads(Path(manifest['binding_receipt']).read_text())['rest_contexts']['original']['restoration']['after_visibility']['rigs']
                rigs=[bpy.data.objects[n] for n in names];rig=rigs[1];objects=owned(rig)
                body=next(c for c in bpy.data.collections if any(o in c.objects.values() for o in objects))
                for collection in bpy.data.collections:
                    if any(o.type=='MESH' and any(m.type=='ARMATURE' and m.object in (rigs[0],rigs[2]) for m in o.modifiers) for o in collection.all_objects):
                        collection.hide_render=True
                furniture=bpy.data.collections['Witness furniture']
                for obj in list(furniture.all_objects):
                    if obj.type in ('MESH','CURVE'):
                        bpy.data.objects.remove(obj,do_unlink=True)
                report['current_step']='import shelf row '+str(row_index);save()
                with bpy.data.libraries.load(manifest['shelf_scene'],link=False) as (available,imported):
                    imported.objects=[n for n in available.objects if n.startswith(('BOOKCASE_MODEL_ROOT','Back panel','Left side','Right side','Base','Shelf ','Crown','Book '))]
                for obj in imported.objects:
                    if obj is not None:
                        furniture.objects.link(obj)
                report['imported_names']=[o.name if o else None for o in imported.objects];report['current_step']='root row '+str(row_index);save()
                root=next(o for o in imported.objects if o is not None and o.name.startswith('BOOKCASE_MODEL_ROOT'));root.rotation_euler.z=0
                rig.animation_data.action=None;rig['book_visible']=0.;rig['eyes_closed']=0.
                world=translation([.06,root_y,0]);world[:3,:3]=rotation(np.array([0.,0.,1.]),math.pi)
                rig.matrix_world=Matrix(world.tolist());frames={n:v.copy() for n,v in rest.items()}
                offset=np.array([0.,0.,hip_height-.86]);frames['hips']=translation(offset)@rest['hips']
                spine_pivot=rest['spine'][:3,3]+offset;rot=rotation(np.array([1.,0.,0.]),math.radians(lean))
                spine=np.eye(4);spine[:3,:3]=rot;spine[:3,3]=spine_pivot-rot@rest['spine'][:3,3]
                frames['spine']=spine@rest['spine'];head_pivot=(spine@np.r_[rest['head'][:3,3],1])[:3]
                head_rot=rotation(np.array([1.,0.,0.]),math.radians(0.));head=np.eye(4);head[:3,:3]=head_rot;head[:3,3]=head_pivot-head_rot@rest['head'][:3,3];frames['head']=head@rest['head']
                for side,sign in (('L',-1),('R',1)):
                    hip=np.array([sign*.124,0,hip_height]);ankle=np.array([sign*.124,ankle_y,.13])
                    upper_length=np.linalg.norm(rest['shin.'+side][:3,3]-rest['thigh.'+side][:3,3]);lower_length=np.linalg.norm(rest['foot.'+side][:3,3]-rest['shin.'+side][:3,3])
                    ky,kz=knee_point((0,hip_height),(ankle_y,.13),upper_length,lower_length);knee=np.array([sign*.124,ky,kz])
                    for name,start,end in (('thigh.'+side,hip,knee),('shin.'+side,knee,ankle),('foot.'+side,ankle,ankle+np.array([0.,-.14,0.]))):
                        if row_index==0 and name.startswith('foot.'):
                            end=start+np.array([sign*.14,0,0])
                        old=rest[name];length_axis=old[:3,1]
                        frames[name]=apply_swing(old,rotation_between(length_axis,(end-start)/np.linalg.norm(end-start)),start)
                for name in ('upper_arm.L','forearm.L','hand.L'):
                    frames[name]=spine@rest[name]
                upper,lower,hand='upper_arm.R','forearm.R','hand.R'
                wanted=world@np.asarray(canonical[hand]);wanted[:3,3]=0.
                initial_normal=world[:3,:3]@np.array([1.,0.,0.]);normal=np.array([0.,-1.,0.])
                wanted[:3,:3]=rotation_between(initial_normal,normal)@wanted[:3,:3]
                direction=wanted[:3,1];projected=direction-normal*(direction@normal);projected/=np.linalg.norm(projected);target=np.array([0.,0.,-1.])
                roll=math.atan2(normal@np.cross(projected,target),projected@target);wanted[:3,:3]=rotation(normal,roll)@wanted[:3,:3]
                parts=['Relaxed palm.001','Resting thumb.001'];skin=[]
                for name in parts:
                    skin.append(transform(source[name+'/rest_points'],wanted@np.linalg.inv(rest[hand])))
                skin=np.concatenate(skin);wanted[:3,3]=[.06-(skin[:,0].min()+skin[:,0].max())/2,.267-.0002-skin[:,1].max(),.10+.34*row_index+.13-(skin[:,2].min()+skin[:,2].max())/2]
                hand_pose=np.linalg.inv(world)@wanted;shoulder=(spine@np.r_[rest[upper][:3,3],1])[:3];wrist=hand_pose[:3,3]
                a=np.linalg.norm(rest[lower][:3,3]-rest[upper][:3,3]);b=np.linalg.norm(rest[hand][:3,3]-rest[lower][:3,3]);axis=wrist-shoulder;distance=np.linalg.norm(axis)
                record=dict(profile='row'+str(row_index),row=row_index,hip_height=hip_height,spine_degrees=lean,contacts=[],folds=[],slots=[],valid=False)
                report['profiles'].append(record)
                if not abs(a-b)<distance<a+b:
                    record['error']='Authored contact exceeds original source arm reach';record['reach_distance']=distance;save();continue
                axis/=distance;along=.5*(distance+(a-b)*(a+b)/distance);centre=shoulder+along*axis;radius=math.sqrt((a+b-distance)*(a+b+distance)*(distance+a-b)*(distance-a+b))/(2*distance)
                pole=(spine@np.r_[rest[lower][:3,3],1])[:3]-centre;pole-=axis*(pole@axis);pole/=np.linalg.norm(pole);elbow=centre+radius*pole
                deform=hand_pose@np.linalg.inv(rest[hand]);up=apply_swing(spine@rest[upper],rotation_between(spine[:3,:3]@(rest[lower][:3,3]-rest[upper][:3,3]),elbow-shoulder),shoulder)
                low=apply_swing(deform@rest[lower],rotation_between(deform[:3,:3]@(rest[hand][:3,3]-rest[lower][:3,3]),wrist-elbow),elbow)
                up,proof=solve_upper(rest[upper],rest[lower],rest[hand],up,low);frames.update({upper:up,lower:low,hand:hand_pose})
                record['frame_error']=apply_frames(rig,frames);bpy.context.view_layer.update();groups=snapshot(objects);solids=snapshot(furniture.all_objects)
                for name,mesh in groups.items():
                    if name.startswith(('Relaxed shirt sleeve','Turned sleeve cuff','Forearm','Relaxed palm','Resting thumb','Natural neck','Overshirt body','Tailored trouser leg')):
                        pairs,unresolved=kernel.pairs(mesh,mesh,self_test=True);record['folds'].append(dict(part=name,pairs=len(pairs),unresolved=unresolved))
                    if name.startswith(('Forearm','Relaxed palm','Resting thumb','Turned sleeve cuff')):
                        for other,target_mesh in groups.items():
                            if other.startswith(('Overshirt','Shirt lower','Trouser hip','One sewn','Shirt placket','Small horn')):
                                pairs,unresolved=kernel.pairs(mesh,target_mesh)
                                if len(pairs) or unresolved:
                                    record['contacts'].append(dict(kind='distal_body',parts=[name,other],pairs=len(pairs),unresolved=unresolved))
                for column in range(6):
                    displacement=np.array([-.30+.12*column-.06,0,0]);slot=row_index*6+column;collisions=[]
                    shifted={n:Mesh(m.points+displacement,m.triangles,m.native_tree) for n,m in groups.items()}
                    # Native bounds must be rebuilt after an actual translation.
                    from mathutils.bvhtree import BVHTree
                    for mesh in shifted.values():
                        error=float(np.abs(mesh.points-mesh.points.astype(np.float32)).max());mesh.native_tree=BVHTree.FromPolygons(mesh.points.tolist(),mesh.triangles.tolist(),all_triangles=True,epsilon=2*error+2e-6)
                    for name,mesh in shifted.items():
                        for other,target_mesh in solids.items():
                            contact=kernel.contact(mesh,target_mesh,arrays,f'row{row_index}/slot{slot}/'+name+'|'+other)
                            if contact:
                                if isinstance(contact.get('pairs'),np.ndarray):
                                    contact['pairs']=len(contact['pairs'])
                                collisions.append(dict(parts=[name,other],evidence=contact))
                    points=[];triangles=[];offset=0
                    for name in parts:
                        mesh=shifted[name];points.append(mesh.points);triangles.append(mesh.triangles+offset);offset+=len(mesh.points)
                    book=solids[f'Book {row_index} {column}'];patch=measure(np.concatenate(points),np.concatenate(triangles),book.points,book.triangles,normal,.0015)
                    record['slots'].append(dict(slot=slot,column=column,body_offset=displacement.tolist(),contact_area=patch['projected_area'],contact_cells=patch['certified_cells'],collisions=collisions,valid=not collisions and patch['projected_area']>0 and patch['certified_cells']>0))
                record['valid']=not record['contacts'] and all(not r['pairs'] and not r['unresolved'] for r in record['folds']) and all(r['valid'] for r in record['slots'])
                for name,mesh in groups.items():
                    arrays[f'row{row_index}/'+name+'/points']=mesh.points;arrays[f'row{row_index}/'+name+'/triangles']=mesh.triangles
                directory=output/('row'+str(row_index));directory.mkdir();scene=directory/'source.blend';bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(scene))
                record.update(scene=dict(path=str(scene),sha256=digest(scene)),rig=rig.name,body_collection=body.name,frames=frame_state(rig,objects),canvas=[96,120],anchor=[48.0000114440918,116.0004369020462],ortho_scale=2.6516504287719727)
                save()
        report['state']='complete'
    except BaseException as error:
        report.update(state='failed',error=repr(error),error_traceback=traceback.format_exc());raise
    finally:
        np.savez(output/'geometry-witnesses.npz',**arrays);report['inputs_unchanged']=all(digest(p)==s for p,s in inputs.items());save()


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]))
