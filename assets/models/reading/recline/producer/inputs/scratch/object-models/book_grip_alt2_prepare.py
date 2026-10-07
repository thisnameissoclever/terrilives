"""Prepare one coupled static proposal from measured gaze, reach and clearance domains."""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time

os.environ['OPENBLAS_NUM_THREADS']='1'
os.environ['OMP_NUM_THREADS']='1'
import numpy as np
from scipy.optimize import minimize

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import sofa_contact_solver_frames as construction
import sofa_arm_frame_math as frame_math


def run(output):
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic()
    receipt=HERE/'book-grip-original-replay-01/proof.json';prior=json.loads(receipt.read_text())
    domain=json.loads((HERE/'book-grip-alt2-domain-design-01/proof.json').read_text())
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    inputs=dict(domain['inputs'])
    for p in (Path(__file__),receipt,HERE/'book-grip-original-replay-01/reopened.npz'):
        inputs[str(p.resolve())]=digest(p)
    if not all(digest(Path(p))==sha for p,sha in inputs.items()):raise ValueError('A frozen preparation dependency changed')
    cache=np.load(HERE/'book-grip-original-replay-01/reopened.npz')
    f={n:np.asarray(m) for n,m in prior['candidate_state']['bone_matrices'].items()}
    rest={b['name']:np.asarray(b['matrix']) for b in next(iter(prior['raw_source_identity']['bones'].values()))}
    names=[key[:-len('/points')] for key in cache.files if key.endswith('/points')]
    grasp_names=[n for n in names if n.startswith(('Reading book','Printed book line','Relaxed palm','Resting thumb'))]
    grasp=np.concatenate([cache[n+'/points'] for n in grasp_names])
    focus=cache['Reading book pages/points'].mean(0)
    eyes=np.mean([cache['Eye white'+suffix+'/points'].mean(0) for suffix in ('','.001')],0)
    pupil_normals=[]
    for suffix in ('','.001'):
        _,basis=np.linalg.eigh(np.cov(cache['Dark pupil'+suffix+'/points'].T));g=basis[:,0]
        pupil_normals.append(-g if g[1]>0 else g)
    gaze=np.mean(pupil_normals,0);gaze/=np.linalg.norm(gaze)
    head_names=[n for n in names if prior['raw_source_identity']['meshes'][n]['groups']==['head']]
    head=np.concatenate([cache[n+'/points'] for n in head_names])
    head_front=float(np.max((head-eyes)@gaze))
    neck=f['head'][:3,3]
    source_book_rotation=frame_math.proper_rotation(f['book'][:3,:3])
    torso_front=domain['coarse_clearance_domain']['torso_front'];lap_top=domain['coarse_clearance_domain']['lap_top']
    lengths={s:[float(np.linalg.norm(rest[b+'.'+s][:3,3]-rest[a+'.'+s][:3,3])) for a,b in (('upper_arm','forearm'),('forearm','hand'))] for s in ('L','R')}
    calls=0
    def budget():
        nonlocal calls
        calls+=1
        if calls>2500 or time.monotonic()-began>30:raise TimeoutError('Declared thirty-second numerical preparation budget exhausted')
    def state(x):
        pitch,yaw,inclination,distance=x[:4]
        rh=construction.rotation([0,0,1],yaw)@construction.rotation([1,0,0],pitch)
        e=neck+rh@(eyes-neck);g=rh@gaze
        normal=np.asarray([0.,math.sin(inclination),math.cos(inclination)])
        target=np.column_stack(([1.,0.,0.],normal,np.cross([1.,0.,0.],normal)))
        rg=target@source_book_rotation.T
        target_focus=e+distance*g
        translation=target_focus-rg@focus
        gp=grasp@rg.T+translation
        transform=np.eye(4);transform[:3,:3]=rg;transform[:3,3]=translation
        head_transform=np.eye(4);head_transform[:3,:3]=rh;head_transform[:3,3]=neck-rh@neck
        constraints=[torso_front-float(gp[:,1].max())-1e-6,float(gp[:,2].min())-lap_top-1e-6,
            float(np.min((gp-e)@g))-head_front-1e-6,float((e-target_focus)@normal)-1e-6]
        reach={}
        for side in ('L','R'):
            hand=transform@f['hand.'+side];d=float(np.linalg.norm(hand[:3,3]-f['upper_arm.'+side][:3,3]));upper,lower=lengths[side]
            constraints.extend([upper+lower-d-1e-6,d-abs(upper-lower)-1e-6]);reach[side]=d
        return dict(grasp_transform=transform,head_transform=head_transform,eye=e,gaze=g,page_normal=normal,focus=target_focus,
                    margins=np.asarray(constraints),reach=reach)
    def constraints(x):
        budget();return state(x)['margins']-x[4]
    # Source-directed head yaw, the level-page boundary and the midpoint of the
    # declared downward head interval initialize a continuous solve, not a grid.
    start=np.asarray([math.pi/4,0.,0.,.2,0.])
    initial=state(start)
    # Ray distance is bounded by the arm reach plus the measured eye/hand/neck
    # offsets through the triangle inequality, not by a guessed book offset.
    max_distance=max(sum(lengths[s])+np.linalg.norm(neck-f['upper_arm.'+s][:3,3])+np.linalg.norm(eyes-neck)+np.linalg.norm(f['hand.'+s][:3,3]-focus) for s in ('L','R'))
    fit=minimize(lambda x:-x[4],start,method='SLSQP',bounds=[(0,math.pi/2),(-math.pi/2,math.pi/2),(0,math.pi/2),(0,max_distance),(0,.5)],
        constraints=[dict(type='ineq',fun=constraints)],options=dict(maxiter=160,ftol=1e-10,disp=False))
    chosen=state(fit.x)
    report=dict(state='running',inputs=inputs,scope='One numerical static proposal; source geometry and actions untouched; actual Blender skin/contact acceptance still required',
        objective='Maximize the smallest geometric margin in metres across reach, torso, lap, gaze-front and complete rigid-head/grasp separation; no collision can be traded against another score',
        focus=dict(source_part='Reading book pages',source_point=focus.tolist(),meaning='Center of the actual left page, rather than the spine gap'),
        fixed_head_parts=head_names,head_forward_envelope=head_front,
        optimizer=dict(success=bool(fit.success),message=str(fit.message),iterations=fit.nit,parameters=fit.x.tolist(),constraint_calls=calls),
        proposal=dict(head_pitch_degrees=math.degrees(fit.x[0]),head_yaw_degrees=math.degrees(fit.x[1]),page_inclination_toward_reader_degrees=math.degrees(fit.x[2]),
            eye_to_page_distance=float(fit.x[3]),common_margin=float(fit.x[4]),margins=chosen['margins'].tolist(),reach=chosen['reach'],
            transformed_eye=chosen['eye'].tolist(),gaze=chosen['gaze'].tolist(),reading_point=chosen['focus'].tolist(),page_normal=chosen['page_normal'].tolist()),
        arm_constructions=[])
    if not fit.success or chosen['margins'].min()<1e-7:
        report['state']='rejected_kinematic_domain'
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        raise ValueError('The one continuous coupled domain solve did not establish a feasible proposal')
    targets={n:m.copy() for n,m in f.items()}
    targets['book']=chosen['grasp_transform']@f['book'];targets['head']=chosen['head_transform']@f['head']
    for side in ('L','R'):
        data=dict(matrices=dict(spine_pose=f['spine'].tolist(),spine_rest=rest['spine'].tolist(),upper_rest=rest['upper_arm.'+side].tolist(),
            forearm_rest=rest['forearm.'+side].tolist(),hand_rest=rest['hand.'+side].tolist()))
        hand=chosen['grasp_transform']@f['hand.'+side]
        # The source elbow chooses the swivel branch by nearest projection onto
        # the unchanged-length reach circle; full frames choose roll afterward.
        base=construction.coupled_frames(data,hand,0.,0.)
        axis=base['wrist']-base['shoulder'];axis/=np.linalg.norm(axis)
        center=base['shoulder']+axis*np.dot(base['elbow']-base['shoulder'],axis)
        a=base['elbow']-center;b=f['forearm.'+side][:3,3]-center;b-=axis*(axis@b)
        swivel=math.atan2(float(axis@np.cross(a,b)),float(a@b))
        def arm_objective(x):
            budget();solution=construction.coupled_frames(data,hand,float(x[0]),float(x[1]))
            deform=[solution['targets'][n]@np.linalg.inv(rest[n+'.'+side]) for n in ('upper_arm','forearm','hand')]
            spine=f['spine']@np.linalg.inv(rest['spine'])
            angles=[math.radians(frame_math.angle_degrees(u[:3,:3],v[:3,:3])) for u,v in zip([spine,*deform[:-1]],deform)]
            return sum(a*a for a in angles)
        arm=minimize(arm_objective,[swivel,0.],method='SLSQP',bounds=[(swivel-math.pi,swivel+math.pi),(-math.pi,math.pi)],options=dict(maxiter=80,ftol=1e-10))
        if not arm.success:raise ValueError('Full-frame arm proposal did not converge: '+side)
        solution=construction.coupled_frames(data,hand,float(arm.x[0]),float(arm.x[1]))
        for name,matrix in solution['targets'].items():targets[name+'.'+side]=matrix
        report['arm_constructions'].append(dict(side=side,source_swivel_branch=swivel,swivel=float(arm.x[0]),upper_arm_roll=float(arm.x[1]),
            objective=float(arm.fun),iterations=arm.nit,blend_diagnostic=solution['blend_minimum_singular_values'],
            shoulder=solution['shoulder'].tolist(),elbow=solution['elbow'].tolist(),wrist=solution['wrist'].tolist(),
            source_lengths=solution['source_lengths'],full_frame_gate='Actual shoulder/elbow/wrist surfaces remain mandatory; these scalar diagnostics are not acceptance'))
    report['target_frames']={name:matrix.tolist() for name,matrix in targets.items()}
    report['grasp_transform']=chosen['grasp_transform'].tolist();report['head_transform']=chosen['head_transform'].tolist()
    report['state']='prepared';report['elapsed_seconds']=time.monotonic()-began
    report['inputs_unchanged']=all(digest(Path(p))==sha for p,sha in inputs.items())
    if not report['inputs_unchanged']:raise ValueError('A preparation input changed')
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:report[key] for key in ('state','proposal','arm_constructions','elapsed_seconds')},indent=2))


if __name__=='__main__':run(Path(sys.argv[1]))
