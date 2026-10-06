"""Reuse proved outward spine and supported lower-arm frames without sign inference."""
import numpy as np
from seated_pose_chain_math_v1 import solve_upper


def construct(prior,rest,resting,grasp,reader_pitch):
    values=[];proofs=[]
    for seat,state in enumerate(prior):
        frames={n:np.asarray(m,dtype=float).copy() for n,m in state['bone_matrices'].items()}
        if seat==1:
            values.append(frames)
            continue
        world=np.asarray(state['rig_matrix_world'])
        relative=np.linalg.inv(world)@np.asarray(resting[seat]['world'])
        saved=resting[seat]['frames']
        frames['spine']=relative@np.asarray(saved['spine'])
        deform=frames['spine']@np.linalg.inv(rest['spine'])
        attached=deform@rest['head']
        frames['head'][:3,3]=attached[:3,3]
        pivot=(world@np.r_[frames['spine'][:3,3],1])[:3]
        head=(world@np.r_[attached[:3,3],1])[:3]
        outward=float((-1 if seat==0 else 1)*(head[1]-pivot[1]))
        if outward<=.05:
            raise ValueError('Saved full spine did not displace the outer head outward')
        for side in ('L','R'):
            upper,lower,hand=(n+'.'+side for n in ('upper_arm','forearm','hand'))
            frames[upper]=relative@np.asarray(saved[upper])
            frames[lower]=relative@np.asarray(saved[lower])
            frames[hand]=relative@np.asarray(saved[hand])
            solved,proof=solve_upper(rest[upper],rest[lower],rest[hand],frames[upper],frames[lower])
            frames[upper]=solved
            expected=(deform@np.r_[rest[upper][:3,3],1])[:3]
            error=float(np.linalg.norm(expected-frames[upper][:3,3]))
            if error>1e-5:
                raise ValueError('Saved supported arm shoulder detached from the retained outward torso')
            proofs.append(dict(seat=seat,side=side,outward_world_displacement=outward,
                shoulder_attachment_error=error,lower_frame='Retained complete contact-compatible frame',**proof))
        values.append(frames)
    return values,proofs
