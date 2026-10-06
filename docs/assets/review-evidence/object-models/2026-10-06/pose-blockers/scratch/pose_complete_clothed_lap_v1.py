"""One deterministic outermost clothed-lap support refit per retained hand."""
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from pose_complete_supported_transfer_v1 import actual_gap,transform
from book_grip_reading_geometry import Mesh,Kernel
from classify_sofa_lap_contacts import functions_from
from sofa_arm_frame_math import rotation_between,apply_swing
from seated_pose_chain_math_v1 import solve_upper
from continuous_support_patch import measure


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    began=time.monotonic();output=HERE/'pose-complete-clothed-lap-01';output.mkdir(exist_ok=False)
    base=HERE/'pose-complete-supported-author-01'
    paths=[Path(__file__).resolve(),base/'raw/proof.json',base/'raw/authored-geometry.npz',base/'prepared-frames.json',
        HERE/'pose-complete-supported-transfer-01/proof.json',HERE/'sofa-derived-binding-03/normalized-rest.npz']
    inputs={str(p):digest(p) for p in paths}
    states=json.loads(paths[1].read_text())['full_states'];rest={n:np.asarray(v) for n,v in json.loads(paths[3].read_text())['rest'].items()}
    selected=json.loads(paths[4].read_text())['selected'];rows=[];arrays={}
    kernel=Kernel(functions_from(HERE/'audit_sofa_binding.py'),began+120)
    with np.load(paths[2]) as cache,np.load(paths[5]) as source:
        for seat,side,suffix in ((0,'L',''),(2,'R','.001')):
            state=states[seat];world=np.asarray(state['rig_matrix_world']);frames={n:np.asarray(v) for n,v in state['bone_matrices'].items()}
            upper,lower,hand=(n+'.'+side for n in ('upper_arm','forearm','hand'))
            palm_name='Relaxed palm'+suffix;cuff_name='Turned sleeve cuff'+suffix
            points=[];triangles=[];offset=0
            support_names=('Tailored trouser leg'+suffix,'Overshirt body','Shirt lower hem')
            for name in support_names:
                value=cache[f'{seat}/{name}/points'];points.append(value);triangles.append(cache[f'{seat}/{name}/triangles']+offset);offset+=len(value)
            support=Mesh(np.concatenate(points),np.concatenate(triangles))
            normal=np.asarray(selected[str(seat)]['normal']);palm_rest=source[palm_name+'/rest_points'];palm_tri=source[palm_name+'/triangles']
            initial=world@frames[hand];palm=transform(palm_rest,initial@np.linalg.inv(rest[hand]))
            before,triangle,point=actual_gap(palm,palm_tri,support,normal)
            tri=support.tri[triangle];actual_normal=np.cross(tri[1]-tri[0],tri[2]-tri[0]);actual_normal/=np.linalg.norm(actual_normal)
            if actual_normal@normal<0:
                actual_normal=-actual_normal
            align=rotation_between(normal,actual_normal);change=np.eye(4);change[:3,:3]=align;change[:3,3]=point-align@point
            wanted=change@initial;palm=transform(palm_rest,wanted@np.linalg.inv(rest[hand]))
            gap,_,_=actual_gap(palm,palm_tri,support,actual_normal)
            wanted[:3,3]+=actual_normal*(.0005-gap)
            palm=transform(palm_rest,wanted@np.linalg.inv(rest[hand]));hand_pose=np.linalg.inv(world)@wanted
            spine=frames['spine']@np.linalg.inv(rest['spine']);shoulder=(spine@np.r_[rest[upper][:3,3],1])[:3];wrist=hand_pose[:3,3]
            a=np.linalg.norm(rest[lower][:3,3]-rest[upper][:3,3]);b=np.linalg.norm(rest[hand][:3,3]-rest[lower][:3,3]);axis=wrist-shoulder;distance=np.linalg.norm(axis)
            row=dict(seat=seat,before_composite_gap_mm=before*1000,normal=actual_normal.tolist(),support_names=support_names,hits=[],valid=False)
            rows.append(row)
            if not abs(a-b)<distance<a+b:
                row['error']='Outermost lap normal refit exceeds original arm reach';continue
            axis/=distance;along=.5*(distance+(a-b)*(a+b)/distance);centre=shoulder+along*axis
            radius=math.sqrt((a+b-distance)*(a+b+distance)*(distance+a-b)*(distance-a+b))/(2*distance)
            direction=frames[lower][:3,3]-centre;direction-=axis*(direction@axis);direction/=np.linalg.norm(direction);elbow=centre+radius*direction
            deform=hand_pose@np.linalg.inv(rest[hand])
            up=apply_swing(spine@rest[upper],rotation_between(spine[:3,:3]@(rest[lower][:3,3]-rest[upper][:3,3]),elbow-shoulder),shoulder)
            low=apply_swing(deform@rest[lower],rotation_between(deform[:3,:3]@(rest[hand][:3,3]-rest[lower][:3,3]),wrist-elbow),elbow)
            up,proof=solve_upper(rest[upper],rest[lower],rest[hand],up,low)
            cuff_points=transform(source[cuff_name+'/rest_points'],world@up@np.linalg.inv(rest[upper]))
            moving={palm_name:Mesh(palm,palm_tri),cuff_name:Mesh(cuff_points,source[cuff_name+'/triangles'])}
            for name,mesh in moving.items():
                arrays[f'{seat}/{name}/points']=mesh.points;arrays[f'{seat}/{name}/triangles']=mesh.triangles
                for other in ('Overshirt body','One sewn breast pocket','Shirt lower hem','Trouser hip bridge','Shirt placket','Small horn button','Small horn button.001'):
                    target=Mesh(cache[f'{seat}/{other}/points'],cache[f'{seat}/{other}/triangles'])
                    pairs,unresolved=kernel.pairs(mesh,target)
                    if len(pairs) or unresolved:
                        key=f'{seat}/{name}|{other}';arrays[key]=pairs
                        row['hits'].append(dict(parts=[name,other],pairs=len(pairs),unresolved=unresolved,witness=key))
            patch=measure(palm,palm_tri,support.points,support.triangles,actual_normal,.0015)
            row.update(support_area=patch['projected_area'],support_cells=patch['certified_cells'],
                frames={upper:up.tolist(),lower:low.tolist(),hand:hand_pose.tolist()},
                valid=not row['hits'] and patch['projected_area']>0 and patch['certified_cells']>0)
    np.savez(output/'witnesses.npz',**arrays)
    report=dict(state='cached_pass' if all(r['valid'] for r in rows) else 'rejected_single_refit',acceptance=False,inputs=inputs,rows=rows,
        inputs_unchanged=all(digest(p)==s for p,s in inputs.items()),elapsed_seconds=time.monotonic()-began,
        scope='One actual outermost composite lap normal alignment and gap refit per hand, then complete analytic arm frames; no yaw/tangent/elbow search; full evaluated check required if cached passes')
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(state=report['state'],rows=[dict(seat=r['seat'],valid=r['valid'],hits=r['hits'],area=r.get('support_area')) for r in rows])))


if __name__=='__main__':
    run()
