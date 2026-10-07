"""Construct the six supported arms from recorded contacts and full source frames."""
import math
import numpy as np
from sofa_contact_solver_frames import rotation
from sofa_arm_frame_math import solve
from seated_pose_chain_math_v1 import solve_upper


def construct(prior, rest, resting, grasp, reader_pitch):
    frames=[]
    proofs=[]
    for seat,state in enumerate(prior):
        value={n:np.asarray(m,dtype=float).copy() for n,m in state['bone_matrices'].items()}
        world=np.asarray(state['rig_matrix_world'])
        # The outward envelope angles come from the measured all-phase seating proof.
        outward=(-17.305960723622544,0.,17.305966041652816)[seat]
        pitch=reader_pitch if seat==1 else 0.
        turn=rotation([1,0,0],math.radians(pitch))@rotation([0,1,0],math.radians(outward))
        value['spine'][:3,:3]=turn@rest['spine'][:3,:3]
        deform=value['spine']@np.linalg.inv(rest['spine'])
        new_head=deform@rest['head']
        head_shift=new_head[:3,3]-value['head'][:3,3]
        # Preserve the readable world head orientation; move its attached origin coherently.
        value['head'][:3,3]=new_head[:3,3]
        if seat==1:
            value['book'][:3,3]+=head_shift
        for side in ('L','R'):
            name='hand.'+side
            if seat==1:
                hand=value[name].copy()
                row=next(r for r in grasp if r['side']==side)['nearest_actual_surfaces']
                delta=np.asarray(row['book_point'])-np.asarray(row['skin_point'])
                # Move along the actual nearest surface segment, retaining a positive 0.2 mm gap.
                delta*=1-.0002/np.linalg.norm(delta)
                hand[:3,3]+=head_shift+np.linalg.inv(world)[:3,:3]@delta
            else:
                old_world=np.asarray(resting[seat]['world'])
                hand=np.linalg.inv(world)@old_world@np.asarray(resting[seat]['frames'][name])
            data=dict(matrices=dict(spine_pose=value['spine'],spine_rest=rest['spine'],
                upper_rest=rest['upper_arm.'+side],forearm_rest=rest['forearm.'+side],
                hand_rest=rest[name],hand_pose=hand),
                endpoints=dict(upper_head=rest['upper_arm.'+side][:3,3],
                    forearm_head=rest['forearm.'+side][:3,3],forearm_tail=rest[name][:3,3]))
            solved=solve(data)
            upper,proof=solve_upper(rest['upper_arm.'+side],rest['forearm.'+side],rest[name],
                solved['targets']['upper_arm'],solved['targets']['forearm'])
            solved['targets']['upper_arm']=upper
            for part,matrix in solved['targets'].items():
                value[part+'.'+side]=matrix
            proofs.append(dict(seat=seat,side=side,reader_pitch_degrees=reader_pitch,
                contact='Actual nearest book surface' if seat==1 else 'Retained finite lap/armrest patch',
                shoulder=solved['shoulder'].tolist(),elbow=solved['elbow'].tolist(),wrist=solved['wrist'].tolist(),**proof))
        frames.append(value)
    return frames,proofs
