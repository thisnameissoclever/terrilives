"""Cached whole-sleeve motion enclosure and moving-feature coverage controls."""
import hashlib,json,time
from pathlib import Path
import numpy as np
from sofa_contact_solver_patch_guard_v2 import MODEL_EPS,FRAME_EPS,recover_motion,predict,polygons,potential_pairs,separating_plane,polygon_gap,certifies
from diagnose_sofa_hand_frames import triangle_parents

root=Path(__file__).parent;directory=root/'sofa-contact-solver-block-diagnostic-01'
output=root/'sofa-contact-solver-patch-guard-controls-02';output.mkdir(exist_ok=False);began=time.monotonic()
receipt=json.loads((directory/'proof.json').read_text())
audit=json.loads((root/'sofa-binding-audit-01/proof.json').read_text());topology=np.load(root/'sofa-binding-audit-01/source-binding.npz')
names=json.loads((root/'sofa-hand-support-01/proof.json').read_text())['bone_names']
discovery_paths=[Path(__file__),root/'sofa_contact_solver_patch_guard_v2.py',root/'diagnose_sofa_hand_frames.py',
                 root/'sofa-binding-audit-01/proof.json',root/'sofa-binding-audit-01/source-binding.npz',root/'sofa-hand-support-01/proof.json']
discovery_paths += [directory/f'scene-{i:02d}.npz' for i in range(15)]
validation_paths=[directory/f'scene-{i:02d}.npz' for i in (15,16,17)]+[directory/'comparison-17.npz',directory/'proof.json']
hashes=lambda paths:{str(p.resolve()):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
discovery_inputs=hashes(discovery_paths);validation_inputs=hashes(validation_paths)
models=[];faces=[];reports=[];arrays={};source_settings=[]
for seat,side,name in [(0,'L','Relaxed shirt sleeve'),(1,'R','Relaxed shirt sleeve.001')]:
    saved=audit['saved_objects'][name];mods=saved['modifiers']
    assert [m['type'] for m in mods]==['ARMATURE','SUBSURF']
    assert not mods[0]['properties']['use_deform_preserve_volume'] and mods[0]['properties']['use_vertex_groups']
    assert not mods[0]['properties']['use_bone_envelopes']
    assert mods[1]['properties']['subdivision_type']=='CATMULL_CLARK' and mods[1]['properties']['levels']==2
    assert set(saved['groups'])=={'upper_arm.'+side,'spine'}
    weights=topology[name+'/weights'];assert weights.min()>=0 and weights.max()<=1 and np.max(np.abs(weights.sum(1)-1))<1e-6
    source_settings.append(dict(seat=seat,name=name,groups=saved['groups'],modifier_order=[m['type'] for m in mods],
        preserve_volume=False,subdivision='CATMULL_CLARK',levels=2,limit_surface=mods[1]['properties']['use_limit_surface'],
        note='Fixed topology and crease data; relative affine motion only, no independent homogeneous weights recovered'))
    points=[];frames=[];spines=[]
    for i in range(15):
        with np.load(directory/f'scene-{i:02d}.npz') as cache:
            world=cache[f'scene/{seat}/rig_matrix_world'];bones=cache[f'scene/{seat}/bone_matrices']
            frames.append(world@bones[names.index('upper_arm.'+side)])
            spines.append(world@bones[names.index('spine')])
            points.append(cache[f'scene/{seat}/{name}/points'])
    spine_error=max(float(np.abs(m-spines[0]).max()) for m in spines)
    assert spine_error<1e-8
    model=recover_motion(points[0],frames[0],frames[1:],points[1:]);models.append(model)
    face=polygons(topology,name);faces.append(face)
    if max(map(len,face))>4:raise ValueError('Unexpected evaluated polygon arity')
    reports.append(dict(seat=seat,side=side,name=name,vertices=len(points[0]),polygons=len(face),rank=model['rank'],
        singular_values=model['singular_values'].tolist(),training_max_error=model['training_max'],leave_one_out_max_error=model['leave_one_out_max'],
        leave_one_out_ranks=model['leave_one_out_ranks'],leave_one_out_controls=model['leave_one_out_controls'],spine_error=spine_error,upper_origin_error=model['upper_origin_error'],
        operator_norm_cap=model['operator_cap'],coefficient_uncertainty_bound=model['coefficient_uncertainty'],
        displacement_radius_range=[float(model['displacement_radius'].min()),float(model['displacement_radius'].max())],
        error_reserve_range=[float(model['error_reserve'].min()),float(model['error_reserve'].max())]))
    for field in ('moving','reference','reference_frame','displacement_radius','error_reserve'):arrays[f'{seat}/{field}']=model[field]
# Discovery consumes complete sleeve polygons and probe-derived FRAME caps.
# Neither the held-out crossing list nor its material-pair identities selects pairs.
pairs=potential_pairs(*models,*faces,maximum=50000)
planes=[];gaps=[];reserves=[];nonseparable=[]
for index,(ai,bi) in enumerate(pairs):
    if time.monotonic()-began>45:raise RuntimeError('Declared cached proof time budget exhausted')
    av,bv=faces[0][ai],faces[1][bi]
    normal,gap=separating_plane(models[0]['reference'][av],models[1]['reference'][bv])
    reserve=float(models[0]['error_reserve'][av].max()+models[1]['error_reserve'][bv].max()+MODEL_EPS)
    planes.append(normal);gaps.append(gap);reserves.append(reserve)
    if gap<=0:nonseparable.append([ai,bi,gap])
arrays['polygon_pairs']=np.asarray(pairs,dtype=np.int32);arrays['planes']=np.asarray(planes);arrays['reference_gaps']=np.asarray(gaps);arrays['pair_reserves']=np.asarray(reserves)
pair_index={pair:i for i,pair in enumerate(pairs)}
heldout=[];joint_actual=None;joint_predicted=None
for evaluation in (15,16,17):
    actual=[];predicted=[];rows=[]
    with np.load(directory/f'scene-{evaluation:02d}.npz') as cache:
        for model,(seat,side,name) in zip(models,[(0,'L','Relaxed shirt sleeve'),(1,'R','Relaxed shirt sleeve.001')]):
            world=cache[f'scene/{seat}/rig_matrix_world'];bones=cache[f'scene/{seat}/bone_matrices']
            frame=world@bones[names.index('upper_arm.'+side)];prediction,inside=predict(model,frame)
            point=cache[f'scene/{seat}/{name}/points'];error=np.linalg.norm(prediction-point,axis=1)
            enclosed=bool(np.all(np.linalg.norm(point-model['reference'],axis=1)<=model['displacement_radius']))
            change=frame[:3,:3]@np.linalg.inv(model['reference_frame'][:3,:3])-np.eye(3)
            prediction_bound=2*MODEL_EPS+float(np.linalg.norm(change,2))*model['coefficient_uncertainty']
            assert inside and enclosed and error.max()<=prediction_bound
            rows.append(dict(seat=seat,side=side,in_frame_domain=inside,in_swept_enclosure=enclosed,maximum_prediction_error=float(error.max()),prediction_error_bound=prediction_bound))
            actual.append(point);predicted.append(prediction)
        predicted_gaps=np.asarray([polygon_gap(predicted[0][faces[0][a]],predicted[1][faces[1][b]],normal) for (a,b),normal in zip(pairs,planes)])
        actual_gaps=np.asarray([polygon_gap(actual[0][faces[0][a]],actual[1][faces[1][b]],normal) for (a,b),normal in zip(pairs,planes)])
        arrays[f'heldout/{evaluation}/predicted_gaps']=predicted_gaps;arrays[f'heldout/{evaluation}/actual_gaps']=actual_gaps
        heldout.append(dict(evaluation=evaluation,rows=rows,uncertified_polygon_pairs=int(np.sum(predicted_gaps<=reserves)),
                            maximum_gap_prediction_error=float(np.max(np.abs(predicted_gaps-actual_gaps)))))
        if evaluation==17:
            triangles=[cache['scene/0/Relaxed shirt sleeve/triangles'],cache['scene/1/Relaxed shirt sleeve.001/triangles']]
            parents=[triangle_parents(tri,[f.tolist() for f in fs]) for tri,fs in zip(triangles,faces)]
            crossings=cache['scene/neighbor/0/1/Relaxed shirt sleeve/Relaxed shirt sleeve.001']
            missed=[];caught=[]
            for ai,bi in crossings:
                pair=(int(parents[0][ai]),int(parents[1][bi]));i=pair_index.get(pair)
                row=dict(triangles=[int(ai),int(bi)],evaluated_polygons=list(pair))
                if i is None:missed.append(row);continue
                row.update(predicted_gap=float(predicted_gaps[i]),actual_gap=float(actual_gaps[i]),error_reserve=reserves[i],
                           rejected_by_whole_polygon_guard=not certifies(predicted_gaps[i],reserves[i]))
                (caught if row['rejected_by_whole_polygon_guard'] else missed).append(row)
            assert len(caught)==20 and not missed
old=np.load(directory/'comparison-17.npz');neighbor_ids=[i for i,f in enumerate(receipt['model']['features']) if f['kind']=='neighbor guard']
old_clearance=float(old['actual'][neighbor_ids].min());minimum_reserve=float(min(reserves))
assert not certifies(old_clearance,minimum_reserve)
assert time.monotonic()-began<45
for path,sha in {**discovery_inputs,**validation_inputs}.items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha,path
np.savez(output/'whole-polygon-guards.npz',**arrays)
proof=dict(state='complete',passed=True,discovery_inputs=discovery_inputs,validation_inputs=validation_inputs,
    elapsed_seconds=time.monotonic()-began,source_settings=source_settings,motion_models=reports,
    discovery=dict(whole_sleeve_polygon_counts=[len(f) for f in faces],potential_pairs=len(pairs),maximum_pairs=50000,
                   heldout_crossings_used_for_selection=False,nonseparable_reference_polygons=nonseparable),
    heldout=heldout,caught_joint_crossings=caught,missed_joint_crossings=missed,
    error_control=dict(old_positive_point_clearance=old_clearance,minimum_whole_polygon_error_reserve=minimum_reserve,
                       below_error_reserve_rejected=True,calibration_displacement_residual_limit=MODEL_EPS,frame_replay_contract=FRAME_EPS),
    guards_ready=not nonseparable,initial_failed_gate_preserved='sofa-contact-solver-patch-guard-controls-01/affine-validation-failure.json',
    scope='Cached coverage and model-contract proof only; no new pose or geometry job',
    remaining_assumptions=['Future candidate must keep source topology, weights, modifier stack, spine and upper-arm origins fixed',
        'Constructed and actual upper-frame changes must stay inside the recorded operator-norm caps',
        'Calibration residual remains within one micrometre; every future actual mesh must satisfy the propagated prediction interval and swept enclosure',
        'Frame replay retains its existing 1e-5 gate; clearance must exceed the sum of both model/frame uncertainty reserves',
        'No independent homogeneous weights were identified; only relative moving components have rank-three identification',
        'Every proposed result still requires the unmodified complete scene gate; no cached control accepts a new pose'],
    cache_sha256=hashlib.sha256((output/'whole-polygon-guards.npz').read_bytes()).hexdigest())
(output/'proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({k:v for k,v in proof.items() if k not in ['discovery_inputs','validation_inputs','caught_joint_crossings','remaining_assumptions']}))
