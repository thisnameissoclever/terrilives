"""Source-departure preferences that never convert a hard failure into acceptance."""
import math
import numpy as np
from book_grip_reading_service import eligible_for_preference
from sofa_arm_frame_math import angle_degrees


def preferences(evaluation,parameters,context):
    if not eligible_for_preference(evaluation):return None
    actual={n:np.asarray(m) for n,m in evaluation['evaluated_frames'].items()}
    names=['spine','head','book']+[part+'.'+side for side in ('L','R') for part in ('upper_arm','forearm','hand')]
    rotations=sum(angle_degrees(actual[n][:3,:3],context.canonical[n][:3,:3]) for n in names)
    movement=sum(float(np.linalg.norm(actual[n][:3,3]-context.canonical[n][:3,3])) for n in names)
    rays=[r for r in evaluation['rows'] if r['kind']=='visible_page_ray']
    incidence=max(math.degrees(math.acos(float(np.clip(r['printed_front_cosine'],-1,1)))) for r in rays)
    return dict(source_frame_rotation_sum_degrees=rotations,source_origin_displacement_metres=movement,
        page_incidence_degrees=incidence,rule='Compare only fully feasible states. Smaller source departure and clearer page presentation are separate preferences; no surplus-clearance reward or failure-count tradeoff.')


def pareto_feasible(entries,context):
    values=[]
    for entry in entries:
        p=preferences(entry['evaluation'],entry['parameters'],context)
        if p is not None:values.append((entry,p))
    keys=('source_frame_rotation_sum_degrees','source_origin_displacement_metres','page_incidence_degrees')
    return [dict(entry=entry,preferences=p) for entry,p in values if not any(
        all(q[k]<=p[k] for k in keys) and any(q[k]<p[k] for k in keys) for other,q in values if other is not entry)]
