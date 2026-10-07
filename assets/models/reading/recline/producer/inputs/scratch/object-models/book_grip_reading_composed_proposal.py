"""Compose one causal proposal from source controls; no search or acceptance shortcut."""
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
from book_grip_reading_service import ReadingPoseInput
from sofa_contact_solver_frames import coupled_frames
from sofa_arm_frame_math import rotation_between


def run(root,reference_file,output):
    output.mkdir(parents=True,exist_ok=False)
    reference=json.loads(reference_file.read_text());p=reference['parameters'];context=ReadingPoseInput(root)
    source=context.source_cache;canonical=np.load(root/'book-grip-original-replay-01/reopened.npz')
    if np.max(np.abs(context.source_world-np.eye(4)))>1e-12:raise ValueError('This static composition is defined in the recorded original rig frame')
    eyes=np.mean([source['Eye white'+suffix+'/points'].mean(0) for suffix in ('','.001')],0)
    directions=[]
    for suffix in ('','.001'):
        _,axes=np.linalg.eigh(np.cov(source['Dark pupil'+suffix+'/points'].T));n=axes[:,0];directions.append(-n if n[1]>0 else n)
    gaze=np.mean(directions,0);gaze/=np.linalg.norm(gaze)
    center=np.mean([canonical['Reading book pages'+suffix+'/points'].mean(0) for suffix in ('','.001')],0)
    rotation=np.asarray(p['grasp_transform'])[:3,:3]
    grasp_names=[name for name in context.source if name.startswith(('Reading book','Printed book line','Relaxed palm','Resting thumb'))]
    offsets=np.concatenate([(canonical[name+'/points']-center)@rotation.T for name in grasp_names])
    head_names=[name for name in context.source if context.groups[name]==['head']]
    head=np.concatenate([source[name+'/points'] for name in head_names])
    torso=[name for name in context.source if name.startswith(('Overshirt body','Shirt','One sewn','Folded fabric collar','Small horn button','Collar stand'))]
    front=min(float(source[name+'/points'][:,1].min()) for name in torso)
    lap=max(float(source['Tailored trouser leg'+suffix+'/points'][:,2].max()) for suffix in ('','.001'))
    # Two established spatial replay bounds provide a numerical placement guard.
    # The collision/attachment acceptance thresholds do not change.
    guard=2e-5;low=0.;high=float('inf');constraints=[]
    head_bound=float(np.max((head-eyes)@gaze)-np.min(offsets@gaze)+guard)
    low=max(low,head_bound);constraints.append(dict(name='source_rigid_head_envelope',minimum_distance=head_bound))
    if gaze[1]>=0 or gaze[2]>=0:raise ValueError('Recorded source gaze does not define the expected forward/downward ray')
    front_bound=(front-eyes[1]-float(offsets[:,1].max())-guard)/gaze[1]
    lap_bound=(lap-eyes[2]-float(offsets[:,2].min())+guard)/gaze[2]
    low=max(low,front_bound);high=min(high,lap_bound)
    constraints += [dict(name='whole_grasp_in_front_of_torso',minimum_distance=front_bound),dict(name='whole_grasp_above_lap',maximum_distance=lap_bound)]
    lengths={}
    for side in ('L','R'):
        a=np.linalg.norm(context.rest_frames['forearm.'+side][:3,3]-context.rest_frames['upper_arm.'+side][:3,3])
        b=np.linalg.norm(context.rest_frames['hand.'+side][:3,3]-context.rest_frames['forearm.'+side][:3,3]);lengths[side]=(a,b)
        offset=rotation@(context.canonical['hand.'+side][:3,3]-center)
        delta=eyes+offset-context.source_frames['upper_arm.'+side][:3,3]
        along=float(delta@gaze);disc=along*along+(a+b-guard)**2-float(delta@delta)
        if disc<0:raise ValueError('Source-directed readable ray misses an unchanged arm reach sphere')
        lo,hi=-along-math.sqrt(disc),-along+math.sqrt(disc)
        low=max(low,lo);high=min(high,hi);constraints.append(dict(name='reach_'+side,interval=[lo,hi],inner_radius=float(abs(a-b)),outer_radius=float(a+b)))
    if not low<high:raise ValueError('The analytical causal construction has no simultaneous ray interval')
    preferred=float((center-eyes)@gaze);distance=float(np.clip(preferred,low,high))
    target=eyes+distance*gaze;grasp=np.eye(4);grasp[:3,:3]=rotation;grasp[:3,3]=target-rotation@center
    params=dict(grasp_transform=grasp.tolist(),head_relative_rotation=np.eye(3).tolist(),spine_rotation=np.eye(3).tolist(),arms={})
    arm_records=[]
    for side in ('L','R'):
        data=dict(matrices=dict(spine_pose=context.source_frames['spine'],spine_rest=context.rest_frames['spine'],
            upper_rest=context.rest_frames['upper_arm.'+side],forearm_rest=context.rest_frames['forearm.'+side],hand_rest=context.rest_frames['hand.'+side]))
        hand=grasp@context.canonical['hand.'+side]
        reference_zero=coupled_frames(data,hand,0.,0.);axis=reference_zero['wrist']-reference_zero['shoulder'];axis/=np.linalg.norm(axis)
        circle=reference_zero['shoulder']+axis*np.dot(reference_zero['elbow']-reference_zero['shoulder'],axis)
        base=reference_zero['elbow']-circle;wanted=context.source_frames['forearm.'+side][:3,3]-circle;wanted-=axis*(wanted@axis)
        swivel=math.atan2(float(axis@np.cross(base,wanted)),float(base@wanted))
        zero=coupled_frames(data,hand,swivel,0.)
        upper_axis=zero['elbow']-zero['shoulder'];upper_axis/=np.linalg.norm(upper_axis)
        source_vector=context.source_frames['forearm.'+side][:3,3]-context.source_frames['upper_arm.'+side][:3,3]
        transported=rotation_between(source_vector,upper_axis)@context.source_frames['upper_arm.'+side][:3,:3]
        a=zero['targets']['upper_arm'][:3,0].copy();b=transported[:,0].copy();a-=upper_axis*(a@upper_axis);b-=upper_axis*(b@upper_axis)
        roll=math.atan2(float(upper_axis@np.cross(a,b)),float(a@b));solved=coupled_frames(data,hand,swivel,roll)
        params['arms'][side]=dict(swivel=swivel,upper_arm_roll=roll)
        arm_records.append(dict(side=side,source_elbow=context.source_frames['forearm.'+side][:3,3].tolist(),
            proposed_elbow=solved['elbow'].tolist(),wrist=solved['wrist'].tolist(),source_lengths=solved['source_lengths'],
            scalar_blend_diagnostics=solved['blend_minimum_singular_values'],
            rule='Nearest demonstrated source elbow branch, complete source upper-arm frame transported by its required swing; no per-arm angle-cost optimizer or skin acceptance'))
    frames=context.construct(params)
    receipt=dict(schema_version=1,parameters=params,causal_targets=['head_collar','both_arms','page_visibility'],
        rationale='Deliberately composed causal control, not a fit: restore the demonstrated source-relative head/neck state; preserve the current grasp orientation for this experiment; move the common grasp into the source viewing region at the nearest admissible source departure; derive both arm branches from the previously clear source elbows. Only the shared complete actual evaluator can select it.',
        source_head_control='Head and spine return to their recorded source frames; neck reproduction follows its unchanged source influences, not a rigid-neck approximation.',
        readable_region='The paired pages are centered in the binocular viewing field as an authoring preference. The gate accepts visible finite page/text hits, never exact center fixation.',
        orientation_policy='Reference grasp orientation retained for causal isolation in this experiment only; the interface permits full grasp yaw, pitch and roll.',
        constraints=constraints,admissible_ray_interval=[low,high],preferred_ray_distance=preferred,chosen_ray_distance=distance,
        numerical_positioning_guard=guard,page_midpoint=target.tolist(),gaze=gaze.tolist(),
        page_front_cosine=float((rotation@context.canonical['book'][:3,1])@(-gaze)),
        arm_construction=arm_records,constructed_frames={n:m.tolist() for n,m in frames.items()},
        acceptance='UNSELECTED. No new actual skin evaluation, fitting loop or render. Reference/proposal comparison must expose all new violations and cannot accept a lower failure count.')
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    inputs=dict(json.loads((root/'book-grip-reading-interface-01/proof.json').read_text())['inputs'])
    for path in (Path(__file__),reference_file):inputs[str(path.resolve())]=digest(path)
    receipt['inputs']=inputs
    if not all(digest(Path(p))==sha for p,sha in inputs.items()):raise ValueError('A frozen proposal dependency changed')
    (output/'proposal-parameters.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:receipt[k] for k in ('admissible_ray_interval','chosen_ray_distance','page_midpoint','page_front_cosine','arm_construction','acceptance')},indent=2))


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
