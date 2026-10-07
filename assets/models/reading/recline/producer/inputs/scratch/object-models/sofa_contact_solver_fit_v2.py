"""One bounded, witness-guided phase-zero coupled sofa-arm fit."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import numpy as np
import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).parent))
from sofa_contact_solver_scene_v2 import SceneEvaluatorV2, surface_data, retained
from sofa_contact_solver_frames import coupled_frames, rotation
from derive_lap_support_adjustment import minimum_gap

LIMIT=38
SECONDS=1698
WORK_SECONDS=1668
ORDER=((1,'L'),(0,'L'),(2,'R'),(1,'R'))


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def arm_name(name,side):
    return name.startswith(retained.shared.ARM_PARTS) and name.endswith('.001')==(side=='R')


def key(row):
    return (row['kind'],str(row.get('seat',row.get('seats',''))),tuple(row.get('parts',())),row.get('part',''),row.get('side',''))


def active_rows(result,seat,side):
    return [r for r in result['rows'] if not r['valid'] and r.get('seat')==seat
            and any(arm_name(n,side) for n in r.get('parts',[]))]


def merit(result,seat,side):return sum(float(r.get('residual',1.)) for r in active_rows(result,seat,side))


from sofa_contact_solver_domain_v2 import ArmDomain
from sofa_contact_solver_adaptive import linearize


def separating_target(owner,row,classifier,geometry):
    first,second=row['parts'];source=classifier.rest[first+'/rest_points']
    if first.startswith('Relaxed shirt sleeve'):
        # Exclude the demonstrated proximal shoulder material from the rigid
        # predictor. These distal source vertices are purely upper-arm-bound.
        neutral=next(r for r in classifier.neutral['cases'] if r['name']==first)
        source=source[source[:,2]<neutral['bounds'][0][2]]
    if not first.startswith(('Turned sleeve cuff','Relaxed shirt sleeve')):
        raise ValueError('Limiting contact is outside the source rigid upper-arm predictor')
    target=np.asarray(owner[second].points);actual=np.asarray(owner[first].points)
    if first.startswith('Relaxed shirt sleeve'):
        rest=classifier.rest[first+'/rest_points'];actual=actual[rest[:,2]<neutral['bounds'][0][2]]
    _,axes=np.linalg.eigh(np.cov(target.T))
    choices=[]
    for axis in axes.T:
        for sign in (-1,1):
            normal=axis*sign;gap=float((target@normal).max()-(actual@normal).min())
            if gap>1e-6:choices.append((gap,normal))
    if not choices:raise ValueError('No positive measured separating interval')
    gap,normal=min(choices,key=lambda value:value[0])
    return source,normal,float((target@normal).max()),dict(parts=row['parts'],gap=gap,normal=normal.tolist(),
             mechanism='Smallest positive separating interval along actual target principal face axes; rigid distal source material only')


def run(root,output):
    if not bpy.app.background:raise ValueError('Background Blender required')
    output.mkdir(exist_ok=False,parents=True);began=time.monotonic()
    controls=json.loads((root/'sofa-contact-solver-controls-scene-02/proof.json').read_text())
    if not controls['retained_scene_control_passed'] or not controls['exact_reuse_preserved_rows_and_arrays']:raise ValueError('Complete controls required')
    resumed=json.loads((root/'sofa-contact-solver-fit-01/proof.json').read_text())
    checkpoint=resumed['evaluations'][1]
    adaptive=json.loads((root/'sofa-contact-solver-adaptive-controls-01/proof.json').read_text())
    placement=json.loads((root/'sofa-contact-solver-placement-controls-01/proof.json').read_text())
    if not adaptive['passed'] or not placement['passed']:raise ValueError('Corrected parameterization controls required')
    inputs=dict(resumed['inputs']);inputs.update(adaptive['inputs']);inputs.update(placement['inputs'])
    for path,sha in inputs.items():
        if digest(path)!=sha:raise ValueError('Immutable dependency changed: '+path)
    for path in [Path(__file__),root/'sofa_contact_solver_domain_v2.py',root/'sofa_contact_solver_adaptive.py',root/'sofa_contact_solver_placement.py',
                 root/'sofa-contact-solver-fit-01/proof.json',root/'sofa-contact-solver-fit-01/candidate-001.npz',
                 root/'sofa-contact-solver-adaptive-controls-01/proof.json',root/'sofa-contact-solver-placement-controls-01/proof.json']:
        inputs[str(path.resolve())]=digest(path)
    report=dict(state='running',pid=os.getpid(),inputs=inputs,limits=dict(evaluations=LIMIT,seconds=SECONDS,threads=2),
                evaluations=[],updates=[],candidate_evaluations=0,acceptance=False,
                resumed_budget=dict(original_limit=48,calibrated_total_limit=40,prior_evaluations=2,prior_wall_seconds=102,remaining_evaluations=38,remaining_seconds=1698),
                remaining=['Phase-zero opposing and whole-sofa views','Canonical repaired book grip and mixed actions','All shared phases','Owner visual approval'])
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        binding=json.loads((root/'sofa-derived-binding-03/proof.json').read_text())
        source=json.loads((root/'sofa-resting-clearance-01/proof.json').read_text())
        hands=json.loads((root/'sofa-hand-support-01/proof.json').read_text())
        old=json.loads((root/'sofa-coherent-arms-02/proof.json').read_text())
        rigs,bodies,furniture,origins=retained.shared.load_scene(root/'sofa-derived-binding-03',binding)
        retained.shared.pose(rigs,origins,'sit',0.)
        current_frames=[{n:np.asarray(v) for n,v in frame.items()} for frame in checkpoint['frames']]
        for rig,frames in zip(rigs,current_frames):retained.apply_frames(rig,frames)
        owners=retained.torso.surfaces(bodies)
        reference=np.load(root/'sofa-contact-solver-fit-01/candidate-001.npz')
        for seat,owner in enumerate(owners):
            for name,surface in owner.items():
                assert np.array_equal(np.asarray(surface.points),reference[f'candidate/{seat}/{name}/points']),(seat,name,'initial point identity')
                assert np.array_equal(np.asarray(surface.triangles),reference[f'candidate/{seat}/{name}/triangles']),(seat,name,'initial topology identity')
        evaluator=SceneEvaluatorV2(root,rigs,bodies,furniture,hands,[{n:surface_data(s) for n,s in owner.items()} for owner in owners])
        domains={}
        for seat,side in ORDER:
            data=next(r['inputs'] for r in old['frames'] if r['seat']==seat and r['side']==side)
            measurement=next(r['measurement'] for r in hands['hands'] if r['seat']==seat and r['side']==side)
            domains[seat,side]=ArmDomain(seat,side,rigs[seat],data,owners[seat],evaluator.classifier,measurement)
        if domains[1,'L'].needs_reference:raise ValueError('Measured checkpoint did not reconstruct within 1e-5')
        report['domains']=[dict(seat=d.seat,side=d.side,xy_bounds=[d.low.tolist(),d.high.tolist()],upper_facing_search_triangles=d.exposed,palm_radius=d.palm_radius,reference_frame_errors=d.reference_errors,new_reference_required=d.needs_reference,
                               tilt_radians=d.tilt,yaw_swivel_roll_radians=[-math.pi,math.pi],initial_parameters=d.q.tolist()) for d in domains.values()]
        current=copy.deepcopy(checkpoint);current_arrays={k:v for k,v in reference.items()}
        bad_keys={key(row) for row in current['failures']};costs=[];streak=0;last_hard=None;effective_limit=LIMIT
        def evaluate(domain,solution,update,backtrack):
            nonlocal effective_limit
            if len(report['evaluations'])>=effective_limit or time.monotonic()-began>=WORK_SECONDS:raise TimeoutError('Declared fit budget exhausted')
            start=time.monotonic();arrays={};frames=[dict(f) for f in current_frames]
            frames[domain.seat].update(solution['frames']);error=0.
            report['pending_candidate']=dict(index=len(report['evaluations']),seat=domain.seat,side=domain.side,
                parameters=solution['q'].tolist(),frames=[{n:m.tolist() for n,m in f.items()} for f in frames])
            save()
            for rig,frame in zip(rigs,frames):error=max(error,retained.apply_frames(rig,frame))
            result=evaluator.evaluate(arrays,'candidate',error,began+WORK_SECONDS)
            elapsed=time.monotonic()-start;costs.append(elapsed)
            number=len(report['evaluations']);filename=f'candidate-{number:03d}.npz';np.savez(output/filename,**arrays)
            record=dict(index=number,seat=domain.seat,side=domain.side,parameters=solution['q'].tolist(),
                        elapsed_seconds=elapsed,update=update,backtrack=backtrack,frames=[{n:m.tolist() for n,m in f.items()} for f in frames],
                        blend_diagnostics=solution['blend_minimum_singular_values'],cache=filename,cache_sha256=digest(output/filename),**result)
            report['evaluations'].append(record);report['candidate_evaluations']=len(report['evaluations'])
            report.pop('pending_candidate',None)
            if len(costs)==2:
                reserve=max(costs)*1.1
                effective_limit=min(LIMIT,len(costs)+max(0,int((WORK_SECONDS-(time.monotonic()-began))/reserve)))
                report['changed_scene_cost_calibration']=dict(seconds=costs.copy(),effective_evaluation_limit=effective_limit,planning_seconds_per_candidate=reserve)
            save()
            print(json.dumps(dict(event='candidate',index=number,seat=domain.seat,side=domain.side,seconds=elapsed,
                                  valid=result['valid'],active_residual=merit(result,domain.seat,domain.side),failures=[dict(kind=r['kind'],seat=r.get('seat'),parts=r.get('parts'),part=r.get('part')) for r in result['failures']])),flush=True)
            return record,arrays,frames
        no_progress=0;trust=.125;updates=0
        while len(report['evaluations'])<effective_limit and time.monotonic()-began<WORK_SECONDS:
            if current['valid']:
                report['acceptance']=True;report['state']='phase_zero_survivor';report['selected']=current;break
            remaining=[pair for pair in ORDER if active_rows(current,*pair)]
            if not remaining:report['stop_reason']='Remaining failures cannot be corrected by the declared lap-arm domain';break
            pair=remaining[0] if updates==0 else max(remaining,key=lambda pair:merit(current,*pair))
            domain=domains[pair]
            if domain.needs_reference:
                reference_solution=domain.construct(domain.q)
                result,arrays,frames=evaluate(domain,reference_solution,'new coherent reference',0)
                fresh=[r for r in result['failures'] if key(r) not in bad_keys]
                report.setdefault('reference_evaluations',[]).append(dict(seat=domain.seat,side=domain.side,candidate=result['index'],
                    prior_frame_errors=domain.reference_errors,new_hard_failures=[key(r) for r in fresh]))
                if fresh:
                    report['stop_reason']='New coherent reference has a new hard failure; it is not an unchanged baseline'
                    for rig,frame in zip(rigs,current_frames):retained.apply_frames(rig,frame)
                    break
                current,current_arrays,current_frames=result,arrays,frames
                domain.q=reference_solution['q'];domain.needs_reference=False;bad_keys={key(r) for r in current['failures']}
                save()
            rows=active_rows(current,*pair)
            if not rows:continue
            priority=lambda r:(0 if r['parts'][0].startswith('Turned sleeve cuff') and r['parts'][1]=='One sewn breast pocket' else
                               1 if r['parts'][1]=='One sewn breast pocket' else 2 if r['parts'][0].startswith('Turned sleeve cuff') else 3)
            row=min(rows,key=priority)
            owners=retained.torso.surfaces(bodies)
            material,normal,target,predictor=separating_target(owners[domain.seat],row,evaluator.classifier,current_arrays)
            projected=lambda q:float(np.min(domain.points(domain.construct(q),material)@normal))
            model=linearize(domain.q,domain.bounded,projected)
            gap=max(0.,target-model['value']);gradient=model['gradient'];derivatives=model['derivatives']
            norm=float(np.linalg.norm(gradient))
            if norm<1e-10 or gap<=1e-8:report['stop_reason']='Measured limiting region has no useful coupled separating derivative';break
            delta=gradient*(gap+1e-6)/(norm*norm)
            if np.linalg.norm(delta)>trust:delta*=trust/np.linalg.norm(delta)
            update=dict(index=updates,seat=domain.seat,side=domain.side,predictor=predictor,computed_gap=gap,
                        derivatives=derivatives,derivative_rank=model['rank'],reference_entry_move=model['entry_move'],
                        model_reference=model['reference'].tolist(),trust_radius=trust,delta=delta.tolist(),before_residual=merit(current,*pair),trials=[])
            report['updates'].append(update);updates+=1;improved=False
            for backtrack in range(3):
                proposed=domain.bounded(model['reference']+delta*(.5**backtrack))
                if np.linalg.norm(proposed-domain.q)<1e-8:continue
                try:solution=domain.construct(proposed)
                except ValueError as error:update['trials'].append(dict(backtrack=backtrack,construction_error=str(error)));continue
                result,arrays,frames=evaluate(domain,solution,update['index'],backtrack)
                new_hard=[r for r in result['failures'] if key(r) not in bad_keys]
                after=merit(result,*pair);meaningful=after<=update['before_residual']*.99
                signature=tuple(sorted(str(key(r)) for r in new_hard))
                if new_hard and signature==last_hard:streak+=1
                elif new_hard:streak=1;last_hard=signature
                else:streak=0;last_hard=None
                update['trials'].append(dict(candidate=result['index'],active_residual=after,new_hard_failures=[key(r) for r in new_hard],meaningful=meaningful))
                if result['valid'] or (not new_hard and meaningful):
                    current,current_arrays,current_frames=result,arrays,frames;domain.q=solution['q'];bad_keys={key(r) for r in current['failures']}
                    improved=True;no_progress=0;trust=min(.25,trust*1.25);update['accepted_as_search_state']=result['index'];save();break
                for rig,frame in zip(rigs,current_frames):retained.apply_frames(rig,frame)
                if streak>=3:report['stop_reason']='Three trials hit the same new hard failure; fresh approach review required';break
            if streak>=3:break
            if not improved:
                no_progress+=1;trust*=.5
                if no_progress>=2:report['stop_reason']='Two adaptive updates failed the 1 percent improvement and no-new-hard-failure rule';break
            save()
        if current['valid']:
            report['state']='phase_zero_survivor';report['acceptance']=True
        elif report['state']=='running':report['state']='bounded_domain_stopped'
        report['selected']=current
        report['selected_frames']=[{n:m.tolist() for n,m in frame.items()} for frame in current_frames]
        report.setdefault('stop_reason','First complete phase-zero survivor' if current['valid'] else 'Declared evaluation or wall budget reached')
        np.savez(output/'selected-geometry.npz',**current_arrays)
        report['selected_geometry_sha256']=digest(output/'selected-geometry.npz')
    except BaseException as error:
        report['state']='budget_exhausted' if isinstance(error,TimeoutError) else 'failed';report['error']=repr(error)
        if 'current' in locals():
            report['selected']=current
            report['selected_frames']=[{n:m.tolist() for n,m in frame.items()} for frame in current_frames]
            np.savez(output/'selected-geometry.npz',**current_arrays)
            report['selected_geometry_sha256']=digest(output/'selected-geometry.npz')
        raise
    finally:
        report['inputs_unchanged']=all(digest(path)==sha for path,sha in inputs.items());save()
        print(json.dumps(dict(event='complete',pid=os.getpid(),state=report['state'],evaluations=report['candidate_evaluations'],inputs_unchanged=report['inputs_unchanged'],elapsed_seconds=report['elapsed_seconds'])),flush=True)

if __name__=='__main__':run(*(Path(p).resolve() for p in sys.argv[sys.argv.index('--')+1:]))
