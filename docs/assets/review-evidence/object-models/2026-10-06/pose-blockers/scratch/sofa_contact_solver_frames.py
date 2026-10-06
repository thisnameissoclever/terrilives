"""Full-rest-frame coupled arm construction; no endpoint-only roll assumption."""
import math
import numpy as np
from sofa_arm_frame_math import rotation_between, apply_swing


def rotation(axis, angle):
    axis=np.asarray(axis,dtype=float);axis/=np.linalg.norm(axis)
    x,y,z=axis
    skew=np.array([[0.,-z,y],[z,0.,-x],[-y,x,0.]])
    return np.eye(3)+math.sin(angle)*skew+(1-math.cos(angle))*(skew@skew)


def coupled_frames(data, hand, swivel, roll):
    m={name:np.asarray(value,dtype=float) for name,value in data['matrices'].items()}
    spine=m['spine_pose']@np.linalg.inv(m['spine_rest'])
    sh0,el0,wr0=[m[name][:3,3] for name in ('upper_rest','forearm_rest','hand_rest')]
    shoulder=(spine@np.r_[sh0,1.])[:3]; wrist=hand[:3,3]
    a,b=np.linalg.norm(el0-sh0),np.linalg.norm(wr0-el0)
    delta=wrist-shoulder;distance=np.linalg.norm(delta)
    if not abs(a-b)<distance<a+b: raise ValueError('Outside unchanged source reach')
    axis=delta/distance;along=(a*a-b*b+distance*distance)/(2*distance)
    centre=shoulder+axis*along
    radius=math.sqrt(math.prod([a+b-distance,a+b+distance,distance+a-b,distance-a+b]))/(2*distance)
    rest_elbow=(spine@np.r_[el0,1.])[:3]
    radial=rest_elbow-centre;radial-=axis*(radial@axis)
    if np.linalg.norm(radial)<1e-10: raise ValueError('Source does not choose elbow reference')
    elbow=centre+rotation(axis,swivel)@radial/np.linalg.norm(radial)*radius
    swing=rotation_between(spine[:3,:3]@(el0-sh0),elbow-shoulder)
    upper=apply_swing(spine@m['upper_rest'],rotation(elbow-shoulder,roll)@swing,shoulder)
    upper_deform=upper@np.linalg.inv(m['upper_rest'])
    # The forearm starts with the solved upper deformation. This preserves the
    # shared axial reference before adding the actual elbow bend.
    lower_swing=rotation_between(upper_deform[:3,:3]@(wr0-el0),wrist-elbow)
    lower=apply_swing(upper_deform@m['forearm_rest'],lower_swing,elbow)
    deformations=[upper_deform,lower@np.linalg.inv(m['forearm_rest']),hand@np.linalg.inv(m['hand_rest'])]
    bands=[]
    for first,second in zip(deformations,deformations[1:]):
        # A sampled diagnostic is retained, never substituted for actual folds.
        bands.append(min(float(np.linalg.svd((1-t)*first[:3,:3]+t*second[:3,:3],compute_uv=False).min()) for t in np.linspace(0,1,33)))
    return dict(targets=dict(upper_arm=upper,forearm=lower,hand=hand),shoulder=shoulder,elbow=elbow,wrist=wrist,
                source_lengths=[a,b],blend_minimum_singular_values=bands)
