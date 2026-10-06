"""Admissible-reference derivatives and exact full-frame checkpoint recovery."""
import math
import numpy as np
from sofa_contact_solver_frames import coupled_frames


def difference(first,second,cyclic=(2,5,6)):
    delta=np.asarray(first)-np.asarray(second)
    for index in cyclic:
        if index<len(delta):delta[index]=(delta[index]+1)%2-1
    return delta


def linearize(reference,bound,measure,epsilon=.01,cyclic=(2,5,6)):
    """Fit responses to actual bounded moves, with one common reference."""
    base=bound(np.asarray(reference).copy());value=float(measure(base))
    moves=[];responses=[];details=[]
    for index in range(len(base)):
        found=False
        for sign in (1.,-1.):
            trial=base.copy();trial[index]+=sign*epsilon;trial=bound(trial)
            move=difference(trial,base,cyclic)
            if np.linalg.norm(move)<1e-10:continue
            try:response=float(measure(trial))-value
            except ValueError:continue
            moves.append(move);responses.append(response);details.append(dict(parameter=index,actual_move=move.tolist(),response=response))
            found=True;break
        if not found:details.append(dict(parameter=index,unavailable=True))
    if not moves:raise ValueError('No admissible finite-difference direction')
    gradient,residuals,rank,singular=np.linalg.lstsq(np.asarray(moves),np.asarray(responses),rcond=None)
    return dict(reference=base,value=value,gradient=gradient,rank=int(rank),singular_values=singular.tolist(),
                derivatives=details,entry_move=difference(base,reference,cyclic).tolist())


def recover(data,upper,forearm,hand):
    m={name:np.asarray(value,dtype=float) for name,value in data['matrices'].items()}
    spine=m['spine_pose']@np.linalg.inv(m['spine_rest'])
    shoulder=(spine@m['upper_rest'])[:3,3];wrist=np.asarray(hand)[:3,3]
    axis=wrist-shoulder;distance=np.linalg.norm(axis);axis/=distance
    a=np.linalg.norm(m['forearm_rest'][:3,3]-m['upper_rest'][:3,3])
    b=np.linalg.norm(m['hand_rest'][:3,3]-m['forearm_rest'][:3,3])
    centre=shoulder+axis*(a*a-b*b+distance*distance)/(2*distance)
    source=(spine@m['forearm_rest'])[:3,3]-centre;source-=axis*(source@axis);source/=np.linalg.norm(source)
    actual=np.asarray(forearm)[:3,3]-centre;actual-=axis*(actual@axis);actual/=np.linalg.norm(actual)
    swivel=math.atan2(axis@np.cross(source,actual),source@actual)
    zero=coupled_frames(data,hand,swivel,0.)
    upper_axis=zero['elbow']-zero['shoulder'];upper_axis/=np.linalg.norm(upper_axis)
    delta=np.asarray(upper)[:3,:3]@np.linalg.inv(zero['targets']['upper_arm'][:3,:3])
    sine=upper_axis@np.array([delta[2,1]-delta[1,2],delta[0,2]-delta[2,0],delta[1,0]-delta[0,1]])/2
    roll=math.atan2(sine,(np.trace(delta)-1)/2)
    result=coupled_frames(data,hand,swivel,roll)
    errors={name:float(np.abs(result['targets'][name]-np.asarray(value)).max())
            for name,value in [('upper_arm',upper),('forearm',forearm),('hand',hand)]}
    return dict(swivel=swivel,roll=roll,errors=errors,result=result)
