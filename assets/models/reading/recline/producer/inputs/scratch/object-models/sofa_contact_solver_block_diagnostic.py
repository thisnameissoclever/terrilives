"""Bounded two-arm causal diagnostic: common reference, probes, isolated/joint steps."""
import os
os.environ['OPENBLAS_NUM_THREADS']='2'
os.environ['OMP_NUM_THREADS']='2'
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import numpy as np
import bpy

sys.path.insert(0,str(Path(__file__).parent))
from sofa_contact_solver_scene_v2 import SceneEvaluatorV2,retained,surface_data
from sofa_contact_solver_domain_v2 import ArmDomain
from sofa_contact_solver_adaptive import difference
from sofa_contact_solver_block import ACTIVE,belongs,affected,row_key,own_features,neighbor_features,feature_values,summaries,joint_step,nonworsening
from sofa_contact_solver_block_guards import nearby_features
from classify_sofa_lap_contacts import source_map

MAX_EVALUATIONS=18
MAX_SECONDS=1200
WORK_SECONDS=1170
EPSILON=.01
TRUST=.025


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def scalar_guards(result,arrays,prefix,audit,bone_names):
    values=[];features=[]
    for seat,side in ACTIVE:
        support=next(row for row in result['rows'] if row['kind']=='support' and row.get('seat')==seat and row.get('side')==side)
        values.append(math.sqrt(max(0.,support['projected_area']))-math.sqrt(1e-10))
        features.append(dict(group=f'support/{seat}/{side}',kind='finite support guard'))
        matrices=arrays[f'{prefix}/{seat}/bone_matrices']
        shoulder=matrices[bone_names.index('upper_arm.'+side),:3,3];wrist=matrices[bone_names.index('hand.'+side),:3,3]
        distance=float(np.linalg.norm(wrist-shoulder))
        a,b=[audit['rest_bones'][part+'.'+side]['length'] for part in ('upper_arm','forearm')]
        values.extend([a+b-distance,distance-abs(a-b)])
        features.extend([dict(group=f'reach/{seat}/{side}/maximum',kind='reach guard'),dict(group=f'reach/{seat}/{side}/minimum',kind='reach guard')])
    return np.asarray(values),features


def failure_key(row):
    return (row['kind'],str(row.get('seat',row.get('seats',''))),tuple(row.get('parts',())),row.get('part',''),row.get('side',''))


def changes(before,after):
    old={row_key(row):row for row in before['rows'] if row['kind']=='arm_body' and not row['valid']}
    new={row_key(row):row for row in after['rows'] if row['kind']=='arm_body' and not row['valid']}
    rows=[]
    for key,row in old.items():
        prior=float(row.get('residual',1.));current=float(new.get(key,{}).get('residual',0.))
        rows.append(dict(constraint=key,before_segment_length_proxy=prior,after_segment_length_proxy=current,
                         worsened=current>prior+.001,affected_by_block=affected(row)))
    return rows


def run(root,output):
    if not bpy.app.background:raise ValueError('Background Blender required')
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic()
    prior=json.loads((root/'sofa-contact-solver-fit-02/proof.json').read_text())
    pure=json.loads((root/'sofa-contact-solver-block-controls-01/proof.json').read_text())
    if not pure['passed']:raise ValueError('Block controls must pass')
    inputs=dict(prior['inputs']);inputs.update(pure['inputs'])
    for path,sha in inputs.items():
        if digest(path)!=sha:raise ValueError('Immutable dependency changed: '+path)
    for path in [Path(__file__),root/'sofa_contact_solver_block_guards.py',root/'sofa-contact-solver-block-controls-01/proof.json',
                 root/'sofa-contact-solver-fit-02/proof.json',root/'sofa-contact-solver-fit-02/selected-geometry.npz',
                 root/'sofa-coupling-better-way-review.md']:
        inputs[str(path.resolve())]=digest(path)
    report=dict(state='running',pid=os.getpid(),inputs=inputs,limits=dict(complete_evaluations=18,seconds=1200,threads=2),
                evaluations=[],comparisons=[],probes=[],acceptance=False,
                scope='Two-arm local causal comparison; neither probes nor partial improvement accept an invalid pose',
                remaining=['Complete sitting pose','Canonical reading and mixed actions','All shared phases','Opposing views and owner review'])
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        binding=json.loads((root/'sofa-derived-binding-03/proof.json').read_text())
        hands=json.loads((root/'sofa-hand-support-01/proof.json').read_text())
        coherent=json.loads((root/'sofa-coherent-arms-02/proof.json').read_text())
        rigs,bodies,furniture,origins=retained.shared.load_scene(root/'sofa-derived-binding-03',binding)
        retained.shared.pose(rigs,origins,'sit',0.)
        checkpoint=[{name:np.asarray(value) for name,value in frame.items()} for frame in prior['selected_frames']]
        for rig,frames in zip(rigs,checkpoint):retained.apply_frames(rig,frames)
        owners=retained.torso.surfaces(bodies)
        evaluator=SceneEvaluatorV2(root,rigs,bodies,furniture,hands,[{n:surface_data(s) for n,s in owner.items()} for owner in owners])
        def domains_for_current():
            owners=retained.torso.surfaces(bodies);domains=[]
            for seat,side in ACTIVE:
                data=next(row['inputs'] for row in coherent['frames'] if row['seat']==seat and row['side']==side)
                measurement=next(row['measurement'] for row in hands['hands'] if row['seat']==seat and row['side']==side)
                domains.append(ArmDomain(seat,side,rigs[seat],data,owners[seat],evaluator.classifier,measurement))
            return domains
        domains=domains_for_current()
        report['checkpoint_reconstruction']=[dict(seat=d.seat,side=d.side,errors=d.reference_errors,new_reference_required=d.needs_reference) for d in domains]
        report['common_reference_is_new']=any(d.needs_reference for d in domains)
        q0=np.concatenate([d.q for d in domains])
        def construct(q,base):
            frames=[dict(frame) for frame in base];bounded=[]
            for d,part in zip(domains,np.asarray(q).reshape(2,7)):
                solution=d.construct(part);frames[d.seat].update(solution['frames']);bounded.extend(solution['q'])
            return frames,np.asarray(bounded)
        frame0,q0=construct(q0,checkpoint)
        effective_limit=MAX_EVALUATIONS;costs=[]
        def evaluate(label,frames,parameters):
            nonlocal effective_limit
            if len(report['evaluations'])>=effective_limit or time.monotonic()-began>=WORK_SECONDS:raise TimeoutError('Declared block diagnostic budget exhausted')
            report['pending']=dict(label=label,parameters=np.asarray(parameters).tolist(),frames=[{n:m.tolist() for n,m in f.items()} for f in frames]);save()
            started=time.monotonic();error=0.
            for rig,frame in zip(rigs,frames):error=max(error,retained.apply_frames(rig,frame))
            arrays={};result=evaluator.evaluate(arrays,'scene',error,began+WORK_SECONDS)
            for name,solid in evaluator.solids.items():retained.shared.cache_surface(arrays,'scene/furniture/'+name,solid)
            elapsed=time.monotonic()-started;costs.append(elapsed)
            index=len(report['evaluations']);file=f'scene-{index:02d}.npz';np.savez(output/file,**arrays)
            row=dict(index=index,label=label,parameters=np.asarray(parameters).tolist(),elapsed_seconds=elapsed,cache=file,cache_sha256=digest(output/file),
                     frames=[{n:m.tolist() for n,m in f.items()} for f in frames],**result)
            report['evaluations'].append(row);report.pop('pending',None)
            if len(costs)==2:
                planning=max(costs)*1.1
                effective_limit=min(MAX_EVALUATIONS,2+max(0,int((WORK_SECONDS-(time.monotonic()-began))/planning)))
                report['cost_calibration']=dict(seconds=costs.copy(),planning_seconds=planning,effective_evaluation_limit=effective_limit)
            save();print(json.dumps(dict(event='evaluation',label=label,index=index,seconds=elapsed,valid=result['valid'],failures=len(result['failures']))),flush=True)
            return row,arrays
        common,reference=evaluate('common reference',frame0,q0)
        previous={failure_key(row) for row in prior['selected']['failures']}
        new=[row for row in common['failures'] if failure_key(row) not in previous]
        report['common_reference_constraint_changes']=changes(prior['selected'],common)
        if new:
            report['new_reference_failures']=new;report['state']='stopped_new_reference';return
        if common['valid']:
            report['state']='phase_zero_survivor';report['acceptance']=True;report['survivor']=common;return
        domains=domains_for_current();q0=np.concatenate([d.q for d in domains])
        if any(d.needs_reference for d in domains):raise ValueError('Common reference is not stable in the two-arm frame chart')
        # This check distinguishes an admissible chart from a different baseline.
        common_owners=retained.torso.surfaces(bodies)
        report['common_chart_errors']=[dict(seat=d.seat,side=d.side,errors=d.reference_errors) for d in domains]
        moves=[];probe_results=[];maximum_displacements=[];observed=[]
        for coordinate in range(14):
            if len(report['evaluations'])+3>=effective_limit:
                report['stop_reason']='Insufficient measured budget for remaining probes and all three comparisons';break
            chosen=None;construction_errors=[]
            for sign in (1.,-1.):
                q=q0.copy();q[coordinate]+=sign*EPSILON
                try:frames,bounded=construct(q,frame0)
                except ValueError as error:construction_errors.append(str(error));continue
                move=np.concatenate([difference(bounded[i:i+7],q0[i:i+7]) for i in (0,7)])
                if np.linalg.norm(move)>1e-10:chosen=(frames,bounded,move);break
            if chosen is None:
                report['probes'].append(dict(coordinate=coordinate,unavailable=True,construction_errors=construction_errors));continue
            frames,bounded,move=chosen
            row,arrays=evaluate(f'coordinate {coordinate}',frames,bounded)
            max_move=max(float(np.linalg.norm(arrays[f'scene/{seat}/{name}/points']-reference[f'scene/{seat}/{name}/points'],axis=1).max())
                         for seat,side in ACTIVE for name in common_owners[seat] if belongs(name,side))
            maximum_displacements.append(max_move/np.linalg.norm(move));moves.append(move);probe_results.append(row);observed.append(coordinate)
            report['probes'].append(dict(coordinate=coordinate,evaluation=row['index'],actual_move=move.tolist(),maximum_material_displacement=max_move,construction_errors=construction_errors));save()
            if row['valid']:
                report['state']='phase_zero_survivor';report['acceptance']=True;report['survivor']=row;return
        if not moves:report['state']='no_admissible_probes';return
        # Restore the common reference before deriving any local feature.
        for rig,frame in zip(rigs,frame0):retained.apply_frames(rig,frame)
        own,coverage=own_features(common,reference,'scene',evaluator.classifier.neutral)
        failed=[(str(i),np.load(root/f'sofa-contact-solver-fit-02/candidate-{i:03d}.npz')) for i in (3,4,5)]
        maps={label:[source_map(name,cache[f'candidate/{seat}/{name}/triangles'],evaluator.classifier.topology)
                    for seat,name in [(0,'Relaxed shirt sleeve'),(1,'Relaxed shirt sleeve.001')]] for label,cache in failed}
        neighbor=neighbor_features(reference,'scene',failed,maps)
        radius=max(.01,TRUST*float(np.linalg.norm(maximum_displacements))*1.1)
        near,near_coverage=nearby_features(common_owners,evaluator.solids,common,evaluator.classifier,radius)
        unresolved_near=[row for row in near_coverage if 'unresolved_reference_proximity' in row]
        if unresolved_near:
            report['state']='unresolved_local_guards';report['unresolved_nearby']=unresolved_near
            report['stop_reason']='A nearby reference feature has no resolved separation normal';return
        materials=own+neighbor+near
        scalar0,scalar_features=scalar_guards(common,reference,'scene',evaluator.classifier.audit,hands['bone_names'])
        features=materials+scalar_features
        v0=np.r_[feature_values(materials,reference,'scene'),scalar0]
        responses=[];feature_arrays=dict(reference=v0,moves=np.asarray(moves))
        for row in probe_results:
            with np.load(output/row['cache']) as archive:arrays={k:archive[k] for k in archive.files}
            scalar,_=scalar_guards(row,arrays,'scene',evaluator.classifier.audit,hands['bone_names'])
            values=np.r_[feature_values(materials,arrays,'scene'),scalar]
            responses.append(values-v0);feature_arrays[f'probe_{row["index"]}']=values
        jacobian=np.linalg.lstsq(np.asarray(moves),np.asarray(responses),rcond=None)[0].T
        target='arm_body/0/Relaxed shirt sleeve/One sewn breast pocket'
        if not any(row['group']==target for row in own):target=own[0]['group']
        lower=np.full(14,-TRUST);upper=np.full(14,TRUST)
        for coordinate in set(range(14))-set(observed):lower[coordinate]=upper[coordinate]=0.
        for block in range(2):
            for coordinate in (0,1,3,4):
                index=block*7+coordinate;lower[index]=max(lower[index],-1-q0[index]);upper[index]=min(upper[index],1-q0[index])
        proposal=joint_step(features,v0,jacobian,target,lower,upper)
        if proposal['found'] and np.linalg.norm(proposal['step'])>TRUST:
            factor=TRUST/np.linalg.norm(proposal['step']);proposal['step']*=factor;proposal['fraction']*=factor;proposal['predicted']=v0+jacobian@proposal['step']
            if proposal['fraction']<.01:proposal['found']=False;proposal['reason']='Trust-ball bound leaves less than one percent predicted improvement'
        if proposal['found'] and np.linalg.norm(proposal['step'])<1e-10:
            proposal['found']=False;proposal['reason']='Local model produced no material parameter change'
        feature_arrays['jacobian']=jacobian
        np.savez(output/'local-model.npz',**feature_arrays)
        report['model']=dict(features=features,own_coverage=coverage,nearby_coverage=near_coverage,nearby_radius=radius,
                            reference=summaries(features,v0),target=target,trust_radius=TRUST,
                            proposal={k:(v.tolist() if isinstance(v,np.ndarray) else v) for k,v in proposal.items()},
                            note='Oriented local surface-side separation is a predictor, not closed-shirt containment or complete acceptance')
        save()
        if not proposal['found']:
            report['state']='no_useful_local_step';return
        before_keys={failure_key(row) for row in common['failures']}
        for label,mask in [('left alone',np.r_[np.ones(7),np.zeros(7)]),('center right alone',np.r_[np.zeros(7),np.ones(7)]),('joint',np.ones(14))]:
            q=q0+proposal['step']*mask
            try:frames,bounded=construct(q,frame0)
            except ValueError as error:
                report['comparisons'].append(dict(label=label,construction_error=str(error)));continue
            move=np.concatenate([difference(bounded[i:i+7],q0[i:i+7]) for i in (0,7)])
            row,arrays=evaluate(label,frames,bounded)
            scalar,_=scalar_guards(row,arrays,'scene',evaluator.classifier.audit,hands['bone_names'])
            actual=np.r_[feature_values(materials,arrays,'scene'),scalar];predicted=v0+jacobian@move
            constraints=changes(common,row);guard=nonworsening(features,v0,actual);predicted_guard=nonworsening(features,v0,predicted)
            new_hard=[failure for failure in row['failures'] if failure_key(failure) not in before_keys]
            reference_summary=summaries(features,v0);actual_summary=summaries(features,actual)
            initial_violation=reference_summary[target]['maximum_local_violation']
            target_improvement=initial_violation-actual_summary[target]['maximum_local_violation']>=max(1e-6,.01*initial_violation)
            accepted_progress=guard['valid'] and not new_hard and not any(x['worsened'] for x in constraints) and target_improvement
            record=dict(label=label,evaluation=row['index'],predicted=summaries(features,predicted),measured=actual_summary,
                        maximum_feature_prediction_error=float(np.abs(actual-predicted).max()),per_constraint=constraints,
                        source_feature_nonworsening=guard,predicted_nonworsening=predicted_guard,new_hard_failures=new_hard,
                        targeted_geometry_improved=target_improvement,useful_nonworsening_progress=accepted_progress,whole_scene_valid=row['valid'])
            report['comparisons'].append(record);np.savez(output/f'comparison-{row["index"]:02d}.npz',reference=v0,predicted=predicted,actual=actual,actual_move=move);save()
            if row['valid']:
                report['state']='phase_zero_survivor';report['acceptance']=True;report['survivor']=row;return
            if label=='joint' and predicted_guard['valid'] and (not guard['valid'] or new_hard or any(x['worsened'] for x in constraints)):
                report['state']='local_model_mismatch';report['stop_reason']='Joint prediction contradicted actual source features or a per-constraint/full-scene gate';return
        report['state']='diagnostic_complete'
    except BaseException as error:
        report['state']='budget_exhausted' if isinstance(error,TimeoutError) else 'failed';report['error']=repr(error);raise
    finally:
        report['inputs_unchanged']=all(digest(path)==sha for path,sha in inputs.items());save()
        print(json.dumps(dict(event='complete',pid=os.getpid(),state=report['state'],evaluations=len(report['evaluations']),elapsed_seconds=report['elapsed_seconds'],inputs_unchanged=report['inputs_unchanged'])),flush=True)

if __name__=='__main__':run(*(Path(p).resolve() for p in sys.argv[sys.argv.index('--')+1:]))
