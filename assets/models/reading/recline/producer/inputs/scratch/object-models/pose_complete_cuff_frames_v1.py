"""Place each lap elbow along the measured outward garment normal on its exact circle."""
import numpy as np
from sofa_arm_frame_math import solve,rotation_between,apply_swing
from seated_pose_chain_math_v1 import solve_upper


def construct(prior,rest,resting,grasp,reader_pitch):
    values=[];proofs=[]
    for seat,state in enumerate(prior):
        frames={n:np.asarray(m,dtype=float).copy() for n,m in state['bone_matrices'].items()}
        if seat==1:
            values.append(frames);continue
        world=np.asarray(state['rig_matrix_world'])
        side='L' if seat==0 else 'R'
        upper,lower,hand=(n+'.'+side for n in ('upper_arm','forearm','hand'))
        m=dict(spine_pose=frames['spine'],spine_rest=rest['spine'],upper_rest=rest[upper],forearm_rest=rest[lower],hand_rest=rest[hand],hand_pose=frames[hand])
        result=solve(dict(matrices=m,endpoints=dict(upper_head=rest[upper][:3,3],forearm_head=rest[lower][:3,3],forearm_tail=rest[hand][:3,3])))
        shoulder,wrist=result['shoulder'],result['wrist']
        axis=wrist-shoulder;distance=np.linalg.norm(axis);axis/=distance
        a,b=result['endpoint_lengths'];along=.5*(distance+(a-b)*(a+b)/distance)
        centre=shoulder+along*axis
        world_normal=np.asarray(resting[seat]['clearance_normal'])
        normal=np.linalg.inv(world)[:3,:3]@world_normal
        direction=normal-axis*(normal@axis)
        if np.linalg.norm(direction)<1e-10:
            raise ValueError('Measured garment normal does not select the elbow circle')
        direction/=np.linalg.norm(direction)
        elbow=centre+result['circle_radius']*direction
        spine=frames['spine']@np.linalg.inv(rest['spine'])
        hand_deform=frames[hand]@np.linalg.inv(rest[hand])
        upper_vector=rest[lower][:3,3]-rest[upper][:3,3]
        lower_vector=rest[hand][:3,3]-rest[lower][:3,3]
        upper_pose=apply_swing(spine@rest[upper],rotation_between(spine[:3,:3]@upper_vector,elbow-shoulder),shoulder)
        lower_pose=apply_swing(hand_deform@rest[lower],rotation_between(hand_deform[:3,:3]@lower_vector,wrist-elbow),elbow)
        solved,proof=solve_upper(rest[upper],rest[lower],rest[hand],upper_pose,lower_pose)
        frames[upper]=solved;frames[lower]=lower_pose
        proofs.append(dict(seat=seat,side=side,world_clearance_normal=world_normal.tolist(),
            chosen_elbow_world=(world@np.r_[elbow,1])[:3].tolist(),hand_frame_unchanged=True,
            construction='Exact reachable-circle point maximizing displacement along the actual intersecting shirt normals',**proof))
        values.append(frames)
    return values,proofs
