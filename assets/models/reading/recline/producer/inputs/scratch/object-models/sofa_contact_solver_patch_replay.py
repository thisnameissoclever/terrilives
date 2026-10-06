"""Four frozen physical replays with actual-query whole-polygon guard checks."""
import os
os.environ['OPENBLAS_NUM_THREADS']='2'
os.environ['OMP_NUM_THREADS']='2'
import copy,hashlib,json,time
from pathlib import Path
import sys
import numpy as np
import bpy

sys.path.insert(0,str(Path(__file__).parent))
from sofa_contact_solver_scene_v2 import SceneEvaluatorV2,retained,surface_data
from sofa_contact_solver_patch_guard_v2 import MODEL_EPS,predict,polygons,polygon_gap


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def failure_key(row):
    return (row['kind'],str(row.get('seat',row.get('seats',''))),tuple(row.get('parts',[])),row.get('part',''),row.get('side',''))


def class_key(row):return (row.get('seat'),tuple(row.get('parts',[])))


def class_changes(before,after):
    old={class_key(r):r for r in before['rows'] if r['kind']=='arm_body' and not r['valid']}
    new={class_key(r):r for r in after['rows'] if r['kind']=='arm_body' and not r['valid']}
    return [dict(seat=k[0],parts=list(k[1]),before=float(r['residual']),after=float(new.get(k,{}).get('residual',0.)),
                 worsened=float(new.get(k,{}).get('residual',0.))>float(r['residual'])+.001) for k,r in old.items()]


def run(root,output):
    if not bpy.app.background:raise ValueError('Background Blender required')
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic()
    directory=root/'sofa-contact-solver-block-diagnostic-01';guard_dir=root/'sofa-contact-solver-patch-guard-controls-02'
    old=json.loads((directory/'proof.json').read_text());guard=json.loads((guard_dir/'proof.json').read_text())
    proposal=json.loads((root/'sofa-contact-solver-patch-proposal-constructed-01/proof.json').read_text())
    inputs=dict(old['inputs']);inputs.update(guard['discovery_inputs']);inputs.update(guard['validation_inputs']);inputs.update(proposal['inputs'])
    for path,sha in inputs.items():
        if digest(path)!=sha:raise ValueError('Frozen input changed: '+path)
    for path in (Path(__file__),directory/'proof.json',directory/'scene-00.npz',guard_dir/'proof.json',guard_dir/'whole-polygon-guards.npz',root/'sofa-contact-solver-patch-proposal-constructed-01/proof.json'):
        inputs[str(path.resolve())]=digest(path)
    report=dict(state='running',pid=os.getpid(),blender_version=bpy.app.version_string,inputs=inputs,
                limits=dict(full_evaluations=4,seconds=240,threads=2),evaluations=[],acceptance=False,
                contract='Cap-wide conservative discovery; motion-specific identification/replay reserve at known query frames; empirical parameter-linearization margin is not acceptance evidence',
                remaining=['Complete sitting pose','Canonical reading and mixed actions','All phases and views','Owner visual review'])
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        binding=json.loads((root/'sofa-derived-binding-03/proof.json').read_text());hands=json.loads((root/'sofa-hand-support-01/proof.json').read_text())
        rigs,bodies,furniture,origins=retained.shared.load_scene(root/'sofa-derived-binding-03',binding)
        retained.shared.pose(rigs,origins,'sit',0.)
        common=[{name:np.asarray(value) for name,value in frame.items()} for frame in old['evaluations'][0]['frames']]
        for rig,frame in zip(rigs,common):retained.apply_frames(rig,frame)
        owners=retained.torso.surfaces(bodies)
        with np.load(directory/'scene-00.npz') as archive:reference={key:archive[key] for key in archive.files}
        baseline=[{name:dict(points=reference[f'scene/{seat}/{name}/points'],triangles=reference[f'scene/{seat}/{name}/triangles']) for name in owner} for seat,owner in enumerate(owners)]
        evaluator=SceneEvaluatorV2(root,rigs,bodies,furniture,hands,baseline)
        saved=np.load(guard_dir/'whole-polygon-guards.npz');models=[];faces=[];reference_spines=[]
        for index,(seat,side,name) in enumerate(((0,'L','Relaxed shirt sleeve'),(1,'R','Relaxed shirt sleeve.001'))):
            meta=guard['motion_models'][index]
            models.append(dict(reference=saved[f'{seat}/reference'],moving=saved[f'{seat}/moving'],reference_frame=saved[f'{seat}/reference_frame'],
                operator_cap=meta['operator_norm_cap'],coefficient_uncertainty=meta['coefficient_uncertainty_bound'],error_reserve=saved[f'{seat}/error_reserve'],
                displacement_radius=saved[f'{seat}/displacement_radius']))
            faces.append(polygons(evaluator.classifier.topology,name))
            reference_spines.append(reference[f'scene/{seat}/rig_matrix_world']@reference[f'scene/{seat}/bone_matrices'][hands['bone_names'].index('spine')])
        def model_checks(arrays,frames):
            predicted=[];actual=[];reserves=[];components=[]
            for model,reference_spine,(seat,side,name) in zip(models,reference_spines,((0,'L','Relaxed shirt sleeve'),(1,'R','Relaxed shirt sleeve.001'))):
                world=arrays[f'scene/{seat}/rig_matrix_world'];bones=arrays[f'scene/{seat}/bone_matrices']
                planned_frame=world@frames[seat]['upper_arm.'+side];actual_frame=world@bones[hands['bone_names'].index('upper_arm.'+side)]
                planned_points,planned_inside=predict(model,planned_frame);actual_model,actual_inside=predict(model,actual_frame)
                points=arrays[f'scene/{seat}/{name}/points'];inverse=np.linalg.inv(model['reference_frame'][:3,:3])
                planned_change=float(np.linalg.norm(planned_frame[:3,:3]@inverse-np.eye(3),2));actual_change=float(np.linalg.norm(actual_frame[:3,:3]@inverse-np.eye(3),2))
                known_change=max(planned_change,actual_change)
                fixed=model['error_reserve']-(2*MODEL_EPS+model['operator_cap']*model['coefficient_uncertainty'])
                reserve=2*MODEL_EPS+known_change*model['coefficient_uncertainty']+fixed
                query_bound=2*MODEL_EPS+actual_change*model['coefficient_uncertainty']
                actual_model_error=float(np.linalg.norm(actual_model-points,axis=1).max())
                planned_error=np.linalg.norm(planned_points-points,axis=1)
                enclosed=bool(np.all(np.linalg.norm(points-model['reference'],axis=1)<=model['displacement_radius']))
                spine_error=float(np.abs(world@bones[hands['bone_names'].index('spine')]-reference_spine).max())
                valid=planned_inside and actual_inside and enclosed and spine_error<1e-8 and actual_model_error<=query_bound and bool(np.all(planned_error<=reserve))
                components.append(dict(seat=seat,side=side,valid=valid,planned_operator_change=planned_change,actual_operator_change=actual_change,
                    operator_cap=model['operator_cap'],planned_in_frame_domain=planned_inside,actual_in_frame_domain=actual_inside,
                    actual_model_error=actual_model_error,query_prediction_bound=query_bound,maximum_planned_point_error=float(planned_error.max()),
                    minimum_identification_replay_reserve=float(reserve.min()),in_swept_enclosure=enclosed,spine_error=spine_error))
                predicted.append(planned_points);actual.append(points);reserves.append(reserve)
            predicted_gaps=np.asarray([polygon_gap(predicted[0][faces[0][a]],predicted[1][faces[1][b]],n) for (a,b),n in zip(saved['polygon_pairs'],saved['planes'])])
            actual_gaps=np.asarray([polygon_gap(actual[0][faces[0][a]],actual[1][faces[1][b]],n) for (a,b),n in zip(saved['polygon_pairs'],saved['planes'])])
            query_reserve=np.asarray([reserves[0][faces[0][a]].max()+reserves[1][faces[1][b]].max()+MODEL_EPS for a,b in saved['polygon_pairs']])
            arrays['guard/predicted_gaps']=predicted_gaps;arrays['guard/actual_gaps']=actual_gaps;arrays['guard/motion_specific_reserve']=query_reserve
            return dict(valid_model_contract=all(c['valid'] for c in components),components=components,
                motion_specific_forecast_valid=bool(np.all(predicted_gaps>query_reserve)),cap_wide_forecast_valid=bool(np.all(predicted_gaps>saved['pair_reserves'])),
                actual_whole_polygon_separation=bool(np.all(actual_gaps>0)),minimum_predicted_clearance=float(predicted_gaps.min()),
                minimum_actual_clearance=float(actual_gaps.min()),minimum_predicted_margin_over_motion_reserve=float(np.min(predicted_gaps-query_reserve)),
                minimum_actual_margin_over_motion_reserve=float(np.min(actual_gaps-query_reserve)),
                maximum_guard_distance_prediction_error=float(np.max(np.abs(predicted_gaps-actual_gaps))),
                failing_actual_polygon_pairs=[saved['polygon_pairs'][i].tolist() for i in np.flatnonzero(actual_gaps<=0)])
        def evaluate(label,frames):
            if len(report['evaluations'])>=4 or time.monotonic()-began>=220:raise TimeoutError('Declared physical comparison budget exhausted')
            started=time.monotonic();report['pending']=dict(label=label,frames=[{n:m.tolist() for n,m in f.items()} for f in frames]);save()
            error=0.
            for rig,frame in zip(rigs,frames):error=max(error,retained.apply_frames(rig,frame))
            arrays={};result=evaluator.evaluate(arrays,'scene',error,began+220)
            guards=model_checks(arrays,frames)
            file=f'scene-{len(report["evaluations"]):02d}.npz';np.savez(output/file,**arrays)
            row=dict(index=len(report['evaluations']),label=label,elapsed_seconds=time.monotonic()-started,guards=guards,
                     cache=file,cache_sha256=digest(output/file),frames=[{n:m.tolist() for n,m in f.items()} for f in frames],**result)
            report['evaluations'].append(row);report.pop('pending',None);save()
            print(json.dumps(dict(event='evaluation',label=label,seconds=row['elapsed_seconds'],full_gate_valid=row['valid'],failures=len(row['failures']),model_valid=guards['valid_model_contract'])),flush=True)
            return row
        baseline_result=evaluate('common reference',common)
        old_keys={failure_key(r) for r in old['evaluations'][0]['failures']}
        if any(failure_key(r) not in old_keys for r in baseline_result['failures']) or not baseline_result['guards']['valid_model_contract']:
            report['state']='stopped_changed_reference';return
        reference_keys={failure_key(r) for r in baseline_result['failures']}
        for comparison in proposal['comparisons']:
            frames=[dict(frame) for frame in common]
            for arm in comparison['frames']:
                frames[arm['seat']].update({name+'.'+arm['side']:np.asarray(matrix) for name,matrix in arm['targets'].items()})
            row=evaluate(comparison['label'],frames)
            row['per_class_changes']=class_changes(baseline_result,row)
            row['new_hard_failures']=[r for r in row['failures'] if failure_key(r) not in reference_keys]
            row['nonworsening_physical_progress']=not row['new_hard_failures'] and not any(r['worsened'] for r in row['per_class_changes']) and row['guards']['valid_model_contract'] and row['guards']['motion_specific_forecast_valid'] and row['guards']['actual_whole_polygon_separation']
            if row['valid']:
                report['state']='phase_zero_survivor';report['acceptance']=True;report['survivor']=row;save();return
            if not row['guards']['valid_model_contract']:
                report['state']='stopped_model_contract_failure';save();return
            save()
        report['state']='comparison_complete'
    except BaseException as error:
        report['state']='budget_exhausted' if isinstance(error,TimeoutError) else 'failed';report['error']=repr(error);raise
    finally:
        report['inputs_unchanged']=all(digest(path)==sha for path,sha in inputs.items());save()
        print(json.dumps(dict(event='complete',state=report['state'],evaluations=len(report['evaluations']),elapsed_seconds=report['elapsed_seconds'],inputs_unchanged=report['inputs_unchanged'])),flush=True)

if __name__=='__main__':run(*(Path(p).resolve() for p in sys.argv[sys.argv.index('--')+1:]))
