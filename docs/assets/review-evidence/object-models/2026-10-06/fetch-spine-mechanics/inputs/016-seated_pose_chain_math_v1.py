"""Analytic upper-arm frame solve for a retained forearm and non-straight rest chain."""
import math
import numpy as np
from sofa_arm_frame_math import rotation_between,proper_rotation,angle_degrees


def quaternion_product(a,b):
    return np.r_[a[0]*b[0]-a[1:]@b[1:],a[0]*b[1:]+b[0]*a[1:]+np.cross(a[1:],b[1:])]


def quaternion_rotation(q):
    q=np.asarray(q,dtype=float)
    q/=np.linalg.norm(q)
    scalar=q[0];v=q[1:]
    skew=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
    return np.eye(3)+2*scalar*skew+2*skew@skew


def solve_upper(upper_rest,forearm_rest,hand_rest,upper_pose,forearm_pose):
    upper_rest,forearm_rest,hand_rest,upper_pose,forearm_pose=map(lambda m:np.asarray(m,dtype=float),
        (upper_rest,forearm_rest,hand_rest,upper_pose,forearm_pose))
    a=forearm_rest[:3,3]-upper_rest[:3,3]
    b=hand_rest[:3,3]-forearm_rest[:3,3]
    target=forearm_pose[:3,3]-upper_pose[:3,3]
    lengths=[float(np.linalg.norm(v)) for v in (a,b,target)]
    if min(lengths)<=1e-10 or not all(np.isfinite(lengths)):
        raise ValueError('Degenerate source or target arm segment')
    a,b,u=(v/np.linalg.norm(v) for v in (a,b,target))
    lower_deformation=forearm_pose@np.linalg.inv(forearm_rest)
    if np.linalg.det(lower_deformation[:3,:3])<=0:
        raise ValueError('Reflected retained forearm frame')
    lower=proper_rotation(lower_deformation[:3,:3])
    w=lower.T@u
    cosine=float(np.clip(a@w,-1,1))
    if cosine<=-1+1e-10:
        raise ValueError('Antiparallel input has no unique source-defined initial swing')
    scalar=math.sqrt((1+cosine)/2)
    q0=np.r_[scalar,np.cross(a,w)/(2*scalar)]
    q0/=np.linalg.norm(q0)
    aa=float(q0[1:]@b)
    bb=float((q0[0]*w+np.cross(w,q0[1:]))@b)
    if math.hypot(aa,bb)<=1e-10:
        raise ValueError('Upper-arm axial solve is underdetermined')
    half_angle=math.atan2(-aa,bb)
    spin=np.r_[math.cos(half_angle),w*math.sin(half_angle)]
    quaternion=quaternion_product(spin,q0)
    upper=lower@quaternion_rotation(quaternion)
    transported=rotation_between(upper@b,lower@b)@upper
    direction_error=float(np.linalg.norm(upper@a-u))
    elbow_error=float(np.max(np.abs(transported-lower)))
    equation_error=abs(float(quaternion[1:]@b))
    if max(direction_error,elbow_error,equation_error)>1e-8:
        raise ValueError('Analytic upper-arm solve failed its complete transport residual')
    result=upper_pose.copy()
    result[:3,:3]=upper@upper_rest[:3,:3]
    old=proper_rotation((upper_pose@np.linalg.inv(upper_rest))[:3,:3])
    naive=rotation_between(lower@a,u)@lower
    naive_transport=rotation_between(naive@b,lower@b)@naive
    proof=dict(source_upper_direction=a.tolist(),source_forearm_direction=b.tolist(),target_upper_direction=u.tolist(),
        retained_forearm_rotation=lower.tolist(),q0=q0.tolist(),coefficient_A=aa,coefficient_B=bb,
        spin_half_angle=half_angle,solution_quaternion=quaternion.tolist(),
        direction_error=direction_error,elbow_transport_matrix_error=elbow_error,equation_error=equation_error,
        shoulder_frame_change_degrees=angle_degrees(old,upper),
        naive_backward_transport_mismatch_degrees=angle_degrees(naive_transport,lower),
        rest_chain_angle_degrees=float(np.rad2deg(np.arccos(np.clip(a@b,-1,1)))),
        endpoint_length_difference=abs(lengths[0]-lengths[2]),
        contract='Retain all source directions and solve the missing upper axial freedom analytically; no search or arbitrary roll')
    return result,proof
