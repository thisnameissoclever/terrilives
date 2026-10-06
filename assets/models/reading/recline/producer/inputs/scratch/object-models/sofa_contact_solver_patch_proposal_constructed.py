"""Evaluate the in-ball gain proposal at actual constructed frames, without Blender."""
import hashlib,json,time
from pathlib import Path
import numpy as np
from sofa_contact_solver_saved_chart import SavedChart
from sofa_contact_solver_patch_guard_v2 import predict,polygons,polygon_gap,MODEL_EPS
from sofa_contact_solver_block import feature_values,summaries,nonworsening
from sofa_contact_solver_adaptive import difference
import continuous_support_patch as support_patch

root=Path(__file__).parent;directory=root/'sofa-contact-solver-block-diagnostic-01';guard_dir=root/'sofa-contact-solver-patch-guard-controls-02'
out=root/'sofa-contact-solver-patch-proposal-constructed-01';out.mkdir(exist_ok=False);began=time.monotonic()
receipt=json.loads((directory/'proof.json').read_text());guard=json.loads((guard_dir/'proof.json').read_text())
gain=json.loads((root/'sofa-contact-solver-patch-proposal-gain-01/proof.json').read_text());step=np.asarray(gain['parameters'])
with np.load(directory/'scene-00.npz') as cache:reference={k:cache[k] for k in cache.files}
rest=np.load(root/'sofa-derived-binding-03/normalized-rest.npz');topology=np.load(root/'sofa-binding-audit-01/source-binding.npz')
hands=json.loads((root/'sofa-hand-support-01/proof.json').read_text());coherent=json.loads((root/'sofa-coherent-arms-02/proof.json').read_text())
saved=np.load(guard_dir/'whole-polygon-guards.npz');old_local=np.load(directory/'local-model.npz');linear=np.load(root/'sofa-contact-solver-patch-proposal-01/proposal-system.npz')
charts=[];models=[];faces=[]
for index,(seat,side,name) in enumerate(((0,'L','Relaxed shirt sleeve'),(1,'R','Relaxed shirt sleeve.001'))):
    data=next(r['inputs'] for r in coherent['frames'] if r['seat']==seat and r['side']==side)
    measurement=next(r['measurement'] for r in hands['hands'] if r['seat']==seat and r['side']==side)
    charts.append(SavedChart(seat,side,data,reference,rest,hands['bone_names'],measurement))
    meta=guard['motion_models'][index]
    models.append(dict(reference=saved[f'{seat}/reference'],moving=saved[f'{seat}/moving'],reference_frame=saved[f'{seat}/reference_frame'],
        operator_cap=meta['operator_norm_cap'],coefficient_uncertainty=meta['coefficient_uncertainty_bound'],error_reserve=saved[f'{seat}/error_reserve']))
    faces.append(polygons(topology,name))
q0=np.concatenate([c.q for c in charts]);assert np.max(np.abs(q0-linear['reference_parameters']))<1e-8
old_features=receipt['model']['features'];own_ids=[i for i,f in enumerate(old_features) if f['kind']=='existing garment'];own=[old_features[i] for i in own_ids]
rows=[]
for label,mask in [('left alone',np.r_[np.ones(7),np.zeros(7)]),('center right alone',np.r_[np.zeros(7),np.ones(7)]),('joint',np.ones(14))]:
    q=q0+step*mask;solutions=[chart.construct(part) for chart,part in zip(charts,q.reshape(2,7))]
    exact=[];inside=[];specific_reserves=[];frame_rows=[];surrogate=dict(reference)
    for chart,model,solution in zip(charts,models,solutions):
        frame=solution['world_frames']['upper_arm'];point,valid=predict(model,frame);exact.append(point);inside.append(valid)
        operator=frame[:3,:3]@np.linalg.inv(model['reference_frame'][:3,:3])-np.eye(3);magnitude=float(np.linalg.norm(operator,2))
        fixed=model['error_reserve']-(2*MODEL_EPS+model['operator_cap']*model['coefficient_uncertainty'])
        specific_reserves.append(2*MODEL_EPS+magnitude*model['coefficient_uncertainty']+fixed)
        frame_rows.append(dict(seat=chart.seat,side=chart.side,actual_constructed_operator_change=magnitude,operator_cap=model['operator_cap'],in_frame_domain=valid))
        suffix='.001' if chart.side=='R' else ''
        surrogate[f'scene/{chart.seat}/Relaxed shirt sleeve{suffix}/points']=point
        delta=frame@np.linalg.inv(model['reference_frame']);key=f'scene/{chart.seat}/Turned sleeve cuff{suffix}/points';old=reference[key]
        surrogate[key]=old@delta[:3,:3].T+delta[:3,3]
    gaps=np.asarray([polygon_gap(exact[0][faces[0][a]],exact[1][faces[1][b]],n) for (a,b),n in zip(saved['polygon_pairs'],saved['planes'])])
    motion_reserve=np.asarray([specific_reserves[0][faces[0][a]].max()+specific_reserves[1][faces[1][b]].max()+MODEL_EPS for a,b in saved['polygon_pairs']])
    bad_cap=np.flatnonzero(gaps<=saved['pair_reserves']);bad_actual=np.flatnonzero(gaps<=motion_reserve)
    own_values=feature_values(own,surrogate,'scene');own_verdict=nonworsening(own,old_local['reference'][own_ids],own_values)
    before=summaries(own,old_local['reference'][own_ids]);after=summaries(own,own_values)
    # Measure the nonlinear constructed response against the LP's parameter
    # linearization separately from the identification/replay reserve.
    vertex_gaps=[]
    for (a,b),n in zip(saved['polygon_pairs'],saved['planes']):
        vertex_gaps.extend(float(n@(exact[0][av]-exact[1][bv])) for av in faces[0][a] for bv in faces[1][b])
    actual_move=np.concatenate([difference(s['parameters'],chart.q) for s,chart in zip(solutions,charts)])
    linear_gaps=linear['polygon_gap_reference']+linear['polygon_gap_jacobian']@actual_move
    parameter_error=np.abs(np.asarray(vertex_gaps)-linear_gaps)
    supports=[]
    for chart,solution in zip(charts,solutions):
        suffix='.001' if chart.side=='R' else '';name='Relaxed palm'+suffix
        bones=reference[f'scene/{chart.seat}/bone_matrices'];original=chart.world@bones[hands['bone_names'].index('hand.'+chart.side)]
        delta=solution['world_frames']['hand']@np.linalg.inv(original);points=reference[f'scene/{chart.seat}/{name}/points']
        points=points@delta[:3,:3].T+delta[:3,3]
        patch=support_patch.measure(points,reference[f'scene/{chart.seat}/{name}/triangles'],chart.support,chart.support_triangles,chart.normal,.0015)
        supports.append(dict(seat=chart.seat,side=chart.side,predicted_projected_area=patch['projected_area'],predicted_cells=patch['certified_cells'],exposure_requires_full_scene=True))
    rows.append(dict(label=label,frame_domains=frame_rows,parameter_norm=float(np.linalg.norm(actual_move)),
        cap_reserve_guard_valid=not len(bad_cap),actual_motion_reserve_guard_valid=not len(bad_actual),
        minimum_gap_above_cap_reserve=float(np.min(gaps-saved['pair_reserves'])),minimum_gap_above_actual_motion_reserve=float(np.min(gaps-motion_reserve)),
        failing_cap_guards=[dict(pair=int(i),polygons=saved['polygon_pairs'][i].tolist(),constructed_gap=float(gaps[i]),reserve=float(saved['pair_reserves'][i])) for i in bad_cap],
        own_body_nominal_nonworsening=own_verdict,own_before=before,own_after=after,predicted_support=supports,
        maximum_parameter_linearization_error=float(parameter_error.max()),planning_parameter_error_max=float(linear['parameter_linearization_reserve'].max()),
        parameter_linearization_exceeded_planning_rows=int(np.sum(parameter_error>linear['parameter_linearization_reserve']+1e-6)),
        frames=[dict(seat=c.seat,side=c.side,targets={n:m.tolist() for n,m in s['targets'].items()}) for c,s in zip(charts,solutions)],
        replay_required_for_each_garment_class_and_full_scene=True))
    np.savez(out/f'{label.replace(" ","-")}.npz',parameters=q,polygon_gaps=gaps,actual_motion_error_reserve=motion_reserve,own_values=own_values,parameter_linearization_error=parameter_error)
    assert time.monotonic()-began<60
joint=rows[-1]
ready=all(r['in_frame_domain'] for r in joint['frame_domains']) and joint['cap_reserve_guard_valid'] and joint['own_body_nominal_nonworsening']['valid']
paths=[Path(__file__),root/'sofa_contact_solver_saved_chart.py',root/'sofa-contact-solver-patch-proposal-gain-01/proof.json',root/'sofa-contact-solver-patch-proposal-01/proposal-system.npz',directory/'proof.json',directory/'scene-00.npz',guard_dir/'proof.json',guard_dir/'whole-polygon-guards.npz']
proof=dict(state='ready_for_physical_replay' if ready else 'constructed_proposal_rejected',acceptance=False,comparisons=rows,
    gain_fraction=gain['maximum_local_gain_fraction'],elapsed_seconds=time.monotonic()-began,
    inputs={str(p.resolve()):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
    scope='Cached constructed-frame checks; no Blender, no physical pose acceptance and no domain expansion')
(out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(dict(state=proof['state'],gain_fraction=proof['gain_fraction'],elapsed_seconds=proof['elapsed_seconds'],comparisons=[{k:r[k] for k in ['label','frame_domains','parameter_norm','cap_reserve_guard_valid','actual_motion_reserve_guard_valid','minimum_gap_above_cap_reserve','own_body_nominal_nonworsening','maximum_parameter_linearization_error','parameter_linearization_exceeded_planning_rows']} for r in rows])))
