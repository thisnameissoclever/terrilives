"""Whole-polygon guards for a fixed-spine sleeve's measured affine motion.

Recovered vectors are relative moving components, not independent skin weights.
Every certificate is conditional on the stated frame and model-error contract.
"""
import itertools
import math
import numpy as np

MODEL_EPS=1e-6
FRAME_EPS=1e-5


def recover_motion(reference_points,reference_frame,frames,points):
    inverse=np.linalg.inv(reference_frame[:3,:3])
    operators=[frame[:3,:3]@inverse-np.eye(3) for frame in frames]
    design=np.concatenate(operators,axis=0)
    observations=np.concatenate([(point-reference_points).T for point in points],axis=0)
    coefficients,residuals,rank,singular=np.linalg.lstsq(design,observations,rcond=None)
    if rank!=3:raise ValueError('Relative moving component is not identifiable')
    moving=coefficients.T
    training=np.asarray([np.linalg.norm(reference_points+moving@operator.T-point,axis=1) for operator,point in zip(operators,points)])
    leave_one=[];leave_ranks=[];leave_controls=[]
    for excluded in range(len(frames)):
        selected=[i for i in range(len(frames)) if i!=excluded]
        a=np.concatenate([operators[i] for i in selected]);b=np.concatenate([(points[i]-reference_points).T for i in selected])
        fitted,_,r,sigma=np.linalg.lstsq(a,b,rcond=None);leave_ranks.append(int(r))
        if r!=3:raise ValueError('Leave-one-out moving component loses identifiability')
        held_error=np.linalg.norm(reference_points+fitted.T@operators[excluded].T-points[excluded],axis=1)
        leave_one.append(held_error)
        fit_error=max(float(np.linalg.norm(reference_points+fitted.T@operators[i].T-points[i],axis=1).max()) for i in selected)
        uncertainty=2*math.sqrt(len(selected))*MODEL_EPS/float(sigma[-1])
        prediction_bound=2*MODEL_EPS+float(np.linalg.norm(operators[excluded],2))*uncertainty
        valid=fit_error<=MODEL_EPS and float(held_error.max())<=prediction_bound
        leave_controls.append(dict(excluded_probe=excluded,rank=int(r),minimum_singular_value=float(sigma[-1]),
            calibration_max_error=fit_error,prediction_max_error=float(held_error.max()),prediction_error_bound=prediction_bound,passed=valid))
    if float(training.max())>MODEL_EPS:raise ValueError('Affine calibration exceeds the unchanged one-micrometre residual limit')
    if not all(row['passed'] for row in leave_controls):raise ValueError('Leave-out result exceeds its propagated uncertainty')
    origin_error=max(float(np.linalg.norm(frame[:3,3]-reference_frame[:3,3])) for frame in frames)
    if origin_error>MODEL_EPS:raise ValueError('Upper-arm origin was not fixed in the cached experiment')
    cap=max(float(np.linalg.norm(operator,2)) for operator in operators)
    # Bound coefficient sensitivity to a MODEL_EPS observation error at each
    # end of each measured displacement. This is a conditional error contract.
    coefficient_uncertainty=2*math.sqrt(len(frames))*MODEL_EPS/float(singular[-1])
    length=np.linalg.norm(moving,axis=1)
    frame_uncertainty=3*FRAME_EPS*np.linalg.norm(inverse,2)*length+2*math.sqrt(3)*FRAME_EPS
    error_reserve=2*MODEL_EPS+cap*coefficient_uncertainty+frame_uncertainty
    displacement=cap*(length+coefficient_uncertainty)+2*MODEL_EPS+2*math.sqrt(3)*FRAME_EPS
    return dict(reference=reference_points,moving=moving,reference_frame=reference_frame,
                rank=int(rank),singular_values=singular,training_max=float(training.max()),
                leave_one_out_max=float(np.max(leave_one)),leave_one_out_ranks=leave_ranks,leave_one_out_controls=leave_controls,
                upper_origin_error=origin_error,operator_cap=cap,coefficient_uncertainty=coefficient_uncertainty,
                error_reserve=error_reserve,displacement_radius=displacement)


def predict(model,frame):
    operator=frame[:3,:3]@np.linalg.inv(model['reference_frame'][:3,:3])-np.eye(3)
    origin=float(np.linalg.norm(frame[:3,3]-model['reference_frame'][:3,3]))
    inside=float(np.linalg.norm(operator,2))<=model['operator_cap']+1e-8 and origin<=MODEL_EPS
    return model['reference']+model['moving']@operator.T,inside


def polygons(topology,name):
    offsets=topology[name+'/rest_polygon_offsets'];vertices=topology[name+'/rest_polygon_vertices']
    return [vertices[offsets[i]:offsets[i+1]] for i in range(len(offsets)-1)]


def potential_pairs(first,second,first_polygons,second_polygons,maximum=50000):
    def bounds(model,faces):
        p=model['reference'];r=model['displacement_radius'][:,None]
        return np.asarray([(p[ids]-r[ids]).min(0) for ids in faces]),np.asarray([(p[ids]+r[ids]).max(0) for ids in faces])
    al,ah=bounds(first,first_polygons);bl,bh=bounds(second,second_polygons)
    result=[]
    for ai in range(len(al)):
        hits=np.flatnonzero(np.all(bh>=al[ai],axis=1)&np.all(bl<=ah[ai],axis=1))
        result.extend((ai,int(bi)) for bi in hits)
        if len(result)>maximum:raise RuntimeError('Declared cached polygon-pair budget exhausted')
    return result


def separating_plane(first,second):
    axes=[]
    for points in (first,second):
        for i,j,k in itertools.combinations(range(len(points)),3):axes.append(np.cross(points[j]-points[i],points[k]-points[i]))
    first_edges=[first[j]-first[i] for i,j in itertools.combinations(range(len(first)),2)]
    second_edges=[second[j]-second[i] for i,j in itertools.combinations(range(len(second)),2)]
    axes.extend(np.cross(a,b) for a in first_edges for b in second_edges)
    axes=np.asarray(axes);length=np.linalg.norm(axes,axis=1);axes=axes[length>1e-12]/length[length>1e-12,None]
    if not len(axes):raise ValueError('Degenerate source polygon')
    a=first@axes.T;b=second@axes.T
    forward=a.min(0)-b.max(0);backward=b.min(0)-a.max(0)
    i=int(np.argmax(np.maximum(forward,backward)))
    normal=axes[i] if forward[i]>=backward[i] else -axes[i]
    gap=float(max(forward[i],backward[i]))
    return normal,gap


def polygon_gap(first,second,normal):return float(np.min(first@normal)-np.max(second@normal))


def certifies(gap,reserve):return gap>reserve
