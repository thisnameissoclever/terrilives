"""Fit the existing full-size bed posture to the unchanged whole sofa."""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import bpy
import numpy as np
from mathutils import Matrix,Vector

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path[:0]=[str(HERE),str(ROOT/'assets/models/bedroom')]
from double_bed_sleep import apply_approved_pose,point_bone
from pose_complete_independent_author_v1 import snapshot
from pose_complete_cached_native_v2 import CompleteKernel
from classify_sofa_lap_contacts import functions_from
from pose_complete_supported_transfer_v1 import actual_gap
from book_grip_reading_geometry import Mesh
from continuous_support_patch import measure
from book_grip_original_replay import owned,frame_state


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def merge(meshes):
    points=[];triangles=[];offset=0
    for mesh in meshes:
        points.append(mesh.points);triangles.append(mesh.triangles+offset);offset+=len(mesh.points)
    return Mesh(np.concatenate(points),np.concatenate(triangles))


def run(manifest_path,output):
    manifest=json.loads(manifest_path.read_text());inputs=dict(manifest['inputs'])
    if not bpy.app.background or output.exists() or any(digest(p)!=s for p,s in inputs.items()):
        raise ValueError('Require new recline source and immutable inputs')
    output.mkdir();began=time.monotonic();report=dict(state='running',pid=os.getpid(),inputs=inputs,acceptance=False,contacts=[],folds=[])
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    save();arrays={}
    try:
        bpy.ops.wm.open_mainfile(filepath=manifest['source_scene'])
        names=json.loads(Path(manifest['binding_receipt']).read_text())['rest_contexts']['original']['restoration']['after_visibility']['rigs']
        rigs=[bpy.data.objects[n] for n in names];rig=rigs[1];objects=owned(rig)
        body=next(c for c in bpy.data.collections if any(o in c.objects.values() for o in objects))
        for collection in bpy.data.collections:
            if any(o.type=='MESH' and any(m.type=='ARMATURE' and m.object in (rigs[0],rigs[2]) for m in o.modifiers) for o in collection.all_objects):
                collection.hide_render=True
        config=json.loads(Path(manifest['bed_config']).read_text());config.update(sleeping_scale=1.,rig_location=[0,0,0],world_offset=[0,0,0],root_translation=[0,0,0])
        apply_approved_pose(rig,config);rig['eyes_closed']=0.;rig['book_visible']=0.;bpy.context.view_layer.update()
        furniture=bpy.data.collections['Witness furniture'];solids=snapshot(furniture.all_objects);groups=snapshot(objects)
        seat=merge([m for n,m in solids.items() if n.startswith('Seat cushion')])
        hip=groups['Trouser hip bridge'];points=np.concatenate([m.points for m in groups.values()])
        shift=np.array([-.15,-(points[:,1].min()+points[:,1].max())/2,0.])
        shift[2]=.5605-float(hip.points[:,2].min())
        rig.matrix_world=Matrix.Translation(shift.tolist())@rig.matrix_world;bpy.context.view_layer.update();groups=snapshot(objects)
        rear=max(m.points[:,0].max() for n,m in groups.items() if n.startswith(('Relaxed shirt sleeve','Turned sleeve cuff','Forearm','Relaxed palm','Resting thumb')))
        shift_x=.1085-rear
        rig.matrix_world=Matrix.Translation((shift_x,0,0))@rig.matrix_world;bpy.context.view_layer.update();groups=snapshot(objects)
        clothed_pelvis=merge([groups[n] for n in ('Trouser hip bridge','Overshirt body','Shirt lower hem')])
        gap,_,_=actual_gap(clothed_pelvis.points,clothed_pelvis.triangles,seat,np.array([0.,0.,1.]))
        shift_z=.0005-gap
        heel=min(m.points[:,1].min() for n,m in groups.items() if n.startswith('Fitted rounded shoe sole'))
        shift_y=-.915-heel
        rig.matrix_world=Matrix.Translation((0,shift_y,shift_z))@rig.matrix_world;bpy.context.view_layer.update();groups=snapshot(objects)
        report['actual_support_refit']=dict(rear_arm_clearance=.0015,shift_x=shift_x,clothed_pelvis_initial_gap=gap,shift_z=shift_z,heel_projected_shift=shift_y)
        # Keep the accepted foot directions. Derive the shin elevation from
        # the actual heel offset and the unchanged armrest top.
        for side,suffix in (('L',''),('R','.001')):
            foot=groups['Fitted rounded shoe sole'+suffix];ankle=rig.matrix_world@rig.pose.bones['foot.'+side].head
            knee=rig.matrix_world@rig.pose.bones['shin.'+side].head
            relative=float(foot.points[:,2].min())-ankle.z
            sine=(.7505-relative-knee.z)/rig.data.bones['shin.'+side].length
            if abs(sine)>=1:
                raise ValueError('Existing lower leg cannot reach the real armrest')
            angle=math.asin(sine)
            point_bone(rig,'shin.'+side,(0,-math.cos(angle),math.sin(angle)))
            point_bone(rig,'foot.'+side,(0,0,1))
        groups=snapshot(objects)
        kernel=CompleteKernel(functions_from(HERE/'audit_sofa_binding.py'),began+180)
        for name,mesh in groups.items():
            if name.startswith(('Relaxed shirt sleeve','Turned sleeve cuff','Forearm','Relaxed palm','Resting thumb')):
                pairs,unresolved=kernel.pairs(mesh,mesh,self_test=True)
                report['folds'].append(dict(part=name,pairs=len(pairs),unresolved=unresolved))
            for other,solid in solids.items():
                contact=kernel.contact(mesh,solid,arrays,'furniture/'+name+'|'+other)
                if contact:
                    if isinstance(contact.get('pairs'),np.ndarray):
                        contact['pairs']=len(contact['pairs'])
                    report['contacts'].append(dict(kind='furniture',parts=[name,other],evidence=contact))
            if name.startswith(('Forearm','Relaxed palm','Resting thumb','Turned sleeve cuff')):
                for other,target in groups.items():
                    if other.startswith(('Overshirt','Shirt lower','Trouser hip','One sewn','Shirt placket','Small horn')):
                        pairs,unresolved=kernel.pairs(mesh,target)
                        if len(pairs) or unresolved:
                            report['contacts'].append(dict(kind='distal_body',parts=[name,other],pairs=len(pairs),unresolved=unresolved))
        clothed_pelvis=merge([groups[n] for n in ('Trouser hip bridge','Overshirt body','Shirt lower hem')])
        patch=measure(clothed_pelvis.points,clothed_pelvis.triangles,seat.points,seat.triangles,np.array([0.,0.,1.]),.003)
        report['pelvis_support']=dict(projected_area=patch['projected_area'],certified_cells=patch['certified_cells'],surface='Actual outermost clothed torso/pelvis, not trousers buried beneath shirt')
        report['feet_support']=[]
        arm=solids['Arm left']
        for suffix in ('','.001'):
            mesh=groups['Fitted rounded shoe sole'+suffix];patch=measure(mesh.points,mesh.triangles,arm.points,arm.triangles,np.array([0.,0.,1.]),.003)
            report['feet_support'].append(dict(part='Fitted rounded shoe sole'+suffix,projected_area=patch['projected_area'],certified_cells=patch['certified_cells']))
        report['valid']=not report['contacts'] and all(not r['pairs'] and not r['unresolved'] for r in report['folds']) and report['pelvis_support']['projected_area']>0 and all(r['projected_area']>0 for r in report['feet_support'])
        for name,mesh in groups.items():
            arrays[name+'/points']=mesh.points;arrays[name+'/triangles']=mesh.triangles
        scene=output/'source.blend';bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(scene))
        report.update(state='complete',rig=rig.name,body_collection=body.name,content='long_sofa',stage='recline',exclusive=True,body_scale=list(rig.scale),
            source_bed_scale=0.88,recline_scale=1.,canvas=[160,176],anchor=[80.00000953674316,144.00043869018555],ortho_scale=3.889087200164795,
            scene=dict(path=str(scene),sha256=digest(scene)),frames=frame_state(rig,objects))
    except BaseException as error:
        report.update(state='failed',error=repr(error));raise
    finally:
        np.savez(output/'geometry-witnesses.npz',**arrays);report['inputs_unchanged']=all(digest(p)==s for p,s in inputs.items());save()


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]))
