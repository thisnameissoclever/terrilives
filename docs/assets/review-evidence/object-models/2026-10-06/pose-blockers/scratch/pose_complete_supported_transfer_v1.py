"""Four bounded cached lap-contact candidates per hand, without a parameter grid."""
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import continuous_support_patch as patch
from book_grip_reading_geometry import Mesh,Kernel
from classify_sofa_lap_contacts import functions_from
from sofa_contact_solver_frames import rotation
from sofa_arm_frame_math import rotation_between,apply_swing
from seated_pose_chain_math_v1 import solve_upper


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def transform(points,matrix):
    return points@matrix[:3,:3].T+matrix[:3,3]


def basis(normal):
    tangent=np.asarray([-1.,0.,0.]);tangent-=normal*(normal@tangent);tangent/=np.linalg.norm(tangent)
    return np.column_stack((tangent,np.cross(normal,tangent),normal))


def actual_gap(points,triangles,support,normal):
    axes=basis(normal)
    hand=patch.projected(points,triangles,axes,-1)
    seat=patch.projected(support.points,support.triangles,axes,1)
    best=None
    for hi,triangle in enumerate(hand['triangles']):
        ids=np.flatnonzero(np.all(seat['high']>=hand['low'][hi],axis=1)&np.all(seat['low']<=hand['high'][hi],axis=1))
        for si in ids:
            poly=patch.intersect(list(triangle[:,:2]),seat['triangles'][si,:,:2])
            if len(poly)<3 or abs(patch.signed_area(poly))<=1e-14:
                continue
            if patch.hidden(poly,hand['planes'][hi],hand,hi,False) or patch.hidden(poly,seat['planes'][si],seat,si,True):
                continue
            values=np.c_[np.asarray(poly),np.ones(len(poly))]
            gaps=values@(hand['planes'][hi]-seat['planes'][si])
            index=int(np.argmin(gaps));gap=float(gaps[index])
            if best is None or gap<best[0]:
                xy=np.asarray(poly[index]);z=float(np.r_[xy,1.]@seat['planes'][si])
                best=(gap,int(seat['ids'][si]),axes@np.r_[xy,z])
    if best is None:
        raise ValueError('No actual unoccluded palm/thigh projected overlap')
    return best


def run():
    began=time.monotonic();output=HERE/'pose-complete-supported-transfer-01';output.mkdir(exist_ok=False)
    paths=[Path(__file__).resolve(),HERE/'pose-complete-cuff-01/raw/proof.json',HERE/'pose-complete-cuff-01/raw/authored-geometry.npz',
        HERE/'pose-complete-cuff-01/prepared-frames.json',HERE/'sofa-derived-binding-03/normalized-rest.npz',
        HERE/'sofa-hand-support-01/proof.json',HERE/'continuous_support_patch.py',HERE/'seated_pose_chain_math_v1.py',HERE/'audit_sofa_binding.py']
    paths.extend([HERE/'pose-complete-supported-fit-01/proof.json',HERE/'pose-complete-supported-fit-01/witnesses.npz'])
    inputs={str(p):digest(p) for p in paths}
    successful=json.loads(paths[-2].read_text())['selected']['2']
    source_state=json.loads(paths[1].read_text())['full_states'];rest={n:np.asarray(m) for n,m in json.loads(paths[3].read_text())['rest'].items()}
    hands=json.loads(paths[5].read_text())['hands'];arrays={};rows=[];selected={'2':copy.deepcopy(successful)}
    kernel=Kernel(functions_from(paths[8]),began+120)
    cache=np.load(paths[2]);source=np.load(paths[4])
    def save(state='running'):
        report=dict(state=state,inputs=inputs,acceptance=False,candidates=rows,selected=selected,elapsed_seconds=time.monotonic()-began,
            limits=dict(cached_candidates_per_hand=1,math_frame_derivatives_per_step=0,seconds=120),
            scope='One deterministic mirrored feasible right placement transferred to left support coordinates with proper handedness and actual normal refit; right frames preserved exactly; full evaluated check mandatory')
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        for seat,side,suffix in ((0,'L',''),):
            state=source_state[seat];world=np.asarray(state['rig_matrix_world']);inverse=np.linalg.inv(world)
            frames={n:np.asarray(m).copy() for n,m in state['bone_matrices'].items()}
            upper,lower,hand=(n+'.'+side for n in ('upper_arm','forearm','hand'))
            palm_name='Relaxed palm'+suffix;cuff_name='Turned sleeve cuff'+suffix
            palm_rest=source[palm_name+'/rest_points'];palm_tri=source[palm_name+'/triangles']
            cuff_rest=source[cuff_name+'/rest_points'];cuff_tri=source[cuff_name+'/triangles']
            support_name=next(r['measurement']['support'] for r in hands if r['seat']==seat and r['side']==side)
            normal=np.asarray(next(r['measurement']['support_normal'] for r in hands if r['seat']==seat and r['side']==side));normal/=np.linalg.norm(normal)
            support=Mesh(cache[f'{seat}/{support_name}/points'],cache[f'{seat}/{support_name}/triangles'])
            targets={n:Mesh(cache[f'{seat}/{n}/points'],cache[f'{seat}/{n}/triangles']) for n in ('Overshirt body','One sewn breast pocket','Shirt lower hem','Trouser hip bridge','Shirt placket','Small horn button','Small horn button.001')}
            initial_hand=world@frames[hand];original_elbow=frames[lower][:3,3]
            initial_palm=transform(palm_rest,initial_hand@np.linalg.inv(rest[hand]))
            initial_cuff=transform(cuff_rest,world@frames[upper]@np.linalg.inv(rest[upper]))
            replay=max(float(np.linalg.norm(initial_palm-cache[f'{seat}/{palm_name}/points'],axis=1).max()),float(np.linalg.norm(initial_cuff-cache[f'{seat}/{cuff_name}/points'],axis=1).max()))
            if replay>1e-5:
                raise ValueError('Rigid cuff/palm source replay control failed')
            _,_,pivot=actual_gap(initial_palm,palm_tri,support,normal)
            tangents=basis(normal)[:,:2];scales=np.asarray([.04,.04,math.radians(30)])
            def candidate(q,measure_contact=False):
                displacement=tangents@(q[:2]*scales[:2]);yaw=rotation(normal,float(q[2]*scales[2]))
                change=np.eye(4);change[:3,:3]=yaw;change[:3,3]=pivot+displacement-yaw@pivot
                wanted=change@initial_hand
                palm=transform(palm_rest,wanted@np.linalg.inv(rest[hand]))
                _,triangle,point=actual_gap(palm,palm_tri,support,normal)
                tri=support.tri[triangle];new_normal=np.cross(tri[1]-tri[0],tri[2]-tri[0]);new_normal/=np.linalg.norm(new_normal)
                if new_normal@normal<0:
                    new_normal=-new_normal
                align=rotation_between(normal,new_normal);adjust=np.eye(4);adjust[:3,:3]=align;adjust[:3,3]=point-align@point
                wanted=adjust@wanted;palm=transform(palm_rest,wanted@np.linalg.inv(rest[hand]))
                gap,_,_=actual_gap(palm,palm_tri,support,new_normal)
                wanted[:3,3]+=new_normal*(.0005-gap);palm=transform(palm_rest,wanted@np.linalg.inv(rest[hand]))
                hand_pose=inverse@wanted;spine=frames['spine']@np.linalg.inv(rest['spine'])
                shoulder=(spine@np.r_[rest[upper][:3,3],1])[:3];wrist=hand_pose[:3,3]
                a=np.linalg.norm(rest[lower][:3,3]-rest[upper][:3,3]);b=np.linalg.norm(rest[hand][:3,3]-rest[lower][:3,3])
                axis=wrist-shoulder;distance=np.linalg.norm(axis)
                if not abs(a-b)<distance<a+b:
                    raise ValueError('Supported hand leaves the original source reach')
                axis/=distance;along=.5*(distance+(a-b)*(a+b)/distance);centre=shoulder+along*axis
                radius=math.sqrt((a+b-distance)*(a+b+distance)*(distance+a-b)*(distance-a+b))/(2*distance)
                direction=original_elbow-centre;direction-=axis*(direction@axis);direction/=np.linalg.norm(direction)
                elbow=centre+radius*direction
                hand_deform=hand_pose@np.linalg.inv(rest[hand])
                up=apply_swing(spine@rest[upper],rotation_between(spine[:3,:3]@(rest[lower][:3,3]-rest[upper][:3,3]),elbow-shoulder),shoulder)
                low=apply_swing(hand_deform@rest[lower],rotation_between(hand_deform[:3,:3]@(rest[hand][:3,3]-rest[lower][:3,3]),wrist-elbow),elbow)
                up,proof=solve_upper(rest[upper],rest[lower],rest[hand],up,low)
                cuff=transform(cuff_rest,world@up@np.linalg.inv(rest[upper]))
                contact=patch.measure(palm,palm_tri,support.points,support.triangles,new_normal,.0015) if measure_contact else None
                return dict(cuff=cuff,palm=palm,frames={upper:up,lower:low,hand:hand_pose},normal=new_normal,contact=contact,proof=proof)
            q=np.asarray(successful['parameters']).copy();q[1:]*=-1
            for index in range(1):
                kernel.budget()
                try:
                    value=candidate(q,True)
                except ValueError as error:
                    rows.append(dict(seat=seat,index=index,parameters=q.tolist(),valid=False,error=str(error)));save();break
                cuff_mesh=Mesh(value['cuff'],cuff_tri);hits=[];constraints=[]
                prefix=f'{seat}/{index}';arrays[prefix+'/cuff/points']=value['cuff'];arrays[prefix+'/cuff/triangles']=cuff_tri
                arrays[prefix+'/palm/points']=value['palm'];arrays[prefix+'/palm/triangles']=palm_tri
                for name,target in targets.items():
                    pairs,unresolved=kernel.pairs(cuff_mesh,target)
                    if len(pairs) or unresolved:
                        key=prefix+'/'+name;arrays[key+'/pairs']=pairs
                        hits.append(dict(part=name,pairs=len(pairs),unresolved=unresolved,witness=key))
                        for ci,ti in pairs:
                            tri=target.tri[ti];n=np.cross(tri[1]-tri[0],tri[2]-tri[0]);n/=np.linalg.norm(n)
                            constraints.append((int(ci),tri[0].copy(),n))
                area=value['contact']['projected_area'];cells=value['contact']['certified_cells']
                row=dict(seat=seat,index=index,parameters=q.tolist(),replay_control_error=replay,hits=hits,
                    support_area=area,support_cells=cells,normal=value['normal'].tolist(),
                    valid=not hits and area>0 and cells>0,frames={n:m.tolist() for n,m in value['frames'].items()})
                rows.append(row);save()
                if row['valid']:
                    selected[str(seat)]=row;break
                if not constraints or index==0:
                    break
                def residual(points):
                    tri=points[cuff_tri]
                    return np.asarray([float(((tri[ci]-origin)@n).min()) for ci,origin,n in constraints])
                baseline=residual(value['cuff']);jac=[]
                # Frame derivatives use frozen witnesses; they are not extra physical candidates.
                for axis_index in range(3):
                    probe=q.copy();probe[axis_index]+=.001
                    jac.append((residual(candidate(probe)['cuff'])-baseline)/.001)
                matrix=np.stack(jac,axis=1);step=np.zeros(3)
                for _ in range(12):
                    for vector,target in zip(matrix,.0015-baseline):
                        violation=target-vector@step
                        norm=vector@vector
                        if violation>0 and norm>1e-14:
                            step+=vector*(violation/norm)
                    step=np.clip(step,-.5,.5)
                new_q=np.clip(q+step,-1,1)
                if np.linalg.norm(new_q-q)<1e-6:
                    row['stop']='Bounded witness-directed update has no remaining step';break
                q=new_q
        save('cached_pass' if len(selected)==2 else 'bounded_no_candidate')
    except BaseException as error:
        rows.append(dict(error=repr(error)));save('failed');raise
    finally:
        np.savez(output/'witnesses.npz',**arrays);cache.close();source.close()
        report=json.loads((output/'proof.json').read_text());report['inputs_unchanged']=all(digest(p)==sha for p,sha in inputs.items())
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(state=report['state'],selected=list(selected),evaluations=len(rows),seconds=report['elapsed_seconds'])))


if __name__=='__main__':
    run()
