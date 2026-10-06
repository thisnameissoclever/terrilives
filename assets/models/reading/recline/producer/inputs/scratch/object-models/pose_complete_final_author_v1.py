"""Author one mixed scene from measured support and actual book-surface witnesses."""
import gc
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
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import book_grip_original_replay as source
import probe_sofa_resting_clearance as retained
from pose_complete_final_frames_v1 import construct
from pose_complete_cached_native_v2 import CompleteKernel
from book_grip_reading_geometry import Mesh
from classify_sofa_lap_contacts import functions_from
from seated_pose_chain_geometry_v1 import finite_grasp
from continuous_support_patch import measure


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(manifest_path,output):
    if not bpy.app.background or output.exists():
        raise ValueError('Require background Blender and a new output')
    manifest=json.loads(manifest_path.read_text())
    inputs=dict(manifest['inputs']);inputs[str(manifest_path)]=digest(manifest_path)
    if any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Frozen corrected-scene input changed')
    output.mkdir(exist_ok=False)
    began=time.monotonic()
    report=dict(state='running',pid=os.getpid(),inputs=inputs,acceptance=False,renders=[],posture_evaluations=[],
        scope='One corrected static mixed scene, supported resting hands, actual nearest-surface grip and coherent six-arm frames')
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    def budget():
        if time.monotonic()-began>180:
            raise TimeoutError('Single corrected-scene author ceiling exhausted')
    save()
    witnesses={}
    try:
        data=json.loads(Path(manifest['prepared_frames']).read_text())
        rest={n:np.asarray(m) for n,m in data['rest'].items()}
        bpy.ops.wm.open_mainfile(filepath=str(HERE/'seated-pose-chain-01/raw/authored-mixed-sofa.blend'))
        binding=json.loads((HERE/'sofa-derived-binding-03/proof.json').read_text())
        rigs=[bpy.data.objects[name] for name in binding['rest_contexts']['original']['restoration']['after_visibility']['rigs']]
        bodies=[]
        for rig in rigs:
            found=[c for c in bpy.data.collections if any(o.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers) for o in c.objects)]
            if len(found)!=1:
                raise ValueError('Ambiguous saved actor ownership')
            bodies.append(found[0])
        collections=[(str(i),body) for i,body in enumerate(bodies)]+[('furniture',bpy.data.collections['Witness furniture'])]
        objects=[o for body in bodies for o in body.all_objects if o.type=='MESH']
        identity=source.rest.identity(objects,rigs)
        kernel=CompleteKernel(functions_from(HERE/'audit_sofa_binding.py'),began+180)
        def snapshot():
            deps=bpy.context.evaluated_depsgraph_get();groups={owner:{} for owner,c in collections}
            for owner,collection in collections:
                for obj in collection.all_objects:
                    if obj.type!='MESH' or obj.hide_render:
                        continue
                    evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh()
                    try:
                        mesh.calc_loop_triangles()
                        points=np.asarray([list(evaluated.matrix_world@v.co) for v in mesh.vertices])
                        triangles=np.asarray([tuple(t.vertices) for t in mesh.loop_triangles],dtype=np.int32)
                        error=float(np.abs(points-points.astype(np.float32).astype(float)).max())
                        tree=BVHTree.FromPolygons(points.tolist(),triangles.tolist(),all_triangles=True,epsilon=2*error+2e-6)
                        groups[owner][obj.get('probe_source_name',obj.name)]=Mesh(points,triangles,tree)
                    finally:
                        evaluated.to_mesh_clear()
            return groups
        pitch=12.
        # At most four measured posture evaluations, never an angle grid or a roll search.
        for index in range(1):
            budget()
            frames,arms=construct(data['prior'],rest,data['resting'],data['grasp'],pitch)
            errors=[]
            for rig,value in zip(rigs,frames):
                errors.append(retained.apply_frames(rig,value))
            bpy.context.view_layer.update()
            groups=snapshot();hits=[];segments=[]
            for a,b in itertools.combinations(('0','1','2'),2):
                for name,left in groups[a].items():
                    for other,right in groups[b].items():
                        if np.any(left.high<right.low) or np.any(right.high<left.low):
                            continue
                        pairs,unresolved=kernel.pairs(left,right)
                        if len(pairs) or unresolved:
                            key=f'posture/{index}/{a}/{name}|{b}/{other}'
                            witnesses[key]=pairs
                            hits.append(dict(owners=[a,b],parts=[name,other],pairs=len(pairs),unresolved=unresolved,witness=key))
                            for i,j in pairs:
                                segment=kernel.primitives['intersection_segment'](left.tri[i],right.tri[j])
                                for endpoint in ('first','second','start','end','a','b'):
                                    if endpoint in segment:
                                        segments.append(np.asarray(segment[endpoint]))
            report['posture_evaluations'].append(dict(index=index,reader_pitch=pitch,hits=hits,frame_errors=errors))
            save()
            if not hits:
                break
            if any('1' not in row['owners'] or any(not n.startswith('Relaxed shirt sleeve') for n in row['parts']) for row in hits):
                report['posture_stop']='Another neighboring body contact requires review'
                break
            # Derive the next depth separation from the exact intersecting sleeve triangles.
            contact_points=np.concatenate([groups[o][n].tri[np.unique(witnesses[row['witness']][:,i])].reshape(-1,3)
                for row in hits for i,(o,n) in enumerate(zip(row['owners'],row['parts']))])
            pivot=(np.asarray(data['prior'][1]['rig_matrix_world'])@np.r_[frames[1]['spine'][:3,3],1])[:3]
            lever=float(np.median(contact_points[:,2])-pivot[2])
            if lever<=.05:
                raise ValueError('Neighbor witnesses do not define a useful torso-depth lever')
            depth_span=float(np.ptp(contact_points[:,0]))
            increment=math.degrees(math.atan2(depth_span+.002,2*lever))
            pitch=min(30.,pitch+min(10.,increment))
            report['posture_evaluations'][-1]['measured_update']=dict(depth_span=depth_span,lever=lever,pitch_increment=increment,next_pitch=pitch)
            if index==0:
                report['posture_stop']='The corrected retained outward scene still has neighboring contacts'
                break
            del groups
            gc.collect()
        report['outward_displacement']=[row for row in arms if 'outward_world_displacement' in row]
        report.update(arm_construction=arms,final_reader_pitch=report['posture_evaluations'][-1]['reader_pitch'],
            full_states=[source.frame_state(rig,source.owned(rig)) for rig in rigs])
        with np.load(HERE/'seated-pose-chain-01/raw/authored-geometry.npz') as baseline:
            report['protected_lower_body']=[]
            for owner in ('0','1','2'):
                for name in groups[owner]:
                    if not name.startswith(('Trouser hip bridge','Tailored trouser leg','Fitted rounded shoe')):
                        continue
                    mesh=groups[owner][name]
                    error=float(np.linalg.norm(mesh.points-baseline[owner+'/'+name+'/points'],axis=1).max())
                    equal=bool(np.array_equal(mesh.triangles,baseline[owner+'/'+name+'/triangles']))
                    report['protected_lower_body'].append(dict(owner=owner,part=name,error=error,ordered_triangles_equal=equal))
                    if error>1e-5 or not equal:
                        raise ValueError('Supported lower body changed')
        report['rig_checks']=[]
        for seat,rig in enumerate(rigs):
            length=max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones)
            scale=max(abs(v-1) for b in rig.pose.bones for v in b.scale)
            joints=max((rig.pose.bones[a+'.'+s].tail-rig.pose.bones[b+'.'+s].head).length for s in ('L','R') for a,b in (('upper_arm','forearm'),('forearm','hand')))
            report['rig_checks'].append(dict(seat=seat,length_error=length,scale_error=scale,joint_error=joints))
            if max(length,scale,joints)>1e-5:
                raise ValueError('Corrected full-chain rig integrity failed')
        report['resting_contact']=[]
        hands=json.loads((HERE/'sofa-hand-support-01/proof.json').read_text())['hands']
        for row in hands:
            seat,side=row['seat'],row['side']
            if seat==1:
                continue
            m=row['measurement'];support_owner=str(seat) if m['support'].startswith('Tailored') else 'furniture'
            palm=groups[str(seat)]['Relaxed palm'+('' if side=='L' else '.001')]
            support=groups[support_owner][m['support']]
            patch=measure(palm.points,palm.triangles,support.points,support.triangles,np.asarray(m['support_normal']),.0015)
            prefix=f'resting/{seat}/{side}'
            for key in ('basis','vertices','offsets','pairs','excluded'):
                witnesses[prefix+'/'+key]=patch[key]
            report['resting_contact'].append(dict(seat=seat,side=side,support=m['support'],projected_area=patch['projected_area'],certified_cells=patch['certified_cells'],spans=patch['spans'],witness=prefix,valid=patch['projected_area']>0 and patch['certified_cells']>0))
        rotation=(np.asarray(report['full_states'][1]['rig_matrix_world'])@np.asarray(report['full_states'][1]['bone_matrices']['book'])@np.linalg.inv(rest['book']))[:3,:3]
        report['finite_grasp_contact']=finite_grasp(groups['1'],rotation,witnesses)
        for row in report['finite_grasp_contact']:
            row['nearest_actual_surfaces']['method']='Complete actual triangle distance; current skin/book crossings independently retained below'
        report['skin_book_crossings']=[]
        book_names=[n for n in groups['1'] if n.startswith(source.PROP)]
        for side,suffix in (('L',''),('R','.001')):
            for name in ('Relaxed palm','Resting thumb','Forearm with elbow and wrist sections'):
                for book_name in book_names:
                    pairs,unresolved=kernel.pairs(groups['1'][name+suffix],groups['1'][book_name])
                    if len(pairs) or unresolved:
                        key=f'grasp/{name+suffix}|{book_name}';witnesses[key]=pairs
                        report['skin_book_crossings'].append(dict(parts=[name+suffix,book_name],pairs=len(pairs),unresolved=unresolved,witness=key))
        report['source_identity_equal']=source.rest.identity(objects,rigs)==identity
        if not report['source_identity_equal']:
            raise ValueError('Correction changed source geometry, weights, bones or materials')
        arrays={}
        for owner,meshes in groups.items():
            for name,mesh in meshes.items():
                arrays[owner+'/'+name+'/points']=mesh.points
                arrays[owner+'/'+name+'/triangles']=mesh.triangles
        np.savez(output/'authored-geometry.npz',**arrays)
        (output/'authored-pose.json').write_text(json.dumps(report['full_states'],indent=2)+'\n')
        bpy.ops.wm.save_as_mainfile(filepath=str(output/'authored-mixed-sofa.blend'))
        report['contact_gate_failures']=[]
        if report.get('posture_stop'):
            report['contact_gate_failures'].append(report['posture_stop'])
        if any(not r['valid'] for r in report['resting_contact']):
            report['contact_gate_failures'].append('Missing finite resting contact')
        if any(not r['valid'] or r['nearest_actual_surfaces']['distance']>.0015 for r in report['finite_grasp_contact']):
            report['contact_gate_failures'].append('Missing actual finite book contact')
        if report['skin_book_crossings']:
            report['contact_gate_failures'].append('Actual skin/book surface crossing')
        save()
        del arrays,groups,kernel,identity
        gc.collect()
        scene=bpy.context.scene
        scene.render.threads_mode='FIXED';scene.render.threads=2
        # Preserve all four camera orientations and source pixel density; fit the changed silhouette.
        cameras=json.loads((HERE/'pose-complete-02/raw/proof.json').read_text())['renders']
        for old in cameras:
            budget()
            camera=scene.camera;camera.matrix_world=Matrix(old['camera_matrix'])
            rotate=np.asarray(camera.matrix_world)[:3,:3]
            density=max(old['native_size'])/old['camera_scale']
            with np.load(output/'authored-geometry.npz') as geometry:
                keys=[k for k in geometry.files if k.endswith('/points')]
                if old['name'].startswith('reader'):
                    keys=[k for k in keys if k.startswith('1/') and (k.split('/')[1].startswith(source.ARM+source.PROP) or any(t in k.lower() for t in ('head','eye','hair','ear','nose','mouth','lip','chin')))]
                points=np.concatenate([geometry[k] for k in keys])
                projected=points@rotate
                center=(projected[:,:2].min(0)+projected[:,:2].max(0))/2
                size=np.ceil(np.ptp(projected[:,:2],axis=0)*density+12).astype(int).tolist()
                position=np.asarray(camera.matrix_world)[:3,3]
                current=position@rotate
                position+=rotate@np.r_[center-current[:2],0.]
                camera.matrix_world.translation=position.tolist()
            del points,projected,geometry
            gc.collect()
            camera.data.ortho_scale=float(max(size)/density)
            scene.render.resolution_x,scene.render.resolution_y=(v*8 for v in size)
            scene.render.resolution_percentage=100
            scene.render.filepath=str(output/(old['name']+'.png'))
            start=time.monotonic();bpy.ops.render.render(write_still=True)
            path=Path(scene.render.filepath)
            report['renders'].append(dict(name=old['name'],native_size=size,source_density=8,
                camera_matrix=[list(r) for r in camera.matrix_world],camera_scale=camera.data.ortho_scale,
                retained_source_pixels_per_world_unit=density,
                seconds=time.monotonic()-start,image=dict(path=path.name,sha256=digest(path)),
                labels=['Unaccepted corrected mixed scene; actual contact and full-scene witnesses retained']))
            save()
        report.update(state='complete',diagnostic_render_count=4)
    except BaseException as error:
        report.update(state='failed',error=repr(error));raise
    finally:
        np.savez(output/'author-witnesses.npz',**witnesses)
        report['inputs_unchanged']=all(digest(p)==sha for p,sha in inputs.items())
        if not report['inputs_unchanged']:
            report.update(state='failed',error='Frozen corrected-scene input changed')
        save()


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]))
